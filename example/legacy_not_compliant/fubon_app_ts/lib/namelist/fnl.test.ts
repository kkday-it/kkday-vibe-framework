import { test } from "node:test";
import assert from "node:assert/strict";
import {
  countPax, parseSchedule, rowForDate, rosterTabName, useTime, mmdd, tourPrefix,
  kyobashaMail, hozugawaMail, rosterValues, blockers, type FnlInput, type FnlPax,
} from "./fnl.ts";

/** 照 2026 催行予定一覧表 2026-08-16 的真實形狀（欄位順序、標題文字都照抄）。 */
const HDR = ["", "団体名", "催行日", "最大人数", "募集人数(TG含み)", "FNL", "ガイド資料",
  "トロッコ列車", "", "", "", "京馬車乗車時間", "保津川下り"];
const ROWS = [
  ["", "8月"],
  HDR,
  ["", "KK260816-30651", "2026/8/16( 日)", "24名", "23", "TRUE", "森山明明 080-6109-0963",
    "嵯峨野３号", "嵯峨", "～", "亀岡", "10:35", "11:00-11:30乗船"],
  ["", "KK260817-30651", "2026/8/17( 月)", "24名", "16", "FALSE", "森山明明 080-6109-0963",
    "嵯峨野３号", "嵯峨", "～", "亀岡", "10:35", "11:00-11:30乗船"],
];

const PAX: FnlPax[] = [
  { name: "TZU-YUN WANG", gender: "女", age: 15, nationality: "TW" },
  { name: "DING-YUAN WANG", gender: "男", age: 10, nationality: "TW" },
  { name: "YU-QIAO LIU", gender: "女", age: 11, nationality: "TW" },
];

function input(over: Partial<FnlInput> = {}): FnlInput {
  const rows = parseSchedule(ROWS);
  const row = rowForDate(rows, "2026-08-17")!;
  const pax = over.pax ?? PAX;
  return {
    date: "2026-08-17", row, pax, counts: countPax(pax),
    rosterUrl: "https://docs.google.com/spreadsheets/d/1VcX/edit?gid=1043034797#gid=1043034797",
    ...over,
  };
}

test("13 歲以上算大人、12 歲以下算子供", () => {
  assert.deepEqual(countPax(PAX), { adult: 1, child: 2, infant: 0, total: 3 });
});

test("剛好 13 歲算大人（分界含在大人這邊）", () => {
  const c = countPax([{ name: "A", gender: "男", age: 13, nationality: "TW" },
                      { name: "B", gender: "女", age: 12, nationality: "TW" }]);
  assert.deepEqual([c.adult, c.child], [1, 1]);
});

test("幼児恆為 0 —— 兩歲以下不佔位也不能下訂，不會出現在名單上", () => {
  assert.equal(countPax(PAX).infant, 0);
});

test("解析一覧表：跳過月份分隔列，只認 KK 開頭的團號", () => {
  const rows = parseSchedule(ROWS);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].tourCode, "KK260816-30651");
});

test("F 欄 TRUE 代表已經寄過", () => {
  const rows = parseSchedule(ROWS);
  assert.equal(rows[0].sent, true);    // 8/16 已寄
  assert.equal(rows[1].sent, false);   // 8/17 還沒
});

test("找不到「団体名」標題就中止 —— 不可以安靜當成今天沒團", () => {
  assert.throws(() => parseSchedule([["日期", "人數"]]), /団体名/);
});

test("欄位改名（少了 FNL 欄）也要中止", () => {
  const broken = ROWS.map((r) => (r === HDR ? r.map((c) => (c === "FNL" ? "済み" : c)) : r));
  assert.throws(() => parseSchedule(broken), /FNL/);
});

test("依出發日找到那一列", () => {
  const rows = parseSchedule(ROWS);
  assert.equal(rowForDate(rows, "2026-08-17")!.tourCode, "KK260817-30651");
  assert.equal(rowForDate(rows, "2026-08-20"), undefined);
});

