import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRoster, pickMonthTab } from "./shift-roster.ts";

const rows = [
  ["", "8/14", "8/15", "8/16"],
  ["王禮子", "", "30651", ""],
  ["0912345678", "", "", ""],
  ["曾奕豪", "", "614858A", ""],
  ["0987654321", "", "", ""],
  ["林某某", "155294", "", ""],
  ["0911111111", "", "", ""],
];

test("讀出那一天排到的導遊與車別碼", () => {
  const r = parseRoster(rows, "2026-08-15");
  assert.deepEqual(r.get("30651")?.map((g) => g.name), ["王禮子"]);
  assert.equal(r.get("614858")?.[0].car, "A");
  assert.equal(r.get("614858")?.[0].phone, "0987654321");
  assert.equal(r.get("155294"), undefined);        // 那是 8/14 的班，不該混進來
});

test("換一天就換一欄，不會沿用前一天", () => {
  const r = parseRoster(rows, "2026-08-14");
  assert.deepEqual([...r.keys()], ["155294"]);
});

test("找不到當月分頁回 null —— 寧可說沒讀到，也不要拿別月的班表", () => {
  assert.equal(pickMonthTab(["26 07月", "26 08月"], "2026-08-15"), "26 08月");
  assert.equal(pickMonthTab(["26 07月"], "2026-08-15"), null);
});
