import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { DEFAULTS, TIME_WINDOWS, windowOf, type ExpeditionContract, type TimeWindowType } from './contract';
import * as copy from './copy';
import * as flow from './flow';
import { describeRisk, type NlOutcome } from './nl';
import { WOLF } from './profession';
import {
  appoint,
  applyAdjustment,
  compositeOf,
  dispatch,
  dueAt,
  load,
  proposeAdjustment,
  redispatch,
  save,
  setTimeWindow,
  settle,
  withdraw,
  withdrawInField,
  type AppState,
} from './store';

// D14：步驟感導覽 任命 → 派出 → 戰報；出征紀錄＝次級。每屏 L0 ≤2 行＋一個主 CTA。
// D16 Choose A：導覽規則在 flow.ts（可達性 F4、結算後 F7、草稿保活 F8）；只有「派出」commit（F2）、只有戰報「再派」建約（F5）。
// D16b：可見字全走 copy.ts。
// D18：NL（L2）只在派出 ready「改打法」薄層；出征中主 CTA＝撤回（立刻結算→戰報）；派出頁無紀錄；戰報頁無調整；玩家面無「模擬」標。
export type Screen = flow.Screen;
const STEP_KEYS = ['appoint', 'dispatch', 'report'] as const;

const NAME = DEFAULTS.agent_display;
const PROF = WOLF.profession;

