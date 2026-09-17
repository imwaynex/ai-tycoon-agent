// D14 清晰度減阻：L0 第一眼（SSR 靜態輸出）不得出現 NL／三欄全文／契約 id／引擎字串；空態不露紀錄內容。
// D16／D16b 後：用詞與主 CTA 依新版（無「去出征」、提前回來＋人話原因）。
// D18 後：無「模擬」徽章；出征中主 CTA＝撤回；戰報無改打法；改打法 NL 只在派出 ready 薄層（第一眼收起）。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import App, { type Screen } from './App';
import * as copy from './copy';
import { DEFAULTS } from './contract';
import { WOLF } from './profession';
import { appoint, dispatch, initialState, redispatch, save, settle, STORAGE_KEY, type AppState } from './store';

const T0 = new Date('2026-09-17T12:00:00.000Z');

function mount(state: AppState | null, screen?: Screen): string {
  const data = new Map<string, string>();
  const kv = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  if (state) save(state, kv);
  (globalThis as { localStorage?: unknown }).localStorage = kv;
  return renderToStaticMarkup(createElement(App, { initialScreen: screen }));
}
afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

const appointed = () => appoint(initialState(), T0);
const returned = () => settle(dispatch(appointed(), T0), new Date(T0.getTime() + 10_000));
const text = (html: string) => html.replace(/<[^>]+>/g, '\n');

/** L0＝不在 <details> 內的可見文字。 */
const l0Text = (html: string) => text(html.replace(/<details[\s\S]*?<\/details>/g, ''));

/** 第一眼禁止：NL、三欄全文、契約／引擎字串、證據。 */
function expectCleanL0(html: string, contractId?: string) {
  const l0 = l0Text(html);
  expect(html).not.toContain('<input');
  expect(l0).not.toContain(copy.N0(DEFAULTS.agent_display));
  expect(l0).not.toContain('用一句話');
  for (const v of Object.values(WOLF.profession.skill)) expect(l0).not.toContain(v);
  expect(l0).not.toContain(DEFAULTS.sim_engine_id);
  expect(l0).not.toContain(DEFAULTS.market_dataset_id);
  expect(l0).not.toContain('evidence');
  expect(l0).not.toContain('replay_ok');
  if (contractId) expect(l0).not.toContain(contractId);
  expect(html.match(/class="cta"/g)?.length ?? 0).toBeLessThanOrEqual(1);
}

describe('D14 L0 第一眼', () => {
  it('大將空態：只有「還沒有大將。」＋任命；不露整體表現／紀錄緊湊／摺疊', () => {
    const html = mount(null);
    expect(l0Text(html)).toContain(copy.L0.appointEmpty);
    expect(html).toContain(`>${copy.CTA.appoint}</button>`);
    expect(html).not.toContain('wall-compact');
    expect(html).not.toContain(copy.COMPOSITE_TITLE);
    expect(html).not.toContain('<details');
    expectCleanL0(html);
  });

  it('大將有人：名；D18 無「模擬」；D16 F1 無主 CTA（無「去出征」）；三欄僅 L1 摺疊', () => {
    const s = appointed();
    const html = mount(s, 'appoint');
    expect(html).toContain(DEFAULTS.agent_display);
    expect(text(html)).not.toContain('模擬');
    expect(html).not.toContain('class="cta"');
    expect(html).not.toContain('去出征');
    expect(html).toContain(copy.L1.professionDetail);
    expectCleanL0(html, s.current!.contract_id);
  });

  it('派出 L0：期間＋選好了＋派出；無 contract_id／engine', () => {
    const s = appointed();
    const html = mount(s, 'dispatch');
    expect(html).toContain(copy.L0.dispatchReady(DEFAULTS.agent_display));
    expect(html).toContain('role="radiogroup"');
    expect(html).toMatch(new RegExp(`class="cta"[^>]*>${copy.CTA.dispatch}<`));
    expectCleanL0(html, s.current!.contract_id);
  });

  it('在外面：D18 主 CTA＝撤回（唯一）；無「取消」、無禁用 hero CTA', () => {
    const s = dispatch(appointed(), new Date(Date.now() - 1000));
    const html = mount(s, 'dispatch');
    expect(l0Text(html)).toContain(copy.L0.inField);
    expect(html).not.toContain('取消</button>');
    expect(html.match(/class="cta"[^>]*>([^<]+)</g)).toEqual([`class="cta">${copy.CTA.withdrawInField}<`]);
    expect(html).not.toMatch(/<button[^>]*\sdisabled[=\s>]/);
  });

  it('戰報 L0：再派為唯一主 CTA、撤回弱；無 evidence；D18 無「改打法」', () => {
    const s = returned();
    const html = mount(s, 'report');
    expect(html).toMatch(new RegExp(`class="cta"[^>]*>${copy.CTA.redispatch}<`));
    expect(html).toMatch(new RegExp(`class="weak-link"[^>]*>${copy.CTA.withdraw}<`));
    expect(text(html)).not.toContain(copy.CTA.adjust);
    expect(html).toContain('class="big');
    expectCleanL0(html, s.current!.contract_id);
    expect(s.current!.evidence_id && html.includes(s.current!.evidence_id)).toBeFalsy();
  });

  it('主路徑只靠主 CTA 可走完：任命 → 派出 → 回來 → 再派（不經次級）', () => {
    let s = appointed();
    s = dispatch(s, T0);
    s = settle(s, new Date(T0.getTime() + 10_000));
    s = redispatch(s, new Date(T0.getTime() + 20_000));
    expect(s.current!.status).toBe('ready');
    expect(s.config!.enabled).toBe(true);
    expect(mount(s)).toContain(copy.L0.dispatchReady(DEFAULTS.agent_display));
  });

  it('預設畫面依狀態進對步驟；存檔 key 不變', () => {
    expect(STORAGE_KEY).toBe('short-raid-proto/v1');
    expect(mount(returned())).toContain(copy.L0.returned(DEFAULTS.agent_display));
  });
});

