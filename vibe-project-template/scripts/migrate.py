#!/usr/bin/env python3
"""db:migrate — 零依賴 forward-only SQL migration runner（Spec §2.5）。

用法:
    python -m scripts.migrate          # 套用所有未執行的 migration
    ./run.sh migrate                   # 同上（透過 run.sh）

行為:
    1. 從 env 讀 DB 連線（DATABASE_URL 或 DB_* 分項）
    2. 取 advisory lock 避免並行
    3. 建 schema_migrations 表（若不存在）
    4. 掃描 db/migrations/*.sql，只跑沒記錄過的
    5. 每個檔案跑在單一 transaction 內
    6. 重複執行安全
"""
import os
import sys
from pathlib import Path

try:
    import psycopg2
except ImportError:
    print("錯誤: 需要安裝 psycopg2-binary。請在 requirements.txt 加上 psycopg2-binary。")
    sys.exit(1)


def get_connection_string():
    """從 env 組出連線字串。DATABASE_URL 優先。"""
    url = os.environ.get("DATABASE_URL")
    if url:
        return url
    host = os.environ.get("DB_HOST")
    port = os.environ.get("DB_PORT", "5432")
    user = os.environ.get("DB_USER")
    password = os.environ.get("DB_PASSWORD")
    dbname = os.environ.get("DB_NAME")
    if not all([host, user, password, dbname]):
        print("錯誤: 缺少 DB 連線設定。請設定 DATABASE_URL 或 DB_HOST/DB_USER/DB_PASSWORD/DB_NAME。")
        sys.exit(1)
    return f"postgresql://{user}:{password}@{host}:{port}/{dbname}?sslmode=require"


def main():
    conn_str = get_connection_string()
    migrations_dir = Path(__file__).resolve().parents[1] / "db" / "migrations"

    if not migrations_dir.is_dir():
        print(f"找不到 migration 目錄: {migrations_dir}")
        sys.exit(1)

    conn = psycopg2.connect(conn_str)
    conn.autocommit = False

    try:
        cur = conn.cursor()

        # Advisory lock 避免並行 migrate
        cur.execute("SELECT pg_advisory_lock(42)")

        # 建 schema_migrations 表
        cur.execute("""
            CREATE TABLE IF NOT EXISTS schema_migrations (
                filename VARCHAR(255) PRIMARY KEY,
                applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.commit()

        # 取得已套用的 migration
        cur.execute("SELECT filename FROM schema_migrations ORDER BY filename")
        applied = {row[0] for row in cur.fetchall()}

        # 掃描並執行
        sql_files = sorted(f for f in migrations_dir.glob("*.sql"))
        pending = [f for f in sql_files if f.name not in applied]

        if not pending:
            print("✅ 所有 migration 已套用，無待辦。")
            return

        for sql_file in pending:
            print(f"▶ 套用: {sql_file.name} ...", end=" ")
            sql = sql_file.read_text(encoding="utf-8")
            try:
                cur.execute(sql)
                cur.execute(
                    "INSERT INTO schema_migrations (filename) VALUES (%s)",
                    (sql_file.name,)
                )
                conn.commit()
                print("✅")
            except Exception as e:
                conn.rollback()
                print(f"❌ 失敗: {e}")
                sys.exit(1)

        print(f"\n完成: 共套用 {len(pending)} 個 migration。")

    finally:
        cur.execute("SELECT pg_advisory_unlock(42)")
        conn.commit()
        conn.close()


if __name__ == "__main__":
    main()
