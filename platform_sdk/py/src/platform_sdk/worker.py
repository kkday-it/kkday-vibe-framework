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
    logging.info("MVP 佔位:目前已改為 K8s CronJob 直接呼叫 api.py，無待辦任務，立即退出。")
    # TODO: 未來若有自建 Database Queue 需求，在此實作撿件與派發 K8s Job。


if __name__ == "__main__":
    main()
