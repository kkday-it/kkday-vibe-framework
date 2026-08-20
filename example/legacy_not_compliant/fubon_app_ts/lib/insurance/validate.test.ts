// 執行：node --test lib/insurance/validate.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { insuranceIssue, partitionInsurable, resolveIdConflicts } from "./validate.ts";
import type { NamelistRecord } from "./classify.ts";

const base: NamelistRecord = {
  birthday: "1980-01-01",
  departureDate: "2026-07-28",
  nationCode: "TW",
  twIdNo: "A123456789",
  localLastName: "陳",
  localFirstName: "測試",
};

test("合法本國身分證(1英文+9數字)→ 可投保", () => {
  assert.equal(insuranceIssue(base), null);
});

test("少一碼身分證 → 不投保", () => {
  // 真實案例：L22265218（只有 8 碼數字）
  assert.ok(insuranceIssue({ ...base, twIdNo: "L22265218" }));
});

test("缺身分證 → 不投保", () => {
  assert.ok(insuranceIssue({ ...base, twIdNo: "" }));
});

test("非本國有護照 → 可投保；缺護照 → 不投保", () => {
  assert.equal(
    insuranceIssue({ ...base, nationCode: "JP", twIdNo: "", passportNo: "TR1234567" }),
    null
  );
  assert.ok(insuranceIssue({ ...base, nationCode: "JP", twIdNo: "", passportNo: "" }));
});

test("日期不合法 → 不投保（不崩潰）", () => {
  assert.ok(insuranceIssue({ ...base, birthday: "[merged] 2日" }));
  assert.ok(insuranceIssue({ ...base, departureDate: "" }));
});

test("同身分證不同姓名 → 全刪", () => {
  const recs: NamelistRecord[] = [
    { ...base, twIdNo: "A111111111", localLastName: "王", localFirstName: "小明" },
    { ...base, twIdNo: "A111111111", localLastName: "李", localFirstName: "大華" },
  ];
  const { kept, removed } = resolveIdConflicts(recs);
  assert.equal(kept.length, 0);
  assert.equal(removed.length, 2);
});

test("同身分證同姓名 → 去重只留一筆", () => {
  const recs: NamelistRecord[] = [
    { ...base, twIdNo: "A111111111", enLastName: "CHANG", enFirstName: "CHIA JUNG" },
    { ...base, twIdNo: "A111111111", enLastName: "Chang", enFirstName: "Chia Jung" },
  ];
  const { kept, removed } = resolveIdConflicts(recs);
  assert.equal(kept.length, 1);
  assert.equal(removed.length, 0);
});

test("不同身分證同姓名 → 都保留", () => {
  const recs: NamelistRecord[] = [
    { ...base, twIdNo: "A111111111", localLastName: "陳", localFirstName: "怡君" },
    { ...base, twIdNo: "B222222222", localLastName: "陳", localFirstName: "怡君" },
  ];
  const { kept, removed } = resolveIdConflicts(recs);
  assert.equal(kept.length, 2);
  assert.equal(removed.length, 0);
});

test("partitionInsurable：切成可投保 / 排除兩堆", () => {
  const recs: NamelistRecord[] = [
    { ...base, twIdNo: "A123456789" },
    { ...base, twIdNo: "L22265218" }, // 少一碼 → 排除
  ];
  const { insurable, excluded } = partitionInsurable(recs);
  assert.equal(insurable.length, 1);
  assert.equal(excluded.length, 1);
  assert.equal(excluded[0].record.twIdNo, "L22265218");
});

test("非法日期(13月/45日)→ 不投保", () => {
  assert.ok(insuranceIssue({ ...base, birthday: "1980-13-01" }));
  assert.ok(insuranceIssue({ ...base, departureDate: "2026-07-45" }));
  assert.ok(insuranceIssue({ ...base, departureDate: "2026-02-30" })); // 2月無30
  assert.equal(insuranceIssue({ ...base, departureDate: "2026-07-28 00:00:00" }), null); // 帶時間仍可
});

test("缺姓名(中英皆空)→ 不投保", () => {
  assert.ok(insuranceIssue({ ...base, localLastName: "", localFirstName: "", enLastName: "", enFirstName: "" }));
});

test("同證號同人：一筆中文一筆英文 → 不誤刪，去重留一", () => {
  const recs: NamelistRecord[] = [
    { ...base, twIdNo: "A111111111", localLastName: "王", localFirstName: "小明", enLastName: "", enFirstName: "" },
    { ...base, twIdNo: "A111111111", localLastName: "", localFirstName: "", enLastName: "WANG", enFirstName: "XIAOMING" },
  ];
  const { kept, removed } = resolveIdConflicts(recs);
  assert.equal(kept.length, 1);
  assert.equal(removed.length, 0);
});

test("同證號跨不同出團日 → 兩筆都保留（不同團兩張單）", () => {
  const recs: NamelistRecord[] = [
    { ...base, twIdNo: "A111111111", departureDate: "2026-07-28", localLastName: "王", localFirstName: "小明" },
    { ...base, twIdNo: "A111111111", departureDate: "2026-07-29", localLastName: "王", localFirstName: "小明" },
  ];
  const { kept, removed } = resolveIdConflicts(recs);
  assert.equal(kept.length, 2);
  assert.equal(removed.length, 0);
});
