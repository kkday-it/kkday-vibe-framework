# Specs CHANGELOG

## 2026-09-14

- `2026-09-14-vibe-plugin-v1-design.md`（新增）/ Vibe Governance Plugin v1 設計 / grill 定案（單一終點線、棕地混合分工、綠地走 plugin、v1=標準版）後的第一份交付物設計：plugin/ 子目錄結構、SessionStart 短注入、Stop hook fail-open guard、vibe-start scaffolder 三題問答、三個 migration skill 收編、驗收五條。
- `2026-09-14-vibe-plugin-v1-design.md`（codex peer-review 修正，5H+4M+2L 全採納）/ codex 審出實質問題逐項落地 / (H1) marketplace source 改 `"./plugin"`、安裝明確兩步（add + install）、發版前 plugin validate；(H2) guard 新增 `--project-root`——打包後 `__file__` 在 plugin cache，原 parents[2] 推 ROOT 會檢查錯目錄；(H3) hook 定位改「advisory 安全網」誠實標示（可被刪檔/中斷/上限繞過），強制層明確 = CI + branch protection；(H4) scaffolder 取 template 改釘 tag、暫存 clone + manifest 驗證 + atomic copy、fail-closed 不留半成品；(H5) 三題外欄位自動推導（id/owner/status/schedules）、guard cloud-ready 檔案檢查依 tier 分級（green=warning）、run.sh 不帶參數改列 task 清單（修 spec §1.4 既有矛盾）；(M) 收編 namespace 並存風險註記、驗收條件改「fixture→指令→預期」格式、更新相容寫進發版程序、SessionStart 設 1200-byte 預算；(L) COMPANY.md 釘死 spec 檔名、warning 可見性誠實標示（debug-only，正式管道是 CI）。
