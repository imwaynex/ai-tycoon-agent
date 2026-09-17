// 文案槽。
// D16b：玩家可見用詞唯一準據＝03-世界敘事/文案槽-用詞人話-D16b.md（與 D14 衝突時聽 D16b）。
// D14：層級（L0 每態 ≤2 行、一個主 CTA、無 NL）仍聽 03-世界敘事/文案槽-主路徑極短句-D14.md。
// D18：玩家可見用詞以 03-世界敘事/文案槽-D18-派出撤回與畫面精簡.md 為準——玩家面無「模擬」字；撤回＝帶回戰報；改打法只在派出前。
// 內部 enum（ready／in_field／returned／withdrawn_settled／failed_*）只在程式裡，**永不**進 UI 字串。
import type { ExpeditionContract, ResultStatus } from './contract';

/** 步驟短標（D16b §2）；紀錄＝次級入口。 */
export const STEPS = { appoint: '任命', dispatch: '派出', report: '戰報' } as const;
export const HISTORY = '紀錄';

/** 屏標題（D16b §2）。 */
export const SCREEN = {
  appoint: '大將',
  dispatch: '派出',
  report: '戰報',
  wall: '出征紀錄',
} as const;

export const CTA = {
  appoint: '任命',
  reappoint: '重新任命',
  dispatch: '派出',
  redispatch: '再派',
  withdraw: '撤回',
  withdrawHint: '停用這員',
  whyNot: '為什麼',
  adjust: '改打法',
  /** D18：出征中主 CTA（withdraw_in_field）。 */
  withdrawInField: '撤回',
  nlSubmit: '說',
  nlConfirm: '確認',
  nlClose: '收起',
} as const;

/** F7 badge */
export const BADGE_NEW = '有新結果';

/** F4：不可達時的極短原因（一行）。 */
export const NAV_REASON = {
  cannotDispatch: '現在不能派。',
  noContract: '還沒有可派的。',
  noReport: '還沒有戰報。',
} as const;

// ---- L0：主路徑極短句（D16b §3） ----

export const L0 = {
  appointEmpty: '還沒有大將。',
  appointBlocked: '現在不能派。',
  dispatchReady: (name: string) => `派 ${name} 出去。`,
  sending: '正在派出…',
  inField: '在外面。等結果。',
  returned: (name: string) => `${name} 回來了。`,
  folded: (name: string, reason: string) => `${name} 提前回來。${reason}。`,
  withdrawn: (name: string) => `${name} 已撤回。紀錄都留著。`,
  /** D18：出征中撤回結算後的戰報 L0。 */
  withdrawnSettled: (name: string) => `${name} 已撤回。戰報帶回。`,
} as const;

/** F3：期間選定／鎖定回饋。 */
export const PICKED = (label: string) => `選好了：${label}`;
export const LOCKED = (label: string) => `這次：${label}`;

/** 戰報數字標。 */
export const METRIC = { pnl: '賺賠', drawdown: '最大回落' } as const;

/** 大將副行（可選一行）：{profession} · {composite_brief} */
export const appointSubline = (profession: string, brief: string) => `${profession} · ${brief}`;
export const compositeBrief = (raids: number, pnl: string) => (raids === 0 ? '還沒出過征' : `出征 ${raids} 次 · 賺賠 ${pnl}`);

// ---- F9：出征紀錄緊湊入口（D18：不在派出頁；大將／戰報後才有） ----

export const WALL_COMPACT = {
  empty: '還沒出過征',
  latest: (outcome: string, pnl: string) => `最近：${outcome} ${pnl}`,
  link: '出征紀錄',
} as const;

// ---- L1：次級（展開才見） ----

export const L1 = {
  professionDetail: '這員會什麼',
  dispatchDetail: '這次怎麼派',
  fullText: '看全文',
  devDetail: '開發詳情',
  wallEmpty: '還沒出過征。',
  wallFoot: '提前回來的也留著。',
} as const;

/** D18 大將 L2 產品說明（點開才見；禁「模擬」字、不寫成真盤）。 */
export const VIRTUAL_FUNDS_NOTE = '大將使用虛擬資金，交易不會送往真實市場。';

