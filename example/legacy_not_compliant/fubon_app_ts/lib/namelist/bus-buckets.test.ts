import test from "node:test";
import assert from "node:assert/strict";
import { findBuckets } from "./bus-buckets.ts";

test("AM 把司機資訊填在導遊欄時，仍算司兼導（39100 積丹，Ina 2026-08-15）", () => {
  const rows = [
    ["", "團號", "出發日", "", "合計", "", "", "巴士公司 車型", "", "", "", "導遊手配書", "導遊", "司機"],
    ["催行決定", "KK260816-39100", "", "", "7", "", "", "Kitaya 25座 位空20", "", "", "", "",
      "車番：あ863\n乗務員：汪彦滕\n連絡先：08095602157", ""],
  ];
  const bk = findBuckets(rows, { tour: 1, bus: 7, total: 4, guide: 12, driver: 13 }, "2026-08-16", 0);
  assert.equal(bk.length, 1);
  // 導遊欄有字，但那是司機資訊 → 不能判成純司機，否則名單會寄錯人
  assert.equal(bk[0].serviceMode, "司兼導");
  assert.equal(bk[0].guideName, "");
  assert.deepEqual(bk[0].bigDriver, { plate: "あ863", name: "汪彦滕", phone: "08095602157" });
});

test("導遊欄真的是導遊姓名時照舊判成純司機", () => {
  const rows = [
    ["", "團號", "", "", "合計", "", "", "巴士公司 車型", "", "", "", "", "導遊", "司機"],
    ["催行決定", "KK260816-39100", "", "", "7", "", "", "Kitaya 25座", "", "", "", "", "林科豐 070-4034-4412", ""],
  ];
  const bk = findBuckets(rows, { tour: 1, bus: 7, total: 4, guide: 12, driver: 13 }, "2026-08-16", 0);
  assert.equal(bk[0].serviceMode, "純司機");
  assert.equal(bk[0].guideName, "林科豐");
  assert.equal(bk[0].bigDriver.name, "");
});

test("🔴 催行狀況在團號右邊也要讀得到（268173 九州包車那張）", () => {
  // 團號 A 欄、催行狀況 B 欄 —— 原本只往左找，狀態永遠空白，那團就被體檢排除掉了
  const rows = [
    ["團號", "催行狀況", "出發日期", "人數", "巴士公司 車型", "司機"],
    ["KK260824-268173", "催行決定", "2026/08/24", "6", "TB 10座", "已給手配書"],
  ];
  const cols = { tour: 0, bus: 4, total: 3, guide: -1, driver: 5 };
  const [b] = findBuckets(rows, cols as any, "2026-08-24", 0);
  assert.equal(b.status, "催行決定");
  assert.equal(b.go, true);
});
