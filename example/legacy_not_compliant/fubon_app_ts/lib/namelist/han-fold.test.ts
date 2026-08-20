import test from "node:test";
import assert from "node:assert/strict";
import { foldHan } from "./han-fold.ts";

test("繁簡折成同一個形狀", () => {
  assert.equal(foldHan("富田農場一日遊"), foldHan("富田农场一日游"));
  assert.equal(foldHan("1人成團"), foldHan("1人成团"));
});

test("表裡有 BMP 以外的字 → 對照不能錯位（2026-08-19 踩過）", () => {
  // 錯位的話後面的字會被折成毫不相干的字（當時「农场」變成「迴塊」）
  assert.equal(foldHan("農場"), "农场");
  assert.equal(foldHan("鐵道"), "铁道");
  assert.equal(foldHan("溫泉"), "温泉");
  // 沒有對照的字原樣保留
  assert.equal(foldHan("FUJI SAFARI 2026"), "FUJI SAFARI 2026");
});
