// D16 Choose A 流暢度：純函式導覽規則（可測；App 只照做）。
// F2：導覽永不改 AppState（不建約、不派出）——本檔只讀 AppState，只回 UI 狀態。
// 準據：04-體驗設計/IA流暢度改稿-D16.md §0／§5／§6。

import type { AppState } from './store';
import { NAV_REASON } from './copy';

export type Screen = 'appoint' | 'dispatch' | 'report' | 'wall';

export type Reach = { ok: true } | { ok: false; reason: string };

/** F4 可達性（§5）：大將＋出征紀錄恆可達；派出需可呈現契約；戰報需可呈現戰報。 */
export function reach(state: AppState, target: Screen): Reach {
  const c = state.current;
  const enabled = !!state.config?.enabled;
  switch (target) {
    case 'appoint':
    case 'wall':
      return { ok: true };
    case 'dispatch':
      if (!state.config) return { ok: false, reason: NAV_REASON.noContract };
      if (!enabled) return { ok: false, reason: NAV_REASON.cannotDispatch };
      return c ? { ok: true } : { ok: false, reason: NAV_REASON.noContract };
    case 'report':
      return enabled && c?.status === 'returned' ? { ok: true } : { ok: false, reason: NAV_REASON.noReport };
  }
}

/** F7：進入已回來的派出席 → 直接戰報（不放「看戰報」CTA）。 */
export function redirect(state: AppState, target: Screen): Screen {
  if (target === 'dispatch' && state.config?.enabled && state.current?.status === 'returned') return 'report';
  return target;
}

/** 開 App 時的預設屏（主路徑下一點不猜）。 */
export function defaultScreen(s: AppState): Screen {
  if (!s.config || !s.config.enabled || !s.current) return 'appoint';
  return redirect(s, 'dispatch');
}

/** 初始屏：指定屏若不可達 → 預設屏。 */
export function initialScreenOf(s: AppState, requested?: Screen): Screen {
  if (!requested) return defaultScreen(s);
  const target = redirect(s, requested);
  return reach(s, target).ok ? target : defaultScreen(s);
}

export interface Ui {
  screen: Screen;
  /** 改打法薄層（D18：只在派出 ready） */
  adjustOpen: boolean;
  /** NL 子薄層（D18 起改打法直接開 NL；保留欄位供舊導覽規則） */
  nlOpen: boolean;
  /** F8：NL 草稿依 contract_id hoist；go() 不清。 */
  drafts: Readonly<Record<string, string>>;
  /** F4：不可達原因（極短，一行）。 */
  notice: string | null;
  /** F7：有未看的結果（contract_id）；到戰報即清。 */
  unseen: string | null;
}

export const initialUi = (state: AppState, requested?: Screen): Ui => ({
  screen: initialScreenOf(state, requested),
  adjustOpen: false,
  nlOpen: false,
  drafts: {},
  notice: null,
  unseen: null,
});

/** go()：可達才切；切席可關薄層，但 **不清 drafts**（F8）。不可達 → 不切＋極短原因（F4）。 */
export function go(ui: Ui, state: AppState, target: Screen): Ui {
  const next = redirect(state, target);
  const r = reach(state, next);
  if (!r.ok) return { ...ui, notice: r.reason };
  return {
    ...ui,
    screen: next,
    adjustOpen: false,
    nlOpen: false,
    notice: null,
    unseen: next === 'report' ? null : ui.unseen,
  };
}

/**
 * F7：結算後怎麼走。
 * 仍在派出席且無編輯薄層開著 → 自動進戰報；否則留原席＋「有新結果」badge。
 */
export function afterSettle(ui: Ui, state: AppState): Ui {
  const c = state.current;
  if (!c || c.status !== 'returned') return ui;
  const sheetOpen = ui.adjustOpen || ui.nlOpen;
  if (ui.screen === 'dispatch' && !sheetOpen) return go(ui, state, 'report');
  if (ui.screen === 'report') return ui;
  return { ...ui, unseen: c.contract_id };
}

export function setDraft(ui: Ui, contractId: string, text: string): Ui {
  return { ...ui, drafts: { ...ui.drafts, [contractId]: text } };
}

export function clearDraft(ui: Ui, contractId: string): Ui {
  const { [contractId]: _, ...rest } = ui.drafts;
  return { ...ui, drafts: rest };
}

/** F6：派出後這段時間內顯示「正在派出…」，之後換成進度（以狀態為準，不擋操作）。 */
export const SENDING_MS = 600;
export const isSending = (dispatchedAt: string | null, now: number): boolean =>
  !!dispatchedAt && now - Date.parse(dispatchedAt) < SENDING_MS;
