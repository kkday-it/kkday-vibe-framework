import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeCsNotes, splitGroup } from "./enrich.ts";
import type { ProductGroup, NamelistRow } from "./guide-namelist.ts";

const row = (mid: string, note = ""): NamelistRow => ({
  bookingNo: mid, bookingDate: "", language: "", enName: "X", productNo: "284399",
  packageName: "", gender: "", birthday: "", age: 30, nationality: "", buyerPhone: "",
  appType: "", appAccount: "", note, splitHint: false,
});
const group = (rows: NamelistRow[]): ProductGroup =>
  ({ productNo: "284399", productName: "P", departureDate: "2026-08-02", rows, total: rows.length, warnings: [] });

const note = (mid: string, text: string, companions: string[] = []) =>
  ({ productNo: "284399", date: "2026-08-02", mid, note: text, companions, notifiedBd: "", rowNo: 2 });

test("追加備註接在原備註後、簡轉繁、不重覆", () => {
  const g = group([row("26KK000000001", "原備註")]);
  const { merged } = mergeCsNotes([g], [note("26KK000000001", "改成素食")]);
  assert.equal(merged, 1);
  assert.equal(g.rows[0].note, "原備註｜客服追加：改成素食");
  mergeCsNotes([g], [note("26KK000000001", "改成素食")]);
  assert.equal(g.rows[0].note, "原備註｜客服追加：改成素食");   // 跑第二次不會疊
});

test("同行單被分到同一台車", () => {
  const rows = [row("26KK000000001"), row("26KK000000001"), row("26KK000000002"),
                row("26KK000000003"), row("26KK000000003"), row("26KK000000003")];
  const notes = [note("26KK000000001", "同行單26KK000000003", ["26KK000000003"])];
  const buckets = [
    { tourCode: "KK260802-284399A", carLetter: "A", date: "2026-08-02", productNo: "284399", capacity: 5, booked: null, busText: "", rowNo: 7 },
    { tourCode: "KK260802-284399B", carLetter: "B", date: "2026-08-02", productNo: "284399", capacity: 5, booked: null, busText: "", rowNo: 8 },
  ];
  const e = splitGroup(group(rows), buckets, notes);
  const a = e.buses.find(b => b.carLetter === "A")!, b = e.buses.find(b => b.carLetter === "B")!;
  const carOf = (mid: string) => (a.rows.some(r => r.bookingNo === mid) ? "A" : "B");
  assert.equal(carOf("26KK000000001"), carOf("26KK000000003"));   // 同行必同車
  assert.equal(a.total + b.total, 6);
});

test("容量抓不到就不分車，並警告", () => {
  const buckets = [
    { tourCode: "KK260802-284399A", carLetter: "A", date: "2026-08-02", productNo: "284399", capacity: null, booked: null, busText: "北之旅大巴", rowNo: 7 },
    { tourCode: "KK260802-284399B", carLetter: "B", date: "2026-08-02", productNo: "284399", capacity: 40, booked: null, busText: "", rowNo: 8 },
  ];
  const e = splitGroup(group([row("26KK000000001")]), buckets, []);
  assert.equal(e.buses.length, 1);
  assert.ok(e.warnings.some(w => /沒寫「位空」/.test(w)));
});

test("不用車的商品不該喊『無法分車』（30651 嵐山，Ina 2026-08-15）", () => {
  // 假警報混在真缺漏裡，人會開始略過警告——比不報還糟。
  const bk: any = {
    tourCode: "KK260815-30651", carLetter: "", date: "2026-08-15", productNo: "30651",
    capacity: null, booked: null, busText: "", guideText: "森山", guideName: "森山", guidePhone: "",
    driverText: "", status: "催行決定", go: true, usesVehicle: false, serviceMode: "純司機",
  };
  const g: any = { productNo: "30651", productName: "嵐山半日遊", rows: [{ bookingNo: "A" }, { bookingNo: "B" }], warnings: [] };
  const out = splitGroup(g, [bk], []);
  assert.equal(out.buses.length, 1);
  assert.equal(out.buses[0].rows.length, 2);              // 人一個都沒少
  assert.deepEqual(out.warnings.filter((w) => /分車/.test(w)), []);
});

test("528834 型：依方案分車，C／D 上帶 C 的那台（Ina 2026-08-15）", () => {
  const bk = (code: string, letter: string): any => ({
    tourCode: code, carLetter: letter, date: "2026-08-20", productNo: "528834",
    capacity: 25, booked: null, busText: "巴士 位空 25", guideText: "", guideName: "", guidePhone: "",
    driverText: "", status: "催行決定", go: true, usesVehicle: true, serviceMode: "純司機",
  });
  const row = (mid: string, plan: string): any => ({
    bookingNo: mid, packageName: `【促銷字樣】 ${plan}方案：富士山親子一日遊`, enName: "X", note: "",
  });
  const g: any = {
    productNo: "528834", productName: "富士山親子", warnings: [],
    rows: [row("m1", "A"), row("m2", "B"), row("m3", "C"), row("m4", "D")],
  };
  const out = splitGroup(g, [bk("KK260820-528834", ""), bk("KK260820-528834C", "C")], []);
  const ab = out.buses.find((b) => b.carLetter === "")!;
  const cd = out.buses.find((b) => b.carLetter === "C")!;
  assert.deepEqual(ab.rows.map((r: any) => r.bookingNo), ["m1", "m2"]);
  assert.deepEqual(cd.rows.map((r: any) => r.bookingNo), ["m3", "m4"]);   // D 也上 C 那台
});

test("有人的套餐看不出方案 → 整團不分，不猜", () => {
  const bk = (code: string, letter: string): any => ({
    tourCode: code, carLetter: letter, date: "2026-08-20", productNo: "528834", capacity: 25,
    booked: null, busText: "位空 25", guideText: "", guideName: "", guidePhone: "", driverText: "",
    status: "催行決定", go: true, usesVehicle: true, serviceMode: "純司機",
  });
  const g: any = {
    productNo: "528834", productName: "富士山親子", warnings: [],
    rows: [{ bookingNo: "m1", packageName: "C方案：…", enName: "X", note: "" },
           { bookingNo: "m2", packageName: "富士山親子一日遊", enName: "Y", note: "" }],
  };
  const out = splitGroup(g, [bk("KK260820-528834", ""), bk("KK260820-528834C", "C")], []);
  assert.equal(out.buses.length, 1);
  assert.equal(out.buses[0].rows.length, 2);            // 人一個都沒少
  assert.match(out.warnings.join(" "), /看不出方案/);
});
