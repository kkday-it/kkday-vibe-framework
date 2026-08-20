import { test } from "node:test";
import assert from "node:assert/strict";
import { sourceLinks, preflightLink } from "./links.ts";

test("沒設 ID 就不放那一條 —— 點不開的連結比沒有連結更糟", () => {
  assert.deepEqual(sourceLinks({} as any), []);
  const only = sourceLinks({ JP_AUDIT_SHEET_ID: "A" } as any);
  assert.deepEqual(only.map((x) => x.label), ["執行紀錄"]);
});

test("兩個都有就兩條", () => {
  const l = sourceLinks({ JP_AUDIT_SHEET_ID: "A", PORTAL_SHEET_ID: "B" } as any);
  assert.deepEqual(l.map((x) => x.label), ["執行紀錄", "車公司回報"]);
  assert.match(l[0].url, /spreadsheets\/d\/A$/);
});

test("出團前檢查連到那個分頁，不是整份試算表 —— AM 工作台有兩頁", async () => {
  const sheets = { spreadsheets: { get: async () => ({ data: { sheets: [
    { properties: { title: "重寄申請", sheetId: 1 } },
    { properties: { title: "出團前檢查", sheetId: 42 } },
  ] } }) } };
  const [l] = await preflightLink(sheets as any, { AM_SHEET_ID: "X" } as any);
  assert.match(l.url, /#gid=42$/);
});

test("問不到 gid 就退回整份的網址，不要因此少一條連結", async () => {
  const sheets = { spreadsheets: { get: async () => { throw new Error("403"); } } };
  const [l] = await preflightLink(sheets as any, { AM_SHEET_ID: "X" } as any);
  assert.equal(l.url, "https://docs.google.com/spreadsheets/d/X");
});
