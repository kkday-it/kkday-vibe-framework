#!/usr/bin/env bash
set -euo pipefail

TASK="${1:-}"
[ -n "$TASK" ] || { echo "usage: ./run.sh <task> [args...]"; echo "tasks: web | worker"; exit 2; }
shift || true

case "$TASK" in
  web)
    # 執行 Flask API 伺服器
    export FLASK_APP=src/api.py
    exec flask run --host=0.0.0.0 --port=${PORT:-5000}
    ;;
  worker)
    export PYTHONPATH="$(pwd)/../../platform_sdk/py:$PYTHONPATH"
    exec python -m platform_sdk.worker --project-yaml PROJECT.yaml
    ;;
  *)
    echo "unknown task: $TASK" >&2
    exit 2
    ;;
esac
