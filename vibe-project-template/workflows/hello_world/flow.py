import os
from platform_sdk import Context

def run(ctx: Context, **kwargs):
    ctx.log.info("Hello World Workflow Started")
    
    # 示範使用 ctx.secrets
    api_key = ctx.secrets.get("secret://hello_world_api_key", "default_mock_key")
    ctx.log.info("Successfully loaded secrets (value is masked).")
    
    # 示範使用 ctx.storage
    report_content = f"Report generated at {ctx.log._run_id}\nAll systems go."
    saved_path = ctx.storage.write_text("report.txt", report_content)
    
    # 示範使用 ctx.notify
    ctx.notify.slack(f"Hello World workflow {ctx.log._run_id} completed. Report saved to {saved_path}")
    
    ctx.log.info("Hello World Workflow Finished")
    return {"status": "success", "report_path": saved_path}

if __name__ == "__main__":
    # 本地測試進入點 (Interactive Mode)
    ctx = Context(workflow_id="sample.hello.world")
    run(ctx)
