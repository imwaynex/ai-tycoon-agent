// 狀態機（純函式）＋ localStorage 持久化。
// 任命 → 派出 → 歸來（結算入牆）→ 再派／撤回。
// 契約狀態（lock-D11）：ready → in_field → returned；再派＝新契約。
// 戰績牆只增不刪；撤回（停用這員）只停用配置（config.enabled=false），不動契約狀態。
// D12：期間每約可選（ready 可改、in_field 鎖定）。
// D18：出征中撤回＝立刻結算（withdrawInField → returned／withdrawn_settled，入牆）；
//      改打法只在 ready：產新 strategy_version 並綁本約（in_field／returned 拒改）。

import {
  TIME_WINDOWS,
  canTransition,
  constraintSnapshotOk,
  createContract,
  hardFlagsOk,
  settlementGatePasses,
  type OptionalContractFields,
  windowLegal,
  windowOf,
  type ExpeditionContract,
  type TimeWindowType,
} from './contract';
import { interpretIntent, type NlOutcome } from './nl';
import { WOLF, skillKeysOk, type RiskParams } from './profession';
import { runSim, simInputOf, verifyReplay, withdrawnSecOf } from './sim';

export interface AgentConfig {
  agent_id: string;
  /** 下一約要用的策略版本（NL 調策略會換新版）。 */
  strategy_version: string;
  /** 下一約要用的風險硬頂（職業限制內）。 */
  risk: RiskParams;
  /** 上次選的期間；新約預填，但派出前可改。 */
  time_window_type: TimeWindowType;
  /** 應用層旗標：撤回＝false。非契約狀態。 */
  enabled: boolean;
}

export interface AppState {
  config: AgentConfig | null;
  /** 目前這一趟（ready / in_field / returned） */
  current: ExpeditionContract | null;
  /** 戰績履歷：已結算契約，含失敗。唯讀。 */
  wall: readonly ExpeditionContract[];
  seq: number;
  /** 已發出的策略版本號（v1 為職業基底）；只增不減，避免同名不同配置。 */
  strategy_seq: number;
}

export const STORAGE_KEY = 'short-raid-proto/v1';

export const initialState = (): AppState => ({ config: null, current: null, wall: [], seq: 0, strategy_seq: 1 });

export class RaidError extends Error {}

function freezeContract(c: ExpeditionContract): ExpeditionContract {
  return Object.freeze({
    ...c,
    simulation_source: Object.freeze({ ...c.simulation_source }),
    constraint_snapshot: Object.freeze({ ...c.constraint_snapshot }),
  }) as ExpeditionContract;
}

function newReadyContract(config: AgentConfig, state: AppState, now: Date): { current: ExpeditionContract; seq: number } {
  const seq = state.seq + 1;
  return {
    current: createContract(seq, now, {
      strategy_version: config.strategy_version,
      risk: config.risk,
      time_window_type: config.time_window_type,
    }),
    seq,
  };
}

const baseConfig = (time_window_type: TimeWindowType = TIME_WINDOWS[0].time_window_type): AgentConfig => ({
  agent_id: WOLF.agent_id,
  strategy_version: WOLF.base_strategy_version,
  risk: { ...WOLF.base_risk },
  time_window_type,
  enabled: true,
});

/** 任命（或撤回後重新任命）WOLF，以職業基底策略產生一份可派契約。 */
export function appoint(state: AppState, now: Date): AppState {
  if (isInFlight(state)) throw new RaidError('在外面，不能重新任命。');
  const config = baseConfig(state.config?.time_window_type);
  return { ...state, config, ...newReadyContract(config, state, now) };
}

/** 選／重設本約期間：只在 ready（派出前）；出征中鎖定。 */
export function setTimeWindow(state: AppState, type: TimeWindowType): AppState {
  const c = state.current;
  const win = windowOf(type);
  if (!win) throw new RaidError('沒有這個時長。');
  if (!state.config?.enabled) throw new RaidError('這員已撤回。');
  if (c?.status === 'in_field') throw new RaidError('派出後就不能改時長了（已鎖定）。');
  if (!c || c.status !== 'ready') throw new RaidError('還沒有可派的。');
  return {
    ...state,
    config: { ...state.config, time_window_type: win.time_window_type },
    current: { ...c, time_window_type: win.time_window_type, planned_duration: win.planned_duration },
  };
}

