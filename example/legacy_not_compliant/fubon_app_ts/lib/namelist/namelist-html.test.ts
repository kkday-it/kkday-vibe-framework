import test from "node:test";
import assert from "node:assert/strict";
import { namelistToHtml, shortPackages, planLabels, ambiguousPlans, prettyBirthday } from "./namelist-html.ts";

test("不用車的行程不印車輛資訊那一塊（30651 嵐山，Ina 2026-08-15）", () => {
  const bus = { tourCode: "KK260816-30651", carLetter: "", capacity: null, rows: [], total: 22, serviceMode: "純司機" as const, busText: "" };
  const html = namelistToHtml({ productNo: "30651", productName: "京都嵐山半日遊", departureDate: "2026-08-16", bus, companions: [], usesVehicle: false });
  assert.equal(/車両番号|バス会社|本日中にご連絡/.test(html), false);
});

test("有車的行程照印", () => {
  const bus = { tourCode: "KK260816-39100", carLetter: "", capacity: 14, rows: [], total: 7, serviceMode: "司兼導" as const, busText: "Kitaya" };
  const html = namelistToHtml({ productNo: "39100", productName: "積丹半島", departureDate: "2026-08-16", bus, companions: [], usesVehicle: true });
  assert.match(html, /車両番号/);
});

test("司兼導團頁尾不留導遊欄（Ina 2026-08-15）", () => {
  const bus = { tourCode: "KK260816-39100", carLetter: "", capacity: 14, rows: [], total: 7, serviceMode: "司兼導" as const, busText: "Kitaya" };
  const html = namelistToHtml({ productNo: "39100", productName: "積丹半島", departureDate: "2026-08-16", bus, companions: [], usesVehicle: true });
  assert.equal(/ガイド<span class="zhi">導遊<\/span>/.test(html), false);
});

test("純司機團頁尾照留導遊欄（那是我方另派的導遊）", () => {
  const bus = { tourCode: "KK260816-39100", carLetter: "", capacity: 14, rows: [], total: 7, serviceMode: "純司機" as const, busText: "Kitaya" };
  const html = namelistToHtml({ productNo: "39100", productName: "積丹半島", departureDate: "2026-08-16", bus, companions: [], usesVehicle: true, guideName: "森山明明" });
  assert.match(html, /森山明明/);
});

test("只有一台車時不印「單一車」；分車時才標 A 車（Ina 2026-08-15）", () => {
  const mk = (carLetter: string, usesVehicle = true) => namelistToHtml({
    productNo: "39100", productName: "積丹半島", departureDate: "2026-08-16",
    bus: { tourCode: "KK260816-39100", carLetter, capacity: 14, rows: [], total: 7, serviceMode: "純司機" as const, busText: "x" },
    companions: [], usesVehicle,
  });
  assert.equal(mk("").includes("單一車"), false);
  assert.match(mk("A"), /A 車/);
  // 不用車的行程連位空都不該出現
  assert.equal(/位空/.test(mk("", false)), false);
});

test("電話一律斷成 080-9560-2157 好唸好抄（Ina 2026-08-15）", () => {
  const bus = { tourCode: "KK260816-39100", carLetter: "", capacity: 14, rows: [], total: 7, serviceMode: "司兼導" as const, busText: "Kitaya" };
  const html = namelistToHtml({
    productNo: "39100", productName: "積丹半島", departureDate: "2026-08-16", bus, companions: new Map(), usesVehicle: true,
    vehicle: { company: "Kitaya株式会社", plate: "あ863", drivers: [{ name: "汪彦滕", phone: "08095602157" }] },
  } as any);
  assert.match(html, /080-9560-2157/);
  assert.equal(html.includes("08095602157"), false);
});

