import test from "node:test";
import assert from "node:assert/strict";
import { parseResendRequests, pendingFor, isRequested, RESEND_TAB, NOT_FOUND } from "./resend-requests.ts";

const HDR = ["申請時間", "出團日", "團號", "原因", "狀態", "處理時間"];

test("讀出待處理的重寄申請", () => {
  const reqs = parseResendRequests([
    HDR,
    ["2026-08-15 17:20", "2026-08-16", "KK260816-39100", "車號打錯", "", ""],
    ["2026-08-15 09:00", "2026-08-16", "KK260816-30651", "備註漏了", "已重寄", "2026-08-15 09:05"],
  ]);
  assert.equal(reqs.length, 2);
  const pend = pendingFor(reqs, "2026-08-16");
  assert.equal(pend.length, 1);
  assert.equal(pend[0].tourCode, "KK260816-39100");
});

test("團號比對忽略空白與大小寫（AM 手打會有全形空白）", () => {
  const reqs = parseResendRequests([HDR, ["", "2026-08-16", " kk260816-39100 ", "", "", ""]]);
  assert.ok(isRequested(reqs, "2026-08-16", "KK260816-39100"));
});

test("別天的申請不會被誤處理", () => {
  const reqs = parseResendRequests([HDR, ["", "2026-08-17", "KK260817-39100", "", "", ""]]);
  assert.equal(pendingFor(reqs, "2026-08-16").length, 0);
});

test("狀態欄空白＝待處理（AM 不一定會填）", () => {
  const reqs = parseResendRequests([HDR, ["", "2026-08-16", "KK260816-39100", "", "", ""]]);
  assert.equal(reqs[0].done, false);
});

test("⚠️ 欄位改名讀不到時要吵，不能安靜回空——申請會石沉大海", () => {
  assert.throws(() => parseResendRequests([["時間", "備註"], ["x", "y"]]), new RegExp(RESEND_TAB));
});

test("空分頁不算錯（就是還沒有人申請）", () => {
  assert.deepEqual(parseResendRequests([]), []);
  assert.deepEqual(parseResendRequests([HDR]), []);
});

/** 下拉選單改版後的兩個新行為（Ina 2026-08-15）。 */

test("下拉選單的值帶商品名，只取前面的團號", () => {
  const rows = [
    ["申請時間", "出團日", "團號", "原因", "狀態", "處理時間"],
    ["", "2026-08-16", "KK260816-39100　積丹半島一日遊", "客人加訂", "", ""],
  ];
  const [r] = parseResendRequests(rows);
  assert.equal(r.tourCode, "KK260816-39100");
  assert.ok(isRequested([r], "2026-08-16", "kk260816-39100"));
});

test("「找不到這團」算已處理——否則每小時重試一次、每小時 tag 一次真人", () => {
  const rows = [
    ["申請時間", "出團日", "團號", "原因", "狀態", "處理時間"],
    ["", "2026-08-16", "KK260816-00000", "", NOT_FOUND, "2026-08-15 20:00"],
  ];
  assert.equal(pendingFor(parseResendRequests(rows), "2026-08-16").length, 0);
});

test("AM 把狀態欄清空之後會再被撿起來", () => {
  const rows = [
    ["申請時間", "出團日", "團號", "原因", "狀態", "處理時間"],
    ["", "2026-08-16", "KK260816-39100", "", "", "2026-08-15 20:00"],
  ];
  assert.equal(pendingFor(parseResendRequests(rows), "2026-08-16").length, 1);
});

test("欄序改了也讀得到——解析靠標題文字，不靠位置", () => {
  // AM 要填的三欄在前、程式在寫的三欄在後（2026-08-15 改的順序）
  const rows = [
    ["出團日", "團號", "原因", "申請時間", "狀態", "處理時間"],
    ["2026-08-16", "KK260816-39100　積丹半島", "客人加訂", "2026-08-15 22:10", "", ""],
  ];
  const [r] = parseResendRequests(rows);
  assert.equal(r.date, "2026-08-16");
  assert.equal(r.tourCode, "KK260816-39100");
  assert.equal(r.reason, "客人加訂");
  assert.equal(r.done, false);
});

// ── 「重寄什麼」欄（Ina 2026-08-16 新增）─────────────────────────────
import { kindOf, RESEND_KINDS, RESEND_KIND_LIST, NOT_ENABLED, statusRangeA1 } from "./resend-requests.ts";

test("空白一律當「名單給導遊」—— 這欄是後來才加的，舊資料不能因此失效", () => {
  assert.equal(kindOf(""), "GUIDE");
  assert.equal(kindOf(undefined), "GUIDE");
  assert.equal(kindOf("　"), "GUIDE");
});

test("認得出三種選項", () => {
  assert.equal(kindOf(RESEND_KINDS.GUIDE), "GUIDE");
  assert.equal(kindOf(RESEND_KINDS.FNL), "FNL");
  assert.equal(kindOf(RESEND_KINDS.SCM), "SCM");
});

test("選項文字之後改了也還認得（比對關鍵字不是整串）", () => {
  assert.equal(kindOf("FNL 給供應商"), "FNL");
  assert.equal(kindOf("重寄保津川"), "FNL");
  assert.equal(kindOf("SCM 回報"), "SCM");
});

test("認不得的字當成名單給導遊，不要整列丟掉", () => {
  assert.equal(kindOf("隨便打的字"), "GUIDE");
});

test("解析時帶出 kind，並且可以只挑某一種", () => {
  const rows = [
    ["出團日", "團號", "重寄什麼", "原因", "申請時間", "狀態", "處理時間"],
    ["2026-08-18", "KK260818-30651　嵐山", RESEND_KINDS.FNL, "人數改了", "", "", ""],
    ["2026-08-18", "KK260818-155294　富良野", RESEND_KINDS.GUIDE, "名單有錯", "", "", ""],
    ["2026-08-18", "KK260818-30651　嵐山", RESEND_KINDS.FNL, "重複", "", "已重寄", ""],
  ];
  const reqs = parseResendRequests(rows);
  assert.deepEqual(reqs.map((r) => r.kind), ["FNL", "GUIDE", "FNL"]);
  assert.equal(pendingFor(reqs, "2026-08-18", "FNL").length, 1);
  assert.equal(pendingFor(reqs, "2026-08-18", "GUIDE").length, 1);
  assert.equal(pendingFor(reqs, "2026-08-18").length, 2);
});

test("尚未開通的項目處理完會寫回原因，且不會被重複撿起來", () => {
  assert.match(NOT_ENABLED, /還沒開通/);
  const rows = [
    ["出團日", "團號", "重寄什麼", "原因", "申請時間", "狀態", "處理時間"],
    ["2026-08-18", "KK260818-30651", RESEND_KINDS.SCM, "", "", NOT_ENABLED, ""],
  ];
  assert.equal(pendingFor(parseResendRequests(rows), "2026-08-18").length, 0);
});

test("下拉選項就是那三個，順序固定", () => {
  assert.deepEqual(RESEND_KIND_LIST,
    ["名單給導遊", "FNL 給京馬車＆保津川", "SCM 回報司導給客人（尚未開通）"]);
});

test("狀態欄範圍從標題算，不寫死 —— 加欄之後 E:F 會蓋掉申請時間", () => {
  assert.equal(statusRangeA1(12), "F12:G12");   // 出團日A 團號B 重寄什麼C 原因D 申請時間E 狀態F 處理時間G
});
