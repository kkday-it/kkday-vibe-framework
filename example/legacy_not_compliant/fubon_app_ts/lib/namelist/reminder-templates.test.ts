import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePacks, buildReminder, pickLocale } from "./reminder-templates.ts";

/** 照實際那張表的形狀：第 0 列是欄號，第 1 列才是標題，「姓名」出現兩次。 */
const NUMS = Array.from({ length: 25 }, (_, i) => String(i + 1));
const HEAD = [
  "語系", "司導前段", "司導後段", "姓名", "tel", "line", "WhatsApp", "WeChat", "",
  "飯店資訊前段", "飯店資訊後段", "日文名稱", "中文名稱", "英文名稱", "日文地址", "英文地址",
  "第一晚", "第二晚", "", "名古屋整修罐頭", "", "司兼隨前段", "司兼隨後段", "姓名", "車號",
];
const tw = [
  "繁體中文(台灣)", "您好，感謝您的訂購\nーーー", "ーーー\n祝您旅程愉快", "導遊姓名：", "電話：",
  "Line帳號：", "WhatsApp 帳號：", "WeChat 帳號：", "", "", "", "", "", "", "", "", "", "", "", "", "",
  "您好\n此團因未滿20位旅客\nーーー", "ーーー\n（此為系統自動通知。）", "姓名：", "車號：",
];
const en = [...tw]; en[0] = "English"; en[3] = "Guide's name: "; en[4] = "Telephone: "; en[23] = "Name: "; en[24] = "License plate: ";
const ROWS = [NUMS, HEAD, tw, en];


test("解析出各語系，標籤取自表上而非程式", () => {
  const p = parsePacks(ROWS);
  assert.equal(p.size, 2);
  assert.equal(p.get("zh-tw")!.labels.guideName, "導遊姓名：");
  assert.equal(p.get("en")!.labels.plate, "License plate: ");
});

test("「姓名」在表上出現兩次 → 司導區與司兼隨區各自取對的那一個", () => {
  const p = parsePacks(ROWS).get("zh-tw")!;
  assert.equal(p.labels.guideName, "導遊姓名：");   // 司導區
  assert.equal(p.labels.name, "姓名：");            // 司兼隨區
});

test("罐頭只有前後段，不含姓名電話車號（那些由 SCM 欄位顯示）", () => {
  const p = parsePacks(ROWS).get("zh-tw")!;
  const g = buildReminder(p, "純司機");
  assert.match(g, /您好/);
  assert.match(g, /祝您旅程愉快/);
  assert.doesNotMatch(g, /導遊姓名|電話：|Line帳號|車號/);
});

test("司兼導用司兼隨那組前後段（含未滿 20 位那句）", () => {
  const p = parsePacks(ROWS).get("zh-tw")!;
  const d = buildReminder(p, "司兼導");
  assert.match(d, /未滿20位/);
  assert.doesNotMatch(buildReminder(p, "純司機"), /未滿20位/);
});

test("「以下為…聯絡方式及注意事項」這種引言要拿掉（後面已經沒有聯絡資訊了）", () => {
  const p = parsePacks(ROWS).get("zh-tw")!;
  p.guideLead = "您好，感謝您的訂購\n以下為導遊聯絡方式及注意事項，請您留意\nーーー";
  const t = buildReminder(p, "純司機");
  assert.match(t, /感謝您的訂購/);
  assert.doesNotMatch(t, /聯絡方式/);
});

test("各語系的引言都認得（英文、韓文、簡中）", () => {
  const p = parsePacks(ROWS).get("zh-tw")!;
  for (const line of [
    "Please find the contact details and important reminders below:",
    "다가오는 여행의 가이드 연락처 및 중요 안내 사항을 전달해 드립니다.",
    "以下为导游联系方式及注意事项，请您留意",
  ]) {
    p.guideLead = `Hello\n${line}\nーーー`;
    assert.doesNotMatch(buildReminder(p, "純司機"), /聯絡方式|联系方式|contact details|연락처/i);
  }
});

test("前後段接起來時，連續兩條分隔線併成一條", () => {
  const p = parsePacks(ROWS).get("zh-tw")!;
  p.guideLead = "您好\nーーーーーーーーー";
  p.guideTail = "ーーーーーーーーー\n重要提醒：";
  const t = buildReminder(p, "純司機");
  assert.doesNotMatch(t, /ーーーーーーーーー\nーーーーーーーーー/);
  assert.match(t, /您好\nーーーーーーーーー\n重要提醒：/);
});
