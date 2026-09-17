// D18 派出撤回與畫面精簡：R1–R8（01-範圍/驗收句-D18-派出撤回與畫面精簡.md）。
// 準據：02-系統規則/出征契約-D18規格補丁.md、04-體驗設計/IA動線改稿-D18.md、03-世界敘事/文案槽-D18-派出撤回與畫面精簡.md。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import App from './App';
import APP_SRC from './App.tsx?raw';
import * as copy from './copy';
import { DEFAULTS, REQUIRED_FIELDS, RESULT_STATUSES, missingFields, settlementGatePasses, type OptionalContractFields } from './contract';
import * as flow from './flow';
import { WOLF } from './profession';
import { verifyReplay } from './sim';
import * as store from './store';
import {
  applyAdjustment,
  appoint,
  compositeOf,
  dispatch,
  initialState,
  load,
  proposeAdjustment,
  redispatch,
  save,
  settle,
  withdrawInField,
  type AppState,
} from './store';

const T0 = new Date('2026-09-17T12:00:00.000Z');
const at = (s: number) => new Date(T0.getTime() + s * 1000);
const NAME = DEFAULTS.agent_display;

function memKV() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}
function mount(state: AppState | null, screen?: flow.Screen): string {
  const kv = memKV();
  if (state) save(state, kv);
  (globalThis as { localStorage?: unknown }).localStorage = kv;
  return renderToStaticMarkup(createElement(App, { initialScreen: screen }));
}
afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

const visible = (html: string) =>
  html.replace(/<details class="more dev">[\s\S]*?<\/details>/g, '').replace(/<[^>]+>/g, '\n').replace(/&amp;/g, '&');
const l0Text = (html: string) => visible(html.replace(/<details[\s\S]*?<\/details>/g, ''));

const appointed = () => appoint(initialState(), T0);
const inField = () => dispatch(appointed(), T0);
/** 以真實時鐘派出（SSR 渲染在外面用 Date.now()）。 */
const inFieldNow = () => dispatch(appointed(), new Date(Date.now() - 1000));
const withdrawnAt = (sec: number, s: AppState = inField()) => withdrawInField(s, at(sec));

/** 跑多趟撤回，直到撤回結算的戰果符合條件。 */
function withdrawUntil(pred: (pnl: number) => boolean): AppState {
  let s = appointed();
  for (let i = 0; i < 200; i++) {
    const base = i * 20;
    s = withdrawInField(dispatch(s, at(base)), at(base + 1 + ((i * 7) % 20) / 10));
    const c = s.current!;
    if (c.result_status === 'withdrawn_settled' && pred(c.realized_pnl!)) return s;
    s = redispatch(s, at(base + 5));
  }
  throw new Error('no matching withdrawn raid in 200 tries');
}

const section = (key: string, next: string) => APP_SRC.slice(APP_SRC.indexOf(`screen === '${key}' && (`), APP_SRC.indexOf(`screen === '${next}' && (`));

describe('R1｜派出後可隨時撤回', () => {
  it('in_field 主 CTA＝撤回（唯一主鈕）；無「不能叫回」', () => {
    const html = mount(inFieldNow(), 'dispatch');
    const ctas = [...html.matchAll(/class="cta"[^>]*>([^<]+)</g)].map((m) => m[1]);
    expect(ctas).toEqual([copy.CTA.withdrawInField]);
    expect(copy.CTA.withdrawInField).toBe('撤回');
    expect(visible(html)).not.toContain('不能叫回');
  });

  it('正在派出…（剛派出）也可撤回', () => {
    const html = mount(dispatch(appointed(), new Date()), 'dispatch');
    expect(l0Text(html)).toContain(copy.L0.sending);
    expect(html).toMatch(new RegExp(`class="cta"[^>]*>${copy.CTA.withdrawInField}<`));
  });

  it('派出後任一時刻（0 秒、中途、到點後）皆可撤回', () => {
    for (const sec of [0, 0.5, 1.7, 2.9, 3, 12]) {
      const s = withdrawnAt(sec);
      expect(s.current!.status).toBe('returned');
    }
  });

  it('cancel_supported=true；其餘三旗標仍 false', () => {
    const c = inField().current!;
    expect(c.cancel_supported).toBe(true);
    expect(c.okx_dependency).toBe(false);
    expect(c.real_funds).toBe(false);
    expect(c.parallel_dispatch_allowed).toBe(false);
  });

  it('非 in_field 不能撤回結算（ready／returned）', () => {
    expect(() => withdrawInField(appointed(), T0)).toThrow();
    expect(() => withdrawInField(withdrawnAt(1), at(2))).toThrow();
  });
});

