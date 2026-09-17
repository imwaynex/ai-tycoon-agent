// D16 Choose A（F1–F9）＋ D16b 用詞（Wd1–Wd5）。
// 準據：04-體驗設計/IA流暢度改稿-D16.md §0／§5／§6／§11；03-世界敘事/文案槽-用詞人話-D16b.md；01-範圍/驗收句-用詞好懂-D16b.md。
// 導覽規則以 flow.ts 純函式測；畫面以 SSR 靜態輸出測；接線以 App 原始碼守門（無 DOM 測試環境）。
// D18 覆寫處（F6 撤回、F8 薄層改在派出、F9 派出頁無紀錄、Wd5 無模擬標）已就地更新；D18 專測見 d18.test.ts。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import App from './App';
import APP_SRC from './App.tsx?raw';
import * as copy from './copy';
import { DEFAULTS, TIME_WINDOWS } from './contract';
import * as flow from './flow';
import {
  appoint,
  dispatch,
  initialState,
  redispatch,
  save,
  setTimeWindow,
  settle,
  withdraw,
  withdrawInField,
  type AppState,
} from './store';

const T0 = new Date('2026-09-17T12:00:00.000Z');
const at = (s: number) => new Date(T0.getTime() + s * 1000);
const NAME = DEFAULTS.agent_display;

function mount(state: AppState | null, screen?: flow.Screen): string {
  const data = new Map<string, string>();
  const kv = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  if (state) save(state, kv);
  (globalThis as { localStorage?: unknown }).localStorage = kv;
  return renderToStaticMarkup(createElement(App, { initialScreen: screen }));
}
afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

/** 玩家可見文字：去標籤；「開發詳情」（dev 摺疊，允許技術欄位）不算。 */
const visible = (html: string) =>
  html
    .replace(/<details class="more dev">[\s\S]*?<\/details>/g, '')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&amp;/g, '&');
const l0Text = (html: string) => visible(html.replace(/<details[\s\S]*?<\/details>/g, ''));

const appointed = () => appoint(initialState(), T0);
const inField = () => dispatch(appointed(), T0);
const returned = () => settle(inField(), at(10));
const withdrawn = () => withdraw(appointed());
const ui = (s: AppState, screen: flow.Screen, extra: Partial<flow.Ui> = {}): flow.Ui => ({ ...flow.initialUi(s), screen, ...extra });

describe('F1｜任命成功 → 自動進派出；大將頁無「去出征」', () => {
  it('任命後導向派出（可達、ready 態有派出 CTA）', () => {
    const s = appointed();
    const u = flow.go(ui(initialState(), 'appoint'), s, 'dispatch');
    expect(u.screen).toBe('dispatch');
    expect(u.notice).toBeNull();
    expect(mount(s, 'dispatch')).toMatch(new RegExp(`class="cta"[^>]*>${copy.CTA.dispatch}<`));
  });

  it('接線：任命／重新任命按鈕走 actGo(…, "dispatch")', () => {
    expect(APP_SRC).toMatch(/const doAppoint = \(\) => actGo\(\(s\) => appoint\(s, new Date\(\)\), 'dispatch'\)/);
    expect((APP_SRC.match(/onClick=\{doAppoint\}/g) ?? []).length).toBe(1);
  });

  it('大將頁（ready／returned）無主 CTA、無 goDispatch', () => {
    expect('goDispatch' in copy.CTA).toBe(false);
    for (const s of [appointed(), returned()]) {
      const html = mount(s, 'appoint');
      expect(html).not.toContain('class="cta"');
      expect(visible(html)).not.toContain('去出征');
    }
  });
});