test("⚠️ 客人電話不重新分段——台灣手機是 4-3-3，套日本的 3-3-4 會切錯（2026-08-15 踩過）", () => {
  const rows = [{ bookingNo: "26KK1", bookingDate: "2026-08-01 10:00", enName: "A B", gender: "F", age: 30, nationality: "TW", buyerPhone: "0912-000-000", imType: "", imAccount: "", note: "" }] as any[];
  const bus = { tourCode: "KK260816-39100", carLetter: "", capacity: 14, rows, total: 1, serviceMode: "司兼導" as const, busText: "x" };
  const html = namelistToHtml({ productNo: "39100", productName: "x", departureDate: "2026-08-16", bus, companions: new Map(), usesVehicle: true } as any);
  assert.match(html, /0912-000-000/);
  assert.equal(html.includes("091-200-0000"), false);
});

test("⚠️ 輸出的 HTML 不能有內部註解——這份文件會寄給導遊（2026-08-15 踩過）", () => {
  const bus = { tourCode: "KK260816-39100", carLetter: "", capacity: 14, rows: [], total: 1, serviceMode: "司兼導" as const, busText: "x" };
  const html = namelistToHtml({ productNo: "39100", productName: "x", departureDate: "2026-08-16", bus, companions: new Map(), usesVehicle: true } as any);
  assert.equal(/<!--/.test(html), false);
});

test("同一張訂單共用底色、編號只印第一列並標人數（Ina 2026-08-15 ②＋③）", () => {
  const mk = (bookingNo: string, name: string) => ({
    bookingNo, bookingDate: "2026-08-01 10:00", enName: name, gender: "男", age: 30,
    nationality: "TW", buyerPhone: "0900-000-000", appType: "", appAccount: "", note: "",
  });
  // 編號要挑不會出現在內嵌 logo base64 裡的字串，否則計數會誤判（2026-08-15 踩過）
  const rows = [mk("26KK777001", "ONE"), mk("26KK777001", "TWO"), mk("26KK777001", "THREE"), mk("26KK777002", "FOUR")] as any[];
  const bus = { tourCode: "KK260816-39100", carLetter: "", capacity: 14, rows, total: 4, serviceMode: "司兼導" as const, busText: "x" };
  const html = namelistToHtml({ productNo: "39100", productName: "x", departureDate: "2026-08-16", bus, companions: new Map(), usesVehicle: true } as any);

  // 三人的訂單只印一次編號，並標「3 名」
  assert.equal(html.split("26KK777001").length - 1, 1);
  assert.match(html, /3 名/);
  // 同一訂單三列同底色（ga），下一張訂單換色（gb）並在交界畫線（gt）
  assert.equal(html.split('class="ga"').length - 1, 3);
  assert.match(html, /class="gb gt"/);
  // 一個人的訂單不標人數
  assert.equal(/1 名/.test(html), false);
});

test("資訊還沒到時的文字要看收件人：司兼導寄車公司＝請他們提供（Ina 2026-08-15）", () => {
  const mkBus = (mode: "司兼導" | "純司機") => ({ tourCode: "KK260816-39100", carLetter: "", capacity: 14, rows: [], total: 1, serviceMode: mode, busText: "x" });
  const html = (mode: "司兼導" | "純司機") => namelistToHtml({
    productNo: "39100", productName: "x", departureDate: "2026-08-16",
    bus: mkBus(mode), companions: new Map(), usesVehicle: true, vehicle: {},
  } as any);
  assert.match(html("司兼導"), /16:00 までにご連絡ください/);
  assert.match(html("純司機"), /本日中にご連絡/);
  assert.equal(/16:00 までにご連絡ください/.test(html("純司機")), false);
});

