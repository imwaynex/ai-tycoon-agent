// 職業＝Skill（D12-1）。D16b：三欄全文用詞換人話（折返→提前回來、回撤→回落／停損線、成交→買賣）。
// 三欄：能力（會什麼）／適用情境（適合什麼）／限制（不能超什麼）。
// 文案取自 03-世界敘事/文案槽-職業Skill與NL調策略-D12-草案.md「示意｜WOLF 三欄」。
// 限制有機器可檢部分（bounds / outOfScope）：NL 調策略與派出閘、結算閘都以此守門。

export interface RiskParams {
  max_drawdown_limit_pct: number;
  max_trade_count: number;
}

/** constraint_snapshot 的 D13 最小鍵。 */
export interface SkillText {
  ability: string;
  applicable_context: string;
  limits: string;
}

export interface Profession {
  name: string;
  skill: SkillText;
  /** [下限, 上限]；NL 調策略不可越過。 */
  bounds: { [K in keyof RiskParams]: readonly [number, number] };
  /** 職業外打法：NL 提到即擋下。 */
  outOfScope: readonly { pattern: RegExp; label: string }[];
}

export interface AgentDef {
  agent_id: string;
  display: string;
  profession: Profession;
  base_strategy_version: string;
  base_risk: RiskParams;
}

export const MOMENTUM_BREAKOUT: Profession = {
  name: '動能突破',
  skill: {
    ability: '突破就跟；趨勢在，倉位跟得上。',
    applicable_context: '單邊動能明確、能忍較大回落換報酬的短征。',
    limits: '碰到停損線就提前回來（最大回落 ≤ 6%、買賣 ≤ 30 次）；不做它不會的、不破底線。',
  },
  bounds: {
    max_drawdown_limit_pct: [2, 6],
    max_trade_count: [5, 30],
  },
  outOfScope: [
    { pattern: /做空|放空|空單/, label: '做空' },
    { pattern: /槓桿/, label: '加槓桿' },
    { pattern: /均值回歸|抄底|摸底|逆勢/, label: '逆勢抄底' },
    { pattern: /網格/, label: '網格' },
    { pattern: /實盤|真實資金|真錢|okx/i, label: '實盤／真實資金' },
    { pattern: /(取消|拿掉|關掉|不要|不設|沒有|無)(風險)?(限制|上限|硬頂)|不設限/, label: '拿掉硬頂' },
  ],
};

export const WOLF: AgentDef = {
  agent_id: 'agent_wolf',
  display: 'WOLF',
  profession: MOMENTUM_BREAKOUT,
  base_strategy_version: 'strat_wolf_v1',
  base_risk: { max_drawdown_limit_pct: 5, max_trade_count: 24 },
};

export const AGENTS: Readonly<Record<string, AgentDef>> = { [WOLF.agent_id]: WOLF };

export const professionOf = (agent_id: string): Profession | null => AGENTS[agent_id]?.profession ?? null;

export const SKILL_KEYS = ['ability', 'applicable_context', 'limits'] as const;

/** 三鍵存在且非空白字串。 */
export function skillKeysOk(snapshot: unknown): boolean {
  if (!snapshot || typeof snapshot !== 'object') return false;
  const s = snapshot as Record<string, unknown>;
  return SKILL_KEYS.every((k) => typeof s[k] === 'string' && (s[k] as string).trim() !== '');
}

/** 風險鍵皆落在職業限制內。 */
export function riskWithinBounds(p: Profession, r: Partial<RiskParams>): boolean {
  return (Object.keys(p.bounds) as (keyof RiskParams)[]).every((k) => {
    const v = r[k];
    const [lo, hi] = p.bounds[k];
    return typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
  });
}