describe('D14／D16b 戰報 L0：提前回來帶人話原因，與正賺賠不互撕', () => {
  const OLD_GENERIC = '折返。失敗已記入。';
  /** 以真實結算出的歸來約為底，改成 failed_risk＋正損益（32 欄不增不減）。 */
  const foldedWithProfit = (): AppState => {
    const s = returned();
    const c = { ...s.current!, result_status: 'failed_risk' as const, realized_pnl: 94.25, max_drawdown: 3.18 };
    return { ...s, current: c, wall: s.wall.map((w) => (w.contract_id === c.contract_id ? c : w)) };
  };

  it('helper：failed_risk＋pnl>0 → 人話原因＋「有賺但規則叫停」，≤2 行', () => {
    const lines = copy.reportL0({ result_status: 'failed_risk', realized_pnl: 94.25 }, 'WOLF');
    const all = lines.join('\n');
    expect(lines.length).toBeLessThanOrEqual(2);
    expect(lines).toEqual(['WOLF 提前回來。碰到停損線。', '這次有賺，但規則叫停，提前回來。已記下。']);
    expect(all).toContain(copy.FOLD_NOTE.profit);
    expect(all).not.toContain(OLD_GENERIC);
    expect(all).not.toContain('失敗');
    for (const l of lines) expect([...l].length).toBeLessThanOrEqual(20);
  });

  it('helper：各 failed_* 皆帶人話原因；pnl≤0 次行只「已記下」；completed＝回來了', () => {
    for (const st of ['failed_risk', 'failed_data', 'failed_timeout', 'failed_constraint'] as const) {
      for (const pnl of [-12.5, 0, 40]) {
        const lines = copy.reportL0({ result_status: st, realized_pnl: pnl }, 'WOLF');
        expect(lines).toHaveLength(2);
        expect(lines[0]).toBe(`WOLF 提前回來。${copy.REASON_SHORT[st]}。`);
        expect(copy.REASON_SHORT[st]).not.toContain('提前回來');
        expect(lines[0].split('提前回來').length - 1).toBe(1);
        expect(lines.join('')).not.toMatch(/failed_|折返/);
        expect(lines[1]).toBe(pnl > 0 ? copy.FOLD_NOTE.profit : copy.FOLD_NOTE.logged);
        expect(lines.join('')).not.toContain('失敗');
      }
    }
    expect(copy.reportL0({ result_status: 'completed', realized_pnl: -3 }, 'WOLF')).toEqual([copy.L0.returned('WOLF')]);
  });

  it('掛載戰報：failed_risk＋綠字正賺賠 → L0 可見人話原因，無舊空喊', () => {
    const s = foldedWithProfit();
    const html = mount(s, 'report');
    const l0 = l0Text(html);
    expect(html).toContain('class="big up"');
    expect(l0).toContain('WOLF 提前回來。碰到停損線。');
    expect(l0).toContain(copy.FOLD_NOTE.profit);
    expect(l0).not.toContain(OLD_GENERIC);
    expectCleanL0(html, s.current!.contract_id);
  });

  it('真實引擎路徑：連續再派至 failed_risk＋pnl>0（種子決定性），戰報 L0 帶原因', () => {
    let s = returned();
    for (let i = 1; i <= 200 && !(s.current!.result_status === 'failed_risk' && s.current!.realized_pnl! > 0); i++) {
      const t = new Date(T0.getTime() + i * 20_000);
      s = settle(dispatch(redispatch(s, t), t), new Date(t.getTime() + 10_000));
    }
    expect(s.current!.result_status).toBe('failed_risk');
    expect(s.current!.realized_pnl!).toBeGreaterThan(0);
    const l0 = l0Text(mount(s, 'report'));
    expect(l0).toContain('WOLF 提前回來。碰到停損線。');
    expect(l0).toContain(copy.FOLD_NOTE.profit);
    expect(l0).not.toContain(OLD_GENERIC);
  });
});

describe('D14／D16b 文案槽', () => {
  it('L0 極短句皆單行短句；職業縮寫各 ≤8 字', () => {
    const lines = [
      copy.L0.appointEmpty,
      copy.L0.appointBlocked,
      copy.L0.dispatchReady('WOLF'),
      copy.L0.sending,
      copy.L0.inField,
      copy.L0.returned('WOLF'),
      copy.L0.withdrawn('WOLF'),
      copy.L0.withdrawnSettled('WOLF'),
    ];
    for (const l of lines) {
      expect(l).not.toContain('\n');
      expect([...l].length).toBeLessThanOrEqual(16);
    }
    for (const v of [...Object.values(copy.SKILL_SHORT_LABEL), ...Object.values(copy.SKILL_SHORT_WOLF)]) {
      expect([...v].length).toBeLessThanOrEqual(8);
    }
  });
});
