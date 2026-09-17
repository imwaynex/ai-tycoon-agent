import { describe, expect, it } from 'vitest';
import {
  CONTRACT_STATUSES,
  REQUIRED_FIELDS,
  RESULT_STATUSES,
  TIME_WINDOWS,
  canTransition,
  createContract,
  missingFields,
  settlementGatePasses,
  type ExpeditionContract,
} from './contract';
import { interpretIntent } from './nl';
import { WOLF, skillKeysOk } from './profession';
import { runSim, simInputOf, verifyReplay } from './sim';
import {
  appoint,
  applyAdjustment,
  compositeOf,
  dispatch,
  initialState,
  load,
  proposeAdjustment,
  redispatch,
  setTimeWindow,
  STORAGE_KEY,
  save,
  settle,
  withdraw,
  type AppState,
  type KV,
} from './store';

const LOCK_32 = `contract_id, empire_id, agent_id, strategy_version, simulation_principal, currency, time_window_type, planned_duration, simulation_source, sim_engine_id, market_dataset_id, market_dataset_version, sim_run_id, status, created_at, dispatched_at, settled_at, battle_result_id, result_status, realized_pnl, return_pct, max_drawdown, trade_count, attribution_ref, constraint_snapshot, evidence_id, is_official, replay_ok, parallel_dispatch_allowed, cancel_supported, okx_dependency, real_funds`
  .split(',')
  .map((s) => s.trim());

const T0 = new Date('2026-09-17T12:00:00.000Z');
const at = (sec: number) => new Date(T0.getTime() + sec * 1000);

function memKV(): KV & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

/** 一趟完整出征：任命/再派 → 派出 → 歸來 */
function fullRaid(state: AppState, t: number): AppState {
  let s = state.current?.status === 'returned' ? redispatch(state, at(t)) : appoint(state, at(t));
  s = dispatch(s, at(t));
  return settle(s, at(t + 3));
}

/** 跑到出現指定結果為止 */
function raidUntil(pred: (c: ExpeditionContract) => boolean): AppState {
  let s = initialState();
  for (let i = 0; i < 200; i++) {
    s = fullRaid(s, i * 10);
    if (pred(s.current!)) return s;
  }
  throw new Error('not found');
}

describe('契約 32 必填欄位', () => {
  it('REQUIRED_FIELDS 與 lock-D11 名單完全一致（32 項、同名同序）', () => {
    expect(LOCK_32).toHaveLength(32);
    expect([...REQUIRED_FIELDS]).toEqual(LOCK_32);
  });

  it('新建契約含全部 32 欄位，且無多餘欄位', () => {
    const c = createContract(1, T0);
    expect(missingFields(c)).toEqual([]);
    expect(Object.keys(c).sort()).toEqual([...LOCK_32].sort());
  });

  it('結算後契約仍含全部 32 欄位，無多餘欄位', () => {
    const s = fullRaid(initialState(), 0);
    const c = s.current!;
    expect(missingFields(c)).toEqual([]);
    expect(Object.keys(c).sort()).toEqual([...LOCK_32].sort());
  });

  it('硬旗標與預設值', () => {
    const c = createContract(1, T0);
    expect(c.okx_dependency).toBe(false);
    expect(c.real_funds).toBe(false);
    expect(c.cancel_supported).toBe(true); // D18 覆寫 D11
    expect(c.parallel_dispatch_allowed).toBe(false);
    expect(c.empire_id).toBe('empire_demo_01');
    expect(c.agent_id).toBe('agent_wolf');
    expect(c.currency).toBe('sandbox_USD');
    expect(c.planned_duration).toBe(3);
    expect(c.simulation_source).toEqual({
      engine: 'sim_engine_local_v1',
      dataset: 'feed_mock_crypto_v1',
      dataset_version: '2026.09.17',
      run: c.sim_run_id,
    });
  });
});

