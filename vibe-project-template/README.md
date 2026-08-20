# <專案名>

> 從 vibe-project-template 開出來的 cloud-ready workflow/service 專案。
> 最高約束是 `docs/cloud-ready-spec.md`;AI 開發規則見 `CLAUDE.md`。

## 這專案做什麼

(一段話)

## 快速開始

```bash
cp .env.example .env      # 只供本機;cloud 由 runtime env/secrets 注入
pip install -r requirements.txt
./run.sh <task>
```

## 開新專案 checklist

1. 先讀 `docs/cloud-ready-spec.md`,設計必須符合 EKS/RDS/S3/Kubernetes CronJob 約束。
2. 填 `PROJECT.yaml`(id/owner/team/risk_tier/touches/runtime/schedules)。
3. 更新 `.env.example`,每個 env 都標註分類、用途與是否必填。
4. 需要排程 → `PROJECT.yaml schedules` 加 cron + endpoint,並實作 `POST /api/jobs/<name>`。
5. 有副作用的動作(打 API/操作外站/發訊息)→ 寫成 `workflows/` 下的 workflow 包,並只用 `ctx.*` adapter。
6. 有 PII → `PROJECT.yaml touches.pii: true`,audit log/status/notification 必須 mask。
7. push 後看 guard CI 綠燈。

## 目錄

| 路徑 | 放什麼 |
|---|---|
| `src/` | 專案內部邏輯 |
| `workflows/` | 要被治理的動作單元(照 workflow-contract-v0) |
| `integrations/` / `adapters/` | 串接設定與 adapter,不放業務邏輯 |
| `assets/` | 圖片、報告等產出物 |
| `docs/` | 規劃、決策紀錄 |
| `scripts/` | 一次性/維運腳本(標注可否重跑) |
| `tests/` | 測試 |

## 部署備註

- Container port:`${PORT:-8080}`
- Health endpoint:`/health` 或 `/api/health`
- Scheduled jobs:`POST /api/jobs/<name>` with `Authorization: Bearer $CRON_SECRET`
- DB:PostgreSQL via `DB_*` or `DATABASE_URL`;runtime 不做 DDL
- Storage:S3 via bucket/region env and AWS default credential chain
- Logs:stdout/stderr;任何 audit/status/notification 不得含 raw secret 或 raw PII

## 負責人

owner 見 `PROJECT.yaml`。
