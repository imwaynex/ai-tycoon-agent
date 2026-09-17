# 短征原型（模擬）｜short-raid-proto — D12 功能＋D14 清晰度＋D16 流暢度／D16b 用詞

示範：**任命 → 派出（每次選期間）→ 歸來 → 再派／撤回**；職業三欄、履歷、NL 調策略＝次級（D14）。
對齊 `SPEC.md`、`02-系統規則/出征契約-本輪必填-lock-D11.md`（32 必填不動）、`02-系統規則/出征契約-D12規格補丁.md`、
`01-範圍/範圍增量-D12-定稿.md`、`04-體驗設計/IA增量-任命席出征席-D12.md`、`03-世界敘事/文案槽-職業Skill與NL調策略-D12-草案.md`。

> 全程**模擬**：本地自建引擎 + 假行情。不連 OKX、不動真實資金（`okx_dependency=false`、`real_funds=false`）。無 XP、無排行榜、無參數／prompt 工具箱。

## 執行

```bash
npm i && npm run dev     # 開 http://localhost:5173（手機：npm run dev -- --host，同網段開 IP）
npm test                 # vitest 單元測試
npm run build            # tsc 型別檢查 + vite build
```

Mobile 驗收：瀏覽器 DevTools 裝置模式（如 390×844）切直／橫，或真機開 `--host` 位址。

## D18 派出撤回與畫面精簡（覆寫下方 D11／D14／D16 相關描述）

準據：`01-範圍/範圍增量-D18-定稿.md`、`01-範圍/驗收句-D18-派出撤回與畫面精簡.md`（R1–R8）、`02-系統規則/出征契約-D18規格補丁.md`、`04-體驗設計/IA動線改稿-D18.md`、`03-世界敘事/文案槽-D18-派出撤回與畫面精簡.md`。測試：`src/d18.test.ts`。

- `cancel_supported=true`（32 欄名不變）：出征中主 CTA「撤回」→ `withdrawInField` → 與到點同一結算閘 → `returned`＋`result_status=withdrawn_settled`（損益可正／零／負）＋選填 `withdrawn_at` → 入牆、凍結不可刪。撤回前引擎已產 `failed_*` 者照實保留。
- 改打法（NL）只在派出 ready 次級薄層；`in_field`／戰報拒改；D12 職業 bounds 仍守。
- 派出頁無出征紀錄；戰報頁無改打法／NL／職業詳情。
- 玩家 UI 無「模擬」字／徽章；大將職業詳情內一句「虛擬資金／不送真實市場」；資料層仍 `sim_engine_local_v1`、`real_funds=false`、`okx_dependency=false`。

## D14 清晰度減阻（60 秒）

> 下表為 D14 當時用詞；D16b 起玩家可見字改人話（見下節）。

準據：`04-體驗設計/IA減阻-60秒清晰度-D14.md`、`03-世界敘事/文案槽-主路徑極短句-D14.md`（主路徑 L0 唯一文案準據）、`01-範圍/驗收句-60秒清晰度-D14.md`。
不加功能；32 必填、狀態機、`cancel_supported=false` 不動。

- **導覽**：步驟 `①任命 → ②出征 → ③戰報`（不再四 Tab 同權）；右上＝模擬徽章＋弱連結「履歷」（**空態不出現**）。刪 `sim-strip` 引擎長條。
- **分層**：L0＝角色／極短句（≤2 行）＋**一個**主 CTA；L1＝虛線摺疊（職業詳情、出征詳情、履歷）；L2＝NL「交代打法」，**只在戰報席「調整」裡**。
- 單欄、主 CTA 貼底；橫屏不加欄、不加資訊（只收緊間距）。

| 屏 | L0（第一眼） | L1／L2（點了才見） |
|----|--------------|--------------------|
| 任命席・空 | 還沒有大將。＋「任命」 | — |
| 任命席・有人 | WOLF＋模擬＋一行 `動能突破 · N 征 · 累計損益`＋「派出」；撤回此配置＝弱連結 | 職業詳情（三欄縮寫 → 看全文 D12 P0） |
| 任命席・出征中 | 現在不能派。＋（次）看原因 | — |
| 出征席 | 派 WOLF 出征。＋期間三段＋「派出」／出征中。等戰報。＋進度（無取消） | 出征詳情（契約 id、版本、約束、引擎／資料集） |
| 戰報席 | WOLF 歸來。／折返。失敗已記入。＋大字損益＋回撤＋「再派」；撤回＝弱 | 調整 → 報酬／成交／期間／耗時（折返原因）、職業詳情、**交代打法（NL）** |
| 戰績履歷 | 綜合表現＋「第 N 征 · 歸來／折返」人話列表 | 點列 → 指標 → 開發詳情（evidence／replay_ok／32 欄 JSON） |

測試：`src/clarity.test.ts` 以 SSR 靜態輸出守 L0（無 NL／input、無三欄全文、無 contract_id／engine／evidence、主 CTA ≤1、空態無履歷）。

## D16 流暢度（Choose A）＋ D16b 用詞

準據：`04-體驗設計/IA流暢度改稿-D16.md`（§0 F1–F9、§5 可達性、§6 路徑）、`03-世界敘事/文案槽-用詞人話-D16b.md`（**玩家可見用詞唯一準據**，與 D14 衝突時聽它）、`01-範圍/驗收句-用詞好懂-D16b.md`。
自檢：`05-工程/自檢-D16與D16b落地-2026-09-17.md`。

