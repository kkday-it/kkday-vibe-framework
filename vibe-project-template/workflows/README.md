# workflows/ — 要被治理的動作單元

每個 workflow 一個資料夾,照 workflow-contract-v0(vibe-coding-governance/workflow-contract-v0.md):

```
<workflow-name>/
  manifest.yaml  # 必要。宣告觸碰了哪些外部系統、需要什麼機密。     # id/owner/type/intent/inputs/outputs/credentials/risk_tier…
├── flow.py              # 執行邏輯,只准透過 ctx.* 碰外界
├── README.md
└── tests/
    └── dry_run_case.yaml
```

鐵則:
- flow 只認 `ctx.*`(ctx.secrets / ctx.browser / ctx.notify / ctx.checkpoint)— 禁 import requests 直打、禁直用 kkday-connectors、禁讀 os.environ 拿憑證
- credentials 只准 `vault://` 引用
- dry_run 必實作;寫入單點;typed errors;迴圈有界
- 多方參數流程:inputs 各欄位標 `decided_by: <role>`,通知連結宣告 `frontend_url` 模板
