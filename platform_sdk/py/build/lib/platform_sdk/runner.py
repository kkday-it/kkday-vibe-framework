"""執行單一 workflow run:載 flow → 注入 ctx → 執行 → 失敗三件套(§12-3)。

run wrapper 職責(§6.3):開跑寫 run 記錄、結束更新狀態(MVP 記在 JSONL/摘要檔)、之後由框架重建狀態頁 index。
"""
import importlib.util
import json
import os
import sys
import time
from pathlib import Path

from .context import Context
from .errors import WorkflowError


def run_workflow(workflow_id, inputs=None, run_id=None):
    inputs = inputs or {}
    ctx = Context(workflow_id, run_id=run_id)
    ctx.log.info("run start", inputs_keys=list(inputs.keys()), mode=ctx.mode)
    t0 = time.time()

    workflow_path = Path.cwd() / "workflows" / workflow_id / "flow.py"
    if not workflow_path.exists():
        return _finish(ctx, t0, {"status": "error", "error_msg": f"找不到 flow: {workflow_path}"})

    try:
        spec = importlib.util.spec_from_file_location(f"workflows.{workflow_id}.flow", workflow_path)
        mod = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = mod
        spec.loader.exec_module(mod)
        if not hasattr(mod, "run"):
            raise WorkflowError("flow.py 未定義 run(ctx, **inputs) 函數")

        result = mod.run(ctx, **inputs)
        return _finish(ctx, t0, result if isinstance(result, dict) else {"status": "success", "result": result})

    except Exception as e:
        # 失敗三件套:① 現場保全(截圖+HTML) ② Slack 告警 ③ 狀態記錄供狀態頁
        log_dir = Path(os.environ.get("VIBE_LOG_PATH", "/tmp/vibe_logs"))
        log_dir.mkdir(parents=True, exist_ok=True)
        artifacts = ctx.browser.capture_failure(log_dir / ctx.run_id)
        ctx.log.error(f"run failed: {e}", error_type=type(e).__name__, artifacts=artifacts)
        ctx.notify(f"🔴 {workflow_id} 失敗 (run {ctx.run_id})\n錯誤: {type(e).__name__}: {e}\n"
                   f"log: {ctx.log.path}" + (f"\n現場: {', '.join(artifacts)}" if artifacts else ""))
        return _finish(ctx, t0, {"status": "error", "error_type": type(e).__name__, "error_msg": str(e)})
    finally:
        ctx.browser.close()


def _finish(ctx, t0, result):
    duration = round(time.time() - t0, 2)
    result.setdefault("status", "unknown")
    summary = {"run_id": ctx.run_id, "workflow": ctx.workflow_id, "status": result["status"],
               "duration_s": duration, "log": str(ctx.log.path)}
    # run 摘要(供狀態頁 index 重建)
    log_dir = Path(os.environ.get("VIBE_LOG_PATH", "/tmp/vibe_logs"))
    log_dir.mkdir(parents=True, exist_ok=True)
    (log_dir / f"{ctx.run_id}.summary.json").write_text(
        json.dumps({**summary, **{k: v for k, v in result.items() if k != "status"}},
                   ensure_ascii=False, indent=2))
    ctx.log.info("run end", **summary)
    return result


def main():
    """CLI:python -m platform_sdk.runner --workflow <id> [--run-id r-x] [--input k=v ...] [--yes]"""
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--workflow", required=True)
    p.add_argument("--run-id")
    p.add_argument("--input", action="append", default=[], help="k=v,可多個")
    p.add_argument("--yes", action="store_true", help="放行 interactive checkpoint")
    args, _ = p.parse_known_args()
    if args.yes:
        os.environ["VIBE_YES"] = "1"
    inputs = dict(kv.split("=", 1) for kv in args.input)
    result = run_workflow(args.workflow, inputs, run_id=args.run_id)
    print(json.dumps(result, ensure_ascii=False))
    sys.exit(0 if result.get("status") == "success" else 1)


if __name__ == "__main__":
    main()
