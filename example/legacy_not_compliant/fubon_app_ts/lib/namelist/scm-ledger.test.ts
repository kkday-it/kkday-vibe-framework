import { test } from "node:test";
import assert from "node:assert/strict";
import { decide, sameInfo, describeChange, inWatchWindow, keyOf, type DriverInfo, type ScmSentRecord } from "./scm-ledger.ts";

const info = (o: Partial<DriverInfo> = {}): DriverInfo => ({
  name: "張董", phone: "080-3908-8581", plateNumber: "福岡230あ509", imAccount: "chang-line", ...o,
});
const sent = (o: Partial<DriverInfo> = {}): ScmSentRecord => ({
  key: keyOf("2026-08-15", "KK260815-284399A"), at: "2026-08-14 17:30", info: info(o),
});

test("第一次填 → 直接回填，不等人確認（客人正在等）", () => {
  const d = decide(undefined, info());
  assert.equal(d.action, "回填");
});

test("車公司重送一模一樣的內容 → 不動作，不吵人也不重發信給客人", () => {
  assert.equal(decide(sent(), info()).action, "不動作");
});

test("換司機 → 第一次看到只先通知，不馬上寫", () => {
  const d = decide(sent(), info({ name: "李師傅", phone: "090-1111-2222" }));
  assert.equal(d.action, "先通知");
  if (d.action !== "先通知") return;
  const lines = describeChange(d.before, d.after);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /姓名：張董 → 李師傅/);
  assert.match(lines[1], /電話/);
});

test("通知滿一小時沒人喊停 → 自動寫出更正", () => {
  const after = info({ name: "李師傅" });
  const d = decide(sent(), after, { at: "2026-08-14 20:00", after }, new Date("2026-08-14T21:00:00"));
  assert.equal(d.action, "回填更正");
});

test("還沒滿一小時 → 還是只通知，給人喊停的時間", () => {
  const after = info({ name: "李師傅" });
  const d = decide(sent(), after, { at: "2026-08-14 20:00", after }, new Date("2026-08-14T20:30:00"));
  assert.equal(d.action, "先通知");
});

test("寬限期內又改一次 → 重新計時，不會寫到中間那一版", () => {
  const first = info({ name: "李師傅" });
  const d = decide(sent(), info({ name: "王師傅" }), { at: "2026-08-14 20:00", after: first }, new Date("2026-08-14T21:30:00"));
  assert.equal(d.action, "先通知");
  if (d.action !== "先通知") return;
  assert.equal(d.after.name, "王師傅");
});

test("Portal 還沒填 → 不動作，不會寫一筆空白的司導資訊給客人", () => {
  assert.equal(decide(undefined, info({ name: "  " })).action, "不動作");
});

test("只是空白與連字號的差異不算變更", () => {
  assert.ok(sameInfo(info(), info({ phone: "080 3908 8581" })));
  assert.ok(sameInfo(info(), info({ plateNumber: "福岡230あ 509" })));
  assert.ok(!sameInfo(info(), info({ plateNumber: "福岡230あ508" })));
});

test("時間窗：前一天 17:00 開始，出發當天 06:00 結束", () => {
  const dep = "2026-08-15";
  const jst = (s: string) => new Date(s + "Z");             // 這裡的時間都當 JST 算
  assert.ok(!inWatchWindow(jst("2026-08-14T16:59:00"), dep));  // 17:00 前還在原本的流程裡
  assert.ok(inWatchWindow(jst("2026-08-14T17:00:00"), dep));
  assert.ok(inWatchWindow(jst("2026-08-15T05:59:00"), dep));
  assert.ok(!inWatchWindow(jst("2026-08-15T06:01:00"), dep));  // 團要出發了，寫了客人也來不及看
});

test("團號比對不受空白與大小寫影響", () => {
  assert.equal(keyOf("2026-08-15", " kk260815-284399a "), keyOf("2026-08-15", "KK260815-284399A"));
});
