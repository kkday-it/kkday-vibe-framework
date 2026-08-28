# Vibe Framework Roadmap

本檔保存「重要但尚未實作」的能力。主 README、template 與 proposal 不把這些寫成已交付承諾；但它們仍是後續要追的設計事項。

最高優先級仍是 `vibe-cloud-ready-spec.md`。roadmap 項目若與 DevOps spec 衝突，必須改成 cloud-ready 版本後才能進主線。

## ⚠️ 開始 M1 前先確認:conformance-gate-spec.md 的 A/B 規則跟現有用法對不上

`conformance-gate-spec.md`(2026-08-28 merge,見 PR #1)的 A(輸入閘門)/B(輸出閘門)規則假設的情境是「AI agent **即時呼叫**一個 governed tool」(reference-only input、tool_result 筆數上限這些概念,對映的是 MCP 或類似的 agent-tool 呼叫層)。

但這個 repo 目前實際的用法是「**同事叫 Claude Code 寫一次性的 `flow.py`**,之後由 K8s CronJob/worker 排程執行」——寫 code 的當下沒有任何 tool call 發生,A/B 規則邏輯上套不上這個流程。C(資料流封鎖)/D(寫入護欄)/E(不孤兒+可觀測)三組沒有這個問題,對「Claude 寫 code」這個現有流程直接有效。

**M1 實作前建議先決定**:
1. A/B 兩組規則現在要不要照字面實作進 `validate_project.py`?(若實作,guard 檢查的對象——input/output schema 的 maxLength/maxItems 這些——其實還是可以套在 `manifest.yaml` 的 `inputs`/`outputs` 定義上,不一定要等到有 MCP 呼叫層才有意義;但要確認這個解讀跟原意一致)
2. 還是先只做 C/D/E,把 A/B 標成「等 MCP/即時 agent 呼叫層出現才啟用」,列進 roadmap 而非 M1?

這個決定會影響 M1 的實際範圍,建議開工前先拍板,不要照單全收。

## R1. Scaffold 指令

**狀態**：未實作。

目標：

- `vibe init <project-id>` 產生 cloud-ready project。
- 複製 `docs/cloud-ready-spec.md`、`CLAUDE.md`、`PROJECT.yaml`、`.env.example`、`Dockerfile`、`.dockerignore`。
- 依語言產生 health endpoint 與 `/api/jobs/<name>` skeleton。

完成條件：

- 新專案不手修即可通過 guard。
- README 內不再需要手動複製 template 的步驟。

## R2. Cloud-Ready Guard 完整化

**狀態**：基本 guard 已有，cloud-ready rules 未完整。

待補：

- `.env.example` 變數分類檢查。
- Dockerfile 非 root、`0.0.0.0`、不 copy `.env`、不在 CMD 跑 migration。
- `.dockerignore` 檢查。
- `/health` 與 `/api/jobs/*` 宣告檢查。
- 掃描反模式：SQLite、file DB、`setInterval`、crond、hardcoded localhost、runtime DDL、寫專案目錄 uploads。

## R3. Kubernetes CronJob / GitOps 同步

**狀態**：未實作。

主線設計：

- `PROJECT.yaml schedules` 是 repo 內宣告。
- 平台/GitOps 將 schedules 轉成 Kubernetes CronJob。
- CronJob 呼叫 `POST /api/jobs/<name>`，帶 `Authorization: Bearer $CRON_SECRET`。

不採用為主線：

- Dkron。
- GitHub Actions cron。
- container 內 crond。
- in-process timer。

Dkron 若未來仍需支援，定位為 legacy adapter 或特殊環境 fallback。

## R4. Connectors / `ctx.*` 實作

**狀態**：SDK shim 介面先行，多數正式實作未完成。

待補：

- `ctx.storage` → S3，使用 AWS SDK default credential chain。
- `ctx.db` → PostgreSQL，連線池小、TLS、CRUD runtime。**Agent flow 執行情境需 read-only role / draft schema 分離**（conformance-gate-spec.md D1 load-bearing 控制：未宣告 `effect: write` 的直寫要在權限層被擋，不能只靠宣告誠實），生產寫入只能由已批准 executor 用另一組較高權限憑證執行；`ctx.db` 從 `_NotYet` 佔位接上真 adapter 時一併做。
- `ctx.notify` → 公司 Slack/Email connector，token 不外露；send 前跑 `ctx.redact()`(對映 conformance-gate-spec.md A2)。
- `ctx.sheet` → Google Sheet export view，不作 source of truth；介面只接受 `PROJECT.yaml touches` 綁定的 folder/sheet ID 與 `file_id`/`path`，不暴露任意 ID 或模糊搜尋參數（對映 conformance-gate-spec.md C4）。
- `ctx.mail` → 公司郵件 connector。
- `ctx.log` → audit log masking、run summary、status renderer。
- **Egress allowlist runtime enforcement**（對映 conformance-gate-spec.md C3）：runtime 依 `manifest permissions.network.allow_hosts` 過濾出網，未宣告 host 一律拒（deny-by-default）。

完成條件：

- workflow 不需要直接 import vendor SDK。
- guard 能阻擋黃/紅區 workflow 直接使用禁用 SDK。
- agent 執行情境無法繞過宣告直接寫生產 DB（D1 權限層驗證）。

## R5. PII Masking 深化

**狀態**：基本 logger masking 可先做；完整 DLP 尚未。

主線要求：

- script 內處理 PII 可使用裸值。
- 寫入 audit log、status page、notification、run summary 前必須 mask。
- `PROJECT.yaml touches.pii: true` 時，狀態頁只放統計與來源系統連結。

待補：

- manifest 級 `pii` 欄位 mapping。
- 自訂 masking policy。
- hash / last-four / source-record-id helper。
- status renderer 強制檢查。

## R6. Workflow Contract Schema

**狀態**：文件與 guard 形狀已有，尚未統一成 JSON Schema。

待補：

- `schemas/project.schema.json`
- `schemas/workflow-manifest.schema.json`
- Python/TS SDK 共用同一 contract。
- guard 依 schema 驗證。

## R7. CODEOWNERS / Curator Review

**狀態**：未實作。

目標：

- 黃/紅區 workflow PR 需要 framework curator approve。
- 綠區 team 自審。
- 修改 `CLAUDE.md` 公司共用段或 cloud-ready spec 時需要 framework owner review。

## R8. 多方參數狀態機

**狀態**：設計保留，未實作。

Cloud-ready 版方向：

- 狀態存在 PostgreSQL。
- 觸發與補參數入口部署在 EKS 內部 service，或由我方排程去拉外部表單資料。
- 不依賴外部 SaaS webhook 主動打進內網。
- 補參數本身即 approval。
- audit log 記錄 actor/role/time/field，但 PII 值 mask 或 hash。

## R9. Kill Switch / Rerun / Audit Viewer

**狀態**：未實作。

待補：

- 停用 CronJob。
- 撤 secret / 停 token。
- run-level cancel/retry。
- 重跑建立新 run，引用原 run。
- audit viewer 顯示 masked log、狀態、來源系統連結。
- **Run ledger 結構**（對映 conformance-gate-spec.md E3）：每次執行至少記 `run_id / actor / 處理數 / 失敗數 / 結果`，PII 一律 mask；需搭配一條 conformance test 斷言任一 flow 執行後平台輸出確實存在這筆完整紀錄，E3 才能從「—」升成 `error` gate（目前無此測試，見 conformance-gate-spec.md E3 的誠實標註）。

## R10. Vibefile / Dkron Legacy Adapter

**狀態**：不作 cloud-ready 主線。

可能仍有價值：

- vibefile 可作內部臨時報表分享工具。
- Dkron 可作舊環境或非 EKS 專案 fallback。

限制：

- 不應寫進預設 template。
- 不應取代 S3/status endpoint/Kubernetes CronJob 主線。
- 若使用，必須明確標成 legacy adapter，並通過 PII/secret masking。
