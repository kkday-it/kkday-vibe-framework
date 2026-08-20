#!/usr/bin/env bash
# 統一進入點:本機、CI、K8s CronJob/Deployment 都從這裡跑。
# 預設執行環境為 Python 3.11+
set -euo pipefail

TASK="${1:-}"
[ -n "$TASK" ] || { echo "usage: ./run.sh <task> [args...]"; echo "tasks: web | worker | run --run-id=<id> | <自訂 task>"; exit 2; }
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
    # 由 worker 派工的單一 run:載入 skill、執行、更新狀態機、發狀態頁
    exec python -m platform_sdk.runner --project-yaml PROJECT.yaml "$@"
    ;;
  migrate)
    # DB migration runner (Spec §2.5)
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
