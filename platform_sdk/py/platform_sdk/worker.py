"""標準 worker — 派工器(§7.5/§12):每專案單飛(Dkron concurrency=forbid),秒級退出。

正式職責(vibe DB + ingest 就緒後實作):
  1. 讀該專案 pending 表,row lock 撿 `ready` 的 run
  2. 對每個 run 經 Dkron API 建立並觸發一次性 run job
     (名=<專案id>.run.<run_id>,@manually,命令=./run.sh run --run-id=<id>)
     — 每個 run 都是一等 Dkron 執行:可見、可停、跑掛告警;絕不 fork 子行程
  3. 在途 run 數控制在 manifest max_parallel(預設 3)內
  4. 從 DB 全量重建 vibefile index 頁
  5. 回收已完成的一次性 job

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
