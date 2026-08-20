import { test } from "node:test";
import assert from "node:assert/strict";
import { rankProductTabs, pickCol, locateCols } from "./bigsheet.ts";
test("同編號多分頁：現行的排前面，隱藏／舊表往後（2026-08-15 大表實測）", () => {
  const tabs = [
    { title: "30651嵐山七月異動", hidden: true },
    { title: "30651-嵐山-舊", hidden: true },
    { title: "30651 嵐山" },
  ];
  const r = rankProductTabs(tabs, "30651");
  assert.equal(r[0], "30651 嵐山");                       // 現行的一定第一
  assert.deepEqual(r.slice(1).sort(), ["30651-嵐山-舊", "30651嵐山七月異動"]);
  // 兩張同樣是「隱藏＋舊表」→ 誰先誰後無所謂，不綁死順序
});

test("隱藏不等於作廢：只往後排，仍在候選內", () => {
  // 實測有隱藏分頁裡仍然有團 → 直接排除會整團消失
  const tabs = [{ title: "170052 山中湖KABA", hidden: true }, { title: "170052 山中湖（包車）" }];
  assert.equal(rankProductTabs(tabs, "170052").length, 2);
  assert.equal(rankProductTabs(tabs, "170052")[0], "170052 山中湖（包車）");
});

test("「（包車）」是正常變體，不是舊表，不該被降級到隱藏之後", () => {
  const tabs = [{ title: "155290箱根（包車）" }, { title: "155290箱根" }];
  assert.deepEqual(rankProductTabs(tabs, "155290").map((t) => t.includes("包車")), [false, true]);
});

test("pickCol：『導遊手配書』不能蓋過真正的『導遊』欄（39100 積丹，Ina 2026-08-15）", () => {
  const hdr = ["", "團號", "", "", "合計", "", "", "巴士公司 車型", "", "", "", "導遊手配書", "導遊", "司機", "餐食"];
  assert.equal(pickCol(hdr, /導遊|ガイド|添乗/), 12);
  assert.equal(pickCol(hdr, /司機|ドライバー|運転/), 13);
});

test("pickCol：只有修飾欄時仍然回它（總比讀不到好，但排最後）", () => {
  assert.equal(pickCol(["導遊手配書"], /導遊/), 0);
});

test("pickCol：沒有相符的欄回 -1，不要回 0 誤指到第一欄", () => {
  assert.equal(pickCol(["團號", "出發日"], /導遊/), -1);
});

/**
 * 多日遊分頁的標題列沒有「團號」二字——那一欄的標題直接寫成「158778 立山黑部三日遊」。
 * 原本整張分頁被安靜跳過，整個多日遊類別對大表掃描是隱形的（實測 8 個分頁）。
 */
test("標題列沒有「團號」時，用內容反推團號欄", () => {
  const rows = [
    ["OID158778 黑部立山", "", "", "", "", "", "", ""],
    ["催行状況", "保出", "158778 立山黑部三日遊", "出發日期", "方 案", "總人數", "巴士公司 / 車型", "導遊", "司機"],
    ["催行決定", "", "KK260816-158778A", "8/16", "", "13", "閻霞大巴", "", ""],
    ["", "", "", "", "", "", "", "", ""],
  ];
  const loc = locateCols(rows);
  assert.ok(loc, "應該要找得到標題列");
  assert.equal(loc!.hi, 1);
  assert.equal(loc!.cols.tour, 2, "團號欄應該靠內容認出是第 3 欄");
  assert.equal(loc!.cols.bus, 6);
});

test("有「團號」標題時仍走原本那條路，不受影響", () => {
  const rows = [
    ["催行状況", "團號", "巴士公司 / 車型", "導遊", "司機"],
    ["催行決定", "KK260816-39100", "北之旅", "", ""],
  ];
  const loc = locateCols(rows);
  assert.equal(loc!.cols.tour, 1);
});

test("認不出團號欄就回 null，不硬給一個欄號", () => {
  // 有「出發日期」也有「車型」，但下面完全沒有 KK 團號 → 寧可說問不到
  const rows = [
    ["出發日期", "巴士公司 / 車型", "備考"],
    ["8/16", "某某巴士", "尚未開賣"],
  ];
  assert.equal(locateCols(rows), null);
});

test("標題寫成「出發（換行）日期」也要認得出來 —— 對不上就整張分頁隱形（2026-08-20）", () => {
  // 153708 SPK戲雪、262036 白川＋牧歌 兩張分頁就是這樣寫的，原本整張被安靜跳過
  const rows = [
    ["OID153708 北海道戲雪"],
    [],
    ["催行状況", "保出", "153708 登別戲雪手配書", "出發\n日期", "A", "B", "合計", "位空", "司兼導", "巴士公司"],
    ["", "", "KK260822-153708", "8/22", "", "", "20", "25", "", "北都交通"],
  ];
  const loc = locateCols(rows);
  assert.notEqual(loc, null);
  assert.equal(loc!.hi, 2);
  // 團號那一欄是靠內容認出來的（標題寫的是商品名，不是「團號」）
  assert.equal(loc!.cols.tour, 2);
});