describe('狀態機（lock-D11）', () => {
  it('枚舉恰為 ready / in_field / returned', () => {
    expect([...CONTRACT_STATUSES]).toEqual(['ready', 'in_field', 'returned']);
  });

  it('合法轉移只有 ready→in_field→returned', () => {
    const all = [...CONTRACT_STATUSES];
    const legal = all.flatMap((f) => all.filter((t) => canTransition(f, t)).map((t) => `${f}→${t}`));
    expect(legal).toEqual(['ready→in_field', 'in_field→returned']);
  });

  it('新建契約起始於 ready', () => {
    expect(createContract(1, T0).status).toBe('ready');
  });

  it('再派＝新契約（ready），舊 returned 契約不被改寫', () => {
    const s1 = fullRaid(initialState(), 0);
    const old = s1.current!;
    const s2 = redispatch(s1, at(10));
    expect(s2.current!.status).toBe('ready');
    expect(s2.current!.contract_id).not.toBe(old.contract_id);
    expect(s2.wall[0]).toBe(old);
    expect(s2.wall[0].status).toBe('returned');
  });

  it('舊存檔狀態名遷移：dispatched→in_field、settled→returned', () => {
    const kv = memKV();
    const s = fullRaid(initialState(), 0);
    const legacyWall = s.wall.map((w) => ({ ...w, status: 'settled' }));
    kv.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...s, wall: legacyWall, current: { ...legacyWall[0] } }),
    );
    const r = load(kv);
    expect(r.wall[0].status).toBe('returned');
    expect(r.current!.status).toBe('returned');
    const inField = dispatch(redispatch(s, at(10)), at(10));
    kv.setItem(STORAGE_KEY, JSON.stringify({ ...inField, current: { ...inField.current!, status: 'dispatched' } }));
    expect(load(kv).current!.status).toBe('in_field');
  });
});

describe('流程', () => {
  it('任命 → 派出 → 歸來：狀態依序 ready → in_field → returned', () => {
    let s = appoint(initialState(), T0);
    expect(s.current!.status).toBe('ready');
    s = dispatch(s, T0);
    expect(s.current!.status).toBe('in_field');
    expect(s.current!.dispatched_at).toBe(T0.toISOString());
    s = settle(s, at(3));
    expect(s.current!.status).toBe('returned');
    expect(RESULT_STATUSES).toContain(s.current!.result_status);
  });

  it('單線：出征中不可再派出／再派／撤回', () => {
    let s = dispatch(appoint(initialState(), T0), T0);
    expect(() => dispatch(s, T0)).toThrow();
    expect(() => redispatch(s, T0)).toThrow();
    expect(() => withdraw(s)).toThrow();
    s = settle(s, at(3));
    expect(() => settle(s, at(4))).toThrow();
  });
});

describe('戰績牆', () => {
  it('結算寫入牆，且牆上紀錄不可變', () => {
    const s = fullRaid(initialState(), 0);
    expect(s.wall).toHaveLength(1);
    expect(s.wall[0].contract_id).toBe(s.current!.contract_id);
    expect(s.wall[0].status).toBe('returned');
    expect(Object.isFrozen(s.wall)).toBe(true);
    expect(Object.isFrozen(s.wall[0])).toBe(true);
    expect(() => {
      (s.wall[0] as { realized_pnl: number | null }).realized_pnl = 999;
    }).toThrow();
  });

  it('失敗以 result_status 表示，且保留在牆上', () => {
    const s = raidUntil((c) => c.result_status !== 'completed');
    const failed = s.wall[s.wall.length - 1];
    expect(failed.result_status).toMatch(/^failed_/);
    expect(failed.status).toBe('returned');
    // 再跑幾趟，失敗那筆仍在原位
    let s2 = s;
    for (let i = 0; i < 3; i++) s2 = fullRaid(s2, 5000 + i * 10);
    expect(s2.wall).toContainEqual(failed);
    expect(s2.wall.length).toBe(s.wall.length + 3);
  });

  it('撤回停用配置，但不刪歷史', () => {
    let s = initialState();
    for (let i = 0; i < 4; i++) s = fullRaid(s, i * 10);
    const before = [...s.wall];
    s = withdraw(s);
    expect(s.config!.enabled).toBe(false);
    expect(s.wall).toEqual(before);
    expect(() => redispatch(s, at(100))).toThrow();
  });

  it('可派契約被撤回 → 狀態仍為 ready（不發明 lock 外狀態），配置停用、不可派、不入牆', () => {
    let s = fullRaid(initialState(), 0);
    s = redispatch(s, at(10));
    s = withdraw(s);
    expect(s.config!.enabled).toBe(false);
    expect(s.current!.status).toBe('ready');
    expect(s.wall).toHaveLength(1);
    expect(() => dispatch(s, at(11))).toThrow();
  });

  it('歸來後撤回：牆上契約仍為 returned', () => {
    let s = fullRaid(initialState(), 0);
    s = withdraw(s);
    expect(s.current!.status).toBe('returned');
    expect(s.wall.every((w) => w.status === 'returned')).toBe(true);
  });

  it('localStorage 持久化：存取後牆（含失敗）完整還原', () => {
    const kv = memKV();
    let s = raidUntil((c) => c.result_status !== 'completed');
    s = withdraw(s);
    save(s, kv);
    const restored = load(kv);
    expect(restored.wall).toEqual(s.wall);
    expect(restored.config!.enabled).toBe(false);
    expect(Object.isFrozen(restored.wall[0])).toBe(true);
  });
});

