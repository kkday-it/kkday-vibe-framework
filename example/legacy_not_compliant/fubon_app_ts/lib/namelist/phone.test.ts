import { test } from "node:test";
import assert from "node:assert/strict";
import { prettyPhone, driverLabel, vehicleLine } from "./phone.ts";

test("日本手機補成 080-9560-2157 好唸好抄（Ina 2026-08-15）", () => {
  assert.equal(prettyPhone("08095602157"), "080-9560-2157");
  assert.equal(prettyPhone("0312345678"), "031-234-5678");
});

test("長度不符就原樣回傳 —— 寧可不好唸，也不要切錯", () => {
  assert.equal(prettyPhone("81 90-1234-5678"), "81 90-1234-5678");
  assert.equal(prettyPhone(""), "");
  assert.equal(prettyPhone(undefined), "");
});

test("信本文那行：有電話就跟著姓名印，格式跟名單 PDF 一致（Winnie 2026-08-20）", () => {
  assert.equal(driverLabel({ name: "汪彦滕", phone: "08061090963" }), "汪彦滕（080-6109-0963）");
});

test("沒電話就只印姓名 —— 不留一個空括號", () => {
  assert.equal(driverLabel({ name: "汪彦滕" }), "汪彦滕");
  assert.equal(driverLabel({ name: "汪彦滕", phone: "  " }), "汪彦滕");
});

test("🔴 有電話但沒姓名 → 回空字串，不能印出「（080-…）」這種沒有人的括號", () => {
  // Portal 只填到一半是真的會發生的（核對表就在抓「沒填司機姓名」）
  assert.equal(driverLabel({ name: "", phone: "08061090963" }), "");
  assert.equal(driverLabel({ name: "  ", phone: "08061090963" }), "");
});

test("日文信那行用日文詞 —— 標籤日文、內容中文的混語言（Ina 2026-08-20 指出）", () => {
  const veh = { plate: "札幌200か1234", drivers: [{ name: "テスト太郎", phone: "08000000001" }] };
  assert.equal(vehicleLine("ja", veh), "車両番号 札幌200か1234｜運転手 テスト太郎（080-0000-0001）");
  assert.equal(vehicleLine("zh", veh), "車號 札幌200か1234｜司機 テスト太郎（080-0000-0001）");
});

test("日文那行不能出現中文詞", () => {
  const out = vehicleLine("ja", { plate: "あ863", drivers: [{ name: "汪彦滕" }] });
  assert.equal(/車號|司機/.test(out), false);
});

test("兩位司機都列出來；沒姓名的那筆不佔位", () => {
  const veh = { plate: "あ863", drivers: [{ name: "A", phone: "08000000001" }, { name: "", phone: "08000000002" }, { name: "B" }] };
  assert.equal(vehicleLine("zh", veh), "車號 あ863｜司機 A（080-0000-0001）、B");
});

test("一個司機都沒有就只寫車號 —— 不留一個空的「司機」標籤", () => {
  assert.equal(vehicleLine("zh", { plate: "あ863", drivers: [] }), "車號 あ863");
  assert.equal(vehicleLine("ja", { plate: "", drivers: [] }), "車両番号 －");
});
