#!/usr/bin/env bash
# 統一進入點:本機、CI、K8s CronJob/Deployment 都從這裡跑。
# 預設執行環境為 Python 3.11+
set -euo pipefail

TASK="${1:-}"
[ -n "$TASK" ] || { echo "usage: ./run.sh <task> [args...]"; echo "tasks: web | worker | run <workflow-id> [--run-id r-x] [--input k=v ...] [--yes] | migrate | <自訂 task>"; exit 2; }
shift || true

case "$TASK" in
  # ---- 框架保留 task(實作在 kkday-connectors,專案不改) ----
  web)
    # Cloud-Ready 進入點: API Server 綁定 0.0.0.0
    exec gunicorn -b 0.0.0.0:${PORT:-8080} src.api:app
    ;;
  worker)
    # [Legacy/Fallback] 事件驅動派工器
    exec python -m platform_sdk.worker --project-yaml PROJECT.yaml
    ;;
  run)
    # 執行單一 workflow run:載入 workflows/<id>/flow.py、執行、寫 run 摘要。
    # runner 的 CLI 是 per-workflow(--workflow 必填),故 task 收 workflow id 轉傳(issue #2)。
    WF="${1:-}"
    [ -n "$WF" ] || { echo "usage: ./run.sh run <workflow-id> [--run-id r-x] [--input k=v ...] [--yes]" >&2; exit 2; }
    shift
    exec python -m platform_sdk.runner --workflow "$WF" "$@"
    ;;
  migrate)
    # DB migration runner (Spec §4.5)
    exec python scripts/migrate.py
    ;;

  # ---- 專案自訂 task(範例;task 名對應 PROJECT.yaml schedules 的 key) ----
  # daily_report)
  #   exec python -m src.daily_report "$@"
  #   ;;

  *)
    echo "unknown task: $TASK" >&2
    exit 2
    ;;
esac
