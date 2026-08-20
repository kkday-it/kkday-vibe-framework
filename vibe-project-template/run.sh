#!/usr/bin/env bash
# 統一進入點:本機、CI、Dkron 都從這裡跑。
# Dkron executor 一律:clean checkout main → pip install -r requirements.txt → ./run.sh <task>
set -euo pipefail

TASK="${1:-}"
[ -n "$TASK" ] || { echo "usage: ./run.sh <task> [args...]"; echo "tasks: worker | run --run-id=<id> | <自訂 task>"; exit 2; }
shift || true

case "$TASK" in
  # ---- 框架保留 task(實作在 kkday-connectors,專案不改) ----
  worker)
    # 事件驅動派工器:撿 ready → 經 Dkron API 開一次性 run job → 重建 index → 秒退
    exec python -m platform_sdk.worker --project-yaml PROJECT.yaml
    ;;
  run)
    # 由 worker 派工的單一 run:載入 skill、執行、更新狀態機、發狀態頁
    exec python -m platform_sdk.runner --project-yaml PROJECT.yaml "$@"
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
