// 出征契約 — D11 lock 32 必填欄位。不得新增經濟欄位。
// D12 補丁（D13 准）：期間屬單次契約；constraint_snapshot 最小鍵 ability／applicable_context／limits。
// D18 補丁：cancel_supported=true（語意＝出征中撤回→立刻結算，非無結果取消）；result_status 加 withdrawn_settled。32 名單不變。

import {
  WOLF,
  professionOf,
  riskWithinBounds,
  skillKeysOk,
  type RiskParams,
  type SkillText,
} from './profession';

export const REQUIRED_FIELDS = [
  'contract_id',
  'empire_id',
  'agent_id',
  'strategy_version',
  'simulation_principal',
  'currency',
  'time_window_type',
  'planned_duration',
  'simulation_source',
  'sim_engine_id',
  'market_dataset_id',
  'market_dataset_version',
  'sim_run_id',
  'status',
  'created_at',
  'dispatched_at',
  'settled_at',
  'battle_result_id',
  'result_status',
  'realized_pnl',
  'return_pct',
  'max_drawdown',
  'trade_count',
  'attribution_ref',
  'constraint_snapshot',
  'evidence_id',
  'is_official',
  'replay_ok',
  'parallel_dispatch_allowed',
  'cancel_supported',
  'okx_dependency',
  'real_funds',
] as const;

export type RequiredField = (typeof REQUIRED_FIELDS)[number];

/** lock-D11 §3：ready＝可派、in_field＝出征中、returned＝已歸來。無 draft／cancel／withdrawn 態。 */
export const CONTRACT_STATUSES = ['ready', 'in_field', 'returned'] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

/** 合法轉移：ready → in_field → returned（到點 settle 或撤回 settle，同終態）。再派＝新契約（ready），不改寫舊契約。 */
export const LEGAL_TRANSITIONS: Readonly<Record<ContractStatus, readonly ContractStatus[]>> = {
  ready: ['in_field'],
  in_field: ['returned'],
  returned: [],
};

export const canTransition = (from: ContractStatus, to: ContractStatus): boolean =>
  LEGAL_TRANSITIONS[from].includes(to);

export const RESULT_STATUSES = [
  'completed',
  'failed_risk',
  'failed_data',
  'failed_timeout',
  'failed_constraint',
  /** D18：撤回觸發之正式結算；損益可正／零／負，≠失敗。 */
  'withdrawn_settled',
] as const;
export type ResultStatus = (typeof RESULT_STATUSES)[number];

/** D18 選填（不進 32、不升必填）：撤回路徑寫入。 */
export interface OptionalContractFields {
  withdrawn_at?: string;
}

export interface SimulationSource {
  engine: string;
  dataset: string;
  dataset_version: string;
  run: string;
}

/** 派出當下的職業限制快照：Skill 三鍵（D13 寫死）＋本約風險硬頂。 */
export interface ConstraintSnapshot extends SkillText, RiskParams {}

/** 出征期間選項（D12-2）：每約可選；秒數為壓縮原型預設。 */
export const TIME_WINDOWS = [
  { time_window_type: 'short_raid', label: '短征', planned_duration: 3 },
  { time_window_type: 'day_raid', label: '日', planned_duration: 5 },
  { time_window_type: 'week_raid', label: '週', planned_duration: 8 },
] as const;
export type TimeWindowType = (typeof TIME_WINDOWS)[number]['time_window_type'];

export const windowOf = (t: string) => TIME_WINDOWS.find((w) => w.time_window_type === t) ?? null;

/** 本約時窗／計劃時長存在且合法（兩鍵對應同一選項）。 */
export const windowLegal = (c: Pick<ExpeditionContract, 'time_window_type' | 'planned_duration'>): boolean =>
  windowOf(c.time_window_type)?.planned_duration === c.planned_duration;

export interface ExpeditionContract {
  contract_id: string;
  empire_id: string;
  agent_id: string;
  strategy_version: string;
  simulation_principal: number;
  currency: string;
  time_window_type: TimeWindowType;
  /** seconds, wall-clock compressed */
  planned_duration: number;
  simulation_source: SimulationSource;
  sim_engine_id: string;
  market_dataset_id: string;
  market_dataset_version: string;
  sim_run_id: string;
  status: ContractStatus;
  created_at: string;
  dispatched_at: string | null;
  settled_at: string | null;
  battle_result_id: string | null;
  result_status: ResultStatus | null;
  realized_pnl: number | null;
  /** percent, e.g. 1.25 = +1.25% */
  return_pct: number | null;
  /** percent, positive number */
  max_drawdown: number | null;
  trade_count: number | null;
  attribution_ref: string | null;
  constraint_snapshot: ConstraintSnapshot;
  evidence_id: string | null;
  is_official: boolean;
  replay_ok: boolean;
  parallel_dispatch_allowed: false;
  cancel_supported: true;
  okx_dependency: false;
  real_funds: false;
}