describe('F2｜只有「派出」commit；導覽不建約、不派出', () => {
  const states = () => [initialState(), appointed(), inField(), returned(), withdrawn()];

  it('flow.go 對所有態、所有目標都不改 AppState', () => {
    for (const s of states()) {
      const before = JSON.stringify(s);
      for (const t of ['appoint', 'dispatch', 'report', 'wall'] as const) {
        flow.go(ui(s, 'appoint'), s, t);
        flow.afterSettle(ui(s, t), s);
      }
      expect(JSON.stringify(s)).toBe(before);
    }
  });

  it('接線：dispatch() 只在派出鈕；redispatch() 只在戰報再派；go 不呼叫 store', () => {
    expect(APP_SRC.match(/\bdispatch\(s, new Date\(\)\)/g)).toHaveLength(1);
    expect(APP_SRC.match(/\bredispatch\(s, new Date\(\)\)/g)).toHaveLength(1);
    expect(APP_SRC).toMatch(/const go = \(target: Screen\) => setUi\(\(u\) => flow\.go\(u, stateRef\.current, target\)\);/);
  });
});

describe('F3｜期間：短征／日／週；選好了 → 這次；再派預填', () => {
  it('選項標籤＝短征／日／週', () => {
    expect(TIME_WINDOWS.map((w) => w.label)).toEqual(['短征', '日', '週']);
  });

  it('ready：選後可見「選好了：日」', () => {
    const s = setTimeWindow(appointed(), 'day_raid');
    expect(l0Text(mount(s, 'dispatch'))).toContain('選好了：日');
  });

  it('派出後鎖成「這次：週」，無可點期間', () => {
    const s = dispatch(setTimeWindow(appointed(), 'week_raid'), new Date(Date.now() - 1000));
    const html = mount(s, 'dispatch');
    expect(l0Text(html)).toContain('這次：週');
    expect(l0Text(html)).not.toContain('選好了');
    expect(html).not.toContain('role="radiogroup"');
  });

  it('再派預填上一趟期間', () => {
    const s = redispatch(settle(dispatch(setTimeWindow(appointed(), 'week_raid'), T0), at(10)), at(20));
    expect(s.current!.time_window_type).toBe('week_raid');
    expect(l0Text(mount(s, 'dispatch'))).toContain('選好了：週');
  });
});

describe('F4｜可達性：大將＋紀錄恆可達；派出需契約；戰報需戰報', () => {
  it('reach 表', () => {
    const cases: [AppState, boolean, boolean][] = [
      [initialState(), false, false],
      [appointed(), true, false],
      [inField(), true, false],
      [returned(), true, true],
      [withdrawn(), false, false],
    ];
    for (const [s, d, r] of cases) {
      expect(flow.reach(s, 'appoint').ok).toBe(true);
      expect(flow.reach(s, 'wall').ok).toBe(true);
      expect(flow.reach(s, 'dispatch').ok).toBe(d);
      expect(flow.reach(s, 'report').ok).toBe(r);
    }
  });

  it('不可達 → 不切屏＋極短原因', () => {
    const s = initialState();
    const u = flow.go(ui(s, 'appoint'), s, 'report');
    expect(u.screen).toBe('appoint');
    expect(u.notice).toBe(copy.NAV_REASON.noReport);
    const d = flow.go(ui(s, 'appoint'), s, 'dispatch');
    expect(d.screen).toBe('appoint');
    expect(d.notice).toBe(copy.NAV_REASON.noContract);
    expect(flow.go(ui(withdrawn(), 'appoint'), withdrawn(), 'dispatch').notice).toBe(copy.NAV_REASON.cannotDispatch);
    expect(flow.go(ui(inField(), 'dispatch'), inField(), 'report').screen).toBe('dispatch');
    for (const r of Object.values(copy.NAV_REASON)) expect([...r].length).toBeLessThanOrEqual(8);
  });

  it('可達 → 切屏並清原因；指定不可達初始屏 → 預設屏', () => {
    const s = appointed();
    const u = flow.go({ ...ui(s, 'appoint'), notice: 'x' }, s, 'wall');
    expect(u).toMatchObject({ screen: 'wall', notice: null });
    expect(flow.initialScreenOf(initialState(), 'report')).toBe('appoint');
    expect(flow.initialScreenOf(inField(), 'report')).toBe('dispatch');
  });

  it('步驟列：不可達的步驟標淡（aria-disabled），紀錄恆在', () => {
    const html = mount(null);
    expect(html.match(/aria-disabled="true"/g)).toHaveLength(2);
    expect(visible(html)).toContain(copy.HISTORY);
    expect(mount(returned(), 'report')).not.toContain('aria-disabled');
  });
});

