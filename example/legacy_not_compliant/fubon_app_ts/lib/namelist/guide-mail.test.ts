import { test } from "node:test";
import assert from "node:assert/strict";
import { unlinkSync, writeFileSync, existsSync } from "node:fs";
import { loadLedger, alreadySent, markSent, shouldResend, mailSubject, mailBody, splitEmails, displayGuide, mailHtml, planNames, resolveMailTo, REDIRECT_ALL_TO, guideMailCc, hadFullWidth } from "./guide-mail.ts";
import type { BusGroup } from "./enrich.ts";

const P = "/tmp/test-ledger.json";
const bus = (n: number, letter = "A"): BusGroup => ({
  tourCode: "KK260803-184638A", carLetter: letter, capacity: 40,
  rows: Array.from({ length: n }, (_, i) => ({
    bookingNo: `26KK00000000${i}`, bookingDate: "", language: "", enName: "X", productNo: "184638",
    packageName: "", gender: "", birthday: "", age: 30, nationality: "", buyerPhone: "",
    appType: "", appAccount: "", note: i === 0 ? "素食" : "", splitHint: false,
  })), total: n,
});
const input = { guideName: "魏秋蘭", to: "a@b.com", productName: "長岡達摩二日", productNo: "184638",
  departureDate: "2026-08-03", bus: bus(3), companionGroups: 1 };

test("同一團同一收件人只寄一次", () => {
  if (existsSync(P)) unlinkSync(P);
  const l = loadLedger(P);
  assert.equal(alreadySent(l, "KK260803-184638A", "2026-08-03", "a@b.com"), undefined);
  markSent(l, "KK260803-184638A", "2026-08-03", "a@b.com", "s", "2026-08-02 13:00", 1, false, P);
  const l2 = loadLedger(P);
  assert.ok(alreadySent(l2, "KK260803-184638A", "2026-08-03", "A@B.com"));   // 大小寫不影響
  assert.equal(alreadySent(l2, "KK260803-184638B", "2026-08-03", "a@b.com"), undefined); // 另一台車照寄
  unlinkSync(P);
});

test("16:00 補寄：只在第一次沒司機、現在有了才寄", () => {
  if (existsSync(P)) unlinkSync(P);
  const l = loadLedger(P);
  const args = ["KK260803-184638A", "2026-08-03", "a@b.com"] as const;
  // 13:00 還沒寄成功 → 這輪不是補寄
  assert.equal(shouldResend(l, ...args, true).resend, false);
  markSent(l, ...args, "s", "2026-08-02 13:00", 1, false, P);
  assert.equal(shouldResend(l, ...args, false).resend, false);   // 車公司還是沒填 → 不寄，改催 Winnie
  assert.equal(shouldResend(l, ...args, true).resend, true);     // 現在有了 → 補寄
  markSent(l, ...args, "s2", "2026-08-02 16:00", 2, true, P);
  assert.equal(shouldResend(l, ...args, true).resend, false);    // 補寄過就不再寄
  unlinkSync(P);
});

test("第一次就有司機資訊 → 16:00 不再打擾", () => {
  if (existsSync(P)) unlinkSync(P);
  const l = loadLedger(P);
  markSent(l, "KK260803-184638A", "2026-08-03", "a@b.com", "s", "2026-08-02 13:00", 1, true, P);
  assert.equal(shouldResend(l, "KK260803-184638A", "2026-08-03", "a@b.com", true).resend, false);
  unlinkSync(P);
});

test("兩次的主旨與內文分得出來", () => {
  const p1 = { ...input, pass: 1 as const, hasVehicle: false };
  const p2 = { ...input, pass: 2 as const, hasVehicle: true, vehicle: { plate: "品川300あ12-34", drivers: [{ name: "山田太郎", phone: "09012345678" }] } };
  assert.doesNotMatch(mailSubject(p1), /更新/);
  assert.match(mailSubject(p2), /更新·已附司機資訊/);
  assert.match(mailBody(p1), /車公司尚未回報/);
  assert.doesNotMatch(mailBody(p1), /餐廳/);           // 不是每個行程都有餐廳，別寫死（Ina 2026-08-15）
  // 「請先不用等」那句拿掉了（Ina 2026-08-15）：下一句已經說明回報後會補寄更新版，
  // 導遊自然知道不用等，多講一句反而囉嗦。
  assert.doesNotMatch(mailBody(p1), /先寄給您方便提前準備/);
  assert.match(mailBody(p1), /更新版名單/);   // 但「之後會補寄」一定要留著
  assert.match(mailBody(p2), /請以本封為準，先前寄出的那份請勿再使用/);
  assert.match(mailBody(p2), /品川300あ12-34/);
});

