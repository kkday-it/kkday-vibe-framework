#!/usr/bin/env bash
set -euo pipefail

TASK="${1:-}"
[ -n "$TASK" ] || { echo "usage: ./run.sh <task> [args...]"; echo "tasks: web | worker"; exit 2; }
shift || true

case "$TASK" in
  web)
    # 使用 Streamlit 取代原本的 Tkinter
    exec streamlit run src/main.py
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
