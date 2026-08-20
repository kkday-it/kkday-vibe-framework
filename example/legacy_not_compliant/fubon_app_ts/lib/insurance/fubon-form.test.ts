// 執行：node --test lib/insurance/fubon-form.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyNamelist, type NamelistRecord } from "./classify.ts";
import { buildFormPlan, toRocDate, FUBON_FIXED } from "./fubon-form.ts";

test("toRocDate：西元→民國(−1911)", () => {
  assert.equal(toRocDate("2026-07-28"), "115/07/28");
  assert.equal(toRocDate("2026-08-03"), "115/08/03");
});

const SAMPLE: NamelistRecord[] = [
  { birthday: "1982-09-30", departureDate: "2026-07-28", prodTourDay: "0 Day 4 Hour", enLastName: "LI", enFirstName: "JIHYU", twIdNo: "H122675803", nationCode: "TW" },
  { birthday: "1984-09-23", departureDate: "2026-07-28", prodTourDay: "0 Day 4 Hour", enLastName: "HO", enFirstName: "CHUN JU", twIdNo: "Q123588118", nationCode: "TW" },
];

test("buildFormPlan：固定值 + 每桶值正確", () => {
  const bucket = classifyNamelist(SAMPLE).find((b) => b.coverageWan === 500)!;
  const p = buildFormPlan(bucket);
  assert.equal(p.團號, "0728 - 1D 500");
  assert.equal(p.領隊導遊, ""); // 留空
  assert.deepEqual([...p.旅遊地區], ["東北亞", "日本", "日本"]);
  assert.deepEqual([...p.交通工具], ["遊覽車"]);
  assert.equal(p.死亡失能萬, 500);
  assert.equal(p.醫療費用萬, 20); // 一律 20
  assert.equal(p.出發日民國, "115/07/28");
  assert.equal(p.旅遊天數, 1);
  assert.equal(p.旅遊團員人數, 2);
  assert.ok(p.旅遊團員 && p.旅遊團員 !== "-"); // 真人姓名
  assert.equal(p.名冊上傳方式, "c");
  assert.equal(p.名冊檔名, "0728 JP 1day 500.pdf"); // 官方檔名格式
});

test("FUBON_FIXED：醫療 20、名冊 c", () => {
  assert.equal(FUBON_FIXED.醫療費用萬, 20);
  assert.equal(FUBON_FIXED.名冊上傳方式, "c");
});
