# 出征契約｜本輪必填 lock（D11）

日期：2026-09-17  
授權：Wayne → Mack  
狀態：**本輪必填已 lock**（數值預設如本金／秒數仍可由產品／體驗補，但欄位必須存在且結算閘可檢查）

## Lock 條款
1. 採納 `出征契約-待填欄位表-草案.md` 中「本輪建議必填候選＝是」之 **32 項** 為本輪必填。
2. 失敗態併入 `result_status`；`failure_class` 本輪非必填。
3. 短征：同輪體驗內可見歸來；允許壓縮／加速模擬；戰報仍標模擬源。
4. `cancel_supported=false`；不做作戰中取消入口。 **（D18 覆寫：見 `出征契約-D18規格補丁.md` → `cancel_supported=true`；語意＝出征中撤回並立刻結算，非無結果取消；32 名單不改。）**
5. `okx_dependency=false`、`real_funds=false` 維持。
6. `parallel_dispatch_allowed`：建議 false（單線）；若表內已列必填，實作鎖單線直至產品另開。

## 32 必填名單
`contract_id`, `empire_id`, `agent_id`, `strategy_version`, `simulation_principal`, `currency`, `time_window_type`, `planned_duration`, `simulation_source`, `sim_engine_id`, `market_dataset_id`, `market_dataset_version`, `sim_run_id`, `status`, `created_at`, `dispatched_at`, `settled_at`, `battle_result_id`, `result_status`, `realized_pnl`, `return_pct`, `max_drawdown`, `trade_count`, `attribution_ref`, `constraint_snapshot`, `evidence_id`, `is_official`, `replay_ok`, `parallel_dispatch_allowed`, `cancel_supported`, `okx_dependency`, `real_funds`

## 工程開工令
- 任務：短征原型（任命→派出→歸來→再派／撤回）
- 寫碼：`claude --model claude-opus-5 --effort high`
- 對齊：範圍定稿、動線 D7、文案槽最小可講、本 lock 檔
- 產出寫入 `05-工程/`；完成回 Mack＋產品主編
