import os
import hmac
import uuid
from flask import Flask, request, jsonify
from platform_sdk import run_workflow

app = Flask(__name__)

# [Spec §2.2] Fail fast: 缺必要 env 啟動就報錯
_REQUIRED_ENV = ["CRON_SECRET"]

def _validate_env():
    missing = [k for k in _REQUIRED_ENV if not os.environ.get(k)]
    if missing:
        raise RuntimeError(f"啟動失敗: 缺少必要環境變數: {', '.join(missing)}。請檢查 .env.example。")

_validate_env()

# [Rule] 必須提供無外部依賴的 /health
@app.route('/health', methods=['GET'])
def health_check():
    # 不可查 DB、不可打外部服務
    return jsonify({"status": "ok"}), 200

# [Rule] 排程任務必須暴露 POST /api/jobs/<name>，並驗證 Bearer token
@app.route('/api/jobs/<job_name>', methods=['POST'])
def trigger_job(job_name):
    # 驗證 Token
    auth_header = request.headers.get('Authorization', '')
    expected_token = os.environ.get('CRON_SECRET')
    
    if not expected_token:
        return jsonify({"error": "CRON_SECRET not configured"}), 500

    if not auth_header:
        return jsonify({"error": "Unauthorized"}), 401
        
    if not hmac.compare_digest(auth_header, f"Bearer {expected_token}"):
        return jsonify({"error": "Unauthorized"}), 401

    # 同步、有界執行，由 Kubernetes CronJob 負責 Timeout 控制
    run_id = str(uuid.uuid4())
    payload = request.json or {}
    
    try:
        result = run_workflow(job_name, inputs=payload, run_id=run_id)
        return jsonify(result), 200 if result.get("status") == "success" else 500
    except Exception as e:
        return jsonify({"status": "error", "error_msg": str(e), "run_id": run_id}), 500

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 8080))
    # [Rule] HTTP service 必須綁 0.0.0.0
    app.run(host="0.0.0.0", port=port)
