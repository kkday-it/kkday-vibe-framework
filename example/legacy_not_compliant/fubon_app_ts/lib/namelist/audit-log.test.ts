import { test } from "node:test";
import assert from "node:assert/strict";
import { jstStamp, triggerSource, toValues, AUDIT_HEADER } from "./audit-log.ts";

test("時間用日本時區，不看本機時區", () => {
  // 2026-08-18T02:03Z ＝ 日本時間 11:03
  assert.equal(jstStamp(new Date("2026-08-18T02:03:00Z")), "08/18 11:03");
  // 跨日：UTC 8/17 23:30 已經是日本的 8/18 08:30
  assert.equal(jstStamp(new Date("2026-08-17T23:30:00Z")), "08/18 08:30");
});

test("分得出排程自己跑與有人手動按", () => {
  assert.equal(triggerSource({ JP_TRIGGER_INPUT: "cron" } as any), "cron自動");
  assert.equal(triggerSource({ JP_TRIGGER_EVENT: "workflow_dispatch", JP_TRIGGER_ACTOR: "ina" } as any), "手動(ina)");
  assert.equal(triggerSource({} as any), "本機");
});

test("欄位順序跟表頭對得起來 —— 對不上就會整欄錯位", () => {
  const v = toValues(
    { date: "2026-08-19", tourCode: "KK260819-30651", action: "寄名單", target: "導遊森山明明", result: "成功", note: "第1輪・8人", link: "https://x" },
    new Date("2026-08-18T03:03:00Z"), {} as any);
  assert.equal(v.length, AUDIT_HEADER.length);
  assert.deepEqual(v, ["08/18 12:03", "2026-08-19", "KK260819-30651", "寄名單", "導遊森山明明", "成功", "第1輪・8人", "https://x", "本機"]);
});

test("沒給的欄位是空字串，不是 undefined —— 寫進 Sheet 會變成字串 'undefined'", () => {
  const v = toValues({ date: "2026-08-19", action: "DAP刷新", result: "成功" }, new Date(), {} as any);
  assert.equal(v.filter((x) => typeof x !== "string").length, 0);
  assert.equal(v[2], "");
});