test("兩位司機：姓名與電話同一格，第二位起加分隔線（Ina 2026-08-15）", () => {
  const bus = { tourCode: "KK260816-39100", carLetter: "", capacity: 45, rows: [], total: 1, serviceMode: "純司機" as const, busText: "x" };
  const html = namelistToHtml({
    productNo: "39100", productName: "x", departureDate: "2026-08-16", bus, companions: new Map(), usesVehicle: true,
    vehicle: { company: "北の旅観光", plate: "札幌200か1234",
      drivers: [{ name: "テスト太郎", phone: "08000000001" }, { name: "テスト次郎", phone: "08000000002" }] },
  } as any);
  assert.match(html, /運転手1/);
  assert.match(html, /運転手2/);
  assert.match(html, /class="seg sep"/);
  // 電話在姓名的同一格內（用 .sub），不再自成一格
  assert.match(html, /<span class="sub">080-0000-0001<\/span>/);
});

test("同行說明放在該列的備考欄，不再用表格下方的圖例（Ina 2026-08-15）", () => {
  const mk = (no: string, note = "") => ({ bookingNo: no, bookingDate: "2026-08-01 10:00", enName: "X", gender: "男", age: 30, nationality: "TW", buyerPhone: "0900-000-000", appType: "", appAccount: "", note });
  const rows = [mk("26KK777001", "ベジタリアン"), mk("26KK777002")] as any[];
  const bus = { tourCode: "KK260816-39100", carLetter: "", capacity: 14, rows, total: 2, serviceMode: "司兼導" as const, busText: "x" };
  const html = namelistToHtml({ productNo: "39100", productName: "x", departureDate: "2026-08-16", bus,
    companions: new Map([["26KK777001", "g1"], ["26KK777002", "g1"]]), usesVehicle: true } as any);
  assert.match(html, /同行單，請安排同車鄰座/);
  // 備考欄只用中文（Ina 2026-08-17）：這一格已經有客人寫的原文，再配一行日文會變成日中日中四行
  assert.equal(/同行のご予約・お座席はお近くに/.test(html), false);
  // 客人自己填的備註還在，兩者並存
  assert.match(html, /ベジタリアン/);
  // 表格下方不再有圖例
  assert.equal(/class="legend"/.test(html), false);
});

test("同行註記只印在訂單第一列，四人訂單不會印四次（Ina 2026-08-17）", () => {
  const mk = (no: string, name: string) => ({ bookingNo: no, bookingDate: "2026-08-01 10:00", enName: name, gender: "男", age: 30, nationality: "TW", buyerPhone: "0900-000-000", appType: "LINE", appAccount: "abc123", note: "" });
  // 一張四人訂單 ＋ 另一張同行的單人訂單
  const rows = [mk("26KK777001", "A"), mk("26KK777001", "B"), mk("26KK777001", "C"), mk("26KK777001", "D"), mk("26KK777002", "E")] as any[];
  const bus = { tourCode: "KK260816-39100", carLetter: "", capacity: 14, rows, total: 5, serviceMode: "純司機" as const, busText: "x" };
  const html = namelistToHtml({ productNo: "39100", productName: "x", departureDate: "2026-08-16", bus,
    companions: new Map([["26KK777001", "g1"], ["26KK777002", "g1"]]), usesVehicle: true } as any);
  // 兩張訂單各一次＝兩次，不是五次
  assert.equal((html.match(/同行單，請安排同車鄰座/g) ?? []).length, 2);
  // 通訊軟體同理：只在代表人那列
  assert.equal((html.match(/abc123/g) ?? []).length, 2);
});

test("備考欄整欄只印在訂單第一列——客人原文與客服追加都不重複（Ina 2026-08-17）", () => {
  const note = "盡量不要安排旅遊巴後面座位｜客服追加：與 26KK273700327 同行單";
  const mk = (name: string) => ({ bookingNo: "26KK777001", bookingDate: "2026-08-01 10:00", enName: name, gender: "男", age: 30, nationality: "TW", buyerPhone: "0900-000-000", appType: "", appAccount: "", note });
  const rows = [mk("A"), mk("B"), mk("C"), mk("D")] as any[];
  const bus = { tourCode: "KK260816-39100", carLetter: "", capacity: 14, rows, total: 4, serviceMode: "純司機" as const, busText: "x" };
  const html = namelistToHtml({ productNo: "39100", productName: "x", departureDate: "2026-08-16", bus,
    companions: new Map(), usesVehicle: true } as any);
  assert.equal((html.match(/盡量不要安排旅遊巴後面座位/g) ?? []).length, 1);
  assert.equal((html.match(/與 26KK273700327 同行單/g) ?? []).length, 1);
  // 客服追加另起一行、跟客人原文分開排版
  assert.match(html, /<span class="cs">客服追加：/);
  // 拆開之後客人那段尾巴不留分隔的「｜」
  assert.equal(/後面座位｜/.test(html), false);
});