describe('R2｜撤回＝立刻結算並帶回戰報（入牆、不可刪）', () => {
  it('撤回 → returned＋withdrawn_settled＋過同一結算閘＋入牆＋withdrawn_at（選填、不進 32）', () => {
    expect(RESULT_STATUSES).toContain('withdrawn_settled');
    const s = withdrawnAt(1.2);
    const c = s.current! as typeof s.current & OptionalContractFields;
    expect(c.status).toBe('returned');
    expect(c.result_status).toBe('withdrawn_settled');
    expect(c.settled_at).toBe(at(1.2).toISOString());
    expect(c.withdrawn_at).toBe(c.settled_at);
    for (const k of ['battle_result_id', 'evidence_id', 'attribution_ref', 'realized_pnl', 'return_pct', 'max_drawdown', 'trade_count'] as const) {
      expect(c[k]).not.toBeNull();
    }
    expect(missingFields(c)).toEqual([]);
    expect(REQUIRED_FIELDS).toHaveLength(32);
    expect(REQUIRED_FIELDS as readonly string[]).not.toContain('withdrawn_at');
    expect(verifyReplay(c)).toBe(true);
    expect(c.replay_ok).toBe(true);
    expect(settlementGatePasses(c)).toBe(true);
    expect(c.is_official).toBe(true);
    expect(s.wall).toHaveLength(1);
    expect(s.wall[0]).toBe(c);
  });

  it('撤回比到點跑得少（立刻結算，不等到點）', () => {
    const early = withdrawnAt(0.5).current!;
    expect(early.result_status).toBe('withdrawn_settled');
    expect(early.trade_count!).toBeLessThanOrEqual(settle(inField(), at(3)).current!.trade_count! + 1);
    // 0 秒撤回：沒有 tick → 賺賠為零，仍是正式戰報
    const zero = withdrawnAt(0).current!;
    expect(zero.result_status).toBe('withdrawn_settled');
    expect(zero.realized_pnl).toBe(0);
    expect(zero.is_official).toBe(true);
  });

  it('損益正交：withdrawn_settled 可正／負；不算失敗（綜合表現）', () => {
    const pos = withdrawUntil((p) => p > 0);
    const neg = withdrawUntil((p) => p < 0);
    expect(pos.current!.realized_pnl!).toBeGreaterThan(0);
    expect(neg.current!.realized_pnl!).toBeLessThan(0);
    const m = compositeOf([withdrawnAt(0).current!], WOLF.agent_id)!;
    expect(m.failures).toBe(0);
  });

  it('D5：撤回戰報凍結不可改；再派不改寫舊紀錄；存讀檔後原樣', () => {
    let s = withdrawnAt(1);
    const row = s.wall[0];
    expect(Object.isFrozen(row)).toBe(true);
    expect(Object.isFrozen(s.wall)).toBe(true);
    expect(() => {
      (row as { realized_pnl: number }).realized_pnl = 999;
    }).toThrow();
    const snapshot = JSON.parse(JSON.stringify(row));
    s = redispatch(s, at(5));
    s = withdrawInField(dispatch(s, at(6)), at(7));
    expect(s.wall).toHaveLength(2);
    expect(JSON.parse(JSON.stringify(s.wall[0]))).toEqual(snapshot);
    const kv = memKV();
    save(s, kv);
    expect(JSON.parse(JSON.stringify(load(kv).wall[0]))).toEqual(snapshot);
  });

  it('無「無結果取消」：store 無 cancel／delete API', () => {
    expect(Object.keys(store).some((k) => /cancel|delete|remove|clear/i.test(k))).toBe(false);
  });

  it('戰報 L0：「{name} 已撤回。戰報帶回。」＋賺賠／最大回落；紀錄有「已撤回」條', () => {
    const s = withdrawnAt(1);
    const report = mount(s, 'report');
    expect(l0Text(report)).toContain(copy.L0.withdrawnSettled(NAME));
    expect(copy.L0.withdrawnSettled(NAME)).toBe(`${NAME} 已撤回。戰報帶回。`);
    expect(l0Text(report)).toContain(copy.METRIC.pnl);
    expect(l0Text(report)).toContain(copy.METRIC.drawdown);
    expect(visible(report)).not.toMatch(/已取消|無結果|失敗/);
    const wall = mount(s, 'wall');
    expect(visible(wall)).toContain(copy.OUTCOME.withdrawn);
  });

  it('App：撤回鈕 → withdrawInField → 進戰報', () => {
    expect(APP_SRC).toMatch(/onWithdraw=\{\(\) => actGo\(\(s\) => withdrawInField\(s, new Date\(\)\), 'report'\)\}/);
  });
});