test("台帳壞掉要中止，不能當成沒寄過", () => {
  writeFileSync(P, "{壞掉的 json", "utf8");
  assert.throws(() => loadLedger(P), /重複寄信/);
  unlinkSync(P);
});

test("主旨與內文帶出關鍵資訊", () => {
  assert.match(mailSubject(input), /2026-08-03｜KK260803-184638A（A 車）｜長岡達摩二日/);
  const b = mailBody(input);
  assert.match(b, /旅客人數：3 位/);
  assert.match(b, /商品編號：184638/);      // 商品編號獨立一行（Ina 2026-08-15）
  // 同行單與備註的提醒改放**名單**上（圖例與備考欄）——導遊在現場看的是名單，
  // 寫在信裡等於講完就忘（Ina 2026-08-15）。
  assert.doesNotMatch(b, /①②③/);
  assert.doesNotMatch(b, /位旅客填了備註/);
});

test("司兼導寄車公司：資訊給了就單純寄，沒給就要求 16:00 前補", () => {
  const co = { ...input, recipient: "車公司" as const, guideName: "北之旅株式会社", pass: 1 as const };
  const done = mailBody({ ...co, hasVehicle: true });
  const todo = mailBody({ ...co, hasVehicle: false });
  assert.match(done, /司機與車輛資訊已收到/);
  assert.doesNotMatch(done, /16:00 前/);              // 已經給了就別再催
  assert.match(todo, /16:00 前/);                     // 對車公司講 16:00
  assert.doesNotMatch(todo, /17:00 前提供司機/);       // 17:00 是對客期限，不是給車公司的期限
  assert.match(todo, /轉交隨團司機/);
  assert.match(mailSubject({ ...co, hasVehicle: false }), /請回覆司導資訊/);
  assert.doesNotMatch(mailSubject({ ...co, hasVehicle: true }), /請回覆/);
  // 給導遊的信不該出現車公司的措辭
  assert.doesNotMatch(mailBody({ ...input, pass: 1 as const, hasVehicle: false }), /轉交隨團司機/);
});

test("一格多個信箱要拆開（Kitaya 那格是兩個地址用換行分隔）", () => {
  assert.deepEqual(splitEmails("roy19880417@hotmail.com\nkitaya.yokoi@hotmail.com"),
    ["roy19880417@hotmail.com", "kitaya.yokoi@hotmail.com"]);
  assert.deepEqual(splitEmails("a@b.com, c@d.com; e@f.com"), ["a@b.com", "c@d.com", "e@f.com"]);
  assert.deepEqual(splitEmails("（尚未提供）"), []);       // 不是信箱就不要，寧可查不到收件人
  assert.deepEqual(splitEmails(""), []);
});

test("稱呼加職稱，讀音註記不帶進信裡（Ina 2026-08-15）", () => {
  // 直呼全名不禮貌；名冊上的「（モリヤマミンミン）」是給我們對人用的，不該出現在稱呼裡
  assert.equal(displayGuide("森山明明（モリヤマミンミン）"), "森山明明");
  assert.equal(displayGuide("毛曉彩／毛暁彩"), "毛曉彩");
  assert.equal(displayGuide(""), "您");
  // 日文為主、中文在下（Ina 2026-08-15）→ 開頭是日文稱呼，中文段落在分隔線之後
  const b = mailBody({ ...input, guideName: "森山明明（モリヤマミンミン）" });
  assert.match(b, /^森山明明 ガイド様/);
  assert.match(b, /森山明明 導遊 您好/);
  // 讀音註記只在稱呼裡去掉，兩個語言版本都要去掉
  assert.equal(b.includes("モリヤマミンミン"), false);
});

