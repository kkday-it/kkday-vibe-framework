import { test } from "node:test";
import assert from "node:assert/strict";
import { brief, detail, blocksOf } from "./slack-format.ts";

const row = (code: string, status: string, alert = false) => ({
  code, product: "福岡一日遊", pax: 20, crew: "導遊 劉洋", status, alert,
});
const lines = (s: string) => s.split("\n");

test("摘要那行就回答「有沒有我要做的事」", () => {
  const busy = brief({
    kind: "名單", date: "2026-08-19", headline: "12:00 名單已產出",
    rows: [row("A", "司機・車號 待補", true)], tours: 1,
    actions: [{ text: "催 Travelbox 補司機與車號", link: "https://p" }],
  });
  assert.match(busy, /🔴 1 件待處理/);

  const calm = brief({ kind: "名單", date: "2026-08-19", headline: "12:00 名單已產出", rows: [row("A", "齊備")], tours: 1 });
  assert.match(calm, /✅ 全部齊備，不需動作/);
});

test("標題有類型圖示 —— 滑過去要分得出哪則是哪則（Ina 2026-08-18）", () => {
  assert.match(lines(brief({ kind: "名單", date: "d", headline: "h" }))[0], /^📋 \*d 出團｜h\*$/);
  assert.match(lines(brief({ kind: "SCM", date: "d", headline: "h" }))[0], /^📲 /);
  assert.match(lines(brief({ kind: "警報", date: "d", headline: "h" }))[0], /^🚨 /);
  // kind 是選填，沒給就沒有圖示
  assert.match(lines(brief({ date: "d", headline: "h" }))[0], /^\*d 出團｜h\*$/);
});

test("每台車行首一個紅綠 —— 要動手的那台一眼看得到", () => {
  const d = detail([
    { code: "A", product: "福岡一日遊", pax: 20, crew: "導遊 劉洋", status: "司機・車號 待補", alert: true },
    { code: "B", product: "京都嵐山", pax: 23, crew: "導遊 森山明明", status: "不需用車" },
  ]);
  assert.match(d[0], /^🔴 \*A\*/);
  assert.match(d[3], /^✅ \*B\*/);   // d[2] 是車與車之間的空行
  // 狀態本身仍然是文字，不靠記憶圖示的意思
  assert.match(d[1], /司機・車號 待補$/);
  // 手機上不會歪：不用等寬表格，每一行都短
  assert.equal(d.some((l) => l.includes("```")), false);
  assert.ok(d.every((l) => l.length < 40), d.join("|"));
});

test("測試提示接在標題下面，@ 的人自己一行", () => {
  const l = lines(brief({ kind: "名單", date: "d", headline: "h", testing: true, who: "<@U1>" }));
  assert.match(l[0], /^📋 /);
  assert.match(l[1], /目前還在測試期間.*都還不會收到信/);
  // 🔴 要講的是「你今天照舊怎麼做」——只寫系統不寄信，看的人會以為 SCM 已經有了（Ina 2026-08-18）
  assert.match(l[1], /SCM 只寫\*測試台\*、\*不動正式台\*.*填回 KGRP/);
  assert.equal(l[2], "<@U1>");
});

test("沒事也要發，而且要明講沒事 —— 收不到訊息跟壞掉長得一樣", () => {
  const s = brief({ kind: "體檢", date: "2026-08-19", headline: "16:00 體檢完成" });
  assert.match(s, /✅ 全部齊備，不需動作/);
  assert.equal(s.includes("待處理"), false);
});

test("待處理一件一行 —— 拆兩行的話團一多就變兩倍長（Ina 2026-08-18）", () => {
  const s = brief({ kind: "催件", date: "d", headline: "h",
    actions: [
      { text: "催車公司填專用表單｜A", link: "https://p", linkText: "車公司專用表單" },
      { text: "催車公司填專用表單｜B", link: "https://q", linkText: "車公司專用表單" },
    ] });
  const l = lines(s);
  const todo = l.filter((x) => x.startsWith("⏰ ") && x !== l[0]);
  assert.equal(todo.length, 2);
  assert.equal(todo[0], "⏰ 催車公司填專用表單｜A　<https://p|車公司專用表單>");
});

test("連結一行一條，用途本身就是可點的字", () => {
  const s = brief({ kind: "名單", date: "d", headline: "h",
    links: [{ label: "名單存檔", url: "https://a" }, { label: "執行紀錄", url: "https://b" }] });
  // 用途本身就是連結，後面不再掛一個「開啟」
  assert.match(s, /^<https:\/\/a\|名單存檔>$/m);
  assert.match(s, /^<https:\/\/b\|執行紀錄>$/m);
  assert.equal(s.includes("|開啟>"), false);
});

