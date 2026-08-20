// 執行：node --test lib/insurance/notify-slack.test.ts
// 守住 Slack 訊息組法：成功/失敗/中止/全已投保過、排除提醒、保費顯示、稽核 tag、商品斷行。
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSlackText, type SlackRunSummary } from "./notify-slack.ts";

const okRow = {
  出團日: "2026-07-30", 團號: "0730 - 1D 250", 天數: 1, 保額萬: 250, 人數: 27,
  模式: "真送" as const, 結果: "成功" as const, 保費: "864.0元(每人保費32.0元)", 保單號: "2526ATL2040970",
};

test("成功：顯示保單號、不顯示保費（保費只進 Sheet）", () => {
  const t = buildSlackText({ 出團日: "2026-07-30", 模式: "真送", ok: true, rows: [okRow] });
  assert.match(t, /✅ 富邦投保完成/);
  assert.match(t, /2526ATL2040970/);
  assert.doesNotMatch(t, /保費/);
});

test("tag 在獨立一行（後面隔空行接加粗標題）", () => {
  const t = buildSlackText({ 出團日: "2026-07-30", 模式: "真送", ok: true, rows: [okRow], auditMentionIds: ["U1", "U2"] });
  assert.match(t, /^<@U1> <@U2>\n\n\*✅ 富邦投保完成/);
});

test("有排除 → 加⚠️提醒行", () => {
  const t = buildSlackText({ 出團日: "2026-07-30", 模式: "真送", ok: true, rows: [okRow], excludedCount: 2 });
  assert.match(t, /有 2 人被排除、未投保/);
  assert.match(t, /排除未投保.*分頁確認/);
});

test("稽核 tag：成功也 @Demi&Klo", () => {
  const t = buildSlackText({ 出團日: "2026-07-30", 模式: "真送", ok: true, rows: [okRow], auditMentionIds: ["U1", "U2"] });
  assert.match(t, /<@U1> <@U2>/);
});

test("試跑結束：照樣 tag，但不再要人進後台核對（Ina 2026-08-18）", () => {
  const t = buildSlackText({ 出團日: "2026-07-30", 模式: "真送", ok: true, rows: [okRow], auditMentionIds: ["U1"] });
  // tag 留著 —— 意義從「請你去核對」變成「讓你知道今天保了什麼」
  assert.match(t, /<@U1>/);
  // 🔴 天天出現又不用做的提醒，會讓人整則跳過，連真的要處理的失敗一起跳掉
  assert.doesNotMatch(t, /試跑階段|後台驗證投保內容/);
});

test("商品逐項斷行（多商品不擠一行、段落小標＋縮排、全名不精簡）", () => {
  const t = buildSlackText({
    出團日: "2026-07-30", 模式: "真送", ok: true, rows: [okRow],
    products: [{ oid: "30651", name: "A" }, { oid: "155294", name: "北海道富良野" }],
  });
  assert.match(t, /🗾 \*商品（2）\*\n　30651　A\n　155294　北海道富良野/);
});

test("標題加粗、摘要在標題下一行、保單用小標", () => {
  const t = buildSlackText({
    出團日: "2026-07-30", 模式: "真送", ok: true, rows: [okRow],
    products: [{ oid: "30651", name: "A" }],
  });
  assert.match(t, /^\*✅ 富邦投保完成｜出團日 2026-07-30\*\n共 \d+ 人・1 張保單/);
  assert.match(t, /🎫 \*保單\*/);
});

test("全部已投保過 → 綠字、不當異常、不 tag", () => {
  const t = buildSlackText({ 出團日: "2026-07-29", 模式: "真送", ok: true, rows: [], allSkipped: true, skipped: 2, mentionUserId: "UINA" });
  assert.match(t, /✅ 富邦投保：全部已投保過/);
  assert.doesNotMatch(t, /🚨/);
  assert.doesNotMatch(t, /<@UINA>/);
});

test("失敗 → 🚨/❌ 並 tag Ina", () => {
  const bad: SlackRunSummary = {
    出團日: "2026-07-30", 模式: "真送", ok: false, mentionUserId: "UINA",
    rows: [{ ...okRow, 結果: "失敗", 保費: undefined, 保單號: undefined, 錯誤: "登入逾時" }],
  };
  const t = buildSlackText(bad);
  assert.match(t, /<@UINA>/);
  assert.match(t, /失敗：登入逾時/);
});

test("中止（沒跑到任何桶）→ 🚨 中止並 tag", () => {
  const t = buildSlackText({ 出團日: "2026-07-30", 模式: "真送", ok: false, rows: [], abortReason: "登入失敗", mentionUserId: "UINA" });
  assert.match(t, /🚨 富邦投保中止/);
  assert.match(t, /<@UINA>/);
  assert.match(t, /登入失敗/);
});
