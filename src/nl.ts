// NL 調策略（D12-1b）：一句話交代大將，不是參數工具箱。
// 規則式、決定性解析；只能動職業允許的風險硬頂（回撤上限、成交上限），且收束在職業 bounds 內。
// 行為（單一明確）：
//   - 提到職業外打法（做空、槓桿、實盤…）→ blocked（擋下，不產新版）
//   - 數值越界 → rewritten（改寫回界內，確認後產新版）
//   - 界內 → accepted（確認後產新版）
//   - 聽不出要調什麼／結果與現行相同 → blocked

import type { Profession, RiskParams } from './profession';

export type NlOutcome =
  | { kind: 'accepted'; request: string; risk: RiskParams }
  | { kind: 'rewritten'; request: string; risk: RiskParams; rewrites: string[] }
  | { kind: 'blocked'; request: string; reason: string };

const NUM = '(\\d+(?:\\.\\d+)?)';
const DD_PATTERNS = [new RegExp(`(?:回撤|回落|停損線?)[^\\d]{0,10}${NUM}`), new RegExp(`${NUM}\\s*%[^\\d]{0,4}(?:回撤|回落|停損)`)];
const TRADE_PATTERNS = [new RegExp(`(?:成交|交易|出手|買賣)[^\\d]{0,10}${NUM}`), new RegExp(`${NUM}\\s*(?:筆|次)`)];
const CAUTIOUS = /保守|穩|謹慎|小心|收斂|少出手/;
const BOLD = /積極|放手|大膽|激進|衝|多出手/;

const firstNumber = (text: string, patterns: RegExp[]): number | null => {
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return Number(m[1]);
  }
  return null;
};

export const describeRisk = (r: RiskParams) => `停損線 ${r.max_drawdown_limit_pct}%、買賣上限 ${r.max_trade_count} 次`;

export function interpretIntent(intent: string, current: RiskParams, p: Profession): NlOutcome {
  const request = intent.trim();
  if (!request) return { kind: 'blocked', request, reason: '還沒說內容。' };

  const outside = p.outOfScope.filter((o) => o.pattern.test(request)).map((o) => o.label);
  if (outside.length) {
    return { kind: 'blocked', request, reason: `「${outside.join('、')}」不在 ${p.name} 的能力內。` };
  }

  const wanted: Partial<RiskParams> = {};
  const dd = firstNumber(request, DD_PATTERNS);
  const tr = firstNumber(request, TRADE_PATTERNS);
  if (dd !== null) wanted.max_drawdown_limit_pct = dd;
  if (tr !== null) wanted.max_trade_count = Math.round(tr);

  const stance = CAUTIOUS.test(request) ? -1 : BOLD.test(request) ? 1 : 0;
  if (stance !== 0) {
    wanted.max_drawdown_limit_pct ??= current.max_drawdown_limit_pct + stance;
    wanted.max_trade_count ??= current.max_trade_count + stance * 6;
  }

  if (wanted.max_drawdown_limit_pct === undefined && wanted.max_trade_count === undefined) {
    return { kind: 'blocked', request, reason: '聽不出要改什麼。說目標和底線就好，例如「保守一點，停損線 4%」。' };
  }

  const risk: RiskParams = { ...current };
  const rewrites: string[] = [];
  const LABEL: Record<keyof RiskParams, [string, string]> = {
    max_drawdown_limit_pct: ['停損線', '%'],
    max_trade_count: ['買賣上限', ' 次'],
  };
  for (const k of Object.keys(LABEL) as (keyof RiskParams)[]) {
    const v = wanted[k];
    if (v === undefined) continue;
    const [lo, hi] = p.bounds[k];
    const clamped = Math.min(hi, Math.max(lo, v));
    if (clamped !== v) {
      const [name, unit] = LABEL[k];
      rewrites.push(`${name} ${v}${unit} → ${clamped}${unit}（它只能在 ${lo}–${hi}${unit}）`);
    }
    risk[k] = clamped;
  }

  if (risk.max_drawdown_limit_pct === current.max_drawdown_limit_pct && risk.max_trade_count === current.max_trade_count) {
    const why = rewrites.length ? `收回界內後，` : '';
    return { kind: 'blocked', request, reason: `${why}跟現在的打法一樣（${describeRisk(current)}），不用改。` };
  }

  return rewrites.length ? { kind: 'rewritten', request, risk, rewrites } : { kind: 'accepted', request, risk };
}
