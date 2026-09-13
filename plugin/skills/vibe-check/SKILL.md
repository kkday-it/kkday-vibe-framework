---
name: vibe-check
description: 健檢現有專案是否符合 kkday vibe coding 規範。當使用者問「這個專案合規嗎」「幫我檢查一下」「上雲前看一下」、或想知道現有資料夾離公司標準差多少時使用。跑 guard + 對照 cloud-ready 三關，輸出差距清單與下一步。
---

# vibe-check — 專案健檢

本 skill 唯一源在 `kkday-it/kkday-vibe-framework` 的 vibe-governance plugin。

## 流程

1. **有沒有 `PROJECT.yaml`？** 沒有 → 這個專案還沒申報，先建議跑 `vibe-start` 補申報（可以只補 green 最小版），沒申報就沒有分級、guard 也不知道用什麼標準看它。
2. **跑 guard**：優先用專案自帶 `scripts/guard/validate_project.py`，沒有就用 plugin 內建副本（`hooks/validate_project.py`），一律帶 `--project-root`。列出紅燈與警告。
3. **對照 cloud-ready 三關**（權威：`vibe-cloud-ready-spec-0913.md`）：
   - 第一關：本機 `docker compose` 起得來？參數都在 `.env`？（§1.8 清單逐項）
   - 第二關：無狀態、不寫磁碟、log 走 stdout、無 runtime DDL（§3 硬約束表）
   - 第三關：平台介接項（RDS/S3/排程）——只列「要跟平台談什麼」，不在本機驗。
4. **輸出**：分「現在就該修（紅燈）」「上雲前要補（黃燈）」「要跟平台確認（清單）」三段，各附對應 spec 節次。是 PaaS-heavy 專案（Supabase/Vercel…）要遷移的，指路 `cloud-ready-review`（完整落差審查）。