describe('R3｜出征前可調策略（ready 次級「改打法」）', () => {
  it('派出 ready：有「改打法」次級入口；L0 第一眼無 NL 框；主 CTA 仍＝派出', () => {
    const html = mount(appointed(), 'dispatch');
    expect(html).toMatch(new RegExp(`class="l1-toggle"[^>]*>${copy.CTA.adjust}<`));
    expect(html).not.toContain('<input');
    expect(l0Text(html)).not.toContain(copy.N0(NAME));
    expect([...html.matchAll(/class="cta"[^>]*>([^<]+)</g)].map((m) => m[1])).toEqual([copy.CTA.dispatch]);
  });

  it('改打法 → 新 strategy_version 綁本約 → 可派出', () => {
    let s = appointed();
    s = applyAdjustment(s, proposeAdjustment(s, '保守一點，停損線 3%'));
    expect(s.current!.status).toBe('ready');
    expect(s.current!.strategy_version).toBe('strat_wolf_v2');
    s = dispatch(s, T0);
    expect(s.current!.status).toBe('in_field');
    expect(s.current!.strategy_version).toBe('strat_wolf_v2');
  });

  it('in_field／returned 拒改打法', () => {
    const o = proposeAdjustment(appointed(), '停損線 3%');
    expect(() => proposeAdjustment(inField(), '停損線 3%')).toThrow();
    expect(() => applyAdjustment(inField(), o)).toThrow(/派出後/);
    expect(() => proposeAdjustment(withdrawnAt(1), '停損線 3%')).toThrow(/派出前/);
    expect(() => applyAdjustment(withdrawnAt(1), o)).toThrow(/派出前/);
  });

  it('改打法文案（Mater D18 §3）', () => {
    expect(copy.N0(NAME)).toBe(`派出前跟 ${NAME} 交代這次怎麼打。`);
    expect(copy.N1('X')).toBe('收到。X 仍在它會的範圍內。可以派出。');
    expect(copy.N1B('Y')).toBe('超出它會的了。已收束：Y。確認後可派出。');
    expect(copy.N2).toBe('這步做不到——不是不肯，是不能超。收一收再試。');
    expect(copy.N3).toBe('這裡是交代大將，不是改設定面板。');
  });
});

describe('R4｜調策略不破職業限制（D12 constraint_snapshot）', () => {
  it('越界 → 改寫回界內；職業外 → 擋下不產版；偽造越權 → 拒', () => {
    let s = appointed();
    const re = proposeAdjustment(s, '停損線 20%，買賣 99 次');
    expect(re.kind).toBe('rewritten');
    s = applyAdjustment(s, re);
    const [, ddMax] = WOLF.profession.bounds.max_drawdown_limit_pct;
    const [, trMax] = WOLF.profession.bounds.max_trade_count;
    expect(s.current!.constraint_snapshot.max_drawdown_limit_pct).toBe(ddMax);
    expect(s.current!.constraint_snapshot.max_trade_count).toBe(trMax);
    for (const k of ['ability', 'applicable_context', 'limits'] as const) {
      expect(s.current!.constraint_snapshot[k]).toBe(WOLF.profession.skill[k]);
    }

    const base = appointed();
    const blocked = proposeAdjustment(base, '改成做空加槓桿');
    expect(blocked.kind).toBe('blocked');
    expect(() => applyAdjustment(base, blocked)).toThrow();
    expect(() =>
      applyAdjustment(base, { kind: 'accepted', request: '停損線 3%', risk: { max_drawdown_limit_pct: 50, max_trade_count: 24 } }),
    ).toThrow();
  });

  it('越權快照 → 拒派出', () => {
    const s = appointed();
    const bad: AppState = {
      ...s,
      current: { ...s.current!, constraint_snapshot: { ...s.current!.constraint_snapshot, max_drawdown_limit_pct: 50 } },
    };
    expect(() => dispatch(bad, T0)).toThrow(/越權/);
  });
});

describe('R5｜派出頁無出征紀錄', () => {
  it.each([
    ['ready', () => appointed()],
    ['在外面', () => inFieldNow()],
    ['有紀錄後再派 ready', () => redispatch(withdrawnAt(1), at(5))],
  ] as const)('%s：無緊湊牆／紀錄連結／還沒出過征', (_, mk) => {
    const html = mount(mk(), 'dispatch');
    expect(html).not.toContain('wall-compact');
    const main = visible(html.slice(html.indexOf('<main')));
    expect(main).not.toContain(copy.WALL_COMPACT.link);
    expect(main).not.toContain(copy.WALL_COMPACT.empty);
    expect(main).not.toContain('最近：');
  });

  it('App 派出段落不引用 wallCompact／WallList', () => {
    const src = section('dispatch', 'report');
    expect(src).not.toMatch(/wallCompact|WallCompact|WallList/);
  });

  it('紀錄仍可從大將／戰報／步驟列進入', () => {
    const s = withdrawnAt(1);
    expect(mount(s, 'appoint')).toContain('wall-compact');
    expect(mount(s, 'report')).toContain('wall-compact');
    expect(flow.reach(s, 'wall').ok).toBe(true);
  });
});

