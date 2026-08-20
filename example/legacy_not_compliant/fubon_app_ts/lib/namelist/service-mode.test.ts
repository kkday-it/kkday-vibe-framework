import { test } from "node:test";
import assert from "node:assert/strict";
import { modeLabel } from "./service-mode.ts";

test("不用車的行程不講服務型態 —— 30651 走鐵道＋遊船，寫「純司機」是叫人去確認不存在的司機", () => {
  assert.equal(modeLabel(false, "純司機"), "");
  assert.equal(modeLabel(false, "司兼導"), "");
});

test("有車的照講", () => {
  assert.equal(modeLabel(true, "純司機"), "純司機");
  assert.equal(modeLabel(true, "司兼導"), "司兼導");
});
