#!/bin/sh
# SessionStart hook:注入公司 vibe coding 規範摘要(≤1200 bytes,spec §4/§7-6)。
# 四種 source(startup/resume/clear/compact)輸出一致,無狀態、無疊加。
cat "$(dirname "$0")/../COMPANY.md"
