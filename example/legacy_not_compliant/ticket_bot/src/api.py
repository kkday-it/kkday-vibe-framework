"""
Ticket Bot - Flask API Server
保留原本做為 Web API 接收請求的功能，
但將爬蟲邏輯抽離到 process_be2_ticket workflow。
"""
import importlib
import threading
from flask import Flask, request, jsonify
from flask_cors import CORS
from platform_sdk import Context

app = Flask(__name__)
CORS(app)

def run_workflow_async(job_name: str, payload: dict = None):
    def _run():
        try:
            module = importlib.import_module(f"workflows.{job_name}.flow")
            ctx = Context(workflow_id=job_name, mode="worker")
            module.run(ctx, payload=payload)
        except Exception as e:
            print(f"Background Job {job_name} failed: {e}")
            
    thread = threading.Thread(target=_run)
    thread.daemon = True
    thread.start()

@app.route('/health', methods=['GET'])
def health():
    return jsonify({"status": "ok"})

@app.route('/api/process_order', methods=['POST'])
def process_order():
    data = request.json
    order_id = data.get('order_id')
    wantan_type = data.get('wantan_type', 'mansatisfied')
    
    if not order_id:
        return jsonify({"error": "缺少 order_id"}), 400
        
    payload = {
        "order_id": order_id,
        "wantan_type": wantan_type,
        "follow_type": "page"
    }

    run_workflow_async("process_be2_ticket", payload=payload)
    
    return jsonify({"status": "accepted"}), 202

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
