import { test } from "node:test";
import assert from "node:assert/strict";
import { buildParties, splitToBuses } from "./assign-buses.ts";
import { parseCapacity, parseTourCode, findBuckets } from "./bus-buckets.ts";

const bucket = (code: string, letter: string, cap: number | null) =>
  ({ tourCode: code, carLetter: letter, date: "2026-08-02", productNo: "284399", capacity: cap, booked: null, busText: "", rowNo: 1 });

test("位空優先於座數", () => {
  assert.equal(parseCapacity("北之旅49座大巴 位空44"), 44);
  assert.equal(parseCapacity("櫻華 14座"), 14);
  assert.equal(parseCapacity("北之旅大巴"), null);
});

test("團號解析出車別碼", () => {
  assert.equal(parseTourCode("KK260802-284399A")?.carLetter, "A");
  assert.equal(parseTourCode("KK250817-155290")?.carLetter, "");
  assert.equal(parseTourCode("260802-284399A"), null);
});

test("同行單一定同車", () => {
  const pax = new Map([["26KK000000001", 2], ["26KK000000002", 3], ["26KK000000003", 4]]);
  const comp = new Map([["26KK000000001", "26KK000000001"], ["26KK000000003", "26KK000000001"]]);
  const parties = buildParties(pax, comp);
  assert.equal(parties.length, 2);
  assert.equal(parties.find(p => p.key === "26KK000000001")!.size, 6);
});

test("兩台車人數盡量均分、結果可重現", () => {
  const parties = buildParties(new Map([["A", 6], ["B", 4], ["C", 4], ["D", 2]]), new Map());
  const r = splitToBuses(parties, [bucket("T-A", "A", 10), bucket("T-B", "B", 10)]);
  assert.equal(r.overflow.length, 0);
  assert.deepEqual(r.assignments.map(a => a.used).sort((x, y) => x - y), [8, 8]);   // 均分，不是 6/10
  const r2 = splitToBuses(parties, [bucket("T-A", "A", 10), bucket("T-B", "B", 10)]);
  assert.deepEqual(r.assignments.map(a => a.parties.map(p => p.key)), r2.assignments.map(a => a.parties.map(p => p.key)));
});

test("沒寫位空就不亂分", () => {
  const r = splitToBuses(buildParties(new Map([["A", 5]]), new Map()), [bucket("T-A", "A", null), bucket("T-B", "B", 20)]);
  assert.equal(r.assignments.length, 0);
  assert.match(r.warnings[0], /沒寫「位空」/);
});

test("放不下就列出來，不硬塞", () => {
  const r = splitToBuses(buildParties(new Map([["A", 30]]), new Map()), [bucket("T-A", "A", 10), bucket("T-B", "B", 10)]);
  assert.equal(r.overflow.length, 1);
  assert.equal(r.assignments.every(a => a.used === 0), true);
});

test("大表導遊欄拆得出姓名與電話", async () => {
  const { parseGuide } = await import("./bus-buckets.ts");
  const a = parseGuide("林科豐 (Nick.yo.lin) 070-4034-4412 競技場スタンド：C區 バス駐車場：B-12");
  assert.equal(a.name, "林科豐");
  assert.equal(a.phone, "07040344412");
  const b = parseGuide("小山　文子 090 1234 5678");
  assert.equal(b.name, "小山文子");
  assert.equal(parseGuide("").name, "");        // 空白不猜
  assert.equal(parseGuide("未定").phone, "");
});

test("大表上三種團號變體都要讀得懂", () => {
  const p = parseTourCode;
  assert.equal(p("KK260802-284399A")?.date, "2026-08-02");
  assert.equal(p("KK20250426-265887A")?.date, "2025-04-26");   // 日期 8 碼
  assert.equal(p("KK241116-195654-A")?.carLetter, "A");         // 字母前有橫槓
  assert.equal(p("KK240618-170052\n備註寫在下一行")?.productNo, "170052"); // 只看第一行
  assert.equal(p("包團報價中"), null);                          // 不是團號就別硬解
});

test("沒有車型欄＝不用車，不該要求位空", () => {
  const rows = [["團號", "出發日期", "人數", "導遊"], ["KK260807-30651", "8/7", "10", "柚子"]];
  const bk = findBuckets(rows, { tour: 0, bus: -1, total: 2, guide: 3 }, "2026-08-07", 0);
  assert.equal(bk.length, 1);
  assert.equal(bk[0].usesVehicle, false);
  assert.equal(bk[0].capacity, null);
});

test("團號欄左邊那格＝催行狀態（不寫死 A 欄）", () => {
  const rows = [
    ["狀態", "團號", "出發日期", "人數", "導遊"],
    ["催行決定", "KK260808-155294", "8/8", "11", "王禮子"],
    ["不催行", "KK260809-155294", "8/9", "0", ""],
    ["催行待ち", "KK260815-155294", "8/15", "9", ""],
  ];
  const cols = { tour: 1, bus: -1, total: 3, guide: 4 };
  assert.equal(findBuckets(rows, cols, "2026-08-08", 0)[0].go, true);
  assert.equal(findBuckets(rows, cols, "2026-08-09", 0)[0].go, false);
  assert.equal(findBuckets(rows, cols, "2026-08-15", 0)[0].status, "催行待ち");   // 待ち≠決定
  assert.equal(findBuckets(rows, cols, "2026-08-15", 0)[0].go, false);
});