describe('重播（決定性種子 → replay_ok）', () => {
  it('同輸入兩次模擬結果完全相同', () => {
    const input = simInputOf(createContract(7, T0));
    expect(runSim(input)).toEqual(runSim(input));
  });

  it('不同 sim_run_id → 不同種子', () => {
    const a = runSim(simInputOf(createContract(1, T0)));
    const b = runSim(simInputOf(createContract(2, T0)));
    expect(a.seed).not.toBe(b.seed);
  });

  it('結算後 replay_ok=true；is_official 需 replay_ok 且過結算閘', () => {
    const s = fullRaid(initialState(), 0);
    const c = s.current!;
    expect(c.replay_ok).toBe(true);
    expect(settlementGatePasses(c)).toBe(true);
    expect(c.is_official).toBe(true);
  });

  it('戰果被竄改 → 重播驗證失敗', () => {
    const c = fullRaid(initialState(), 0).current!;
    expect(verifyReplay({ ...c, realized_pnl: (c.realized_pnl ?? 0) + 1 })).toBe(false);
  });

  it('時間戳不影響戰果（壓縮時長不改變重播）', () => {
    let a = appoint(initialState(), T0);
    a = settle(dispatch(a, T0), at(3));
    let b = appoint(initialState(), at(9999));
    b = settle(dispatch(b, at(9999)), at(10020));
    const pick = (c: ExpeditionContract) => [c.result_status, c.realized_pnl, c.return_pct, c.max_drawdown, c.trade_count];
    expect(pick(a.current!)).toEqual(pick(b.current!));
  });
});

// ---------------- D12 ----------------

describe('D12｜32 必填仍不變', () => {
  it('REQUIRED_FIELDS 恰 32 項，D12 不增刪改名', () => {
    expect(REQUIRED_FIELDS).toHaveLength(32);
    expect(new Set(REQUIRED_FIELDS).size).toBe(32);
    expect([...REQUIRED_FIELDS]).toEqual(LOCK_32);
  });

  it('期間／NL 調整後派出並結算，契約鍵仍恰為 32 項，硬旗標（D18：cancel_supported=true，其餘 false）', () => {
    let s = appoint(initialState(), T0);
    s = setTimeWindow(s, 'week_raid');
    s = settle(dispatch(s, T0), at(8));
    s = redispatch(s, at(10));
    s = applyAdjustment(s, proposeAdjustment(s, '保守一點，回撤 3%'));
    s = settle(dispatch(s, at(10)), at(13));
    for (const c of s.wall) {
      expect(Object.keys(c).sort()).toEqual([...LOCK_32].sort());
      expect([c.parallel_dispatch_allowed, c.cancel_supported, c.okx_dependency, c.real_funds]).toEqual([false, true, false, false]);
    }
  });
});