- **導覽規則**在 `src/flow.ts`（純函式，只讀 AppState、只回 UI 狀態）：`reach`（F4 可達性）、`go`（不可達不切＋極短原因；關薄層不清草稿 F8）、`afterSettle`（F7）、`isSending`（F6）。
- 任命成功 → 自動進「派出」（F1）；大將頁無主 CTA。只有「派出」commit（F2）；只有戰報「再派」建下一趟、期間預填（F5／F3）。
- 步驟列 `①任命 → ②派出 → ③戰報 · 紀錄`；不可達步驟淡化，點了給「還沒有可派的。」「現在不能派。」「還沒有戰報。」。
- 派出後 L0「正在派出…」→「在外面。等結果。」＋進度；無禁用主鈕、無取消。期間「選好了：{X}」→「這次：{X}」。
- 結算時人在派出且無改打法薄層 → 自動戰報；否則戰報步驟掛「有新結果」。
- 出征紀錄緊湊列：「最近：{回來了｜提前回來} {賺賠} · 出征紀錄」。
- 用詞：提前回來＋人話原因（碰到停損線／行情暫時看不清／時間到了／買賣次數用完了）、賺賠／最大回落、撤回 · 停用這員。內部 enum 只在程式與「開發詳情」。

測試：`src/d16.test.ts`（F1–F9、Wd1–Wd5、禁用詞掃描）。

## NL 調策略（L2 薄層，不是工具箱）

入口：戰報「改打法」→「跟大將說」。大將／派出第一眼不出現。草稿依 contract_id 保存，切屏不丟（D16 F8）。

單行輸入 → 規則式解讀（`src/nl.ts`，決定性，無 LLM）→ 回顯 N1／N1b／N2 → 確認。

| 輸入 | 結果 |
|------|------|
| 界內，如「保守一點，回撤 4%」 | `accepted`：確認後產生新 `strategy_version`（`strat_wolf_vN`），**只綁下一約** |
| 數值越界，如「回撤放到 10%，成交 99 筆」 | `rewritten`：收束回職業界限（回撤 2–6%、成交 5–30 筆），確認後產新版 |
| 職業外打法，如做空／槓桿／抄底／網格／實盤／拿掉限制 | `blocked`：擋下，不產新版 |
| 聽不出內容、或結果與現行相同 | `blocked` |

只能動兩個風險硬頂；目前契約（含 ready 未派）一字不改。`applyAdjustment` 會重新解讀驗證，偽造的越界結果也被拒絕。

## 結構

- `src/contract.ts` — 32 必填（`REQUIRED_FIELDS`，編譯期保證 interface 與名單一致）、`TIME_WINDOWS`、`ConstraintSnapshot`、派出／結算閘
- `src/profession.ts` — 職業＝Skill：WOLF／動能突破三欄文案、機器可檢限制（bounds、職業外打法）、`skillKeysOk`
- `src/nl.ts` — NL 調策略解讀（accepted／rewritten／blocked）
- `src/sim.ts` — `sim_engine_local_v1`：種子決定性模擬；tick 數＝`planned_duration × 40`；`verifyReplay`
- `src/store.ts` — 純函式狀態機（appoint / setTimeWindow / dispatch / settle / redispatch / withdraw / proposeAdjustment / applyAdjustment）、綜合表現 `compositeOf`、持久化與舊檔相容
- `src/flow.ts` — D16 導覽規則（可達性、結算後跳席／badge、草稿保活、派出過渡）
- `src/copy.ts` — 繁中文案槽：D16b 人話用詞；D14 L0 極短句／L1 縮寫為主路徑；D12 P0／P2／N0–N4 僅展開層
- `src/App.tsx`、`src/styles.css` — UI（mobile 直／橫）
- `src/raid.test.ts` — 規則測試（D11／D12）
- `src/clarity.test.ts` — D14 L0 清晰度測試
- `src/d16.test.ts` — D16 F1–F9＋D16b Wd 用詞測試

## 規則落點

- **32 必填不變**：D12 沒有新增頂層欄位；職業資訊進既有必填 `constraint_snapshot`。
- **constraint_snapshot**：`ability`、`applicable_context`、`limits`（D13 最小鍵，派出當下快照）＋ `max_drawdown_limit_pct`、`max_trade_count`（本約風險硬頂，模擬引擎用）。
- **派出閘**：硬旗標、期間合法、Skill 三鍵非空、風險硬頂在職業 bounds 內（越權＝拒絕派出）。
- **結算閘**：32 欄齊、硬旗標、期間合法（`time_window_type` 與 `planned_duration` 對應同一選項）、Skill 三鍵非空且未越權、結算資料完整。`is_official = replay_ok && 結算閘`。
- **期間屬單次契約**：新約預填上次選擇；`ready` 可改；`in_field` 鎖定（`setTimeWindow` 拋錯）；再派＝新約重新可選。
- **硬旗標**：`okx_dependency` / `real_funds` / `cancel_supported` / `parallel_dispatch_allowed` 皆為型別層級 `false`；store 無 cancel API。
- **狀態機（lock-D11）**：`ready` → `in_field` → `returned`；再派＝新契約。
- **牆不可變**：入牆紀錄 `Object.freeze`；無刪除 API。撤回只設 `config.enabled=false`；重新任命回到職業基底策略 v1，版本號只增不減（不重用 vN）。
- **失敗**：`result_status`（`failed_risk` / `failed_constraint` / `failed_data` / `failed_timeout`），照樣入牆、計入綜合表現。
- **舊存檔（D11）**：`localStorage` key 仍為 `short-raid-proto/v1`。牆上舊紀錄原樣保留（不補寫快照、不洗白）；尚未派出的舊 ready 約因缺 Skill 快照會換發新約。

## 不做

XP、等級、排行榜、經濟系統、OKX、真實資金、作戰中取消、參數／prompt／Model 工具箱、職業市場。
