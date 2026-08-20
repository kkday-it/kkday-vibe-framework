import { test } from "node:test";
import assert from "node:assert/strict";
import { planOf, plansOnCar, isOddPlanLetter, PLAN_SPLIT_PRODUCTS } from "./plan-split.ts";

test("從套餐名稱認出方案：促銷字樣會變，「X方案」結構不變", () => {
  assert.equal(planOf("【1人成團｜保證出發】 A方案：富士山親子一日遊～富士野生動物園FUJI SAFARI PARK（不含「叢林巴士」搭乘費用）"), "A");
  assert.equal(planOf("B方案：富士山親子一日遊～富士野生動物園FUJI SAFARI PARK（含「叢林巴士」搭乘費用）"), "B");
  assert.equal(planOf("【1人成團｜保證出發｜暑假限定～日本水蜜桃吃到飽＋箱根釜飯御膳午餐！】 C方案：富士山親子一日遊"), "C");
  assert.equal(planOf("【秋冬限定～長腳蟹盛宴全餐＋鮮採柑橘吃到飽！】 D方案：富士山親子一日遊"), "D");
});

test("認不出方案就回空字串——寧可整團不分，也不要猜錯把人放到別條行程", () => {
  assert.equal(planOf("富士山親子一日遊"), "");
  assert.equal(planOf(""), "");
});

test("團號字母 → 收哪些方案（528834 不標字母、573405 寫 A 團，同一件事）", () => {
  assert.deepEqual(plansOnCar("C"), ["C", "D"]);
  assert.deepEqual(plansOnCar(""), ["A", "B"]);
  assert.deepEqual(plansOnCar("A"), ["A", "B"]);
  assert.deepEqual(plansOnCar("c"), ["C", "D"]);
  assert.equal(plansOnCar("B"), null);      // 沒見過的寫法＝不知道，要停下來問
});

test("兩支商品都納入方案分車", () => {
  assert.ok(PLAN_SPLIT_PRODUCTS.has("528834"));
  assert.ok(PLAN_SPLIT_PRODUCTS.has("573405"));
});

test("車別碼寫 D 也收，但要標記成不合慣例（大表實際出現過 528834D）", () => {
  assert.deepEqual(plansOnCar("D"), ["C", "D"]);
  assert.equal(isOddPlanLetter("D"), true);
  assert.equal(isOddPlanLetter("C"), false, "C 是慣例寫法，不該被標記");
  assert.equal(isOddPlanLetter(""), false);
});
