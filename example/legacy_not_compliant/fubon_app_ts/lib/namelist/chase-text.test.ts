import { test } from "node:test";
import assert from "node:assert/strict";
import { chaseText, chaseActions, tourLine, type ChaseItem } from "./chase-text.ts";

const bus = (tourCode: string, guide = "導遊 森山明", tail = "彌榮觀光", mode = "司兼導"): ChaseItem =>
  ({ mode, kind: "車", tourCode, product: "京都一日遊", guide, tail, link: `https://form/${tail}` });

test("團號先、斷行、帶導遊名字（Ina 2026-08-18）", () => {
  const [a] = chaseActions([bus("KK260819-528834A")], 2);
  const [l1, l2] = a.text.split("\n");
  // 第一行就是「哪一團、誰帶」——AM 打給車公司時講的是「某某帶的那團」
  assert.equal(l1, "*KK260819-528834A*　京都一日遊　導遊 森山明");
  assert.equal(l2, "【司兼導】彌榮觀光還沒填司機姓名／電話／車號，17:00 要給客人");
  // 導遊還沒配的話那一格就不印，不要留一個空的欄位
  assert.equal(tourLine({ ...bus("A"), guide: "" }), "*A*　京都一日遊");
});

test("掛在車後面時不重印團號商品 —— 上一行剛印過", () => {
  const c = bus("KK260819-528834A");
  assert.equal(chaseText(c, 1, true), "【司兼導】彌榮觀光還沒填司機姓名／電話／車號");
  assert.equal(chaseText(c, 1).split("\n").length, 2);
});

test("同一間車公司併成一段，團號各自一行（訂單多時不會拉長）", () => {
  const acts = chaseActions([bus("A"), bus("B", "導遊 陳小美"), bus("C", "導遊 王大明", "京阪巴士")], 2);
  assert.equal(acts.length, 2);
  const lines = acts[0].text.split("\n");
  assert.equal(lines.length, 3);           // 兩團各一行 ＋ 一行動作
  assert.match(lines[0], /^\*A\*/);
  assert.match(lines[1], /^\*B\*.*陳小美$/);
  assert.equal(acts[0].link, "https://form/彌榮觀光");
  // 做法不同（司兼導 vs 純司機）就不能併
  assert.equal(chaseActions([bus("A"), bus("B", "導遊 甲", "彌榮觀光", "純司機")], 2).length, 2);
});

test("純司機過了 16:00 要自己轉給導遊；導遊未派是另一件事", () => {
  assert.match(chaseText(bus("A", "導遊 甲", "彌榮觀光", "純司機"), 2), /轉給導遊並填回大表/);
  assert.match(chaseText({ mode: "純司機", kind: "導遊", tourCode: "A", product: "x", guide: "", tail: "班表排的是 王小明" }, 1),
    /還沒派導遊/);
});