describe('D12｜constraint_snapshot 職業 Skill 鍵', () => {
  it('新約快照含 ability／applicable_context／limits 且非空，並保留風險鍵', () => {
    const snap = appoint(initialState(), T0).current!.constraint_snapshot;
    for (const k of ['ability', 'applicable_context', 'limits'] as const) {
      expect(typeof snap[k]).toBe('string');
      expect(snap[k].trim()).not.toBe('');
    }
    expect(snap).toMatchObject(WOLF.profession.skill);
    expect(snap.max_drawdown_limit_pct).toBe(WOLF.base_risk.max_drawdown_limit_pct);
    expect(snap.max_trade_count).toBe(WOLF.base_risk.max_trade_count);
  });

  it('結算後快照（入牆）仍含三鍵', () => {
    const w = fullRaid(initialState(), 0).wall[0];
    expect(skillKeysOk(w.constraint_snapshot)).toBe(true);
  });
});

describe('D12｜結算閘要求 Skill 鍵非空', () => {
  it('三鍵任一空白／缺漏 → 結算閘不過', () => {
    const c = fullRaid(initialState(), 0).current!;
    expect(settlementGatePasses(c)).toBe(true);
    for (const k of ['ability', 'applicable_context', 'limits'] as const) {
      expect(settlementGatePasses({ ...c, constraint_snapshot: { ...c.constraint_snapshot, [k]: '  ' } })).toBe(false);
      const { [k]: _drop, ...rest } = c.constraint_snapshot;
      void _drop;
      expect(settlementGatePasses({ ...c, constraint_snapshot: rest as ExpeditionContract['constraint_snapshot'] })).toBe(false);
    }
  });

  it('出征中快照被清空 → 結算後 is_official=false（仍入牆，不洗白）', () => {
    const s = dispatch(appoint(initialState(), T0), T0);
    const tampered: AppState = {
      ...s,
      current: { ...s.current!, constraint_snapshot: { ...s.current!.constraint_snapshot, limits: '' } },
    };
    const r = settle(tampered, at(3));
    expect(r.current!.is_official).toBe(false);
    expect(r.wall).toHaveLength(1);
  });

  it('派出閘：Skill 鍵空白或風險超出職業限制 → 拒絕派出', () => {
    const s = appoint(initialState(), T0);
    const blank: AppState = { ...s, current: { ...s.current!, constraint_snapshot: { ...s.current!.constraint_snapshot, ability: '' } } };
    expect(() => dispatch(blank, T0)).toThrow(/職業快照/);
    const over: AppState = { ...s, current: { ...s.current!, constraint_snapshot: { ...s.current!.constraint_snapshot, max_drawdown_limit_pct: 50 } } };
    expect(() => dispatch(over, T0)).toThrow(/越權/);
  });
});

