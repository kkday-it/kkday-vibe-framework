"""[Legacy] 標準 worker — 派工器:早期預留作為本機 worker，
現行架構下已被 Kubernetes CronJob + api.py 取代。

正式職責(若未來需要從 DB 撿件):
  1. 讀該專案 pending 表,row lock 撿 `ready` 的 run
  2. 對每個 run 呼叫 platform_sdk.run_workflow (或拋出新的 K8s Job)
  3. 在途 run 數控制在 manifest max_parallel(預設 3)內
  4. 從 DB 全量重建 vibefile index 頁

MVP:佔位 — 印出職責並立即退出(符合「秒退」形狀,不做常駐迴圈)。
"""
import argparse
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] [worker] %(message)s")


def main():
    parser = argparse.ArgumentParser(description="Enterprise Workflows dispatcher (one-shot)")
    parser.add_argument("--project-yaml", required=True)
    args = parser.parse_args()

    logging.info(f"worker 啟動(專案配置: {args.project_yaml})")
    logging.info("MVP 佔位:vibe DB pending 表與 ingest 尚未就緒,無件可派,立即退出(秒退形狀)")
    # TODO(vibe DB 就緒): 撿 ready → Dkron API 開一次性 run job → 重建 index → 回收完成 job


if __name__ == "__main__":
    main()
