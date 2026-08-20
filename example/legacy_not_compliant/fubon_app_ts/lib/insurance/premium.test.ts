// 執行：node --test lib/insurance/premium.test.ts
// 守住 2026-07-29 的保費漏抓真因：金額含小數點（864.0元）必須抓得到。
import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePremium } from "./premium.ts";

test("含小數點：864.0元(每人保費32.0元)", () => {
  assert.equal(parsePremium("保險費 864.0元(每人保費32.0元)"), "864.0元(每人保費32.0元)");
});

test("逗號＋小數：3,124.0元", () => {
  assert.equal(parsePremium("保險費 3,124.0元(每人保費44.0元)"), "3,124.0元(每人保費44.0元)");
});

test("無小數的舊格式：836元（每人44元）", () => {
  assert.equal(parsePremium("保險費836元（每人44元）"), "836元（每人44元）");
});

test("夾在整頁文字中也抓得到", () => {
  const page = "團員名冊檔 0730 JP 1day 250.pdf\n保險費 864.0元(每人保費32.0元)\n年保單號 2525ATYN000045";
  assert.equal(parsePremium(page), "864.0元(每人保費32.0元)");
});

test("沒有保費 → 回空字串", () => {
  assert.equal(parsePremium("這頁沒有金額"), "");
  assert.equal(parsePremium(""), "");
});