test("生日留著給設施投保用，年齡放小字（Ina 2026-08-17）", () => {
  const r = { bookingNo: "26KK1", bookingDate: "2026-08-01 10:00", enName: "A", gender: "男", age: 36, birthday: "19900305", nationality: "TW", buyerPhone: "0900-000-000", appType: "", appAccount: "", note: "", packageName: "P" };
  const bus = { tourCode: "T", carLetter: "", capacity: 9, rows: [r], total: 1, serviceMode: "純司機" as const, busText: "x" };
  const html = namelistToHtml({ productNo: "1", productName: "x", departureDate: "2026-08-18", bus, companions: new Map(), usesVehicle: true } as any);
  assert.match(html, /1990-03-05/);
  // 生日與年齡分開兩欄（Ina 2026-08-17）：設施要生日、導遊點名看年齡
  assert.match(html, /<th>生年月日/);
  assert.match(html, /<th>年齢/);
  assert.match(html, /<td class="c">36<\/td>/);
});

test("方案：促銷／成團標籤不算行程差異，真差異要留著（Ina 2026-08-17，用實際資料校過）", () => {
  const kinds = (ns: string[]) => [...new Set(shortPackages(ns).values())].length;
  // 同一個行程賣三種成團人數（155294 實際資料）
  assert.equal(kinds([
    "【1人成團】富田農場彩虹花田&美瑛四季彩之丘&白金青池一日遊",
    "【早鳥限時特惠｜45%OFF】富田農場彩虹花田&美瑛四季彩之丘&白金青池一日遊【 20人成團】",
    "【早鳥限時特惠】富田農場彩虹花田&美瑛四季彩之丘&白金青池一日遊【 20人成團】"]), 1);
  // 只差一對括號（30651 實際資料）
  assert.equal(kinds([
    "【1人成團】嵐山半日遊｜嵐山小火車＆保津川遊船（嵯峨駅／09點50分集合）",
    "【嵐山半日遊】｜嵐山小火車＆保津川遊船（嵯峨駅／09點50分集合）【 6人成團】"]), 1);
  // 「暑假限定」「限量促銷」也是促銷（528834／158778 實際資料，2026-08-17 補上）
  assert.equal(kinds([
    "【1人成團｜保證出發｜暑假限定～水蜜桃吃到飽】Ｃ方案：富士山親子一日遊",
    "【暑假限定～水蜜桃吃到飽】Ｃ方案：富士山親子一日遊"]), 1);
  assert.equal(kinds([
    "【1人成團｜保證出發】Ｃ方案：黑部立山避暑三日遊（2人一室）",
    "【限量促銷～30%OFF！】Ｃ方案：黑部立山避暑三日遊（2人一室）【 16人成團】",
    "【限量促銷】Ｃ方案：黑部立山避暑三日遊（2人一室）【 16人成團】"]), 1);
  // ⚠️ 單獨的「限定」不能剝——那是真的方案差異
  assert.equal(kinds(["【女性限定】京都和服體驗", "【親子方案】京都和服體驗"]), 2);
});