test("HTML 版把長連結收成一行按鈕，純文字版仍保留完整網址", () => {
  const link = "https://script.google.com/macros/s/AKfy" + "x".repeat(80) + "/exec?t=abc123";
  const i = { ...input, recipient: "車公司" as const, hasVehicle: false, portalLink: link };
  const body = mailBody(i);
  assert.ok(body.includes(link));                       // 純文字：完整網址，點得到
  const html = mailHtml(i, body);
  assert.match(html, /貴公司專用表單（點這裡填寫）/);
  assert.ok(!html.includes(`>${link}<`));               // HTML：網址只在 href 裡，不裸露
  assert.match(html, new RegExp(`href="${link.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
});

test("導遊信箱沒確認完 → 預設全部轉寄給 Ina（Ina 2026-08-15）", () => {
  const r = resolveMailTo(["guide@example.jp"], {} as NodeJS.ProcessEnv);
  assert.deepEqual(r.to, [REDIRECT_ALL_TO]);
  assert.equal(r.redirected, true);
});

test("⚠️ 只設 SEND_FOR_REAL 不會讓信寄到外面——還要 GUIDE_MAIL_GO_LIVE", () => {
  const r = resolveMailTo(["guide@example.jp"], { SEND_FOR_REAL: "1" } as unknown as NodeJS.ProcessEnv);
  assert.deepEqual(r.to, [REDIRECT_ALL_TO]);
});

test("GUIDE_MAIL_GO_LIVE=1 才真的寄給對方", () => {
  const r = resolveMailTo(["guide@example.jp", "b@example.jp"], { GUIDE_MAIL_GO_LIVE: "1" } as unknown as NodeJS.ProcessEnv);
  assert.deepEqual(r.to, ["guide@example.jp", "b@example.jp"]);
  assert.equal(r.redirected, false);
});

test("MAIL_TEST_TO 優先於一切（要寄給別人測試時）", () => {
  const r = resolveMailTo(["guide@example.jp"], { GUIDE_MAIL_GO_LIVE: "1", MAIL_TEST_TO: "me@kkday.com" } as unknown as NodeJS.ProcessEnv);
  assert.deepEqual(r.to, ["me@kkday.com"]);
  assert.equal(r.redirected, true);
});

test("不用車的行程，信裡一個字都不提車（30651 嵐山，Ina 2026-08-15）", () => {
  const bus = { tourCode: "KK260816-30651", carLetter: "", capacity: null, rows: [], total: 22, serviceMode: "純司機" as const, busText: "" };
  const body = mailBody({
    guideName: "森山明明", to: "g@x.jp", productName: "京都嵐山半日遊", productNo: "30651",
    departureDate: "2026-08-16", bus, companionGroups: 0, pass: 1,
    hasVehicle: false, usesVehicle: false, recipient: "導遊",
  });
  assert.equal(/車公司|車輛與司機|司機資訊後給/.test(body), false);
});

test("有車但車公司還沒回報時，仍要講清楚（不能讓導遊以為漏印）", () => {
  const bus = { tourCode: "KK260816-39100", carLetter: "", capacity: 14, rows: [], total: 7, serviceMode: "純司機" as const, busText: "Kitaya" };
  const body = mailBody({
    guideName: "森山明明", to: "g@x.jp", productName: "積丹半島", productNo: "39100",
    departureDate: "2026-08-16", bus, companionGroups: 0, pass: 1,
    hasVehicle: false, usesVehicle: true, recipient: "導遊",
  });
  assert.match(body, /車輛與司機資訊車公司尚未回報/);
  // ※ 拿掉了：郵件軟體裡對不齊，看起來像亂碼（Ina 2026-08-15）
  assert.equal(body.includes("※ 車輛與司機資訊"), false);
});

test("雙語：日文在上、中文在下，兩邊資訊一致（Ina 2026-08-15）", () => {
  const bus = { tourCode: "KK260816-39100", carLetter: "", capacity: 14, rows: [], total: 7, serviceMode: "司兼導" as const, busText: "Kitaya" };
  const body = mailBody({
    guideName: "Kitaya株式会社", to: "x@y.jp", productName: "積丹半島一日遊", productNo: "39100",
    departureDate: "2026-08-16", bus, companionGroups: 0, pass: 1,
    hasVehicle: true, usesVehicle: true, vehicle: { plate: "あ863", drivers: [{ name: "汪彦滕" }] }, recipient: "車公司",
  });
  const ja = body.split("─".repeat(24))[0];
  const zh = body.split("─".repeat(24))[1];
  // 人數與團號這種關鍵數字，兩邊都要出現——只有一邊有的話，看另一邊的人會漏掉
  for (const key of ["7", "KK260816-39100", "39100", "2026-08-16"]) {
    assert.ok(ja.includes(key), `日文段缺 ${key}`);
    assert.ok(zh.includes(key), `中文段缺 ${key}`);
  }
  assert.match(ja, /^Kitaya株式会社 様/);
  assert.equal(body.split("自動送信しております").length, 2, "系統署名只能出現一次，且只在日文段");
  assert.equal(zh.includes("自動送信"), false, "中文段不重複系統署名");
});

test("車公司的更新版內文也要說「以本封為準」，不能只有主旨掛更新（2026-08-15 發現漏了）", () => {
  const bus = { tourCode: "KK260816-39100", carLetter: "", capacity: 14, rows: [], total: 3, serviceMode: "司兼導" as const, busText: "Kitaya" };
  const co = { guideName: "Kitaya株式会社", to: "x@y.jp", productName: "積丹半島", productNo: "39100",
    departureDate: "2026-08-16", bus, companionGroups: 0, recipient: "車公司" as const, usesVehicle: true, hasVehicle: true,
    vehicle: { plate: "あ863", drivers: [{ name: "汪彦滕" }] } };
  const p2 = mailBody({ ...co, pass: 2 as const });
  assert.match(p2, /先にお送りした名簿は破棄/);
  assert.match(p2, /請以本封為準，先前寄出的那份請勿再使用/);
  // 12:00 那封不該出現這段
  assert.doesNotMatch(mailBody({ ...co, pass: 1 as const }), /請以本封為準/);
});

test("寄給導遊的信一律 CC JP OP 共用信箱 —— 測試轉寄的也要", () => {
  assert.deepEqual(guideMailCc(false), ["jptour-operation@kkday.com"]);
  // Ina 2026-08-18 明確要求：主旨已標【測試】，OP 分得出來，
  // 而且從測試期就開始收，正式上線那天信流才不會變
  assert.deepEqual(guideMailCc(true), ["jptour-operation@kkday.com"]);
});


test("信裡要寫方案名稱 —— 528834 那種同日兩台車，只有團號不一樣導遊分不出來", () => {
  const withPlans = (...names: string[]) => {
    const b = bus(names.length);
    names.forEach((n, i) => { b.rows[i].packageName = n; });
    return { ...input, bus: b, pass: 1 as const, hasVehicle: false };
  };
  // 一台車載兩個方案 → 兩個都要寫，只寫一個會讓導遊漏掉另一半人的餐食／加購
  const ab = withPlans("A方案：採果", "B方案：採果");
  assert.deepEqual(planNames(ab.bus), ["A方案：採果", "B方案：採果"]);
  assert.match(mailBody(ab), /方案：A方案：採果／B方案：採果/);
  assert.match(mailBody(ab), /プラン：A方案：採果／B方案：採果/);

  // 同一天另一台載的是別的方案 → 兩封信的內文現在分得出來
  const c = withPlans("C方案：多採水果＋午餐");
  assert.notEqual(mailBody(ab), mailBody(c));

  // 重複的方案名只出現一次
  const dup = withPlans("A方案", "A方案", "A方案");
  assert.deepEqual(planNames(dup.bus), ["A方案"]);

  // 方案名空白是**資料異常**，不是正常情況（Ina 2026-08-18：「不可能沒有方案名稱」）。
  // 信裡沒東西可寫只能少一行，所以那一行的缺席要由核對清單的旗標喊出來
  //（見 make-guide-package 的 flags）——這裡只固定「不會印出一行空的『方案：』」。
  assert.doesNotMatch(mailBody({ ...input, pass: 1 as const, hasVehicle: false }), /方案：/);
});

test("信箱：多個一起填要全部收；全形＠要救回來（357観光 實際踩到）", () => {
  assert.deepEqual(splitEmails("a@x.jp\nb@y.jp、c@z.jp; d@w.jp"),
    ["a@x.jp", "b@y.jp", "c@z.jp", "d@w.jp"]);
  // 🔴 全形＠肉眼看不出來，認不出的後果是那家永遠寄不出去，而畫面只寫「查不到信箱」
  assert.deepEqual(splitEmails("yuyang＠inmyshow.jp"), ["yuyang@inmyshow.jp"]);
  assert.equal(hadFullWidth("yuyang＠inmyshow.jp"), true);
  assert.equal(hadFullWidth("yuyang@inmyshow.jp"), false);
  // 不是信箱的字一律丟掉，不要猜
  assert.deepEqual(splitEmails("待確認 -"), []);
});

test("信裡的方案跟名單用同一套判斷去併（Ina 2026-08-19）", () => {
  const row = (packageName: string) =>
    ({ productNo: "155294", packageName, name: "", specs: [] }) as unknown as BusGroup["rows"][number];
  const bus = {
    tourCode: "KK260820-155294", carLetter: "", capacity: null, total: 4, serviceMode: "純司機" as const, busText: "",
    rows: [
      row("【1人成團】富田農場彩虹花田&美瑛四季彩之丘&白金青池一日遊"),
      row("【早鳥限時特惠｜45%OFF】富田農場彩虹花田&美瑛四季彩之丘&白金青池一日遊【 20人成團】"),
      row("【1人成团】富田农场彩虹花田&美瑛四季彩之丘&白金青池一日游"),
    ],
  } as unknown as BusGroup;
  assert.equal(planNames(bus).length, 1);

  // 真的不同的方案照樣分開——導遊現場要知道誰有採果與午餐
  const fuji = {
    ...bus, rows: [
      row("【1人成團｜保證出發】Ｂ方案：富士山親子一日遊（含「叢林巴士」搭乘費用）"),
      row("【暑假限定～日本水蜜桃吃到飽＋箱根釜飯御膳午餐！】Ｃ方案：富士山親子一日遊（含「叢林巴士」搭乘費用）"),
    ],
  } as unknown as BusGroup;
  assert.equal(planNames(fuji).length, 2);
});
