import { test } from "node:test";
import assert from "node:assert/strict";
// ⚠️ 一定要 import 真的實作。原本這裡**複製了一份邏輯**，那樣測試永遠會過，
//    而正式程式可以自己走鐘——今天要抓的就是這種「同一條規則兩份」。
import { splitLabel } from "./label-split.ts";

test("商品名裡有「｜」時要用最後一個切 —— 用第一個會把前後對調（Ina 2026-08-20）", () => {
  const label = "155294 【含 1 人成團方案～早鳥限時特惠｜50%OFF】北海道富良野一日遊｜富田農場彩虹花田&美瑛四季彩之丘&白金青池｜札幌出發｜KK260821-155294";
  const { prod, tour } = splitLabel(label);
  assert.equal(tour, "KK260821-155294");
  assert.match(prod, /^155294 【含 1 人成團方案/);
  assert.match(prod, /札幌出發$/);
});

test("尾巴不像團號就整串當商品名 —— 寧可少一行也不要亂切", () => {
  assert.deepEqual(splitLabel("30651 京都嵐山｜保津川遊船"), { prod: "30651 京都嵐山｜保津川遊船", tour: "" });
});

test("沒有「｜」也要處理得掉", () => {
  assert.deepEqual(splitLabel("30651 嵐山"), { prod: "30651 嵐山", tour: "" });
});

test("無團號那種（label 尾巴是「無團號」）不會被誤認成團號", () => {
  const { tour } = splitLabel("155294 富良野一日遊｜無團號");
  assert.equal(tour, "");
});
