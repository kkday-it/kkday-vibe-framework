# Vibe Framework

Vibe Framework 是一套讓企業員工與 AI coding agent 產出 **cloud-ready enterprise workflow** 的 repo template、SDK shim 與治理規約。

本 repo 的最高指導原則是 [vibe-cloud-ready-spec.md](vibe-cloud-ready-spec.md)：目標環境是公司內部 AWS EKS、RDS PostgreSQL、S3、Kubernetes CronJob、stdout/stderr logging，以及由平台 config-manager 注入的 runtime env/secrets。任何提案、template 或 SDK 行為若與這份 DevOps spec 衝突，以 DevOps spec 為準。

## 核心目標

- 讓非工程背景同仁或 AI assistant 可以寫商業 workflow，但不用自行決定憑證、排程、儲存、部署與雲端約束。
- 讓每個專案從第一天就符合 EKS 上雲條件：stateless、runtime env、PostgreSQL、S3、HTTP job endpoint、health endpoint。
- 讓治理資訊機器可讀：`PROJECT.yaml` 宣告 owner、risk tier、touches、PII、排程與外部連線。
- 讓 workflow 只透過 `ctx.*` adapter 碰外界，日後底層從 local shim 換成正式平台時，業務程式不用重寫。

## Repo 內容

```text
.
├── vibe-cloud-ready-spec.md       # DevOps 上雲硬約束，最高優先級
├── project-template-v0.md         # Enterprise Workflows repo 層提案
├── platform_sdk/
│   ├── py/                        # Python ctx.* local shim
│   └── ts/                        # TypeScript ctx.* local shim
├── vibe-project-template/         # 新專案模板
│   ├── CLAUDE.md                  # AI coding rules
│   ├── docs/cloud-ready-spec.md   # template 內附的 DevOps spec copy
│   ├── PROJECT.yaml               # 專案身分證範本
│   └── scripts/guard/             # repo guard checks
├── registry/                      # PROJECT.yaml 登錄冊 MVP
└── docs/roadmap.md                # 重要但尚未實作的能力
```

內部案例、PDF、私人討論素材不隨此 repo 發布；它們可以作為遷移參考，但不是 framework 的公開驗收依據。

## 目前成熟度

這個 repo 目前是 **M1 template + SDK shim**，不是完整 runtime 平台。

已可用：

- `PROJECT.yaml` 與 workflow manifest 的基本治理形狀。
- `CLAUDE.md` 讓 AI agent 在產出程式前讀 cloud-ready spec。
- Python/TypeScript `ctx.*` local shim 的基本形狀。
- guard CI 的基本 schema/secret/dependency 檢查。
- registry script 的主動登錄 MVP。

仍在 roadmap：

- scaffold 指令。
- Kubernetes CronJob/GitOps 自動同步。
- `ctx.storage`、`ctx.db`、`ctx.sheet`、`ctx.mail` 的正式 connector 實作。
- CODEOWNERS/curator review 自動化。
- 進階狀態機、magic link、重跑與 kill switch。

完整清單見 [docs/roadmap.md](docs/roadmap.md)。

## 新專案原則

從 `vibe-project-template/` 開新專案時，請把 [vibe-cloud-ready-spec.md](vibe-cloud-ready-spec.md) 視為驗收清單，而不是建議：

- container 監聽 `$PORT` 並綁 `0.0.0.0`
- 設定與 secret 只從 runtime env 來
- 檔案產出進 S3，暫存只用 `/tmp`
- DB 使用外部 PostgreSQL，schema 變更走 forward-only migration
- 排程由 Kubernetes CronJob 呼叫 HTTP endpoint，例如 `POST /api/jobs/<name>`
- health endpoint 不依賴 DB 或外部服務
- audit log / status / notification 不可含 secret 或未遮罩 PII

## 給 AI Assistant 的指引

修改任何 template、SDK 或 workflow 規約前，先讀：

1. [vibe-cloud-ready-spec.md](vibe-cloud-ready-spec.md)
2. [project-template-v0.md](project-template-v0.md)
3. [vibe-project-template/CLAUDE.md](vibe-project-template/CLAUDE.md)

如果文件之間出現衝突，依序採用：

1. DevOps cloud-ready spec
2. template/guard 中已實作的機器規則
3. roadmap 中的未來設計