describe('D12｜NL 調策略（不越權）', () => {
  it('界內 → accepted；D18：確認後產生新 strategy_version 綁本約（ready），派出後入牆為新版；下一約沿用', () => {
    let s = appoint(initialState(), T0);
    const ready = s.current!;
    const o = proposeAdjustment(s, '保守一點，回撤 3%');
    expect(o.kind).toBe('accepted');
    s = applyAdjustment(s, o);
    expect(s.config!.strategy_version).toBe('strat_wolf_v2');
    expect(s.current!.contract_id).toBe(ready.contract_id);
    expect(s.current!.strategy_version).toBe('strat_wolf_v2');
    expect(s.current!.constraint_snapshot.max_drawdown_limit_pct).toBe(3);
    s = settle(dispatch(s, T0), at(3));
    expect(s.wall[0].strategy_version).toBe('strat_wolf_v2');
    expect(() => applyAdjustment(s, o)).toThrow(/派出前/);
    // 下一約沿用新版
    s = redispatch(s, at(10));
    expect(s.current!.strategy_version).toBe('strat_wolf_v2');
    expect(s.current!.constraint_snapshot.max_drawdown_limit_pct).toBe(3);
    expect(skillKeysOk(s.current!.constraint_snapshot)).toBe(true);
  });

  it('數值越界 → rewritten：改寫回職業界限內（不會照單全收）', () => {
    let s = appoint(initialState(), T0);
    const o = proposeAdjustment(s, '回撤放到 10%，成交 99 筆');
    expect(o.kind).toBe('rewritten');
    if (o.kind !== 'rewritten') throw new Error();
    const [, ddMax] = WOLF.profession.bounds.max_drawdown_limit_pct;
    const [, trMax] = WOLF.profession.bounds.max_trade_count;
    expect(o.risk).toEqual({ max_drawdown_limit_pct: ddMax, max_trade_count: trMax });
    s = applyAdjustment(s, o);
    s = settle(dispatch(s, T0), at(3));
    const c = s.current!;
    expect(c.constraint_snapshot.max_drawdown_limit_pct).toBeLessThanOrEqual(ddMax);
    expect(settlementGatePasses(c)).toBe(true);
  });

  it('職業外打法 → blocked：不產新版，applyAdjustment 拒絕', () => {
    const s = appoint(initialState(), T0);
    for (const intent of ['改成做空', '加槓桿衝一波', '拿掉限制', '接 OKX 實盤']) {
      const o = proposeAdjustment(s, intent);
      expect(o.kind).toBe('blocked');
      expect(() => applyAdjustment(s, o)).toThrow();
    }
    expect(s.config!.strategy_version).toBe('strat_wolf_v1');
  });

  it('偽造越界的 accepted 結果 → applyAdjustment 重新驗證後拒絕', () => {
    const s = appoint(initialState(), T0);
    expect(() =>
      applyAdjustment(s, { kind: 'accepted', request: '回撤 3%', risk: { max_drawdown_limit_pct: 40, max_trade_count: 24 } }),
    ).toThrow();
  });

  it('聽不出內容／與現行相同 → blocked', () => {
    const cur = WOLF.base_risk;
    expect(interpretIntent('', cur, WOLF.profession).kind).toBe('blocked');
    expect(interpretIntent('加油', cur, WOLF.profession).kind).toBe('blocked');
    expect(interpretIntent(`回撤 ${cur.max_drawdown_limit_pct}%`, cur, WOLF.profession).kind).toBe('blocked');
  });

  it('版本號只增不減：撤回後重新任命再調，不重用舊版號', () => {
    let s = appoint(initialState(), T0);
    s = applyAdjustment(s, proposeAdjustment(s, '回撤 3%'));
    s = appoint(withdraw(s), at(5));
    expect(s.config!.strategy_version).toBe('strat_wolf_v1');
    s = applyAdjustment(s, proposeAdjustment(s, '回撤 4%'));
    expect(s.config!.strategy_version).toBe('strat_wolf_v3');
  });
});

describe('D12｜期間每約可選', () => {
  it('同 Agent 連續兩次出征可有不同 planned_duration', () => {
    let s = appoint(initialState(), T0);
    s = setTimeWindow(s, 'short_raid');
    s = settle(dispatch(s, T0), at(3));
    s = redispatch(s, at(10));
    s = setTimeWindow(s, 'week_raid');
    s = settle(dispatch(s, at(10)), at(18));
    const [a, b] = s.wall;
    expect(a.agent_id).toBe(b.agent_id);
    expect(a.planned_duration).toBe(3);
    expect(b.planned_duration).toBe(8);
    expect(a.time_window_type).not.toBe(b.time_window_type);
    expect(s.wall.every((c) => settlementGatePasses(c))).toBe(true);
  });

  it('再派新約預填上次期間，但派出前可重設', () => {
    let s = setTimeWindow(appoint(initialState(), T0), 'day_raid');
    s = redispatch(settle(dispatch(s, T0), at(5)), at(10));
    expect(s.current!.planned_duration).toBe(5);
    s = setTimeWindow(s, 'short_raid');
    expect(s.current!.planned_duration).toBe(3);
  });

  it('出征中期間鎖定（不可熱改）；結算後舊約期間不被改寫', () => {
    let s = setTimeWindow(appoint(initialState(), T0), 'day_raid');
    s = dispatch(s, T0);
    expect(() => setTimeWindow(s, 'week_raid')).toThrow(/鎖定/);
    s = settle(s, at(5));
    expect(() => setTimeWindow(s, 'week_raid')).toThrow();
    expect(s.wall[0].planned_duration).toBe(5);
  });

  it('選項值 3／5／8 秒；期間決定模擬長度，重播用本約時長', () => {
    expect(TIME_WINDOWS.map((w) => w.planned_duration)).toEqual([3, 5, 8]);
    const base = createContract(1, T0);
    const long = { ...base, time_window_type: 'week_raid' as const, planned_duration: 8 };
    expect(runSim(simInputOf(long)).ticks_run).toBeGreaterThanOrEqual(runSim(simInputOf(base)).ticks_run);
    const s = settle(dispatch(setTimeWindow(appoint(initialState(), T0), 'week_raid'), T0), at(8));
    expect(verifyReplay(s.current!)).toBe(true);
    expect(settlementGatePasses({ ...s.current!, planned_duration: 4 })).toBe(false);
  });

  it('D18：cancel_supported=true（撤回＝結算）；store 仍無「無結果取消」cancel API', async () => {
    const mod = await import('./store');
    expect(Object.keys(mod).some((k) => /cancel/i.test(k))).toBe(false);
    expect(dispatch(appoint(initialState(), T0), T0).current!.cancel_supported).toBe(true);
  });
});

