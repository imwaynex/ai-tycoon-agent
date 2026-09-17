// sim_engine_local_v1 — 自建本地模擬引擎。純函式、決定性：同輸入 → 同戰果。
// 不連 OKX、不碰真實資金；行情為 feed_mock_crypto_v1 種子生成的假資料。

import type { ConstraintSnapshot, ExpeditionContract, ResultStatus } from './contract';

export interface SimInput {
  sim_engine_id: string;
  market_dataset_id: string;
  market_dataset_version: string;
  sim_run_id: string;
  strategy_version: string;
  simulation_principal: number;
  /** 本約計劃時長（秒）；決定模擬 tick 數，重播用同一鍵。 */
  planned_duration: number;
  constraint_snapshot: ConstraintSnapshot;
}

export interface SimResult {
  seed: number;
  result_status: ResultStatus;
  realized_pnl: number;
  return_pct: number;
  max_drawdown: number;
  trade_count: number;
  ticks_run: number;
}

/** 每壓縮秒 40 tick：短征 3 秒＝120 tick。 */
const TICKS_PER_SEC = 40;

export function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedOf(input: SimInput): number {
  return fnv1a(
    [
      input.sim_engine_id,
      input.market_dataset_id,
      input.market_dataset_version,
      input.sim_run_id,
      input.strategy_version,
      input.simulation_principal,
      input.constraint_snapshot.max_drawdown_limit_pct,
      input.constraint_snapshot.max_trade_count,
    ].join('|'),
  );
}

export function simInputOf(c: ExpeditionContract): SimInput {
  return {
    sim_engine_id: c.sim_engine_id,
    market_dataset_id: c.market_dataset_id,
    market_dataset_version: c.market_dataset_version,
    sim_run_id: c.sim_run_id,
    strategy_version: c.strategy_version,
    simulation_principal: c.simulation_principal,
    planned_duration: c.planned_duration,
    constraint_snapshot: c.constraint_snapshot,
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** D18：撤回結算的「跑了多久」（秒）＝ settled_at − dispatched_at；由契約時間戳決定，重播可重算。 */
export function withdrawnSecOf(c: Pick<ExpeditionContract, 'dispatched_at' | 'settled_at'>): number {
  if (!c.dispatched_at || !c.settled_at) return 0;
  return Math.max(0, (Date.parse(c.settled_at) - Date.parse(c.dispatched_at)) / 1000);
}

/**
 * withdrawAtSec：D18 撤回——行情路徑不變（種子同），跑到撤回那一 tick 就平倉結算。
 * 撤回前引擎已產出 failed_*（例如早已碰停損線）→ 照實保留，不改標成撤回（D5 不洗白）。
 */
export function runSim(input: SimInput, withdrawAtSec?: number): SimResult {
  const seed = seedOf(input);
  const TICKS = Math.max(1, Math.round(input.planned_duration * TICKS_PER_SEC));
  const stopAt = withdrawAtSec === undefined ? Infinity : Math.floor(withdrawAtSec * TICKS_PER_SEC);
  const rng = mulberry32(seed);
  const principal = input.simulation_principal;
  const { max_drawdown_limit_pct, max_trade_count } = input.constraint_snapshot;

  // 資料缺口／引擎超時：由種子決定是否發生、在哪一 tick 發生。
  const dataGapAt = rng() < 0.08 ? 20 + Math.floor(rng() * (TICKS - 40)) : -1;
  const timeoutAt = rng() < 0.05 ? Math.floor(TICKS / 2) + Math.floor(rng() * (TICKS / 2 - 10)) : -1;
  const drift = (rng() - 0.45) * 0.002;
  const vol = 0.003 + rng() * 0.004;

  const rets: number[] = [];
  let pos = 0; // 0 flat, 1 long（WOLF：動能突破）
  let equity = principal;
  let peak = principal;
  let maxDd = 0;
  let trades = 0;
  let status: ResultStatus = 'completed';
  let t = 0;

  for (; t < TICKS; t++) {
    if (t >= stopAt) break;
    if (t === dataGapAt) { status = 'failed_data'; break; }
    if (t === timeoutAt) { status = 'failed_timeout'; break; }

    const r = drift + (rng() * 2 - 1) * vol * Math.sqrt(3);
    if (pos === 1) equity *= 1 + r;
    rets.push(r);

    peak = Math.max(peak, equity);
    const dd = ((peak - equity) / peak) * 100;
    maxDd = Math.max(maxDd, dd);
    if (dd > max_drawdown_limit_pct) { status = 'failed_risk'; t++; break; }

    const momentum = rets.slice(-3).reduce((a, b) => a + b, 0);
    const next = momentum > vol * 0.5 ? 1 : momentum < 0 ? 0 : pos;
    if (next !== pos) {
      trades++;
      pos = next;
      if (trades > max_trade_count) { status = 'failed_constraint'; t++; break; }
    }
  }
  if (withdrawAtSec !== undefined && status === 'completed') status = 'withdrawn_settled';
  // 收盤平倉計一筆
  if (pos === 1) trades++;

  const pnl = equity - principal;
  return {
    seed,
    result_status: status,
    realized_pnl: round2(pnl),
    return_pct: round2((pnl / principal) * 100),
    max_drawdown: round2(maxDd),
    trade_count: trades,
    ticks_run: t,
  };
}

/** 重播：以契約上記錄的輸入重跑，與契約上記錄的戰果逐項比對。 */
export function verifyReplay(c: ExpeditionContract): boolean {
  if (c.result_status === null) return false;
  const again = runSim(simInputOf(c), c.result_status === 'withdrawn_settled' ? withdrawnSecOf(c) : undefined);
  return (
    again.result_status === c.result_status &&
    again.realized_pnl === c.realized_pnl &&
    again.return_pct === c.return_pct &&
    again.max_drawdown === c.max_drawdown &&
    again.trade_count === c.trade_count
  );
}