test("方案代號與抬頭文字（Ina 2026-08-17）", () => {
  // ① 名稱本身就是方案字母 → 直接拿字母當代號，不另外配 A／B
  const ab = planLabels([
    "Ａ方案：富士山親子一日遊～富士野生動物園（不含「叢林巴士」搭乘費用）",
    "Ｂ方案：富士山親子一日遊～富士野生動物園（含「叢林巴士」搭乘費用）"]);
  assert.deepEqual(ab.map((x) => x.code), ["Ａ", "Ｂ"]);
  // ② 差異在中間：砍頭之後差異要看得見，不能被砍尾砍掉（會變成「（不」與「（」）
  // 砍完留下的孤兒右括號要去掉（左括號在被砍掉的共同部分裡），不然看起來像被截斷
  assert.deepEqual(ab.map((x) => x.label), ["不含「叢林巴士」搭乘費用", "含「叢林巴士」搭乘費用"]);
  // ③ 除了字母以外一模一樣 → 沒有可寫的差異，交給抬頭合併成一行
  const bc = planLabels(["Ｂ方案：富士山親子一日遊", "Ｃ方案：富士山親子一日遊"]);
  assert.deepEqual(bc.map((x) => x.code), ["Ｂ", "Ｃ"]);
  assert.deepEqual(bc.map((x) => x.label), ["", ""]);
  // ④ 沒有方案字母時才配 A／B；名稱長就砍到只剩差異
  const kid = planLabels(["富良野一日遊｜成人票", "富良野一日遊｜兒童票"]);
  assert.deepEqual(kid.map((x) => x.code), ["A", "B"]);
  assert.deepEqual(kid.map((x) => x.label), ["成人票", "兒童票"]);
});

test("車公司不印給導遊，只印給車公司自己（Ina 2026-08-17）", () => {
  const r = { bookingNo: "26KK1", bookingDate: "2026-08-01 10:00", enName: "A", gender: "男", age: 30, birthday: "19900305", nationality: "TW", buyerPhone: "0900-000-000", appType: "", appAccount: "", note: "", packageName: "P" };
  const veh = { company: "STAR TIGER TRAVEL", plate: "33-06", drivers: [{ name: "ミヤウチ", phone: "08000000001" }] };
  const mkHtml = (serviceMode: "純司機" | "司兼導") => namelistToHtml({
    productNo: "1", productName: "x", departureDate: "2026-08-18",
    bus: { tourCode: "T", carLetter: "", capacity: 9, rows: [r], total: 1, serviceMode, busText: "x" },
    companions: new Map(), usesVehicle: true, vehicle: veh } as any);
  // 純司機＝寄給導遊（可能是別家地接社派來的）→ 不揭露我們用哪家巴士公司
  const toGuide = mkHtml("純司機");
  assert.equal(/STAR TIGER TRAVEL/.test(toGuide), false);
  // 但找得到車的三件事都還在
  assert.match(toGuide, /33-06/);
  assert.match(toGuide, /ミヤウチ/);
  assert.match(toGuide, /080-0000-0001/);
  // 司兼導＝收件人就是車公司本人 → 照印
  assert.match(mkHtml("司兼導"), /STAR TIGER TRAVEL/);
});

test("兩種以上方案：完整名稱放抬頭對照，欄位只放代號（Ina 2026-08-17）", () => {
  const mk = (n: string, pkg: string) => ({ bookingNo: "26KK1", bookingDate: "2026-08-01 10:00", enName: n, gender: "男", age: 30, birthday: "19900305", nationality: "TW", buyerPhone: "0900-000-000", appType: "", appAccount: "", note: "", packageName: pkg });
  const rows = [mk("A", "富良野一日遊｜成人票"), mk("B", "富良野一日遊｜兒童票")];
  const bus = { tourCode: "T", carLetter: "", capacity: 9, rows, total: 2, serviceMode: "純司機" as const, busText: "x" };
  const html = namelistToHtml({ productNo: "1", productName: "x", departureDate: "2026-08-18", bus, companions: new Map(), usesVehicle: true } as any);
  // 抬頭有對照表
  assert.match(html, /<p class="pkl">.*<b>A<\/b> 成人票・<b>B<\/b> 兒童票/);
  // 欄位裡只有代號，不重複整串方案名
  assert.match(html, /<td class="c pk">A<\/td>/);
  assert.equal(/<td[^>]*>成人<\/td>/.test(html), false);
});

