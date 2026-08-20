# <專案名>

> 從 vibe-project-template 開出來的專案。框架規約見 CLAUDE.md(AI 會自動遵守);
> 完整框架文件:project-template-v0.md(vibe-framework)。

## 這專案做什麼

(一段話)

## 快速開始

```bash
cp .env.example .env      # 填本機開發用變數(連 sit)
pip install -r requirements.txt
./run.sh <task>
```

## 開新專案 checklist

1. 填 `PROJECT.yaml`(id/owner/team/risk_tier/touches)— 這是最低要求
2. 需要 Slack/Gmail → `touches.integrations` 登記,程式碼用 `kkday-connectors`
3. 需要排程 → `PROJECT.yaml schedules` 加 task→cron,`run.sh` 加對應 case
4. 有副作用的動作(打 API/操作外站/發訊息)→ 寫成 `workflows/` 下的 workflow 包
5. push 後看 guard CI 綠燈

## 目錄

| 路徑 | 放什麼 |
|---|---|
| `src/` | 專案內部邏輯 |
| `workflows/` | 要被治理的動作單元(照 workflow-contract-v0) |
| `integrations/` | 串接設定與 thin wrapper,不放邏輯 |
| `assets/` | 圖片、報告等產出物 |
| `docs/` | 規劃、決策紀錄 |
| `scripts/` | 一次性/維運腳本(標注可否重跑) |
| `tests/` | 測試 |

## 負責人

owner 見 `PROJECT.yaml`。
