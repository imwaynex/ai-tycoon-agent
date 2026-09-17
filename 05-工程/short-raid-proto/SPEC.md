# Short Raid Proto SPEC (D11 lock + D12 patch)

## Goal
Demo: 任命 → 派出 → 歸來 → 再派／撤回
Self-built simulation; short raid (compress so return visible in same session); failures retained on wall; replay_ok.

## Hard rules
- Use EXACT 32 required fields from lock (names below). Do not invent extra economy fields.
- okx_dependency=false, real_funds=false, cancel_supported=false, parallel_dispatch_allowed=false
- Failure goes in result_status (no required failure_class)
- No XP, no leaderboard main UI, no OKX
- Mark UI as 模擬 always
- History wall keeps failures; withdraw disables config but does NOT delete history

## 32 required fields (exact names)
contract_id, empire_id, agent_id, strategy_version, simulation_principal, currency, time_window_type, planned_duration, simulation_source, sim_engine_id, market_dataset_id, market_dataset_version, sim_run_id, status, created_at, dispatched_at, settled_at, battle_result_id, result_status, realized_pnl, return_pct, max_drawdown, trade_count, attribution_ref, constraint_snapshot, evidence_id, is_official, replay_ok, parallel_dispatch_allowed, cancel_supported, okx_dependency, real_funds

## Minimal defaults (allowed for short raid prototype; fields must exist)
- empire_id: empire_demo_01
- agent_id: agent_wolf ; display WOLF
- strategy_version: strat_wolf_v1
- simulation_principal: 10000
- currency: sandbox_USD
- time_window_type: short_raid | day_raid | week_raid (per contract; D12-2)
- planned_duration: 3 | 5 | 8 (seconds wall-clock compressed; must match time_window_type)
- simulation_source: structure {engine, dataset, dataset_version, run}
- sim_engine_id: sim_engine_local_v1
- market_dataset_id: feed_mock_crypto_v1
- market_dataset_version: 2026.09.17
- status enum (lock-D11 §3): ready（可派） | in_field（出征中） | returned（已歸來）
  - legal transitions: ready → in_field → returned; redispatch = NEW contract at ready (old returned contract never rewritten)
  - contracts start at `ready` on 任命 (no `draft`); no cancel path
  - removed: `dispatched` → `in_field`, `settled` → `returned`, `draft`/`withdrawn_config` dropped (legacy localStorage values are migrated on load)
  - 撤回 is an app-level flag `config.enabled=false`, NOT a contract status; returned contracts stay `returned` on the wall
- result_status enum: completed | failed_risk | failed_data | failed_timeout | failed_constraint
- After settle: is_official true only if replay_ok true and settlement gate passes

## Screens
1 Appoint: empty → appoint WOLF
2 Dispatch: show contract summary → dispatch → in-progress (no cancel, no trading UI)
3 Report: pnl/return/dd/trades + sim badge → 再派 / 撤回
Wall: history including failures

## Copy (Traditional Chinese; from 最小可講)
Use appoint/dispatch/return/redispatch copy; sim badge 模擬

## Stack
Vite + React + TypeScript. localStorage for wall. Vitest unit tests for:
- contract has all 32 fields
- settlement writes wall
- failure retained
- withdraw does not delete history
- replay check (deterministic seed → replay_ok)

## Deliverables in this folder
- runnable app
- npm test + npm run build pass
- README with how to run

---

## D12 iteration (patch approved D13)

Sources: `01-範圍/範圍增量-D12-定稿.md`, `02-系統規則/出征契約-D12規格補丁.md`, `04-體驗設計/IA增量-任命席出征席-D12.md`, `03-世界敘事/文案槽-職業Skill與NL調策略-D12-草案.md`, `04-體驗設計/mobile框-任命出征-直橫-D12.html`.

### Invariants (unchanged)
- 32 required fields: no add/remove/rename. Profession data lives inside existing `constraint_snapshot`.
- `parallel_dispatch_allowed`, `cancel_supported`, `okx_dependency`, `real_funds` = false.
- Status: ready → in_field → returned; redispatch = new contract.
- `profession_id`/`skill_id` NOT added (D13-R1: optional, later).

### constraint_snapshot (snapshot at contract creation, frozen on the wall)
| key | meaning |
|-----|---------|
| `ability` | 會什麼 (non-empty string) |
| `applicable_context` | 適合什麼 (non-empty string) |
| `limits` | 不能超什麼 (non-empty string; states numeric caps) |
| `max_drawdown_limit_pct` | this contract's drawdown cap; within profession bounds [2, 6] |
| `max_trade_count` | this contract's trade cap; within profession bounds [5, 30] |

WOLF / 動能突破 base strategy `strat_wolf_v1`: drawdown 5%, trades 24.

### Duration per contract (D12-2)
- Options: 短征 `short_raid`/3s, 日征 `day_raid`/5s, 週征 `week_raid`/8s.
- New contract pre-fills last choice; editable while `ready` (`setTimeWindow`); locked once `in_field`.
- Sim ticks = planned_duration × 40 → replay uses the contract's own duration.

### Gates
- Dispatch gate: hard flags; window legal; Skill keys non-empty; risk caps within profession bounds (else reject dispatch).
- Settlement gate: all of the above + 32 fields + settled result fields. `is_official = replay_ok && gate`.

### NL 調策略 (D12-1b)
- Thin sheet, single line; deterministic rule parser (`src/nl.ts`), only touches the two risk caps.
- in-bounds → `accepted`; numeric out of bounds → `rewritten` (clamped to bounds); out-of-profession (做空/槓桿/抄底/網格/實盤/拿掉限制) or no-op/unparseable → `blocked`.
- Confirm creates new `strategy_version` (`strat_wolf_v{n}`, monotonic) in config → applies to NEXT contract only; current contract never hot-edited.

### Screens (D12-3 / D12-4)
- 任命席 main tab 角色: hero, Skill 三欄, 綜合表現 (raids/failures, pnl sum, positive-return count, return range, worst drawdown; empty state P2), NL entry; CTA 任命 / 前往出征席 / 撤回此配置. Sub tab 歷史: wall list incl. failures.
- 出征席: agent + profession one-liner, duration picker, contract summary (constraint summary + 模擬 badge), 派出; in_field: locked picker, progress, no cancel.
- Mobile-first CSS: portrait single column (IA order), landscape two columns; primary CTA ≥ 48px, sticky bottom, safe-area aware.

### Tests (D12 additions)
32 fields still exact; snapshot Skill keys; settlement gate requires Skill keys; dispatch gate rejects blank/over-bound; NL accepted → new version next contract only; NL rewritten → clamped; NL blocked; two consecutive raids with different planned_duration; duration locked in field; withdraw keeps wall & failures; composite summary; legacy save compat.