test("名單依訂購時間由早到晚排序，同一張訂單不被拆開（Ina 2026-08-17）", () => {
  const mk = (no: string, n: string, bd: string) => ({ bookingNo: no, bookingDate: bd, enName: n, gender: "男", age: 30, birthday: "19900305", nationality: "TW", buyerPhone: "0900-000-000", appType: "", appAccount: "", note: "", packageName: "P" });
  // 故意亂序：晚訂的排在前面，而且同一張訂單的兩個人被拆開放
  const rows = [
    mk("26KK002", "LATE1", "2026-08-05 09:00"),
    mk("26KK001", "EARLY1", "2026-08-01 08:00"),
    mk("26KK002", "LATE2", "2026-08-05 09:00"),
    mk("26KK001", "EARLY2", "2026-08-01 08:00"),
  ];
  const bus = { tourCode: "T", carLetter: "", capacity: 9, rows, total: 4, serviceMode: "純司機" as const, busText: "x" };
  const html = namelistToHtml({ productNo: "1", productName: "x", departureDate: "2026-08-18", bus, companions: new Map(), usesVehicle: true } as any);
  const order = [...html.matchAll(/<td class="nm">([A-Z0-9]+)<\/td>/g)].map((m) => m[1]);
  assert.deepEqual(order, ["EARLY1", "EARLY2", "LATE1", "LATE2"]);
  // 規則要寫在名單上，不能只有寫程式的人知道
  assert.match(html, /同行單排在一起，其餘依訂購時間由早到晚/);
});

test("不印訂購日：順序本身就是訂購順序（Ina 2026-08-17）", () => {
  const r = { bookingNo: "26KK1", bookingDate: "2026-08-01 10:33", enName: "A", gender: "男", age: 30, birthday: "19900305", nationality: "TW", buyerPhone: "0900-000-000", appType: "", appAccount: "", note: "", packageName: "P" };
  const bus = { tourCode: "T", carLetter: "", capacity: 9, rows: [r], total: 1, serviceMode: "純司機" as const, busText: "x" };
  const html = namelistToHtml({ productNo: "1", productName: "x", departureDate: "2026-08-18", bus, companions: new Map(), usesVehicle: true } as any);
  assert.equal(/2026-08-01/.test(html), false);
  assert.equal(/10:33/.test(html), false);
  assert.equal(/注文日/.test(html), false);
  // 但排序規則還是要寫著，不然沒人知道這個順序代表什麼
  assert.match(html, /同行單排在一起，其餘依訂購時間由早到晚/);
});

test("備考按內容去重：同一句不重複，不一樣的不會被吃掉（2026-08-17 demo 時發現）", () => {
  const mk = (n: string, note: string) => ({ bookingNo: "26KK1", bookingDate: "2026-08-01 10:00", enName: n, gender: "男", age: 30, birthday: "19900305", nationality: "TW", buyerPhone: "0900-000-000", appType: "", appAccount: "", note, packageName: "P" });
  // 一家三口：兩位共用訂單層級的備註，第三位另外有一句自己的
  const rows = [mk("A", "素食"), mk("B", "素食"), mk("C", "小孩需要兒童座椅")];
  const bus = { tourCode: "T", carLetter: "", capacity: 9, rows, total: 3, serviceMode: "純司機" as const, busText: "x" };
  const html = namelistToHtml({ productNo: "1", productName: "x", departureDate: "2026-08-18", bus, companions: new Map(), usesVehicle: true } as any);
  assert.equal((html.match(/素食/g) ?? []).length, 1);           // 重複的只印一次
  assert.equal((html.match(/小孩需要兒童座椅/g) ?? []).length, 1); // 不一樣的一定要印出來
});

