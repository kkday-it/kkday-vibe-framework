// 執行：node --test lib/insurance/mask.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { maskIds } from "./mask.ts";

test("遮台灣身分證號", () => {
  assert.equal(maskIds("投保失敗 A123456789 資料錯"), "投保失敗 A12****789 資料錯");
});

test("遮護照/長數字", () => {
  assert.equal(maskIds("護照 1234567 無效"), "護照 12****67 無效");
});

test("短數字(狀態碼/秒數)不遮", () => {
  assert.equal(maskIds("HTTP 404 逾時 300ms"), "HTTP 404 逾時 300ms");
});

test("非字串安全處理", () => {
  assert.equal(maskIds(undefined), "");
  assert.equal(maskIds(null), "");
});
