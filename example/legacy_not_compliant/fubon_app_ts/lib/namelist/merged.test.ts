import { test } from "node:test";
import assert from "node:assert/strict";
import { fillMerged } from "./bigsheet.ts";

test("垂直合併：值只在第一列，要攤平到整段", () => {
  const rows = [["a", "司機資訊"], ["b", ""], ["c", ""]];
  const out = fillMerged(rows, [{ startRowIndex: 0, endRowIndex: 3, startColumnIndex: 1, endColumnIndex: 2 }]);
  assert.deepEqual(out.map((r) => r[1]), ["司機資訊", "司機資訊", "司機資訊"]);
});

test("已經有值的格子不覆蓋 —— 攤平只補空白", () => {
  const rows = [["", "X"], ["", "Y"]];
  const out = fillMerged(rows, [{ startRowIndex: 0, endRowIndex: 2, startColumnIndex: 1, endColumnIndex: 2 }]);
  assert.deepEqual(out.map((r) => r[1]), ["X", "Y"]);
});

test("合併格本身是空的就什麼都不做", () => {
  const rows = [["a", ""], ["b", ""]];
  const out = fillMerged(rows, [{ startRowIndex: 0, endRowIndex: 2, startColumnIndex: 1, endColumnIndex: 2 }]);
  assert.deepEqual(out.map((r) => r[1]), ["", ""]);
});

test("不改動原本的陣列", () => {
  const rows = [["a", "V"], ["b", ""]];
  fillMerged(rows, [{ startRowIndex: 0, endRowIndex: 2, startColumnIndex: 1, endColumnIndex: 2 }]);
  assert.equal(rows[1][1], "");
});

test("團號欄要排除 —— 攤平它會把一個團認成好幾台車", () => {
  const rows = [["KK-1", "資訊"], ["", ""], ["", ""]];
  const out = fillMerged(rows, [
    { startRowIndex: 0, endRowIndex: 3, startColumnIndex: 0, endColumnIndex: 1 },
    { startRowIndex: 0, endRowIndex: 3, startColumnIndex: 1, endColumnIndex: 2 },
  ], [0]);
  assert.deepEqual(out.map((r) => r[0]), ["KK-1", "", ""]);
  assert.deepEqual(out.map((r) => r[1]), ["資訊", "資訊", "資訊"]);
});