test("528834 八個方案 → 四種，C／D 的餐食是真差異不能剝（Ina 2026-08-17 提供實際頁面）", () => {
  const B = "富士山親子一日遊～富士野生動物園FUJI SAFARI PARK";
  const P = [
    `【1人成團｜保證出發】 A方案：${B}（不含「叢林巴士」搭乘費用）`,
    `【1人成團｜保證出發】 B方案：${B}（含「叢林巴士」搭乘費用）`,
    `A方案：${B}（不含「叢林巴士」搭乘費用）`,
    `B方案：${B}（含「叢林巴士」搭乘費用）`,
    `【秋冬限定～長腳蟹盛宴全餐＋鮮採柑橘吃到飽！】 D方案：${B}（含「叢林巴士」搭乘費用）`,
    `【1人成團｜保證出發｜暑假限定～日本水蜜桃吃到飽＋箱根釜飯御膳午餐！】 C方案：${B}（含「叢林巴士」搭乘費用）`,
    `【1人成團｜保證出發｜秋冬限定～長腳蟹盛宴全餐＋鮮採柑橘吃到飽！】 D方案：${B}（含「叢林巴士」搭乘費用）`,
    `【暑假限定～日本水蜜桃吃到飽＋箱根釜飯御膳午餐！】 C方案：${B}（含「叢林巴士」搭乘費用）`,
  ];
  const fulls = [...new Set(shortPackages(P).values())];
  assert.equal(fulls.length, 4);                       // 促銷寫法不同不算不同方案
  const m = planLabels(fulls);
  assert.deepEqual(m.map((x) => x.code).sort(), ["A", "B", "C", "D"]);
  const label = (c: string) => m.find((x) => x.code === c)!.label;
  assert.match(label("A"), /不含「叢林巴士」/);
  assert.match(label("B"), /^含「叢林巴士」/);
  // ⚠️ C 與 D 的差別是餐食，被當成促銷剝掉的話三個方案的說明會一模一樣
  assert.match(label("C"), /日本水蜜桃吃到飽/);
  assert.match(label("D"), /長腳蟹盛宴/);
});

test("方案分不出來要大聲講，不能安靜印錯（Ina 2026-08-17）", () => {
  const B = "富士山親子一日遊";
  // 只有一種 → 沒問題
  assert.equal(ambiguousPlans([`A方案：${B}`, `A方案：${B}`]), null);
  // 說明各自不同 → 沒問題
  assert.equal(ambiguousPlans([`A方案：${B}（不含叢林巴士）`, `B方案：${B}（含叢林巴士）`]), null);
  // 兩種方案但名稱除了代號以外一模一樣 → 導遊看不出差在哪，要講
  const w = ambiguousPlans([`B方案：${B}`, `C方案：${B}`]);
  assert.match(String(w), /除了代號以外完全一樣/);
  assert.match(String(w), /B／C/);
});

test("同行單排在一起，整組跟著最早的那張單走（Ina 2026-08-17）", () => {
  const mk = (no: string, n: string, bd: string) => ({ bookingNo: no, bookingDate: bd, enName: n, gender: "男", age: 30, birthday: "19900305", nationality: "TW", buyerPhone: "0900-000-000", appType: "", appAccount: "", note: "", packageName: "P" });
  // A（8/01）與 C（8/20）是同行；B（8/05）不是。只照訂購時間排的話會變成 A→B→C，把同行單拆開
  const rows = [
    mk("26KK00C", "C1", "2026-08-20 10:00"),
    mk("26KK00A", "A1", "2026-08-01 10:00"),
    mk("26KK00B", "B1", "2026-08-05 10:00"),
    mk("26KK00A", "A2", "2026-08-01 10:00"),
  ];
  const bus = { tourCode: "T", carLetter: "", capacity: 9, rows, total: 4, serviceMode: "純司機" as const, busText: "x" };
  const html = namelistToHtml({ productNo: "1", productName: "x", departureDate: "2026-08-18", bus,
    companions: new Map([["26KK00A", "g1"], ["26KK00C", "g1"]]), usesVehicle: true } as any);
  const order = [...html.matchAll(/<td class="nm">([A-Z0-9]+)<\/td>/g)].map((m) => m[1]);
  // 同行的 A 與 C 連在一起，整組排在 B 前面（因為組內最早的是 8/01）
  assert.deepEqual(order, ["A1", "A2", "C1", "B1"]);
  // 記號照印出來的順序編：第一組拿①
  assert.match(html, /①/);
});

