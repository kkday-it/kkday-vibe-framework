---
name: vibe-start
description: 起手一個合規的 kkday vibe coding 專案。當使用者要開新專案、寫新工具、做新自動化、說「幫我建一個…」「我想寫一個…」時使用——即使他沒提「合規」或「規範」。問三個白話問題後生出合規骨架（green 最小申報或 yellow+ 完整 template），生成物保證 guard 綠燈。
---

# vibe-start — 起手即合規

本 skill 唯一源在 `kkday-it/kkday-vibe-framework` 的 vibe-governance plugin。

## 流程

### 1. 三個白話問題（一次一題，用使用者聽得懂的話）

1. **「這是要一直開著等人用的（網頁/API），還是時間到跑一下就結束的（報表/同步/爬蟲）？」** → `shape: web | job`
2. **「它會碰到公司系統、客人資料、或需要登入外部網站嗎？」**（逐項確認）→ `touches.internal_apis / pii / external_sites / integrations` → 推 `risk_tier`：都不碰 = green；碰公司系統或排程 = yellow；碰 PII、寫入外部、或外站 RPA = red 傾向（提示需人工審）。
3. **「自己用就好，還是要給團隊用／要定時自動跑？」** → 自己用且 green → 最小路徑；否則完整 template。

### 2. 其餘必填欄位自動推導（不要多問）

- `id`: `<team>.<目前資料夾名>`；team 從 `git config user.email` 或對話上下文推，推不出來才問一句。
- `owner`: `git config user.email` 的帳號部分。
- `status: active`、`schedules: {}`（第 3 題說要排程才引導填 task→cron）。
- 資料夾名含大寫或底線 → 先提醒改名（registry 拒大寫，spec §4.10）。

### 3a. green 最小路徑（自己用、不碰敏感）

只生 `PROJECT.yaml`（含上面欄位）＋ 口頭提醒兩條紅線（帳密走 env、個資不進對話/log）。**不強加 Dockerfile/compose**——guard 對 green 只給提醒不擋。

### 3b. yellow+ 完整路徑（fail-closed，不留半成品）

1. clone 釘版 tag 到暫存目錄：
   ```bash
   git clone --depth 1 --branch plugin-template-v1 https://github.com/kkday-it/kkday-vibe-framework.git "$TMPDIR/vibe-tpl"
   ```
   （tag 由 plugin 發版時配對；**不要用 master**。）
2. 驗證後才複製：clone exit 0、`vibe-project-template/` 下 `PROJECT.yaml`、`Dockerfile`、`compose.yml`、`scripts/guard/validate_project.py` 齊全 → 一次性複製整個 template 內容到目標資料夾。
3. 任何一步失敗 → **不複製任何東西**，告訴使用者手動下載路徑（GitHub → tags → plugin-template-v1 → zip），不要把 token 印進指令或訊息。
4. 依答案改寫 `PROJECT.yaml`（shape/touches/risk_tier/id/owner）；`compose.yml` 依 shape 留 A 型或 B 型段落（另一型的範例註解保留）。

### 4. 出生即綠燈

生成後立刻跑：
```bash
python3 scripts/guard/validate_project.py --project-root "$(pwd)"
```
（green 最小路徑用 plugin 內建 guard 副本。）紅燈就自己修到綠再交付——**scaffold 產物不允許帶紅燈出生**。最後告訴使用者：生成了什麼、他的分級是什麼、下一步（green：直接開始寫；yellow+：第一關驗收清單在 `docs/cloud-ready-spec.md` §1.8）。
