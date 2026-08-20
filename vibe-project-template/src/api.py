import os
import importlib
import threading
from flask import Flask, request, jsonify
from platform_sdk import Context

app = Flask(__name__)

def run_workflow_async(job_name: str):
    """
    Mock implementation of background worker.
    In real K8s CronJob, this might just be running synchronously or using a queue.
    For this API, we use a simple thread to free up the HTTP response.
    """
    def _run():
        try:
            # 依賴規範：工作流程式碼固定在 workflows/<job_name>/flow.py 裡的 run(ctx)
            module = importlib.import_module(f"workflows.{job_name}.flow")
            ctx = Context(workflow_id=job_name, mode="worker")
            ctx.log.info(f"Triggered by API (CronJob). Starting {job_name} in background.")
            module.run(ctx)
        except Exception as e:
            # Context 自己會紀錄 Error Log，這裡只做最後兜底
            print(f"Background Job {job_name} failed: {e}")
            
    thread = threading.Thread(target=_run)
    thread.daemon = True
    thread.start()

# [Rule] 必須提供無外部依賴的 /health
@app.route('/health', methods=['GET'])
def health_check():
    # 不可查 DB、不可打外部服務
    return jsonify({"status": "ok"}), 200

# [Rule] 排程任務必須暴露 POST /api/jobs/<name>，並驗證 Bearer token
@app.route('/api/jobs/<job_name>', methods=['POST'])
def trigger_job(job_name):
    # 驗證 Token
    auth_header = request.headers.get('Authorization')
    expected_token = os.environ.get('CRON_SECRET')
    
    if not expected_token:
        return jsonify({"error": "CRON_SECRET not configured"}), 500
        
    if auth_header != f"Bearer {expected_token}":
        return jsonify({"error": "Unauthorized"}), 401

    # 在此處把任務放進 Queue 或直接非同步執行
    run_workflow_async(job_name)
    
    return jsonify({"status": "accepted", "job": job_name}), 202

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 8080))
    # [Rule] HTTP service 必須綁 0.0.0.0
    app.run(host="0.0.0.0", port=port)
