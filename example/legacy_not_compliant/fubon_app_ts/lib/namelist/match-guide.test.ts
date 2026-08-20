import { test } from "node:test";
import assert from "node:assert/strict";
import { matchGuidesToCars, normName } from "./match-guide.ts";

const cars = [
  { tourCode: "KK260802-284399A", carLetter: "A", guideText: "林科豐 (Nick.yo.lin) 070-4034-4412 競技場スタンド：C區" },
  { tourCode: "KK260802-284399B", carLetter: "B", guideText: "北之旅的票葉家鳳 090-1667-6566" },
];
const g = (name: string, carLetter = "") => ({ name, phone: "0900", oid: "284399", carLetter });

test("姓名黏在別的字裡也對得到", () => {
  const { matched } = matchGuidesToCars([g("葉家鳳")], cars);
  assert.equal(matched[0].carLetter, "B");
  assert.equal(matched[0].via, "大表姓名比對");
});

test("班表自己寫車別碼就優先用", () => {
  const { matched } = matchGuidesToCars([g("誰都不是", "A")], cars);
  assert.equal(matched[0].carLetter, "A");
  assert.equal(matched[0].via, "班表車別碼");
});

test("全形空白／括號註記不影響", () => {
  assert.equal(normName("小山　文子（英文）"), "小山文子");
});

test("對不到就說原因，不亂配", () => {
  const { matched, unmatched } = matchGuidesToCars([g("王小明")], cars);
  assert.equal(matched.length, 0);
  assert.match(unmatched[0].reason, /都沒寫到/);
});

test("只有一台車就直接給", () => {
  const { matched } = matchGuidesToCars([g("誰")], [cars[0]]);
  assert.equal(matched[0].carLetter, "A");
});
