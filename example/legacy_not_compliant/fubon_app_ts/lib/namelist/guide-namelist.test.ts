import { test } from "node:test";
import assert from "node:assert/strict";
import { meaningfulSpecs, shortCharterPlan, isCharter, charterMismatch } from "./guide-namelist.ts";

test("規格：票種不留、客人真正選的留下（Ina 2026-08-18）", () => {
  // 多數商品的規格1 只是票種 → 名單上有年齡了，印了只是噪音
  assert.deepEqual(meaningfulSpecs(["成人"]), []);
  assert.deepEqual(meaningfulSpecs(["成人、兒童"]), []);
  assert.deepEqual(meaningfulSpecs(["兒童、成人", "不拘"]), []);
  // 包車商品的路線在規格裡，方案名稱只寫得出成團人數 → 一定要留
  assert.deepEqual(meaningfulSpecs(["富士山一日遊～冰穴風穴＋新倉山淺間公園", "成人"]),
    ["富士山一日遊～冰穴風穴＋新倉山淺間公園"]);
  assert.deepEqual(meaningfulSpecs(["阿蘇中岳火山〜草千里〜熊本城〜水前寺成趣園", "成人、兒童"]),
    ["阿蘇中岳火山〜草千里〜熊本城〜水前寺成趣園"]);
  // 🔴 認不得的一律留著：漏印是導遊到現場才發現，多印只是佔位子
  assert.deepEqual(meaningfulSpecs(["165cm", "雙人房"]), ["165cm", "雙人房"]);
  assert.deepEqual(meaningfulSpecs(undefined), []);
  assert.deepEqual(meaningfulSpecs(["", "  "]), []);
});

test("包車的方案只留成團人數那段 —— 後面那串跟商品名一樣，會擠掉真正的路線", () => {
  assert.equal(
    shortCharterPlan("【6人成行｜專屬包車】日本九州一日遊｜阿蘇中岳火山 & 熊本城 & 宇佐神宮任選案"),
    "6人成行｜專屬包車");
  // 沒有【】就原樣留著，不要自作聰明砍字
  assert.equal(shortCharterPlan("一般方案"), "一般方案");
  assert.equal(isCharter("196022"), true);
  assert.equal(isCharter("185513"), false);
});

test("包車判斷：清單與方案名互相補位，不一致要喊（Ina 2026-08-18）", () => {
  // ① 在清單裡 → 是
  assert.equal(isCharter("196022"), true);
  // ② 不在清單，但方案名寫了包車 → 也是（新開的包車商品沒有人會來通知）
  assert.equal(isCharter("999999", "【6人成行｜專屬包車】某某一日遊"), true);
  assert.equal(isCharter("185513", "【含 1 人成團方案】福岡一日遊"), false);

  // 兩邊說法一致就不吵
  assert.equal(charterMismatch("265887", ["【6人成行｜專屬包車】x"]), "");
  assert.equal(charterMismatch("185513", ["【含 1 人成團方案】x"]), "");
  // 新的包車商品 → 提醒加進清單，否則名單會少印當天路線
  assert.match(charterMismatch("999999", ["【4人成行｜專屬包車】x"]), /不在包車清單裡/);
  // 清單裡的商品方案名卻不寫包車 → 可能改了型態
  assert.match(charterMismatch("196022", ["一般方案"]), /方案名沒有「包車」/);
});
