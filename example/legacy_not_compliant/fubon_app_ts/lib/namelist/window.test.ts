import { test } from "node:test";
import assert from "node:assert/strict";
import { windowDays, shouldHideToday } from "./window.ts";

/**
 * 這些測試守的是「半夜自己發生、早上才看到後果」的那類錯誤。
 * 人工驗證永遠在同一天內做完，所以跨日／跨月／跨年只能靠測試。
 */

test("一般情況：今天、明天、後天", () => {
  assert.deepEqual(
    windowDays(new Date("2026-08-15T03:00:00Z")),          // 日本 8/15 12:00
    ["2026-08-15", "2026-08-16", "2026-08-17"],
  );
});

test("用日本時區，不看本機時區", () => {
  // UTC 還是 8/15 晚上，日本已經 8/16 早上了
  assert.equal(windowDays(new Date("2026-08-15T22:30:00Z"))[0], "2026-08-16");
});

test("跨月：8/30 起算會滾進 9 月", () => {
  assert.deepEqual(
    windowDays(new Date("2026-08-30T03:00:00Z")),
    ["2026-08-30", "2026-08-31", "2026-09-01"],
  );
});

test("跨年：12/31 起算會滾進隔年", () => {
  assert.deepEqual(
    windowDays(new Date("2026-12-31T03:00:00Z")),
    ["2026-12-31", "2027-01-01", "2027-01-02"],
  );
});

test("閏年 2/28 → 2/29", () => {
  assert.deepEqual(
    windowDays(new Date("2028-02-28T03:00:00Z")),
    ["2028-02-28", "2028-02-29", "2028-03-01"],
  );
});

test("視窗一定是連續三天", () => {
  // 隨便挑一整年的每一天都檢查一次，不靠人挑邊界
  const base = Date.parse("2026-01-01T03:00:00Z");
  for (let i = 0; i < 365; i++) {
    const d = windowDays(new Date(base + i * 86_400_000));
    for (let k = 1; k < 3; k++) {
      const gap = Date.parse(d[k] + "T00:00:00Z") - Date.parse(d[k - 1] + "T00:00:00Z");
      assert.equal(gap, 86_400_000, `${d[k - 1]} → ${d[k]} 不是連續的`);
    }
  }
});

test("06:00 前不收今天的列（那時候還救得回來）", () => {
  assert.equal(shouldHideToday(new Date("2026-08-15T18:00:00Z")), false);   // 日本 8/16 03:00
  assert.equal(shouldHideToday(new Date("2026-08-15T20:30:00Z")), false);   // 日本 05:30
});

test("06:00 之後收起來", () => {
  assert.equal(shouldHideToday(new Date("2026-08-15T21:00:00Z")), true);    // 日本 06:00 整
  assert.equal(shouldHideToday(new Date("2026-08-16T01:00:00Z")), true);    // 日本 10:00
  assert.equal(shouldHideToday(new Date("2026-08-15T14:59:00Z")), true);    // 日本 23:59
});
