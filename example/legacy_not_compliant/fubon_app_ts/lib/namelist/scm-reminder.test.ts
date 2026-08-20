import { test } from "node:test";
import assert from "node:assert/strict";
import { assertNoMeetUp, buildScmReminder, missingForCustomer, pickWritable } from "./scm-reminder.ts";

const base = { orderMid: "26KK218254560", tourLanguage: "zh-tw", name: "田陽 TianYang" };
const LINE = "https://line.me/ti/p/abc";

test("純司機：身份 TOUR_GUIDE、**不送車牌**（就算有值也不送）", () => {
  const p = buildScmReminder({ ...base, scenario: "純司機", phoneCountryCode: "81", phoneNumber: "90-9435-0322", plateNumber: "品川300あ12-34" });
  assert.equal(p.driverGuide.identity, "TOUR_GUIDE");
  assert.equal(p.driverGuide.vehicle.plateNumber, "");
  assert.equal(p.driverGuide.phone.countryCode, "81");
});

test("純司機缺車牌不算缺 —— 客人跟著我方導遊走，不需要認車", () => {
  assert.deepEqual(missingForCustomer({ ...base, scenario: "純司機", phoneNumber: "90-1" }), []);
});

test("司兼導送 DRIVER＋車牌 —— 客人要認得出是哪一台車", () => {
  const p = buildScmReminder({ ...base, scenario: "司兼導", name: "張董 Chang", plateNumber: "福岡230あ509" });
  assert.equal(p.driverGuide.identity, "DRIVER");
  assert.equal(p.driverGuide.vehicle.plateNumber, "福岡230あ509");
});

test("不再送罐頭訊息（2026-08-14 改版）—— 送空字串不是 null", () => {
  const p = buildScmReminder({ ...base, scenario: "司兼導" });
  // 正式台送的就是 ""。null 有沒有被接受沒驗過，就照它送。
  assert.equal(p.otherReminder, "");
});

test("LINE 放的是加好友連結，不是 ID", () => {
  const p = buildScmReminder({ ...base, scenario: "司兼導", imType: "LINE", imAccount: LINE });
  assert.deepEqual(p.driverGuide.ims, [{ extraContactOid: null, platform: "LINE", id: LINE }]);
});

test("司兼導的 SNS 也照司兼導名單有什麼送什麼", () => {
  const p = buildScmReminder({
    ...base, scenario: "司兼導", name: "張董 Chang", plateNumber: "福岡230あ509",
    imType: "LINE", imAccount: LINE,
    contacts: [{ type: "WeChat", account: "driver-wx" }],
  });
  assert.deepEqual(p.driverGuide.ims.map((x) => x.platform), ["LINE", "WECHAT"]);
});

test("名單上沒有的軟體就不送，不硬湊", () => {
  const p = buildScmReminder({ ...base, scenario: "司兼導", imAccount: "", contacts: [] });
  assert.deepEqual(p.driverGuide.ims, []);
});

test("導遊清單上的 WeChat／WhatsApp 也要一起進 ims", () => {
  const p = buildScmReminder({
    ...base, scenario: "純司機", imType: "LINE", imAccount: LINE,
    contacts: [{ type: "WeChat", account: "guide-wx" }, { type: "WhatsApp", account: "+886900000000" }],
  });
  assert.deepEqual(p.driverGuide.ims.map((x) => x.platform), ["LINE", "WECHAT", "WHATSAPP"]);
});

test("同一個軟體重複只留一筆 —— 客人不該被要求加兩次同一個帳號", () => {
  const p = buildScmReminder({
    ...base, scenario: "純司機", imType: "LINE", imAccount: LINE,
    contacts: [{ type: "line", account: "https://line.me/ti/p/other" }, { type: "WeChat", account: "" }],
  });
  assert.deepEqual(p.driverGuide.ims, [{ extraContactOid: null, platform: "LINE", id: LINE }]);
});

test("沒有電話也組得出來（車公司只先給車號的情況）", () => {
  const p = buildScmReminder({ ...base, scenario: "司兼導", plateNumber: "品川300" });
  assert.deepEqual(p.driverGuide.phone, { countryCode: "", number: "" });
  assert.equal(p.driverGuide.vehicle.plateNumber, "品川300");
});

test("司兼導缺電話或車牌會被指出來 —— 照送但要有人去補", () => {
  assert.deepEqual(missingForCustomer({ ...base, scenario: "司兼導", plateNumber: "品川300" }), ["電話"]);
  assert.deepEqual(missingForCustomer({ ...base, scenario: "司兼導" }), ["電話", "車牌"]);
  assert.deepEqual(missingForCustomer({ ...base, scenario: "司兼導", phoneNumber: "90-1", plateNumber: "品川300" }), []);
});

test("沒有姓名就中止 —— 客人不該看到空白的司導資訊", () => {
  assert.throws(() => buildScmReminder({ ...base, scenario: "純司機", name: "  " }), /沒有姓名/);
});

test("serviceLangs 用訂單語系；固定欄位照 SCM 實際格式", () => {
  const p = buildScmReminder({ ...base, scenario: "純司機", tourLanguage: "zh-hk" });
  assert.deepEqual(p.driverGuide.serviceLangs, ["zh-hk"]);
  assert.equal("meetUp" in p, false);   // 整個 key 不送——送了 SCM 會刪集合地點再重建
  assert.equal(p.driverGuide.tourGuidePersonOid, null);
  assert.deepEqual([p.driverGuide.vehicle.color, p.driverGuide.vehicle.model], ["", ""]);
});

test("🔴 payload 一律不含 meetUp —— 2026-08-17 stage 實測的做法", () => {
  const p = buildScmReminder({ ...base, scenario: "純司機" });
  assert.equal("meetUp" in p, false);
  assert.doesNotThrow(() => assertNoMeetUp(p, base.orderMid));
  // 手滑塞回去要擋下來
  assert.throws(() => assertNoMeetUp({ ...p, meetUp: null }, base.orderMid), /不該有 meetUp/);
});

test("🔴 已經有司導資料的訂單要帶回原 oid —— 送 null 會安靜地沒生效", () => {
  const p = buildScmReminder({ ...base, scenario: "純司機", existingGuideOid: 267556 });
  assert.equal(p.driverGuide.tourGuidePersonOid, 267556);
  // 沒填過的訂單第一次寫，null 是對的
  assert.equal(buildScmReminder({ ...base, scenario: "純司機" }).driverGuide.tourGuidePersonOid, null);
});

test("pickWritable 只留訂單內容，丟掉畫面用的參考資料", () => {
  const res = {
    data: {
      preTripStatus: "COMPLETE",
      meetUp: { type: "MEETING", locations: [{ name: "集合點" }] },
      driverGuide: { identity: "DRIVER", name: "某人" },
      otherReminder: "",
      guideLangList: [1, 2, 3],     // 畫面下拉用
      telCodes: [1, 2, 3],          // 246 筆國碼
      result_code: "0000",
    },
  };
  const w = pickWritable(res);
  assert.deepEqual(Object.keys(w).sort(), ["driverGuide", "meetUp", "otherReminder", "preTripStatus"]);
  assert.equal((w.meetUp as any).type, "MEETING");
});

test("pickWritable 沒有 data 包裝也吃", () => {
  assert.deepEqual(pickWritable({ meetUp: null, telCodes: [] }), { meetUp: null });
});