describe('F5｜只有戰報「再派」建新 ready；大將頁無暗門', () => {
  it('大將頁 returned：無再派字、無主 CTA', () => {
    const html = mount(returned(), 'appoint');
    expect(visible(html)).not.toContain(copy.CTA.redispatch);
    expect(html).not.toContain('class="cta"');
  });

  it('戰報：再派為主 CTA；按後進派出 ready（新契約）', () => {
    const s0 = returned();
    expect(mount(s0, 'report')).toMatch(new RegExp(`class="cta"[^>]*>${copy.CTA.redispatch}<`));
    const s1 = redispatch(s0, at(20));
    expect(s1.current!.contract_id).not.toBe(s0.current!.contract_id);
    expect(flow.go(ui(s0, 'report'), s1, 'dispatch').screen).toBe('dispatch');
    expect(APP_SRC).toMatch(/actGo\(\(s\) => redispatch\(s, new Date\(\)\), 'dispatch'\)/);
  });
});

describe('F6｜正在派出… → 進度；無禁用「等待戰報」hero', () => {
  it('剛派出：L0＝正在派出…，尚無進度條', () => {
    const html = mount(dispatch(appointed(), new Date()), 'dispatch');
    expect(l0Text(html)).toContain(copy.L0.sending);
    expect(html).not.toContain('role="progressbar"');
  });

  it('過渡後：在外面。等結果。＋進度＋撤回（D18）；無 disabled CTA、無等戰報', () => {
    const html = mount(dispatch(appointed(), new Date(Date.now() - 1000)), 'dispatch');
    expect(l0Text(html)).toContain(copy.L0.inField);
    expect(html).toContain('role="progressbar"');
    expect(html).not.toMatch(/<button[^>]*\sdisabled[=\s>]/);
    expect(visible(html)).not.toMatch(/等待戰報|等戰報/);
  });

  it('isSending 以派出時間為準', () => {
    const t = '2026-09-17T12:00:00.000Z';
    expect(flow.isSending(t, Date.parse(t) + flow.SENDING_MS - 1)).toBe(true);
    expect(flow.isSending(t, Date.parse(t) + flow.SENDING_MS)).toBe(false);
    expect(flow.isSending(null, 0)).toBe(false);
  });
});

describe('F7｜結算後：仍在派出且無薄層 → 自動戰報；否則 badge「有新結果」', () => {
  const s = returned();

  it('在派出席、無薄層 → 戰報', () => {
    expect(flow.afterSettle(ui(s, 'dispatch'), s)).toMatchObject({ screen: 'report', unseen: null });
  });

  it('已切走（大將／紀錄）→ 留原席＋badge', () => {
    for (const where of ['appoint', 'wall'] as const) {
      const u = flow.afterSettle(ui(s, where), s);
      expect(u.screen).toBe(where);
      expect(u.unseen).toBe(s.current!.contract_id);
    }
  });

  it('編輯薄層開著 → 不搶席，badge', () => {
    for (const extra of [{ adjustOpen: true }, { nlOpen: true }]) {
      const u = flow.afterSettle(ui(s, 'dispatch', extra), s);
      expect(u.screen).toBe('dispatch');
      expect(u.unseen).toBe(s.current!.contract_id);
    }
  });

  it('進戰報即清 badge；接線：計時器走 afterSettle，不直接 go("report")', () => {
    const u = flow.afterSettle(ui(s, 'appoint'), s);
    expect(flow.go(u, s, 'report').unseen).toBeNull();
    expect(copy.BADGE_NEW).toBe('有新結果');
    expect(APP_SRC).toContain('flow.afterSettle(u, next)');
    expect(APP_SRC).not.toMatch(/go\('report'\)/);
  });

  it('進入已回來的派出 → 直接戰報，無「看戰報」CTA', () => {
    expect(flow.go(ui(s, 'appoint'), s, 'dispatch').screen).toBe('report');
    const html = mount(s, 'dispatch');
    expect(l0Text(html)).toContain(copy.L0.returned(NAME).slice(0, 4));
    expect(visible(html)).not.toContain('看戰報');
  });
});