describe('D12｜撤回不洗牆；綜合表現', () => {
  it('撤回配置不刪牆，失敗紀錄保留；綜合表現照算失敗', () => {
    let s = raidUntil((c) => c.result_status !== 'completed');
    const failures = s.wall.filter((c) => c.result_status !== 'completed');
    expect(failures.length).toBeGreaterThan(0);
    const before = [...s.wall];
    s = withdraw(s);
    expect(s.wall).toEqual(before);
    expect(s.wall.filter((c) => c.result_status !== 'completed')).toEqual(failures);
    s = appoint(s, at(9000));
    expect(s.wall).toEqual(before);
    const m = compositeOf(s.wall, WOLF.agent_id)!;
    expect(m.raids).toBe(before.length);
    expect(m.failures).toBe(failures.length);
  });

  it('無歷史 → 綜合表現空態（null，不捏造數字）', () => {
    expect(compositeOf([], WOLF.agent_id)).toBeNull();
  });

  it('綜合表現匯總與牆一致', () => {
    let s = initialState();
    for (let i = 0; i < 5; i++) s = fullRaid(s, i * 10);
    const m = compositeOf(s.wall, WOLF.agent_id)!;
    const sum = Math.round(s.wall.reduce((a, c) => a + c.realized_pnl!, 0) * 100) / 100;
    expect(m.pnl_sum).toBe(sum);
    expect(m.worst_drawdown).toBe(Math.max(...s.wall.map((c) => c.max_drawdown!)));
    expect(m.wins).toBe(s.wall.filter((c) => c.return_pct! > 0).length);
  });
});

describe('D12｜舊存檔相容', () => {
  it('D11 舊 ready 約（無 Skill 快照）載入後換發新約；牆上舊紀錄原樣不改寫', () => {
    const kv = memKV();
    const s = redispatch(fullRaid(initialState(), 0), at(10));
    const legacyWallRow = { ...s.wall[0], time_window_type: 'fixed_duration', constraint_snapshot: { max_drawdown_limit_pct: 6, max_trade_count: 30 } };
    const legacyReady = { ...s.current!, time_window_type: 'fixed_duration', constraint_snapshot: { max_drawdown_limit_pct: 6, max_trade_count: 30 } };
    kv.setItem(
      STORAGE_KEY,
      JSON.stringify({ config: { agent_id: 'agent_wolf', strategy_version: 'strat_wolf_v1', enabled: true }, current: legacyReady, wall: [legacyWallRow], seq: s.seq }),
    );
    const r = load(kv);
    expect(r.wall[0]).toEqual(legacyWallRow);
    expect(r.current!.contract_id).not.toBe(legacyReady.contract_id);
    expect(skillKeysOk(r.current!.constraint_snapshot)).toBe(true);
    expect(() => dispatch(r, at(20))).not.toThrow();
  });
});