test("日期轉換", () => {
  assert.equal(tourPrefix("2026-08-17"), "KK260817");
  assert.equal(rosterTabName("2026-08-17"), "0817");
  assert.equal(mmdd("2026-08-17"), "08/17");
});

test("利用時間去掉「乗船」、連字號改成波浪（跟人手寫的一致）", () => {
  assert.equal(useTime("11:00-11:30乗船"), "11:00~11:30");
  assert.equal(useTime("11:30乘船"), "11:30");
  assert.equal(useTime("10:35"), "10:35");
});

test("京馬車信：用 L 欄時間，且**不附名簿連結**", () => {
  const m = kyobashaMail(input());
  assert.equal(m.to, "info@kyobasha.jp");
  assert.equal(m.subject, "【KKDAY JAPAN】KK260817-30651 京馬車FNL");
  assert.match(m.body, /利用日：08\/17 10:35/);
  assert.ok(!/docs\.google\.com/.test(m.body), "京馬車不該收到名簿連結");
});

test("保津川信：用 M 欄時間，且附名簿連結", () => {
  const m = hozugawaMail(input());
  assert.equal(m.to, "hozugawaboat@gmail.com");
  assert.match(m.body, /利用日：08\/17 11:00~11:30/);
  assert.match(m.body, /参加者名簿/);
  assert.match(m.body, /gid=1043034797/);
});

test("人數那一行照現有信件格式", () => {
  assert.match(kyobashaMail(input()).body,
    /FNL人数：3\+1TG（大人：1名 子供：2名 幼児：0名 添乗：1名）/);
});

test("兩封都 CC jptour-operation", () => {
  assert.equal(kyobashaMail(input()).cc, "jptour-operation@kkday.com");
  assert.equal(hozugawaMail(input()).cc, "jptour-operation@kkday.com");
});

test("名簿內容：抬頭、欄名、旅客、TG 三行", () => {
  const v = rosterValues(input(), "京都嵐山半日遊｜嵐山小火車＆保津川遊船＆京馬車");
  assert.equal(v[1].join(","), "氏名,性別,年齢,国籍");
  // 年齢是**數字**不是字串：現有那頁存數字，送字串會靠左對齊，一眼看出是機器貼的
  assert.deepEqual(v[2], ["TZU-YUN WANG", "女", 15, "TW"]);
  assert.equal(typeof v[2][2], "number");
  assert.deepEqual(v.slice(-3), [["TG："], ["森山明明 080-6109-0963"], ["人数：3+1TG"]]);
});

test("人數跟一覧表 E 欄對不上就擋下來", () => {
  // E 欄寫 16，名單只有 3 人（+1TG = 4）
  assert.match(blockers(input()).join(" "), /人數對不上/);
});

test("人數對得上就放行", () => {
  const pax = Array.from({ length: 15 }, (_, i) =>
    ({ name: `PAX ${i}`, gender: "男", age: 30, nationality: "TW" }));
  assert.deepEqual(blockers(input({ pax, counts: countPax(pax) })), []);
});

test("缺添乗員／缺時間／沒有旅客都會擋", () => {
  const base = input();
  assert.match(blockers({ ...base, pax: [], counts: countPax([]) }).join(" "), /一個人都沒有/);
  assert.match(blockers({ ...base, row: { ...base.row, guide: "" } }).join(" "), /沒有添乗員/);
  assert.match(blockers({ ...base, row: { ...base.row, kyobashaTime: "" } }).join(" "), /京馬車乗車時間/);
  assert.match(blockers({ ...base, row: { ...base.row, hozugawaTime: "" } }).join(" "), /保津川/);
});

test("有人算不出年齡或沒有英文名要擋 —— 對外名簿不能有空格", () => {
  const bad: FnlPax[] = [{ name: "", gender: "男", age: 30, nationality: "TW" },
                         { name: "X", gender: "女", age: NaN, nationality: "TW" }];
  const j = blockers(input({ pax: bad, counts: countPax(bad) })).join(" ");
  assert.match(j, /護照英文名/);
  assert.match(j, /算不出年齡/);
});