test("簡體下單的同一個行程不該被當成另一種方案（Ina 2026-08-19）", () => {
  // 8/20 的 155294：四筆套餐名稱其實是同一條行程，其中一筆是簡體
  const names = [
    "【1人成團】富田農場彩虹花田&美瑛四季彩之丘&白金青池一日遊",
    "【早鳥限時特惠】富田農場彩虹花田&美瑛四季彩之丘&白金青池一日遊【 20人成團】",
    "【早鳥限時特惠｜45%OFF】富田農場彩虹花田&美瑛四季彩之丘&白金青池一日遊【 20人成團】",
    "【1人成团】富田农场彩虹花田&美瑛四季彩之丘&白金青池一日游",
  ];
  assert.equal(new Set(shortPackages(names).values()).size, 1);
  assert.equal(ambiguousPlans(names), null);
});

test("折簡體不會把真的不同的方案合併掉", () => {
  const names = [
    "Ｂ方案：富士山親子一日遊～富士野生動物園（含「叢林巴士」搭乘費用）",
    "【暑假限定～日本水蜜桃吃到飽＋箱根釜飯御膳午餐！】Ｃ方案：富士山親子一日遊～富士野生動物園（含「叢林巴士」搭乘費用）",
  ];
  assert.equal(new Set(shortPackages(names).values()).size, 2);
});

test("促銷詞新增：晚鳥／買一送一／保證出團（2026-08-19 真實資料）", () => {
  const same = [
    "【1人成團】富田農場彩虹花田&美瑛四季彩之丘&白金青池一日遊",
    "【晚鳥限時特惠｜買一送一】富田農場彩虹花田&美瑛四季彩之丘&白金青池一日遊",
    "【早鳥限時特惠】富田農場彩虹花田&美瑛四季彩之丘&白金青池一日遊【 20人成團】",
  ];
  assert.equal(new Set(shortPackages(same).values()).size, 1);
  assert.equal(new Set(shortPackages([
    "【保證出團】福岡出發｜九州自然野生動物園・湯布院・宇佐神宮一日遊",
    "福岡出發｜九州自然野生動物園・湯布院・宇佐神宮一日遊",
  ]).values()).size, 1);
});

test("外語套餐名稱：中日文只有一種行程時併進去，有多種時不猜", () => {
  const zh = "【1人成團】富田農場彩虹花田&美瑛四季彩之丘&白金青池一日遊";
  const en = "[Guaranteed Departure for Solo Traveler] Farm Tomita - Rainbow Fields & Shirogane Blue Pond: 1-day Tour";
  assert.equal(new Set(shortPackages([zh, en]).values()).size, 1);
  // 中日文那側本來就有 B／C 兩條行程 → 外語那筆不併（併錯會讓客人少掉採果與午餐）
  const b = "Ｂ方案：富士山親子一日遊（含「叢林巴士」搭乘費用）";
  const c = "【暑假限定～日本水蜜桃吃到飽】Ｃ方案：富士山親子一日遊（含「叢林巴士」搭乘費用）";
  assert.equal(new Set(shortPackages([b, c, en]).values()).size, 3);
});
