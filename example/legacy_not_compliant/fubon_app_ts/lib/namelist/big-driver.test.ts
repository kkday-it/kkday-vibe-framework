import test from "node:test";
import assert from "node:assert/strict";
import { parseBigDriver, hasBigDriver } from "./big-driver.ts";

test("主流三行寫法（39100 積丹，Ina 2026-08-15 指的那格）", () => {
  const d = parseBigDriver("車番：あ863\n乗務員：汪彦滕\n連絡先：08095602157");
  assert.deepEqual(d, { plate: "あ863", name: "汪彦滕", phone: "08095602157" });
});

test("半形冒號與帶橫槓的電話", () => {
  const d = parseBigDriver("車番:1234\n乗務員:山田 太郎\n連絡先:080-9560-2157");
  assert.equal(d.name, "山田 太郎");
  assert.equal(d.phone, "08095602157");   // 橫槓一律去掉
});

test("全形空白當分隔符", () => {
  const d = parseBigDriver("車番　863\n乗務員　汪　彦滕\n連絡先　080-1234-5678");
  assert.equal(d.plate, "863");
  assert.equal(d.phone, "08012345678");
});

test("標籤變體：車両番号／ドライバー／TEL", () => {
  const d = parseBigDriver("車両番号：品川300あ12\nドライバー：佐藤\nTEL：09012345678");
  assert.deepEqual(d, { plate: "品川300あ12", name: "佐藤", phone: "09012345678" });
});

test("DR：姓名＋下一行裸電話（無標籤）", () => {
  const d = parseBigDriver("DR：田中\n090-1111-2222");
  assert.equal(d.name, "田中");
  assert.equal(d.phone, "09011112222");
});

test("只有司機沒有車號也算數——不要因為缺一項就整格丟掉", () => {
  const d = parseBigDriver("乗務員：鈴木");
  assert.deepEqual(d, { plate: "", name: "鈴木", phone: "" });
  assert.equal(hasBigDriver(d), true);
});

test("⚠️ 純姓名（沒有任何標籤）不猜——這一欄也放導遊名字與集合地點", () => {
  assert.equal(hasBigDriver(parseBigDriver("森山明明")), false);
  assert.equal(hasBigDriver(parseBigDriver("東京駅 八重洲口 集合")), false);
});

test("⚠️ 沒有標籤的裸數字不當電話——可能是受付番号／駐車番号", () => {
  assert.equal(hasBigDriver(parseBigDriver("09012345678")), false);
});

test("空白與 null 不會炸", () => {
  assert.equal(hasBigDriver(parseBigDriver("")), false);
  assert.equal(hasBigDriver(parseBigDriver(null as unknown as string)), false);
});

test("同一行擠兩個標籤時不把後面的吞進姓名", () => {
  const d = parseBigDriver("車番：863\n乗務員：汪彦滕 連絡先：08095602157");
  assert.equal(d.name, "汪彦滕");
});