describe('F8｜go() 關薄層但不清 NL 草稿（依 contract_id）', () => {
  it('草稿跨切席保留；薄層關閉（D18：改打法在派出 ready）', () => {
    const s = appointed();
    const id = s.current!.contract_id;
    let u = flow.setDraft(ui(s, 'dispatch', { adjustOpen: true }), id, '保守一點，停損線 4%');
    u = flow.go(u, s, 'wall');
    expect(u).toMatchObject({ screen: 'wall', adjustOpen: false, nlOpen: false });
    u = flow.go(u, s, 'dispatch');
    expect(u.drafts[id]).toBe('保守一點，停損線 4%');
    expect(flow.clearDraft(u, id).drafts[id]).toBeUndefined();
  });

  it('不可達的 go 也不清草稿', () => {
    const s = inField();
    const u = flow.go(flow.setDraft(ui(s, 'dispatch'), 'ct_x', 'a'), s, 'report');
    expect(u.drafts.ct_x).toBe('a');
  });
});

describe('F9｜出征紀錄緊湊：最近一筆＋連完整紀錄（D18：大將／戰報後，不在派出）', () => {
  it('有紀錄：只露最近一筆', () => {
    let s = returned();
    s = settle(dispatch(redispatch(s, at(20)), at(20)), at(30));
    const html = mount(s, 'report');
    const compact = html.match(/<p class="wall-compact">[\s\S]*?<\/p>/)![0];
    expect(compact.match(/最近：/g)).toHaveLength(1);
    expect(compact).toContain(`>${copy.WALL_COMPACT.link}</button>`);
    expect(html.match(/class="wall-row/g)).toBeNull();
  });

  it('無紀錄：大將頁還沒出過征＋連結；派出頁無；空態不出現', () => {
    expect(visible(mount(appointed(), 'appoint'))).toContain(copy.WALL_COMPACT.empty);
    expect(mount(appointed(), 'dispatch')).not.toContain('wall-compact');
    expect(mount(null)).not.toContain('wall-compact');
  });
});

describe('D16b Wd｜玩家可見用詞', () => {
  const now = Date.now();
  const all: [string, AppState | null, flow.Screen | undefined][] = [
    ['空', null, undefined],
    ['大將', appointed(), 'appoint'],
    ['派出', appointed(), 'dispatch'],
    ['正在派出', dispatch(appointed(), new Date(now)), 'dispatch'],
    ['在外面', dispatch(appointed(), new Date(now - 1000)), 'dispatch'],
    ['大將·在外面', dispatch(appointed(), new Date(now - 1000)), 'appoint'],
    ['戰報', returned(), 'report'],
    ['紀錄', returned(), 'wall'],
    ['撤回', withdrawn(), 'appoint'],
    ['撤回結算戰報', withdrawInField(dispatch(appointed(), new Date(now - 1000)), new Date(now)), 'report'],
    ['撤回結算紀錄', withdrawInField(dispatch(appointed(), new Date(now - 1000)), new Date(now)), 'wall'],
  ];
  const BANNED_EN = /\b(ready|in_field|returned|commit|dispatch|settle|failed_\w*)\b/i;
  const BANNED_ZH = ['去出征', '等戰報', '看戰報', '折返', '損益', '回撤', '履歷', '歸來', '任命席', '出征席', '戰報席', '已選：', '本次期間', '新戰報', '派出中', '失敗', '日征', '週征', '下一約'];

  it.each(all)('%s：無內部英文詞、無舊行話', (_, s, screen) => {
    const v = visible(mount(s, screen));
    expect(v).not.toMatch(BANNED_EN);
    for (const w of BANNED_ZH) expect(v, w).not.toContain(w);
  });

  it('Wd1 主 CTA ∈ 任命／重新任命／派出／撤回（出征中，D18）／再派', () => {
    for (const [, s, screen] of all) {
      for (const m of mount(s, screen).matchAll(/class="cta"[^>]*>([^<]+)</g)) {
        expect([copy.CTA.appoint, copy.CTA.reappoint, copy.CTA.dispatch, copy.CTA.withdrawInField, copy.CTA.redispatch]).toContain(m[1]);
      }
    }
  });

  it('Wd2 步驟／屏名＝任命・派出・戰報・紀錄／大將・派出・戰報・出征紀錄', () => {
    expect(copy.STEPS).toEqual({ appoint: '任命', dispatch: '派出', report: '戰報' });
    expect(copy.HISTORY).toBe('紀錄');
    expect(copy.SCREEN).toEqual({ appoint: '大將', dispatch: '派出', report: '戰報', wall: '出征紀錄' });
  });

  it('Wd3 期間人話：選好了／這次', () => {
    expect(copy.PICKED('短征')).toBe('選好了：短征');
    expect(copy.LOCKED('日')).toBe('這次：日');
  });

  it('Wd4 提前回來人話原因（D16b §4）＋戰報數字標', () => {
    expect(copy.REASON_SHORT).toEqual({
      failed_risk: '碰到停損線',
      failed_data: '行情暫時看不清',
      failed_timeout: '時間到了',
      failed_constraint: '買賣次數用完了',
    });
    expect(copy.FOLD_NOTE).toEqual({ profit: '這次有賺，但規則叫停，提前回來。已記下。', logged: '已記下。' });
    const html = mount(returned(), 'report');
    expect(l0Text(html)).toContain(copy.METRIC.pnl);
    expect(l0Text(html)).toContain(copy.METRIC.drawdown);
  });

  it('Wd5（D18 覆寫）玩家可見面無「模擬」徽章／字；L0 無 sim_engine_／feed id', () => {
    expect('SIM_BADGE' in copy).toBe(false);
    for (const [, s, screen] of all) {
      const html = mount(s, screen);
      expect(html).not.toContain('sim-badge');
      expect(visible(html)).not.toContain('模擬');
      const l0 = l0Text(html);
      expect(l0).not.toContain(DEFAULTS.sim_engine_id);
      expect(l0).not.toContain(DEFAULTS.market_dataset_id);
    }
  });

  it('其他 D16b 槽：正在派出…／在外面。等結果。／有新結果／撤回弱鈕', () => {
    expect(copy.L0.sending).toBe('正在派出…');
    expect(copy.L0.inField).toBe('在外面。等結果。');
    expect(copy.L0.dispatchReady('WOLF')).toBe('派 WOLF 出去。');
    expect(copy.L0.returned('WOLF')).toBe('WOLF 回來了。');
    expect(mount(returned(), 'report')).toMatch(/class="weak-link"[^>]*>撤回<small> · 停用這員<\/small>/);
  });
});

describe('硬約束不動', () => {
  it('D18：cancel_supported=true（撤回＝結算）；UI 無「取消」字', () => {
    expect(inField().current!.cancel_supported).toBe(true);
    expect(visible(mount(dispatch(appointed(), new Date(Date.now() - 1000)), 'dispatch'))).not.toMatch(/取消/);
  });
});
