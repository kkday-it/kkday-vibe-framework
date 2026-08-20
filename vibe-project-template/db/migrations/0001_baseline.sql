-- 0001_baseline.sql
-- 此處請撰寫專案第一次上線所需的 DDL
-- 依照 Cloud-Ready Spec，請勿在 Runtime (api.py 或 flow.py) 中執行 CREATE TABLE
-- 所有的 Schema 變更都應該透過 Migration 腳本，且必須為 Forward-only。

CREATE TABLE IF NOT EXISTS runs (
    run_id VARCHAR(50) PRIMARY KEY,
    workflow_id VARCHAR(100) NOT NULL,
    status VARCHAR(20) NOT NULL,
    duration_s NUMERIC,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
