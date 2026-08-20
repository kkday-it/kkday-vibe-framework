// 執行：node --test lib/insurance/classify.test.ts   （Node 23+ 原生支援 TS）
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ageOn,
  coverageForAge,
  tourDaysFrom,
  classifyNamelist,
  type NamelistRecord,
} from "./classify.ts";

test("ageOn：生日還沒到今年就少一歲", () => {
  // 1982-09-30，基準日 2026-07-27（生日未到）→ 43
  assert.equal(ageOn("1982-09-30", "2026-07-27"), 43);
  // 生日當天就進位
  assert.equal(ageOn("2010-07-27", "2026-07-27"), 16);
  // 生日前一天
  assert.equal(ageOn("2010-07-28", "2026-07-27"), 15);
});

test("coverageForAge：<15 或 ≥70 → 250，其餘 → 500", () => {
  assert.equal(coverageForAge(4), 250);
  assert.equal(coverageForAge(13), 250);
  assert.equal(coverageForAge(14), 250);
  assert.equal(coverageForAge(15), 500); // 邊界：滿 15 → 成人
  assert.equal(coverageForAge(69), 500);
  assert.equal(coverageForAge(70), 250); // 邊界：滿 70 → 高齡
  assert.equal(coverageForAge(77), 250);
});

test("tourDaysFrom：0 Day 算 1 日、1 Day 算 2 日（跨夜）、2 Day 以上＝N", () => {
  assert.equal(tourDaysFrom("0 Day 10 Hour"), 1);
  assert.equal(tourDaysFrom("0 Day 4 Hour"), 1);
  assert.equal(tourDaysFrom("1 Day 0 Hour"), 2); // 579223 長岡花火，跨午夜才回程
  assert.equal(tourDaysFrom("3 Day 0 Hour"), 3); // 黑部立山三日遊真實資料
  assert.equal(tourDaysFrom("2 Day 5 Hour"), 2);
  assert.equal(tourDaysFrom(undefined), 1);
});

test("邊界：滿15/滿70生日剛好在出團日 → 保額切換", () => {
  // 15 歲生日當天出發：足歲=15 → 成人 500
  assert.equal(ageOn("2011-07-29", "2026-07-29"), 15);
  assert.equal(coverageForAge(ageOn("2011-07-29", "2026-07-29")), 500);
  // 差一天沒滿 15：14 → 250
  assert.equal(ageOn("2011-07-30", "2026-07-29"), 14);
  assert.equal(coverageForAge(ageOn("2011-07-30", "2026-07-29")), 250);
  // 70 歲生日當天出發：足歲=70 → 高齡 250
  assert.equal(ageOn("1956-07-29", "2026-07-29"), 70);
  assert.equal(coverageForAge(ageOn("1956-07-29", "2026-07-29")), 250);
  // 差一天沒滿 70：69 → 500
  assert.equal(coverageForAge(ageOn("1956-07-30", "2026-07-29")), 500);
});

test("閏年生日(2/29)足歲計算不崩潰", () => {
  assert.equal(ageOn("2008-02-29", "2026-02-28"), 17); // 生日還沒到
  assert.equal(ageOn("2008-02-29", "2026-03-01"), 18); // 生日已過
});

test("外籍護照旅客(非TW)也能分桶", () => {
  const recs: NamelistRecord[] = [
    { birthday: "2000-01-01", departureDate: "2026-07-29", prodTourDay: "0 Day 8 Hour",
      nationCode: "JP", passportNo: "TR1234567", enLastName: "SATO", enFirstName: "TARO" },
  ];
  const buckets = classifyNamelist(recs);
  assert.equal(buckets.length, 1);
  assert.equal(buckets[0].coverageWan, 500); // 26 歲 → 成人
  assert.equal(buckets[0].travelers.length, 1);
});

// 取自 2026-07-27 實際名單的樣本，驗證整條分類鏈。
const SAMPLE: NamelistRecord[] = [
  { birthday: "1982-09-30", departureDate: "2026-07-27", prodTourDay: "0 Day 4 Hour", localLastName: "李", localFirstName: "日佑" }, // 43 → 500 / 1day
  { birthday: "2022-06-19", departureDate: "2026-07-27", prodTourDay: "0 Day 4 Hour", localLastName: "何", localFirstName: "昕宸" }, // 4  → 250 / 1day
  { birthday: "1949-01-26", departureDate: "2026-07-27", prodTourDay: "0 Day 4 Hour", localLastName: "張", localFirstName: "泰銘" }, // 77 → 250 / 1day
  { birthday: "2009-03-23", departureDate: "2026-07-27", prodTourDay: "3 Day 0 Hour", localLastName: "林", localFirstName: "宸睿" }, // 17 → 500 / 3day
];

test("classifyNamelist：桶正確、排序穩定", () => {
  const buckets = classifyNamelist(SAMPLE);
  const summary = buckets.map((b) => [b.key, b.travelers.length]);
  // 1day-250 (何昕宸+張泰銘), 1day-500 (李日佑), 3day-500 (林宸睿)
  assert.deepEqual(summary, [
    ["2026-07-27|1day-250", 2],
    ["2026-07-27|1day-500", 1],
    ["2026-07-27|3day-500", 1],
  ]);
});