/** 派出：單線（parallel_dispatch_allowed=false）；出征中可撤回＝立刻結算（cancel_supported=true，見 withdrawInField）。 */
export function dispatch(state: AppState, now: Date): AppState {
  const c = state.current;
  if (!state.config?.enabled) throw new RaidError('這員已撤回。');
  if (!c || !canTransition(c.status, 'in_field')) throw new RaidError('還沒有可派的。');
  if (!hardFlagsOk(c)) throw new RaidError('這次設定不對，不能派。');
  if (!windowLegal(c)) throw new RaidError('時長不對，不能派。');
  if (!skillKeysOk(c.constraint_snapshot)) throw new RaidError('職業快照不全，不能派。');
  if (!constraintSnapshotOk(c)) throw new RaidError('越權：這次的規則超出它會的，不能派。');
  if (!c.parallel_dispatch_allowed && isInFlight(state)) throw new RaidError('已經有大將在外面。');
  return { ...state, current: { ...c, status: 'in_field', dispatched_at: now.toISOString() } };
}

/** D18：改打法只在派出前（ready）；出征中／戰報後拒改本約。 */
function assertAdjustable(state: AppState): ExpeditionContract {
  const c = state.current;
  if (c?.status === 'in_field') throw new RaidError('派出後就不能改打法了。');
  if (!c || c.status !== 'ready') throw new RaidError('派出前才能改打法。');
  return c;
}

/** NL 調策略：解讀一句話，回傳採納／改寫／擋下（不改狀態）。只在 ready。 */
export function proposeAdjustment(state: AppState, intent: string): NlOutcome {
  if (!state.config) throw new RaidError('還沒有大將。');
  assertAdjustable(state);
  return interpretIntent(intent, state.config.risk, WOLF.profession);
}

/** 確認 NL 調整（只在 ready）：重驗職業界內 → 產新 strategy_version → 綁本約（派出前）＋預填之後的約。 */
export function applyAdjustment(state: AppState, outcome: NlOutcome): AppState {
  if (!state.config?.enabled) throw new RaidError('這員已撤回。');
  const c = assertAdjustable(state);
  if (outcome.kind === 'blocked') throw new RaidError(outcome.reason);
  const check = interpretIntent(outcome.request, state.config.risk, WOLF.profession);
  if (check.kind === 'blocked' || JSON.stringify(check.risk) !== JSON.stringify(outcome.risk)) {
    throw new RaidError('打法已經變了，請再說一次。');
  }
  const strategy_seq = state.strategy_seq + 1;
  const strategy_version = `strat_wolf_v${strategy_seq}`;
  const risk = { ...outcome.risk };
  const current: ExpeditionContract = { ...c, strategy_version, constraint_snapshot: { ...c.constraint_snapshot, ...risk } };
  if (!constraintSnapshotOk(current)) throw new RaidError('越權：這次的規則超出它會的，不能改。');
  return {
    ...state,
    strategy_seq,
    config: { ...state.config, strategy_version, risk },
    current,
  };
}

export function isInFlight(state: AppState): boolean {
  return state.current?.status === 'in_field';
}

/** 到期時間（ms epoch）。 */
export function dueAt(c: ExpeditionContract): number {
  return c.dispatched_at ? Date.parse(c.dispatched_at) + c.planned_duration * 1000 : Infinity;
}

/** 歸來：跑模擬、重播驗證、過結算閘、寫入戰績牆。 */
export function settle(state: AppState, now: Date): AppState {
  return settleContract(state, now, false);
}

/**
 * D18 撤回（出征中）：立刻結算——與到點 settle 同一套結算閘，終態同 returned，
 * result_status=withdrawn_settled（損益可正／零／負），正式入牆、不可刪；寫選填 withdrawn_at。
 */
export function withdrawInField(state: AppState, now: Date): AppState {
  return settleContract(state, now, true);
}

function settleContract(state: AppState, now: Date, withdrawn: boolean): AppState {
  const c = state.current;
  if (!c || !canTransition(c.status, 'returned')) throw new RaidError('沒有在外面的。');
  const settled_at = now.toISOString();
  const r = runSim(simInputOf(c), withdrawn ? withdrawnSecOf({ dispatched_at: c.dispatched_at, settled_at }) : undefined);
  const run = c.sim_run_id;
  const returned: ExpeditionContract & OptionalContractFields = {
    ...c,
    ...(withdrawn && { withdrawn_at: settled_at }),
    status: 'returned',
    settled_at,
    battle_result_id: `br_${run}`,
    result_status: r.result_status,
    realized_pnl: r.realized_pnl,
    return_pct: r.return_pct,
    max_drawdown: r.max_drawdown,
    trade_count: r.trade_count,
    attribution_ref: `attr_${run}_seed_${r.seed}`,
    evidence_id: `evd_${run}_${r.seed.toString(16)}`,
  };
  returned.replay_ok = verifyReplay(returned);
  returned.is_official = returned.replay_ok && settlementGatePasses(returned);
  const frozen = freezeContract(returned);
  return { ...state, current: frozen, wall: Object.freeze([...state.wall, frozen]) };
}

