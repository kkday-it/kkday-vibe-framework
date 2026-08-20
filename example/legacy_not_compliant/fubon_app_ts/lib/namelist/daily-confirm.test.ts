import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDailyConfirm, namelistBlock, toIso } from "./daily-confirm.ts";

const rows: string[][] = [
  [], ["", "", "明天出團(名單)", "", "", "", "", "", "四天成團"],
  [], ["", "", "08/07", "", "", "", "", "", "08/10"],
  [],
  ["編號", "團名", "人數", "是否成團", "地區", "", "OID", "團名", "人數", "是否成團"],
  ["528834", "富士山親子", "0", "不催行", "關東", "", "30651", "嵐山小火車", "21", "催行決定"],
  ["528834C", "富士山親子 桃子", "12", "催行決定", "關東"],
];

test("讀得出兩個區塊與各自日期", () => {
  const b = parseDailyConfirm(rows, new Date("2026-08-06"));
  assert.equal(b.length, 2);
  assert.equal(b[0].date, "2026-08-07");
  assert.equal(b[1].title, "四天成團");
});

test("不催行的團不算成團；車別碼要拆出來", () => {
  const nb = namelistBlock(parseDailyConfirm(rows, new Date("2026-08-06")))!;
  assert.equal(nb.tours.length, 2);
  assert.equal(nb.tours[0].go, false);              // 不催行
  assert.equal(nb.tours[1].go, true);
  assert.equal(nb.tours[1].carLetter, "C");
  assert.equal(nb.tours[1].productNo, "528834");
});

test("12 月看到 1 月＝明年", () => {
  assert.equal(toIso("1/3", new Date("2026-12-30")), "2027-01-03");
  assert.equal(toIso("08/07", new Date("2026-08-06")), "2026-08-07");
});
