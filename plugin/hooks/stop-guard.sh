#!/bin/sh
# Stop hook:advisory guard 安全網(spec §6)。
# 定位誠實:這不是強制閘門(可被刪檔/中斷繞過),強制層是 yellow+ 專案的 CI。
# 行為:無 PROJECT.yaml → 靜默 exit 0;紅燈 → exit 2 擋收工;hook 自身故障 → fail-open exit 0。

INPUT=$(cat 2>/dev/null || true)

# 專案根:優先 CLAUDE_PROJECT_DIR,其次 hook stdin 的 cwd,最後 pwd
ROOT_DIR="${CLAUDE_PROJECT_DIR:-}"
if [ -z "$ROOT_DIR" ]; then
  ROOT_DIR=$(printf '%s' "$INPUT" | sed -n 's/.*"cwd"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
fi
[ -n "$ROOT_DIR" ] || ROOT_DIR=$(pwd)

# 非 vibe 專案 → 零干擾(spec §6 存活條件)
[ -f "$ROOT_DIR/PROJECT.yaml" ] || exit 0

# guard 來源:專案自帶優先,plugin 內建副本備援
GUARD="$ROOT_DIR/scripts/guard/validate_project.py"
[ -f "$GUARD" ] || GUARD="$(dirname "$0")/validate_project.py"

# fail-open 防呆:python3 或 pyyaml 不在 → 提醒後放行(enforcement 在 CI)
if ! command -v python3 >/dev/null 2>&1; then
  echo "[vibe-governance] 找不到 python3,跳過收工 guard(fail-open;yellow+ 專案 CI 仍會擋)" >&2
  exit 0
fi
if ! python3 -c "import yaml" >/dev/null 2>&1; then
  echo "[vibe-governance] python3 缺 pyyaml,跳過收工 guard(fail-open;pip install pyyaml 可啟用)" >&2
  exit 0
fi

OUT=$(python3 "$GUARD" --project-root "$ROOT_DIR" 2>&1)
CODE=$?

if [ "$CODE" -eq 1 ]; then
  # guard 紅燈:擋收工,把紅燈項給 Claude 修
  echo "[vibe-governance] guard 紅燈,收工前先修正以下項目:" >&2
  echo "$OUT" >&2
  exit 2
elif [ "$CODE" -ne 0 ]; then
  # guard 自身異常(非紅燈):fail-open
  echo "[vibe-governance] guard 執行異常(exit=$CODE),跳過(fail-open):" >&2
  printf '%s\n' "$OUT" | head -3 >&2
  exit 0
fi

# 綠燈:warning 印到 stderr 供 debug(正式可見管道是 CI,不假裝使用者一定看到)
printf '%s\n' "$OUT" | grep -i "warning" >&2 || true
exit 0
