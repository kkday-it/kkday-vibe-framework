# Vibe Framework ☁️

Vibe Framework 是一個為企業級自動化量身打造的開發與佈署框架。

它的核心精神是 **"Vibe Coding"**：讓非工程背景的營運團隊、PM 或是 AI Assistant (例如 Cursor, Windsurf) 能夠專注於撰寫「商業邏輯腳本」，而將所有關於權限管控、憑證管理、排程、與雲端原生 (Cloud-Native) 基礎設施的複雜性，全部交由底層的 **`platform_sdk`** 與 DevOps 團隊來接管。

## 📖 給 AI 助手 (For AI Agents) 的核心指引

如果你是一個 AI Agent，請在撰寫或修改任何程式碼之前，**務必詳細閱讀**以下兩份核心文件：

1. **架構與風格指南**: [vibe-project-template/CLAUDE.md](vibe-project-template/CLAUDE.md)
   - 定義了什麼是 `Workflow`、為什麼不能在原始碼中留下憑證、以及如何正確地操作資料庫。
2. **上雲硬性約束 (Cloud-Ready Spec)**: [vibe-cloud-ready-spec.md](vibe-cloud-ready-spec.md)
   - 定義了專案必須打包成 Docker 容器放入 Kubernetes (EKS) 的 12 條鐵則（例如：必須無狀態、禁止寫入本機硬碟、正確的 Port 綁定等）。

## 🏗️ 框架核心概念

### 1. Platform SDK (`platform_sdk/`)
這是整個框架的「護城河 (Adapter)」。它攔截了所有可能造成副作用的操作。
- 所有的外部連線、憑證取得、Log 輸出、Slack 通知，都**必須**透過它注入的 `Context` 物件來執行。
- 在本機端，它可以讀取 `.env`；在雲端環境，它可以無縫切換為讀取 AWS Vault 或 K8s Secrets，而上層應用程式完全不需改寫。

### 2. Workflows (`workflows/`)
這是原子化的自動化單位 (Atomic Unit of Work)。
- 每一個流程 (如：自動登入 Odoo 填表、去後台抓取訂單) 都被獨立封裝在 `workflows/<workflow_name>/` 下。
- 每個 Workflow 都必須擁有 `manifest.yaml` 來嚴格宣告它會觸碰到的外部系統，以利資安治理。
- 外部的 API Server 或 Web UI，僅能透過 `run_workflow("workflow_id", inputs={...})` 來呼叫它們。

---

## 📂 專案結構

```
.
├── platform_sdk/               # 核心 Adapter 層，支援多語言
│   ├── py/                     # Python 版本的 SDK 與執行器
│   └── ts/                     # Node.js/TypeScript 版本的 SDK
├── vibe-project-template/      # 專案建立範本與檢查腳本 (Guard)
│   ├── CLAUDE.md               # AI 開發指南
│   ├── workflows/              # Workflow 範本
│   └── scripts/guard/          # CI/CD 檢查腳本
├── example/                    # 實際導入框架的範例專案
│   ├── insurance_app/          # 範例：旅行保險自動投保 (Streamlit UI + Playwright)
│   ├── bpm_app/                # 範例：Odoo 匯退單自動送審 (Streamlit UI + Playwright)
│   └── ticket_bot/             # 範例：客服工單處理 (Flask API)
└── vibe-cloud-ready-spec.md    # EKS 上雲 12 條硬性約束
```

## 🚀 快速開始 (For Users / DevOps)

這裡的每個範例專案 (`example/`) 都已經是 100% Cloud-Native 的微服務。你可以進入任何一個範例中啟動它。

以 `bpm_app` 為例：

### 本機開發測試
```bash
cd example/bpm_app
# 啟動 Streamlit 介面
./run.sh web 
```

### 容器化打包與上雲
我們已經為每個專案準備好了 `Dockerfile`，並內建了非 root 使用者與正確的 0.0.0.0 綁定。
```bash
cd example/bpm_app
# 建立 Image
docker build -t vibe-bpm-app .

# 運行容器 (由於完全無狀態，你可以隨意重啟或開多個 Replica)
docker run -p 8501:8501 --env-file .env vibe-bpm-app
```

---

> *"Build for the Cloud, Code for the Vibe."* 
