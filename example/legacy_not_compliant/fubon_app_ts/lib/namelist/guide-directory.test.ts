import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDirectory, contactsFor, isLineUrl, nameKey } from "./guide-directory.ts";

const guideTab = [
  ["Supplier Oid", "Guide Name", "Guide Email", "手機", "導遊 LINE QR", "Line 連結", "WhatsApp 帳號", "WeChat 帳號", "確認無誤", "Line 連結 確認"],
  ["27883", "王禮子", "a@b.com", "090-1111-2222", "(舊 QR 連結)", "https://line.me/ti/p/abc", "-", "wx-001", "V", "V"],
  ["27883", "曾奕豪", "c@d.com", "090-3333-4444", "", "lineid-not-url", "+886900000000", "", "", ""],
];

test("讀出 Line 連結、電話與其他軟體", () => {
  const d = parseDirectory(guideTab);
  const g = d.get(nameKey("王禮子"))!;
  assert.equal(g.lineUrl, "https://line.me/ti/p/abc");
  assert.equal(g.phone, "090-1111-2222");
  assert.deepEqual(g.contacts, [{ type: "WeChat", account: "wx-001" }]);   // WhatsApp 是「-」＝空
});

test("「Line 連結 確認」不會被誤認成連結欄", () => {
  const d = parseDirectory(guideTab);
  assert.equal(d.get(nameKey("王禮子"))!.lineUrl, "https://line.me/ti/p/abc");   // 不是 "V"
});

test("填成 LINE ID 而不是網址 → 不送出，寧可缺也不要給客人點不動的東西", () => {
  const d = parseDirectory(guideTab);
  assert.ok(!isLineUrl(d.get(nameKey("曾奕豪"))!.lineUrl));
  assert.equal(contactsFor(d.get(nameKey("曾奕豪"))).imAccount, "");
});

test("司兼導分頁欄位不同也讀得出來", () => {
  const d = parseDirectory([
    ["分類", "導遊姓名", "電話", "WhatsApp 帳號", "WeChat 帳號", "司兼導 LINE QR", "Line 連結", "備註"],
    ["北海道", "張董 Chang", "080-3908-8581", "", "", "", "https://line.me/ti/p/xyz", ""],
  ]);
  const g = d.get(nameKey("張董 Chang"))!;
  assert.equal(g.lineUrl, "https://line.me/ti/p/xyz");
  assert.equal(g.phone, "080-3908-8581");
});

test("姓名比對不受空白影響", () => {
  const d = parseDirectory(guideTab);
  assert.ok(d.get(nameKey("王 禮子")));
});

test("沒有姓名欄就中止，不會安靜回空表", () => {
  assert.throws(() => parseDirectory([["A", "B"], ["1", "2"]]), /找不到姓名欄/);
});

test("讀得到導遊信箱（寄名單要用）", () => {
  const d = parseDirectory(guideTab);
  assert.equal(d.get(nameKey("王禮子"))!.email, "a@b.com");
  // 司兼導那張沒有信箱欄 → 空字串，不是 undefined，上層才好判斷
  const d2 = parseDirectory([["分類", "導遊姓名", "電話"], ["北海道", "張董", "080-1"]]);
  assert.equal(d2.get(nameKey("張董"))!.email, "");
});

test("一格寫了好幾種姓名寫法也查得到（2026-08-15 實測）", () => {
  const d = parseDirectory([
    ["Supplier Oid", "Guide Name", "Guide Email", "手機"],
    ["27183", "毛曉彩／毛暁彩", "a@b.com", "070-1"],
    ["21234", "森山明明（モリヤマミンミン）", "c@d.com", "080-2"],
  ]);
  // 大表寫的是這兩個短名，跟名冊整格都不相等
  assert.equal(d.get(nameKey("毛曉彩"))!.email, "a@b.com");
  assert.equal(d.get(nameKey("毛暁彩"))!.email, "a@b.com");
  assert.equal(d.get(nameKey("森山明明"))!.email, "c@d.com");
  assert.equal(d.get(nameKey("森山明明（モリヤマミンミン）"))!.email, "c@d.com");
});

test("簡體與繁體要對得起來 —— 兩張表由不同人維護，寫法不一定一致", () => {
  assert.equal(nameKey("田阳"), nameKey("田陽"));
  assert.equal(nameKey(" 田阳 "), "田陽");
  // 對不上的後果不是報錯，是名單寄不出去，而且看起來像「這位導遊沒登記」
  assert.equal(nameKey("森山明明"), nameKey("森山明明"));
});
