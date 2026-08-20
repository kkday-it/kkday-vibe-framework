import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDapNamelist, fixPhone, normalizeBirthday, normalizeMessenger } from "./dap-source.ts";
import { buildFromTravelers } from "./guide-namelist.ts";

/** 真實資料的標題列（中英合併），欄序照 Data Team 給的。 */
const HEADER = [
  "訂單編號 Booking No", "訂單狀態 Order Status", "出發日期 Departure Date",
  "訂購日期GMT9 Booking Date JST", "商品編號 Product No", "商品名稱 Product Name",
  "套餐名稱 Package Name", "訂購人電話 Buyer Phone", "導覽語言 Tour Language", "備註 Note",
  "護照姓 Passport Surname", "護照名 Passport First Name", "性別 Gender",
  "生日 Birthday YYYYMMDD", "國籍 Nationality", "APP聯絡方式 Contact via Messenger",
];
const row = (o: Partial<Record<string, string>> = {}) => [
  o.no ?? "26KK218254560", o.status ?? "GO", o.go ?? "2026-08-14",
  "2026-08-03T20:15:47.554000", "30651", "京都嵐山半日遊", "【1人成團】嵐山半日遊",
  o.phone ?? "+886 0910759828", "zh-tw", o.note ?? "null",
  o.last ?? "CHEN", o.first ?? "PEIYI", "F", o.birthday ?? "19740329", "TW", o.app ?? "0001 / py329",
];

test("空值字串 null 要當成空的，不能印給導遊看", () => {
  const { travelers } = parseDapNamelist([HEADER, row()], "2026-08-14");
  assert.equal(travelers[0].note, "");
  assert.equal(parseDapNamelist([HEADER, row({ app: "null" })], "2026-08-14").travelers[0].messenger, "");
});

test("國碼後面多的 0 要去掉，否則導遊撥不通", () => {
  assert.equal(fixPhone("+886 0910759828"), "+886 910759828");
  assert.equal(fixPhone("+886 921911777"), "+886 921911777");   // 本來就對的不動
  assert.equal(fixPhone("+852 97905025"), "+852 97905025");
  assert.equal(fixPhone("null"), "");
});

test("生日 YYYYMMDD → YYYY-MM-DD（年齡與保險分桶都靠它）", () => {
  assert.equal(normalizeBirthday("19740329"), "1974-03-29");
  assert.equal(normalizeBirthday("1974-03-29"), "1974-03-29");
  const { travelers } = parseDapNamelist([HEADER, row({ birthday: "20150506" })], "2026-08-14");
  const { groups } = buildFromTravelers(travelers, "2026-08-14", { bookingDateIsJst: true });
  assert.equal(groups[0].rows[0].age, 11);
});

test("appType 代碼換成看得懂的名字", () => {
  assert.equal(normalizeMessenger("0001 / py329"), "Line/py329");
  assert.equal(normalizeMessenger("0002 / 95575412"), "WhatsApp/95575412");
  assert.equal(normalizeMessenger("0009 / abc"), "0009/abc");   // 沒見過的代碼原樣保留，不亂猜
  assert.equal(normalizeMessenger("0001 / "), "");
});

test("英文姓名統一大寫（來源三種寫法都有）", () => {
  const { travelers } = parseDapNamelist([HEADER, row({ last: "wong", first: "Megan ngai haam" })], "2026-08-14");
  assert.equal(travelers[0].enLastName, "WONG");
  assert.equal(travelers[0].enFirstName, "MEGAN NGAI HAAM");
});

test("訂購日已是 JST，不可以再減一小時", () => {
  const { travelers } = parseDapNamelist([HEADER, row()], "2026-08-14");
  const { groups } = buildFromTravelers(travelers, "2026-08-14", { bookingDateIsJst: true });
  assert.equal(groups[0].rows[0].bookingDate, "2026-08-03 20:15");
});

test("取消訂單（CX）排除，成立單（GO）保留", () => {
  const r = parseDapNamelist([HEADER, row(), row({ no: "26KK9", status: "CX" })], "2026-08-14");
  assert.equal(r.travelers.length, 1);
  assert.equal(r.skippedCancelled, 1);
});

test("來源放整個月是正常的 —— 只挑目標日那幾筆，不再中止", () => {
  // Ina 2026-08-18 把 DAP 改成未來一個月，好讓我們拿後面的團來測多台車／司兼導那些路徑
  const { travelers } = parseDapNamelist(
    [HEADER, row(), row({ no: "26KK9", go: "2026-08-20" })], "2026-08-14");
  assert.equal(travelers.length, 1);
  assert.equal(travelers[0].departureDate, "2026-08-14");
});