describe('R6｜戰報頁無角色／策略調整', () => {
  it.each([
    ['正常／提前回來', () => settle(inField(), at(10))],
    ['撤回結算', () => withdrawnAt(1)],
  ] as const)('%s：無改打法／NL／職業詳情；主 CTA＝再派', (_, mk) => {
    const html = mount(mk(), 'report');
    const v = visible(html);
    expect(html).not.toContain('<input');
    expect(html).not.toContain('l1-toggle');
    expect(html).not.toContain('nl-sheet');
    expect(v).not.toContain(copy.CTA.adjust);
    expect(v).not.toContain('跟大將說');
    expect(v).not.toContain(copy.L1.professionDetail);
    expect([...html.matchAll(/class="cta"[^>]*>([^<]+)</g)].map((m) => m[1])).toEqual([copy.CTA.redispatch]);
  });

  it('App 戰報段落不引用 NlSheet／adjustOpen／applyAdjustment／SkillShort', () => {
    const src = section('report', 'wall');
    expect(src.length).toBeGreaterThan(0);
    expect(src).not.toMatch(/NlSheet|adjustOpen|nlOpen|applyAdjustment|proposeAdjustment|SkillShort/);
  });

  it('NlSheet 只在派出 ready 段落出現一次', () => {
    expect(APP_SRC.match(/<NlSheet/g)).toHaveLength(1);
    expect(section('dispatch', 'report')).toContain('<NlSheet');
  });
});

describe('R7｜玩家 UI 無「模擬」標', () => {
  const now = Date.now();
  const all: [string, AppState | null, flow.Screen | undefined][] = [
    ['空', null, undefined],
    ['大將', appointed(), 'appoint'],
    ['派出', appointed(), 'dispatch'],
    ['在外面', dispatch(appointed(), new Date(now - 1000)), 'dispatch'],
    ['戰報', settle(inField(), at(10)), 'report'],
    ['撤回戰報', withdrawnAt(1), 'report'],
    ['紀錄', withdrawnAt(1), 'wall'],
  ];

  it.each(all)('%s：可見文字無「模擬」、無 sim 徽章', (_, s, screen) => {
    const html = mount(s, screen);
    expect(visible(html)).not.toContain('模擬');
    expect(html).not.toMatch(/sim-badge|class="sim"/);
  });

  it('copy.ts 所有玩家字串無「模擬」；L2 虛擬資金一句不含「模擬」', () => {
    const strings: string[] = [];
    const walk = (v: unknown) => {
      if (typeof v === 'string') strings.push(v);
      else if (typeof v === 'function') {
        const r = (v as (...a: string[]) => unknown)('X', 'Y');
        if (typeof r === 'string') strings.push(r);
      } else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(copy);
    expect(strings.length).toBeGreaterThan(20);
    for (const str of strings) expect(str, str).not.toContain('模擬');
    expect(copy.VIRTUAL_FUNDS_NOTE).toBe('大將使用虛擬資金，交易不會送往真實市場。');
  });

  it('JSX 字面無「模擬」', () => {
    const jsxText = APP_SRC.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
    expect(jsxText).not.toContain('模擬');
  });
});

describe('R8｜底層仍模擬盤', () => {
  it('撤回／正常結算皆保留 simulation 欄位；real_funds／okx_dependency=false', () => {
    for (const c of [withdrawnAt(1).current!, settle(inField(), at(10)).current!]) {
      expect(c.simulation_source).toEqual({
        engine: DEFAULTS.sim_engine_id,
        dataset: DEFAULTS.market_dataset_id,
        dataset_version: DEFAULTS.market_dataset_version,
        run: c.sim_run_id,
      });
      expect(c.sim_engine_id).toBe('sim_engine_local_v1');
      expect(c.market_dataset_id).toBe('feed_mock_crypto_v1');
      expect(c.simulation_principal).toBeGreaterThan(0);
      expect(c.real_funds).toBe(false);
      expect(c.okx_dependency).toBe(false);
      expect(c.parallel_dispatch_allowed).toBe(false);
    }
  });

  it('NL 要求實盤／OKX 仍擋下', () => {
    expect(proposeAdjustment(appointed(), '接 OKX 實盤').kind).toBe('blocked');
  });

  it('開發詳情仍可見技術 id（非玩家主路徑）', () => {
    const html = mount(appointed(), 'dispatch');
    expect(html).toContain('class="more dev"');
    expect(html).toContain(DEFAULTS.sim_engine_id);
    expect(l0Text(html)).not.toContain(DEFAULTS.sim_engine_id);
  });
});