/** 職業三欄縮寫標籤（各 ≤8 字）與 WOLF 示意。 */
export const SKILL_SHORT_LABEL = { ability: '會什麼', applicable_context: '適合', limits: '不能超' } as const;
export const SKILL_SHORT_WOLF = { ability: '突破就跟', applicable_context: '單邊動能短征', limits: '碰停損線就回' } as const;

/** 折返原因短句（L0 用；不帶「提前回來」，免與 `{name} 提前回來。` 重複）。準據：D16b §4。 */
export const REASON_SHORT: Record<Exclude<ResultStatus, 'completed' | 'withdrawn_settled'>, string> = {
  failed_risk: '碰到停損線',
  failed_data: '行情暫時看不清',
  failed_timeout: '時間到了',
  failed_constraint: '買賣次數用完了',
};

/** 結果人話（紀錄列、指標「為什麼」）。 */
export const OUTCOME = { completed: '回來了', folded: '提前回來', withdrawn: '已撤回' } as const;
export const RESULT_LABEL: Record<ResultStatus, string> = {
  completed: '跑完了',
  ...REASON_SHORT,
  withdrawn_settled: '你叫它回來了',
};

/** 提前回來次行：賺賠與提前回來不互斥。 */
export const FOLD_NOTE = { profit: '這次有賺，但規則叫停，提前回來。已記下。', logged: '已記下。' } as const;

/**
 * 戰報 L0（≤2 行）：正常＝`{name} 回來了。`；提前回來＝`{name} 提前回來。{reason_short}。`＋次行。
 * 禁止空喊「失敗」、禁 raw failed_*：正賺時次行明說「有賺，但規則叫停」。
 */
export function reportL0(c: Pick<ExpeditionContract, 'result_status' | 'realized_pnl'>, name: string): [string] | [string, string] {
  if (!c.result_status || c.result_status === 'completed') return [L0.returned(name)];
  // D18：撤回≠失敗；有賺也只「已記下」，數字說話。
  if (c.result_status === 'withdrawn_settled') return [L0.withdrawnSettled(name), FOLD_NOTE.logged];
  return [L0.folded(name, REASON_SHORT[c.result_status]), (c.realized_pnl ?? 0) > 0 ? FOLD_NOTE.profit : FOLD_NOTE.logged];
}

// ---- D12（僅 L1 展開／L2 薄層） ----

/** P0 三欄全文標籤 */
export const SKILL_LABEL = {
  profession: '職業',
  ability: '會什麼',
  applicable_context: '適合什麼',
  limits: '不能超什麼',
} as const;

export const P2 = ['還沒出過征。', '派一次，這裡才有數字。'];
export const COMPOSITE_TITLE = '整體表現';

// ---- D18 §3：派出前「改打法」（L2；戰報頁無入口） ----

export const N0 = (name: string) => `派出前跟 ${name} 交代這次怎麼打。`;
export const N0_PLACEHOLDER = '例：保守一點，停損線 4%';
export const N_NOW = (risk: string) => `現在：${risk}`;
export const N1 = (accepted: string) => `收到。${accepted} 仍在它會的範圍內。可以派出。`;
export const N1B = (rewritten: string) => `超出它會的了。已收束：${rewritten}。確認後可派出。`;
export const N2 = '這步做不到——不是不肯，是不能超。收一收再試。';
export const N3 = '這裡是交代大將，不是改設定面板。';

export const PERIOD_TITLE = '這次跑多久';
export const PERIOD_LOCKED = '派出後就不能改時長了。';

/** 契約摘要（L1「這次怎麼派」）人話標。 */
export const SUMMARY = {
  agent: '大將',
  principal: '虛擬本金',
  period: '跑多久',
  rules: '規則',
} as const;

/** 指標人話標（改打法／紀錄展開）。 */
export const METRICS = {
  returnPct: '報酬',
  trades: '買賣',
  period: '跑多久',
  elapsed: '實際花了',
  why: '為什麼',
} as const;

/** 整體表現人話標。 */
export const PERF = {
  raids: '出征次數',
  folded: '提前回來',
  pnl: '累計賺賠',
  wins: '有賺',
  range: '報酬區間',
  drawdown: '最大回落',
} as const;