test("這天沒有團不是錯誤 —— 表裡有別天的資料就代表來源是好的", () => {
  const { travelers } = parseDapNamelist([HEADER, row({ go: "2026-08-20" })], "2026-08-14");
  assert.equal(travelers.length, 0);
});

test("fail-closed：空表 / 只有標題都要中止，不能當成今天沒有團", () => {
  // 一列都沒有＝表壞了或權限沒了，那跟「這天沒團」是兩回事
  assert.throws(() => parseDapNamelist([], "2026-08-14"), /空的/);
  assert.throws(() => parseDapNamelist([HEADER], "2026-08-14"), /沒有任何資料列/);
});

test("缺必要欄位就中止，並把看到的標題列印出來", () => {
  assert.throws(() => parseDapNamelist([["訂單編號 Booking No"], ["26KK1"]], "2026-08-14"), /缺少必要欄位/);
});

test("同一訂單多位旅客會被算成同一團的人數", () => {
  const rows = [HEADER, row({ first: "A" }), row({ first: "B" }), row({ first: "C" })];
  const { travelers } = parseDapNamelist(rows, "2026-08-14");
  const { groups } = buildFromTravelers(travelers, "2026-08-14", { bookingDateIsJst: true });
  assert.equal(groups[0].total, 3);
  assert.equal(groups[0].productNo, "30651");
});

test("Sheet 會把日期渲染成美式 8/14/2026 —— 要認得，否則整批被判日期不符", () => {
  const { travelers } = parseDapNamelist([HEADER, row({ go: "8/14/2026" })], "2026-08-14");
  assert.equal(travelers[0].departureDate, "2026-08-14");
});

test("訂購日也是美式格式 → 轉成 YYYY-MM-DD HH:MM 且不再減一小時", () => {
  const { travelers } = parseDapNamelist([HEADER, row({ go: "8/14/2026" })], "2026-08-14");
  const { groups } = buildFromTravelers(travelers, "2026-08-14", { bookingDateIsJst: true });
  assert.equal(groups[0].rows[0].bookingDate, "2026-08-03 20:15");
});

const HEADER2 = [...HEADER.slice(0, 4), "供應商OID Supplier Oid", ...HEADER.slice(4)];
const row2 = (supplier: string, o: Record<string, string> = {}) => {
  const r = row(o);
  return [...r.slice(0, 4), supplier, ...r.slice(4)];
};

test("多日遊（27883）不寄名單，但要回報被排除了什麼", () => {
  const r = parseDapNamelist([HEADER2, row2("1894"), row2("27883", { no: "26KK9" })], "2026-08-14");
  assert.equal(r.travelers.length, 1);
  assert.deepEqual(r.skippedMultiDay, [{ productNo: "30651", travelers: 1 }]);
  assert.deepEqual(r.suppliers, [1894, 27883]);
});

test("整批都是多日遊 → 是正常的「今天不用寄」，不可當成資料異常", () => {
  const r = parseDapNamelist([HEADER2, row2("27883")], "2026-08-14");
  assert.equal(r.travelers.length, 0);
  assert.equal(r.skippedMultiDay[0].travelers, 1);
});

test("沒有供應商欄時要講出來，不能默默當成全部都要寄", () => {
  const r = parseDapNamelist([HEADER, row()], "2026-08-14");
  assert.ok(r.missingColumns.includes("供應商OID"));
});

test("只收 GO：FAIL 不能進名單（Ina 2026-08-15）", () => {
  // 原本只排除 CX，於是 FAIL 整批被放進名單——2026-08-15 當天就有 8 筆。
  const head = ["訂單編號 Booking No", "訂單狀態 Order Status", "出發日期 Departure Date",
    "商品編號 Product No", "護照姓 Passport Surname", "護照名 Passport First Name",
    "生日 Birthday YYYYMMDD", "性別 Gender", "國籍 Nationality", "訂購人電話 Buyer Phone"];
  const row = (no: string, st: string) =>
    [no, st, "8/15/2026", "30651", "WANG", "TEST", "19900101", "M", "TW", "0900000000"];
  const r = parseDapNamelist(
    [head, row("A", "GO"), row("B", "FAIL"), row("C", "CX"), row("D", "go")],
    "2026-08-15",
  );
  assert.equal(r.travelers.length, 2);                       // GO 與小寫 go
  assert.equal(r.skippedCancelled, 2);
  assert.deepEqual(r.skippedByStatus.map((x) => x.status).sort(), ["CX", "FAIL"]);
});