/** 再派：同一配置，新開一份 ready 契約；舊的 returned 契約原封不動留在牆上。
 * D16 F5：UI 只有戰報「再派」會呼叫；期間預填上一趟（config.time_window_type）。 */
export function redispatch(state: AppState, now: Date): AppState {
  if (!state.config?.enabled) throw new RaidError('這員已撤回。');
  if (state.current?.status !== 'returned') throw new RaidError('還沒有戰報，不能再派。');
  return { ...state, ...newReadyContract(state.config, state, now) };
}

/** 撤回（停用這員）：停用配置（應用層旗標）；契約狀態與戰績牆一筆不動。出征中請用 withdrawInField。 */
export function withdraw(state: AppState): AppState {
  if (!state.config) throw new RaidError('還沒有大將。');
  if (isInFlight(state)) throw new RaidError('在外面，先撤回這趟。');
  return { ...state, config: { ...state.config, enabled: false } };
}

// ---- persistence ----

export interface KV {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function save(state: AppState, kv: KV): void {
  kv.setItem(STORAGE_KEY, JSON.stringify(state));
}

/** 舊存檔狀態名 → lock-D11：dispatched→in_field、settled→returned、draft／withdrawn_config→ready。 */
const LEGACY_STATUS: Record<string, ExpeditionContract['status']> = {
  draft: 'ready',
  withdrawn_config: 'ready',
  dispatched: 'in_field',
  settled: 'returned',
};

function migrateContract(c: ExpeditionContract): ExpeditionContract {
  const mapped = LEGACY_STATUS[c.status as string];
  return mapped ? { ...c, status: mapped } : c;
}

/** D18：尚未結算的約（ready／in_field）旗標改 cancel_supported=true；已入牆紀錄原樣不改寫（D5）。 */
const migrateOpenFlags = (c: ExpeditionContract): ExpeditionContract =>
  c.status !== 'returned' && (c.cancel_supported as boolean) !== true ? { ...c, cancel_supported: true } : c;

export function load(kv: KV): AppState {
  try {
    const raw = kv.getItem(STORAGE_KEY);
    if (!raw) return initialState();
    const parsed = JSON.parse(raw) as AppState;
    if (!Array.isArray(parsed.wall)) return initialState();
    const wall = Object.freeze(parsed.wall.map((w) => freezeContract(migrateContract(w))));
    const cur = parsed.current ? migrateOpenFlags(migrateContract(parsed.current)) : null;
    const current =
      cur?.status === 'returned'
        ? wall.find((w) => w.contract_id === cur.contract_id) ?? freezeContract(cur)
        : cur;
    const seq = parsed.seq ?? wall.length;
    const config = parsed.config
      ? { ...baseConfig(), ...parsed.config, risk: { ...WOLF.base_risk, ...parsed.config.risk } }
      : null;
    if (config && !windowOf(config.time_window_type)) config.time_window_type = TIME_WINDOWS[0].time_window_type;
    const state: AppState = { config, current, wall, seq, strategy_seq: parsed.strategy_seq ?? 1 };
    // D11 舊存檔的 ready 約沒有 Skill 快照 → 未派出、不入牆，換發新約；牆上舊紀錄原樣保留不改寫。
    if (config && current?.status === 'ready' && !constraintSnapshotOk(current)) {
      return { ...state, ...newReadyContract(config, state, new Date()) };
    }
    return state;
  } catch {
    return initialState();
  }
}

// ---- 綜合表現（任命席主層；與戰報／牆同源） ----

export interface Composite {
  raids: number;
  pnl_sum: number;
  /** 報酬為正的出征次數 */
  wins: number;
  /** 折返（failed_*）次數——失敗照算，不洗白；撤回結算（withdrawn_settled）不算失敗 */
  failures: number;
  return_min: number;
  return_max: number;
  worst_drawdown: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function compositeOf(wall: readonly ExpeditionContract[], agent_id: string): Composite | null {
  const rows = wall.filter((c) => c.agent_id === agent_id && c.status === 'returned');
  if (rows.length === 0) return null;
  const rets = rows.map((c) => c.return_pct ?? 0);
  return {
    raids: rows.length,
    pnl_sum: r2(rows.reduce((a, c) => a + (c.realized_pnl ?? 0), 0)),
    wins: rows.filter((c) => (c.return_pct ?? 0) > 0).length,
    failures: rows.filter((c) => c.result_status?.startsWith('failed_')).length,
    return_min: Math.min(...rets),
    return_max: Math.max(...rets),
    worst_drawdown: Math.max(...rows.map((c) => c.max_drawdown ?? 0)),
  };
}
