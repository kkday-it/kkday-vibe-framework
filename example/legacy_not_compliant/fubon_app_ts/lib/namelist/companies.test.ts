import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCompanies, matchCompany, coreName } from "./companies.ts";

const rows = [
  ["Supplier Oid", "Car Company Name", "別名/俗稱", "Email", "Link", "確認無誤"],
  ["31732", "櫻華國際", "", "ouka@x.com", "", "FALSE"],
  ["33318", "株式会社サンシャイン貿易", "", "info@sunshinetrade.jp", "", "TRUE"],
  ["31692", "株式会社御遊", "", "", "", "FALSE"],
  ["29040", "STAR TIGER TRAVEL合同会社", "星虎、星虎大巴", "star@x.com", "", "FALSE"],
];
const list = parseCompanies(rows);

test("讀得出清單，空白列跳過", () => {
  assert.equal(list.length, 4);
  assert.equal(list[1].ok, true);
  assert.equal(list[2].email, "");
});

test("大表簡稱對得到正式名", () => {
  assert.equal(matchCompany("櫻華 14座", list)?.email, "ouka@x.com");
  assert.equal(matchCompany("サンシャイン45座 雙司機", list)?.supplierOid, "33318");
  assert.equal(coreName("株式会社御遊"), "御遊");
});

test("對不到就回 null，不亂猜", () => {
  assert.equal(matchCompany("北之旅49座大巴 位空44", list), null);
  assert.equal(matchCompany("", list), null);
});

test("別名欄讓中英文不同名也對得到", () => {
  const hit = matchCompany("星虎大巴", list);
  assert.equal(hit?.supplierOid, "29040");
  assert.equal(hit?.email, "star@x.com");
});

test("異體字／全形／大小寫由程式吃掉，不用填別名", () => {
  const l = parseCompanies([
    ["Supplier Oid", "Car Company Name", "別名", "Email"],
    ["31664", "龍藤観光株式会社", "", "a@x.com"],
    ["28207", "357観光", "", "b@x.com"],
    ["31676", "株式会社FLY観光", "", "c@x.com"],
    ["31976", "Travelbox", "", "d@x.com"],
  ]);
  assert.equal(matchCompany("龍藤觀光49座大巴 一位司機", l)?.supplierOid, "31664"); // 観↔觀
  assert.equal(matchCompany("357觀光7人座", l)?.supplierOid, "28207");
  assert.equal(matchCompany("Fly 14座司兼導 位空13", l)?.supplierOid, "31676");     // 大小寫
  assert.equal(matchCompany("ＴＲＡＶＥＬＢＯＸ 14人座", l)?.supplierOid, "31976"); // 全形
});

test("⚠️ 公司名照原文印，不做日文漢字↔繁體轉換（Ina 2026-08-15）", () => {
  const list = parseCompanies([
    ["Supplier Oid", "Company Name", "Email", "確認", "別名"],
    ["1", "龍藤観光株式会社", "a@b.jp", "TRUE", "龍藤觀光"],
    ["2", "株式会社サンシャイン貿易", "c@d.jp", "TRUE", "陽光貿易"],
  ]);
  // 大表寫繁體簡稱也要配得到（比對層吃掉字形差異）
  const hit = matchCompany("龍藤觀光 49座大巴 位空44", list);
  assert.equal(hit?.name, "龍藤観光株式会社");   // 回傳的是名單上的**原始寫法**
  // 別名只是比對用的橋，不能變成顯示名稱
  assert.equal(matchCompany("陽光貿易 25座", list)?.name, "株式会社サンシャイン貿易");
});