// Compile-time guard: interface keys === lock list, no more, no less.
type _Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _keysMatch: _Exact<keyof ExpeditionContract, RequiredField> = true;
void _keysMatch;

export const DEFAULTS = {
  empire_id: 'empire_demo_01',
  agent_id: WOLF.agent_id,
  agent_display: WOLF.display,
  strategy_version: WOLF.base_strategy_version,
  simulation_principal: 10000,
  currency: 'sandbox_USD',
  time_window_type: 'short_raid' as TimeWindowType,
  sim_engine_id: 'sim_engine_local_v1',
  market_dataset_id: 'feed_mock_crypto_v1',
  market_dataset_version: '2026.09.17',
};

export interface ContractOptions {
  strategy_version: string;
  risk: RiskParams;
  time_window_type: TimeWindowType;
}

const DEFAULT_OPTIONS: ContractOptions = {
  strategy_version: DEFAULTS.strategy_version,
  risk: WOLF.base_risk,
  time_window_type: DEFAULTS.time_window_type,
};

const pad = (n: number) => String(n).padStart(6, '0');

export function createContract(seq: number, now: Date, opts: ContractOptions = DEFAULT_OPTIONS): ExpeditionContract {
  const run = `run_${pad(seq)}`;
  const win = windowOf(opts.time_window_type) ?? TIME_WINDOWS[0];
  return {
    contract_id: `ct_${pad(seq)}`,
    empire_id: DEFAULTS.empire_id,
    agent_id: DEFAULTS.agent_id,
    strategy_version: opts.strategy_version,
    simulation_principal: DEFAULTS.simulation_principal,
    currency: DEFAULTS.currency,
    time_window_type: win.time_window_type,
    planned_duration: win.planned_duration,
    simulation_source: {
      engine: DEFAULTS.sim_engine_id,
      dataset: DEFAULTS.market_dataset_id,
      dataset_version: DEFAULTS.market_dataset_version,
      run,
    },
    sim_engine_id: DEFAULTS.sim_engine_id,
    market_dataset_id: DEFAULTS.market_dataset_id,
    market_dataset_version: DEFAULTS.market_dataset_version,
    sim_run_id: run,
    status: 'ready',
    created_at: now.toISOString(),
    dispatched_at: null,
    settled_at: null,
    battle_result_id: null,
    result_status: null,
    realized_pnl: null,
    return_pct: null,
    max_drawdown: null,
    trade_count: null,
    attribution_ref: null,
    constraint_snapshot: {
      ...WOLF.profession.skill,
      max_drawdown_limit_pct: opts.risk.max_drawdown_limit_pct,
      max_trade_count: opts.risk.max_trade_count,
    },
    evidence_id: null,
    is_official: false,
    replay_ok: false,
    parallel_dispatch_allowed: false,
    cancel_supported: true,
    okx_dependency: false,
    real_funds: false,
  };
}

export function missingFields(obj: object): RequiredField[] {
  return REQUIRED_FIELDS.filter((f) => !Object.prototype.hasOwnProperty.call(obj, f));
}

export function hardFlagsOk(c: ExpeditionContract): boolean {
  return (
    c.okx_dependency === false &&
    c.real_funds === false &&
    c.cancel_supported === true &&
    c.parallel_dispatch_allowed === false
  );
}

/** 快照守門：Skill 三鍵非空，且風險硬頂未越過該員職業限制（可稽核「策略未越權」）。 */
export function constraintSnapshotOk(c: ExpeditionContract): boolean {
  const p = professionOf(c.agent_id);
  return !!p && skillKeysOk(c.constraint_snapshot) && riskWithinBounds(p, c.constraint_snapshot);
}

/**
 * 結算閘：欄位齊、硬旗標正確、期間合法、Skill 快照齊且未越權、結算資料完整。
 * 失敗（result_status=failed_*）仍可通過閘——它是可稽核的失敗紀錄，不洗白。
 */
export function settlementGatePasses(c: ExpeditionContract): boolean {
  return (
    missingFields(c).length === 0 &&
    hardFlagsOk(c) &&
    windowLegal(c) &&
    constraintSnapshotOk(c) &&
    c.status === 'returned' &&
    c.settled_at !== null &&
    c.dispatched_at !== null &&
    c.result_status !== null &&
    (RESULT_STATUSES as readonly string[]).includes(c.result_status) &&
    c.battle_result_id !== null &&
    c.evidence_id !== null &&
    c.attribution_ref !== null &&
    c.realized_pnl !== null &&
    c.return_pct !== null &&
    c.max_drawdown !== null &&
    c.trade_count !== null
  );
}