test("who 是選填 —— 不是每一則都該吵人", () => {
  assert.equal(brief({ kind: "名單", date: "d", headline: "h" }).includes("<@"), false);
});

test("單位是團不是車 —— 同一團拆兩台，工作量跟兩團各一台差很多", () => {
  const rows = [row("A", "待補", true), row("B", "齊備")];
  assert.match(brief({ date: "d", headline: "h", rows, tours: 2 }), /2 團，/);
  assert.match(brief({ date: "d", headline: "h", rows, tours: 1 }), /1 團、2 台車，/);
});

test("寄出的信掛在那台車後面 —— 回答「到底寄了沒」，跟名單 PDF 是兩個問題", () => {
  const d = detail([{ code: "A", product: "x", pax: 1, crew: "導遊 甲", status: "齊備",
    mailUrl: "https://mail.google.com/mail/u/0/#all/1a0" }]);
  assert.match(d[1], /<https:\/\/mail\.google\.com\/mail\/u\/0\/#all\/1a0\|寄出的信>$/);
  // 沒寄就不掛（例如第 3 輪不寄信）
  assert.doesNotMatch(detail([{ code: "A", product: "x", pax: 1, crew: "導遊 甲", status: "齊備" }])[1], /寄出的信/);
});

test("Block Kit：齊備的車不佔正文，只有要動手的才展開（Ina 2026-08-18）", () => {
  const b = blocksOf({
    kind: "名單", date: "2026-08-19", headline: "12:00 名單已產出", tours: 3, who: "<@U1>",
    rows: [
      { code: "A", product: "福岡", pax: 20, crew: "導遊 甲", status: "司機 乙／708", mailUrl: "https://m/1" },
      { code: "B", product: "京都", pax: 18, crew: "導遊 丙", status: "待補", alert: true, mailUrl: "https://m/2",
        todo: { text: "催車公司", link: "https://f", linkText: "車公司專用表單" } },
    ],
  }) as any[];
  assert.equal(b[0].type, "header");
  // header 吃純文字、不能 tag 人，日期壓短
  assert.equal(b[0].text.text, "8/19 出團・12:00 名單已產出");
  assert.match(b[1].text.text, /^\*1 件要處理\*/);
  // 要動手的那台自成一段，按鈕直接開它自己的表單
  const sec = b.find((x) => x.type === "section" && String(x.text.text).includes("*B*"));
  // 🔴 連結要能右鍵複製轉給車公司 → 文字連結，不是按鈕（Ina 2026-08-18）
  assert.match(sec.text.text, /<https:\/\/f\|車公司專用表單>/);
  assert.equal(JSON.stringify(b).includes("accessory"), false);
  // 齊備的收合成一行小灰字，且連結還在
  const cs = b.filter((x) => x.type === "context").map((x) => x.elements[0].text);
  assert.ok(cs.some((t: string) => t.includes("其他 1 團齊備") && t.includes("<https://m/1|寄出的信>")), cs.join("|"));
  // 一個商品一行，不擠成一長串（Ina 2026-08-18）
  assert.match(cs.find((t: string) => t.includes("其他 1 團齊備"))!, /其他 1 團齊備\nA　福岡/);
  // 沒有要動手的車時不寫「其他」——沒有對照組（Ina 2026-08-18）
  const calm = blocksOf({ date: "2026-08-19", headline: "h", tours: 1,
    rows: [{ code: "A", product: "福岡", pax: 20, crew: "司導 甲", status: "齊備" }] }) as any[];
  assert.match(calm.find((x) => x.type === "context").elements[0].text, /^1 團齊備\n/);
  // 要催的那台也要看得到信寄了沒
  assert.match(sec.text.text, /<https:\/\/m\/2\|寄出的信>/);
  // 🔴 打勾不再逐台出現（Ina：「打勾出現的很突兀，要一字一句看完」）
  assert.equal(JSON.stringify(b).includes("✅"), false);
});

test("Block Kit：沒事的日子講清楚沒事，測試期提示在最上面（Ina 2026-08-18）", () => {
  const b = blocksOf({ kind: "體檢", date: "2026-08-19", headline: "16:00 體檢完成", testing: true }) as any[];
  // 🔴 測試期提示是「閱讀這則的前提」，放尾巴的話會先嚇到人才發現沒事發生
  assert.equal(b[0].type, "context");
  assert.match(b[0].elements[0].text, /測試期間.*填回 KGRP/);
  assert.equal(b[1].type, "header");
  assert.match(b[2].text.text, /全部齊備，不需動作/);
  // 沒有要動手的事就不要有分隔線把空白切成兩塊
  assert.equal(b.some((x) => x.type === "divider"), false);
});

test("齊備的團也要看得出誰帶、什麼模式、哪家車公司（Ina 2026-08-18）", () => {
  const b = blocksOf({ date: "d", headline: "h", tours: 1,
    rows: [{ code: "A", product: "福岡", pax: 20, crew: "導遊 劉洋", status: "司機 藤川／708",
      mode: "純司機", company: "彌榮觀光", mailUrl: "https://m/1" }] }) as any[];
  const t = b.find((x) => x.type === "context").elements[0].text;
  assert.match(t, /^1 團齊備\nA　福岡　20 人　<https:\/\/m\/1\|寄出的信>\n　純司機・導遊 劉洋・司機 藤川／708・彌榮觀光$/);
});

test("body 是正文不是小灰字 —— FNL 那種本身就是一份報告的訊息", () => {
  const b = blocksOf({ date: "d", headline: "h", body: ["• 添乗員：山田", "• 信件：<https://m|名簿送付>"] }) as any[];
  const secs = b.filter((x) => x.type === "section").map((x) => x.text.text);
  assert.ok(secs.some((t: string) => t.includes("添乗員")));
});

test("Block Kit 的硬上限：超過就整則發不出去，所以自己先截（2026-08-18 稽核）", () => {
  // 50 個 block 是 Slack 的硬限制 → 30 台車要催會超過
  const many = Array.from({ length: 60 }, (_, i) => ({
    code: `T${i}`, product: "x", pax: 1, crew: "導遊 甲", status: "待補", alert: true,
    todo: { text: "催車公司", link: "https://f" },
  }));
  const b = blocksOf({ kind: "名單", date: "2026-08-19", headline: "h", rows: many, tours: 60,
    testing: true, links: [{ label: "執行紀錄", url: "https://a" }] }) as any[];
  assert.ok(b.length <= 50, String(b.length));
  // 標題與尾巴不能被截掉 —— 掉了就不知道自己在看什麼
  assert.equal(b[1].type, "header");
  assert.ok(JSON.stringify(b.at(-1)).includes("執行紀錄"));
  assert.ok(b.some((x) => JSON.stringify(x).includes("這則太長")));

  // section 文字上限 3000 字：一台車缺很多東西時 todo 會很長
  const long = blocksOf({ date: "d", headline: "h",
    rows: [{ code: "A", product: "x", pax: 1, crew: "c", status: "s", alert: true, todo: { text: "字".repeat(5000) } }] }) as any[];
  assert.ok(long.every((x) => JSON.stringify(x).length < 3200), "section 沒截斷");

  // header 上限 150 字
  const h = blocksOf({ date: "2026-08-19", headline: "長".repeat(300) }) as any[];
  assert.ok(h[0].text.text.length <= 150);
});

test("按鈕的 url 一定要是真網址 —— 不是的話 Slack 整則回 400（2026-08-18 稽核）", () => {
  const b = blocksOf({ date: "d", headline: "h",
    actions: [{ text: "催", link: "查不到專屬連結", linkText: "表單" }] }) as any[];
  // 掛不上按鈕沒關係，該做的事還在；整則發不出去才是災難
  assert.equal(JSON.stringify(b).includes("accessory"), false);
  assert.ok(JSON.stringify(b).includes("催"));
  assert.equal(JSON.stringify(b).includes("查不到專屬連結|"), false);
});

test("要催的那台也要寫車公司（Ina 2026-08-19）", () => {
  const b = blocksOf({
    kind: "體檢", who: "", date: "2026-08-21", headline: "體檢",
    rows: [{
      code: "KK260821-155294", product: "富良野一日遊", pax: 16,
      crew: "導遊 黎家姝・司機 未回報・車號 未回報", status: "", mode: "純司機",
      company: "彌榮觀光", alert: true, todo: { text: "・車公司還沒填 Portal" },
    }],
  });
  const txt = JSON.stringify(b);
  assert.match(txt, /彌榮觀光/, "要催誰要看得到");
});

test("不用車的行程不掛「純司機」（30651 嵐山）", () => {
  const b = blocksOf({
    kind: "體檢", who: "", date: "2026-08-21", headline: "體檢",
    rows: [{
      code: "KK260821-30651", product: "嵐山小火車", pax: 23,
      crew: "導遊 森山明明", status: "", mode: "", company: "",
    }],
  });
  assert.ok(!JSON.stringify(b).includes("純司機"));
});