const fmtMoney = (n: number | null) =>
  n === null ? '—' : `${n >= 0 ? '+' : ''}${n.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
const fmtPct = (n: number | null, sign = true) => (n === null ? '—' : `${sign && n >= 0 ? '+' : ''}${n.toFixed(2)}%`);
const elapsedSec = (c: ExpeditionContract) =>
  c.dispatched_at && c.settled_at ? ((Date.parse(c.settled_at) - Date.parse(c.dispatched_at)) / 1000).toFixed(1) : '—';
const periodName = (t: TimeWindowType) => windowOf(t)?.label ?? '—';
const windowLabel = (c: Pick<ExpeditionContract, 'time_window_type' | 'planned_duration'>) =>
  `${periodName(c.time_window_type)} ${c.planned_duration} 秒`;
const outcomeOf = (c: ExpeditionContract) =>
  c.result_status === 'completed'
    ? copy.OUTCOME.completed
    : c.result_status === 'withdrawn_settled'
      ? copy.OUTCOME.withdrawn
      : copy.OUTCOME.folded;
const isFailed = (c: ExpeditionContract) => !!c.result_status?.startsWith('failed_');

function Lines({ lines, className }: { lines: string[]; className?: string }) {
  return (
    <div className={className ?? 'lines'}>
      {lines.map((l, i) => (
        <p key={i}>{l}</p>
      ))}
    </div>
  );
}

/** L0 極短句：一行。D18：無徽章。 */
function L0({ children }: { children: ReactNode }) {
  return <p className="l0">{children}</p>;
}

/** L1 次級入口：虛線、預設收起。`dev`＝開發詳情（技術欄位只在這裡）。 */
function More({ label, children, dev }: { label: string; children: ReactNode; dev?: boolean }) {
  return (
    <details className={dev ? 'more dev' : 'more'}>
      <summary>{label}</summary>
      <div className="more-body">{children}</div>
    </details>
  );
}

export default function App({ initialScreen }: { initialScreen?: Screen }) {
  const [state, setState] = useState<AppState>(() => load(localStorage));
  const [ui, setUi] = useState<flow.Ui>(() => flow.initialUi(state, initialScreen));
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => save(state, localStorage), [state]);

  /** F4／F8：可達才切；關薄層不清草稿。 */
  const go = (target: Screen) => setUi((u) => flow.go(u, stateRef.current, target));

  /** 改 AppState 的唯一入口（按鈕動作）；成功後可選擇導覽。 */
  const act = (fn: (s: AppState) => AppState, then?: (u: flow.Ui, next: AppState) => flow.Ui) => {
    try {
      const next = fn(state);
      stateRef.current = next;
      setState(next);
      setError(null);
      setUi((u) => (then ? then({ ...u, notice: null }, next) : { ...u, notice: null }));
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };
  const actGo = (fn: (s: AppState) => AppState, target: Screen) => act(fn, (u, next) => flow.go(u, next, target));

  // 在外面：壓縮時鐘，到期自動回來（重新整理後也會補結算）。F7：結算後條件跳戰報，否則 badge。
  const inFlight = state.current?.status === 'in_field' ? state.current : null;
  useEffect(() => {
    if (!inFlight) return;
    const tick = setInterval(() => setNow(Date.now()), 100);
    const wait = Math.max(0, dueAt(inFlight) - Date.now());
    const done = setTimeout(() => {
      const s = stateRef.current;
      if (s.current?.status !== 'in_field') return;
      const next = settle(s, new Date());
      stateRef.current = next;
      setState(next);
      setUi((u) => flow.afterSettle(u, next));
    }, wait);
    return () => {
      clearInterval(tick);
      clearTimeout(done);
    };
  }, [inFlight?.contract_id, inFlight?.status]);

  const c = state.current;
  const enabled = !!state.config?.enabled;
  const { screen } = ui;

  /** F1：任命成功 → 自動進派出。 */
  const doAppoint = () => actGo((s) => appoint(s, new Date()), 'dispatch');

  const withdrawLink = (target?: Screen) => (
    <button className="weak-link" onClick={() => (target ? actGo(withdraw, target) : act(withdraw))}>
      {copy.CTA.withdraw}<small> · {copy.CTA.withdrawHint}</small>
    </button>
  );

  const wallCompact = state.config && <WallCompact wall={state.wall} onOpen={() => go('wall')} />;

  return (
    <div className="app">
      <header className="top">
        <nav className="steps" aria-label="步驟">
          {STEP_KEYS.map((k, i) => {
            const ok = flow.reach(state, k).ok;
            const cls = ['step', screen === k && 'on', !ok && 'off'].filter(Boolean).join(' ');
            return (
              <button key={k} className={cls} aria-current={screen === k ? 'step' : undefined} aria-disabled={!ok || undefined} onClick={() => go(k)}>
                {i > 0 && <span className="arrow" aria-hidden>→</span>}
                {'①②③'[i]}{copy.STEPS[k]}
                {k === 'report' && ui.unseen && <span className="badge">{copy.BADGE_NEW}</span>}
              </button>
            );
          })}
          <span className="dot" aria-hidden>·</span>
          <button className={screen === 'wall' ? 'step on' : 'step'} aria-current={screen === 'wall' ? 'step' : undefined} onClick={() => go('wall')}>
            {copy.HISTORY}
          </button>
        </nav>
      </header>

      {ui.notice && (
        <p className="notice" role="status" onClick={() => setUi((u) => ({ ...u, notice: null }))}>
          {ui.notice}
        </p>
      )}
      {error && <div className="error" onClick={() => setError(null)}>{error}</div>}

      <main>
        {screen === 'appoint' && (
          <section className="screen">
            <h2>{copy.SCREEN.appoint}</h2>
            {!enabled ? (
              <>
                {state.config && <Hero disabled />}
                <L0>{state.config ? copy.L0.withdrawn(NAME) : copy.L0.appointEmpty}</L0>
                {wallCompact}
                <div className="cta-zone">
                  <button className="cta" onClick={doAppoint}>
                    {state.config ? copy.CTA.reappoint : copy.CTA.appoint}
                  </button>
                </div>
              </>
            ) : (
              <>
                <Hero subline={copy.appointSubline(PROF.name, briefOf(state))} />
                {c?.status === 'in_field' && <L0>{copy.L0.appointBlocked}</L0>}
                <div className="l1-row">
                  <More label={copy.L1.professionDetail}>
                    <SkillShort />
                    <p className="muted small">{copy.VIRTUAL_FUNDS_NOTE}</p>
                  </More>
                </div>
                {wallCompact}
                {/* F1／F5：大將頁無「去出征」主 CTA、無暗門再派；前進走步驟列。 */}
                <div className="cta-zone">
                  {c?.status === 'in_field' ? (
                    <button className="ghost" onClick={() => go('dispatch')}>{copy.CTA.whyNot}</button>
                  ) : (
                    withdrawLink()
                  )}
                </div>
              </>
            )}
          </section>
        )}

        {screen === 'dispatch' && (
          <section className="screen">
            <h2>{copy.SCREEN.dispatch}</h2>
            {enabled && c?.status === 'in_field' ? (
              // D18 R1／R2：撤回＝立刻結算，直接進戰報。
              <InField c={c} now={now} onWithdraw={() => actGo((s) => withdrawInField(s, new Date()), 'report')} />
            ) : enabled && c?.status === 'ready' ? (
              <>
                <L0>{copy.L0.dispatchReady(NAME)}</L0>
                <PeriodPicker value={c.time_window_type} onPick={(t) => act((s) => setTimeWindow(s, t))} />
                <p className="picked">{copy.PICKED(periodName(c.time_window_type))}</p>
                <More label={copy.L1.dispatchDetail}>
                  <ContractSummary c={c} />
                </More>
                {/* D18 R3／R4：改打法＝派出前次級薄層；點開才有 NL（L2），界內才綁本約。R5：本屏無出征紀錄。 */}
                <button
                  className={ui.adjustOpen ? 'l1-toggle on' : 'l1-toggle'}
                  aria-expanded={ui.adjustOpen}
                  onClick={() => setUi((u) => ({ ...u, adjustOpen: !u.adjustOpen }))}
                >
                  {copy.CTA.adjust}
                </button>
                {ui.adjustOpen && (
                  <div className="adjust">
                    <More label={copy.L1.professionDetail}>
                      <SkillShort />
                    </More>
                    <NlSheet
                      state={state}
                      draft={ui.drafts[c.contract_id] ?? ''}
                      onDraft={(t) => setUi((u) => flow.setDraft(u, c.contract_id, t))}
                      onApply={(o) => act((s) => applyAdjustment(s, o), (u) => flow.clearDraft({ ...u, adjustOpen: false }, c.contract_id))}
                      onClose={() => setUi((u) => ({ ...u, adjustOpen: false }))}
                    />
                  </div>
                )}
                <div className="cta-zone">
                  {/* F2：唯一 commit。 */}
                  <button className="cta" onClick={() => act((s) => dispatch(s, new Date()))}>{copy.CTA.dispatch}</button>
                </div>
              </>
            ) : (
              <L0>{copy.NAV_REASON.noContract}</L0>
            )}
          </section>
        )}

        {screen === 'report' && (
          <section className="screen">
            <h2>{copy.SCREEN.report}</h2>
            {!enabled || c?.status !== 'returned' ? (
              <L0>{copy.NAV_REASON.noReport}</L0>
            ) : (
              <>
                {(() => {
                  const [head, note] = copy.reportL0(c, NAME);
                  return (
                    <>
                      <L0>{head}</L0>
                      {note && <p className="l0-sub">{note}</p>}
                    </>
                  );
                })()}
                <div className="metric-k">{copy.METRIC.pnl}</div>
                <div className={`big ${(c.realized_pnl ?? 0) >= 0 ? 'up' : 'down'}`}>{fmtMoney(c.realized_pnl)}</div>
                <p className="l0-sub">{copy.METRIC.drawdown} {fmtPct(c.max_drawdown, false)}</p>
                {/* D18 R6：戰報頁無改打法／NL／調職業；只看結果＋再派／撤回（停用這員）。 */}
                {wallCompact}
                <div className="cta-zone">
                  {/* F5：唯一建下一趟；期間預填上一趟（F3）。 */}
                  <button className="cta" onClick={() => actGo((s) => redispatch(s, new Date()), 'dispatch')}>{copy.CTA.redispatch}</button>
                  {withdrawLink('appoint')}
                </div>
              </>
            )}
          </section>
        )}

        {screen === 'wall' && (
          <section className="screen">
            <h2>{copy.SCREEN.wall}</h2>
            {state.wall.length > 0 && <CompositeCard state={state} />}
            <WallList wall={state.wall} />
          </section>
        )}
      </main>
    </div>
  );
}

function briefOf(state: AppState): string {
  const m = compositeOf(state.wall, WOLF.agent_id);
  return copy.compositeBrief(m?.raids ?? 0, fmtMoney(m?.pnl_sum ?? null));
}

function Hero({ subline, disabled }: { subline?: string; disabled?: boolean }) {
  return (
    <div className={disabled ? 'hero disabled' : 'hero'}>
      <div className="avatar" aria-hidden>W</div>
      <div className="hero-text">
        <div className="agent-name">
          {NAME}
        </div>
        {subline && <div className="agent-role">{subline}</div>}
      </div>
    </div>
  );
}

/** F6：先「正在派出…」再進度；無禁用 hero CTA。F3：「這次：{X}」。D18：主 CTA＝撤回（任一時刻可按）。 */
function InField({ c, now, onWithdraw }: { c: ExpeditionContract; now: number; onWithdraw: () => void }) {
  const sending = flow.isSending(c.dispatched_at, now);
  return (
    <>
      <L0>{sending ? copy.L0.sending : copy.L0.inField}</L0>
      <p className="picked locked">{copy.LOCKED(periodName(c.time_window_type))}</p>
      {!sending && <Progress c={c} now={now} />}
      <More label={copy.L1.dispatchDetail}>
        <p className="muted small">{copy.PERIOD_LOCKED}</p>
        <ContractSummary c={c} />
      </More>
      <div className="cta-zone">
        <button className="cta" onClick={onWithdraw}>{copy.CTA.withdrawInField}</button>
      </div>
    </>
  );
}

/** F9：出征紀錄緊湊入口——最近一筆＋連到完整紀錄。D18：只在大將／戰報，不在派出。 */
function WallCompact({ wall, onOpen }: { wall: readonly ExpeditionContract[]; onOpen: () => void }) {
  const last = wall[wall.length - 1];
  return (
    <p className="wall-compact">
      <span>
        {last ? copy.WALL_COMPACT.latest(outcomeOf(last), fmtMoney(last.realized_pnl)) : copy.WALL_COMPACT.empty}
      </span>
      <span aria-hidden> · </span>
      <button className="link" onClick={onOpen}>{copy.WALL_COMPACT.link}</button>
    </p>
  );
}

/** L1 職業三欄縮寫；全文（D12 P0）再展開一層。 */
function SkillShort() {
  const keys = ['ability', 'applicable_context', 'limits'] as const;
  return (
    <div className="skill">
      <div className="skill-title">{PROF.name}</div>
      <dl className="skill-short">
        {keys.map((k) => (
          <div key={k}>
            <dt>{copy.SKILL_SHORT_LABEL[k]}</dt>
            <dd>{copy.SKILL_SHORT_WOLF[k]}</dd>
          </div>
        ))}
      </dl>
      <More label={copy.L1.fullText}>
        <div className="skill-cols">
          {keys.map((k) => (
            <div key={k} className={`skill-col ${k}`}>
              <div className="skill-k">{copy.SKILL_LABEL[k]}</div>
              <div className="skill-v">{PROF.skill[k]}</div>
            </div>
          ))}
        </div>
      </More>
    </div>
  );
}

function CompositeCard({ state }: { state: AppState }) {
  const m = compositeOf(state.wall, WOLF.agent_id);
  return (
    <div className="composite">
      <div className="composite-title">
        {copy.COMPOSITE_TITLE}
      </div>
      {!m ? (
        <Lines className="lines muted small" lines={copy.P2} />
      ) : (
        <div className="perf">
          <Perf k={copy.PERF.raids} v={`${m.raids} 次（${copy.PERF.folded} ${m.failures}）`} />
          <Perf k={copy.PERF.pnl} v={fmtMoney(m.pnl_sum)} tone={m.pnl_sum >= 0 ? 'up' : 'down'} />
          <Perf k={copy.PERF.wins} v={`${m.wins}/${m.raids}`} />
          <Perf k={copy.PERF.range} v={`${fmtPct(m.return_min)} ~ ${fmtPct(m.return_max)}`} />
          <Perf k={copy.PERF.drawdown} v={fmtPct(m.worst_drawdown, false)} />
        </div>
      )}
    </div>
  );
}

function Perf({ k, v, tone }: { k: string; v: string; tone?: 'up' | 'down' }) {
  return (
    <div>
      <div className="k">{k}</div>
      <div className={`v ${tone ?? ''}`}>{v}</div>
    </div>
  );
}

/** 改打法（L2，只在派出 ready）：草稿由 App 依 contract_id 保存，收起／切席不丟（F8）。 */
function NlSheet({
  state,
  draft,
  onDraft,
  onApply,
  onClose,
}: {
  state: AppState;
  draft: string;
  onDraft: (text: string) => void;
  onApply: (o: NlOutcome) => boolean;
  onClose: () => void;
}) {
  const [outcome, setOutcome] = useState<NlOutcome | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setOutcome(proposeAdjustment(state, draft));
  };
  const confirm = () => {
    if (outcome && onApply(outcome)) setOutcome(null);
  };
  return (
    <div className="nl-sheet">
      <div className="nl-title">{copy.CTA.adjust}</div>
      <p className="small">{copy.N0(NAME)}</p>
      {state.config && <p className="muted small">{copy.N_NOW(describeRisk(state.config.risk))}</p>}
      <form className="nl-form" onSubmit={submit}>
        <input
          value={draft}
          onChange={(e) => { onDraft(e.target.value); setOutcome(null); }}
          placeholder={copy.N0_PLACEHOLDER}
          maxLength={60}
          enterKeyHint="send"
        />
        <button type="submit" className="ghost">{copy.CTA.nlSubmit}</button>
      </form>
      {outcome?.kind === 'accepted' && <Lines className="lines ok small" lines={[copy.N1(describeRisk(outcome.risk))]} />}
      {outcome?.kind === 'rewritten' && (
        <Lines className="lines warn small" lines={[copy.N1B(describeRisk(outcome.risk)), ...outcome.rewrites]} />
      )}
      {outcome?.kind === 'blocked' && <Lines className="lines failed small" lines={[copy.N2, outcome.reason]} />}
      <div className="row">
        {outcome && outcome.kind !== 'blocked' && (
          <button className="cta small-cta" onClick={confirm}>{copy.CTA.nlConfirm}</button>
        )}
        <button className="ghost" onClick={onClose}>{copy.CTA.nlClose}</button>
      </div>
      <p className="muted small">{copy.N3}</p>
    </div>
  );
}

/** F3：選項＝短征／日／週（秒數只當小字）。 */
function PeriodPicker({ value, onPick }: { value: TimeWindowType; onPick: (t: TimeWindowType) => void }) {
  return (
    <div className="segs" role="radiogroup" aria-label={copy.PERIOD_TITLE}>
      {TIME_WINDOWS.map((w) => (
        <button
          key={w.time_window_type}
          role="radio"
          aria-checked={value === w.time_window_type}
          className={value === w.time_window_type ? 'seg on' : 'seg'}
          onClick={() => onPick(w.time_window_type)}
        >
          <span>{w.label}</span>
          <small>{w.planned_duration} 秒</small>
        </button>
      ))}
    </div>
  );
}

/** L1「這次怎麼派」：人話摘要；技術 id 只在開發詳情。 */
function ContractSummary({ c }: { c: ExpeditionContract }) {
  return (
    <>
      <dl className="summary">
        <dt>{copy.SUMMARY.agent}</dt><dd>{NAME} · {PROF.name}</dd>
        <dt>{copy.SUMMARY.principal}</dt><dd>{c.simulation_principal.toLocaleString()}</dd>
        <dt>{copy.SUMMARY.period}</dt><dd>{windowLabel(c)}</dd>
        <dt>{copy.SUMMARY.rules}</dt><dd>{describeRisk(c.constraint_snapshot)}</dd>
      </dl>
      <More label={copy.L1.devDetail} dev>
        <p className="muted small">
          {c.contract_id} · {c.strategy_version} · {c.currency} · {c.sim_engine_id} / {c.market_dataset_id}@{c.market_dataset_version} / {c.sim_run_id}
        </p>
      </More>
    </>
  );
}

function Progress({ c, now }: { c: ExpeditionContract; now: number }) {
  const total = c.planned_duration * 1000;
  const elapsed = Math.min(total, Math.max(0, now - Date.parse(c.dispatched_at!)));
  return (
    <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={c.planned_duration} aria-valuenow={Math.round(elapsed / 1000)}>
      <div className="bar" style={{ width: `${(elapsed / total) * 100}%` }} />
      <span>{(elapsed / 1000).toFixed(1)} / {c.planned_duration} 秒</span>
    </div>
  );
}

function Metrics({ c }: { c: ExpeditionContract }) {
  return (
    <div className="metrics">
      <Metric label={copy.METRICS.returnPct} value={fmtPct(c.return_pct)} tone={(c.return_pct ?? 0) >= 0 ? 'up' : 'down'} />
      <Metric label={copy.METRICS.trades} value={`${c.trade_count ?? '—'} 次`} />
      <Metric label={copy.METRICS.period} value={windowLabel(c)} />
      <Metric label={copy.METRICS.elapsed} value={`${elapsedSec(c)} 秒`} />
      {c.result_status && c.result_status !== 'completed' && (
        <div className="metric wide">
          <div className="metric-label">{copy.METRICS.why}</div>
          <div className={isFailed(c) ? 'metric-value down' : 'metric-value'}>{copy.RESULT_LABEL[c.result_status]}</div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' }) {
  return (
    <div className="metric">
      <div className="metric-label">{label}</div>
      <div className={`metric-value ${tone ?? ''}`}>{value}</div>
    </div>
  );
}

/** 出征紀錄：人話主標；32 欄 JSON 進開發詳情。 */
function WallList({ wall }: { wall: readonly ExpeditionContract[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (wall.length === 0) return <L0>{copy.L1.wallEmpty}</L0>;
  return (
    <div className="wall">
      {wall
        .map((c, i) => ({ c, n: i + 1 }))
        .reverse()
        .map(({ c, n }) => {
          const ok = !isFailed(c);
          return (
            <div key={c.contract_id} className={ok ? 'wall-row' : 'wall-row failed'}>
              <button className="wall-head" aria-expanded={open === c.contract_id} onClick={() => setOpen(open === c.contract_id ? null : c.contract_id)}>
                <span className="wall-title">
                  第 {n} 次 · {outcomeOf(c)}
                  <small>
                    {windowLabel(c)} · {copy.METRIC.drawdown} {fmtPct(c.max_drawdown, false)}
                    {c.result_status === 'completed' || !c.result_status ? '' : ` · ${copy.RESULT_LABEL[c.result_status]}`}
                  </small>
                </span>
                <span className={`wall-num ${(c.realized_pnl ?? 0) >= 0 ? 'up' : 'down'}`}>{fmtMoney(c.realized_pnl)}</span>
              </button>
              {open === c.contract_id && (
                <div className="wall-body">
                  <Metrics c={c} />
                  <More label={copy.L1.devDetail} dev>
                    <p className="muted small">
                      {c.strategy_version} · {c.result_status} · replay_ok={String(c.replay_ok)} · is_official={String(c.is_official)} · {c.evidence_id}
                    </p>
                    <pre>{JSON.stringify(c, null, 2)}</pre>
                  </More>
                </div>
              )}
            </div>
          );
        })}
      <p className="muted small">{copy.L1.wallFoot}</p>
    </div>
  );
}
