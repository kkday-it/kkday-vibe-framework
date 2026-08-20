// 執行：node --test lib/insurance/fubon-export.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyNamelist, type NamelistRecord } from "./classify.ts";
import {
  exportBucket,
  fubonGroupNo,
  medicalWan,
  rosterToCsv,
  bucketToRoster,
} from "./fubon-export.ts";

const SAMPLE: NamelistRecord[] = [
  { birthday: "1982-09-30", departureDate: "2026-07-28", prodTourDay: "0 Day 4 Hour", localLastName: "李", localFirstName: "日佑", twIdNo: "H122675803", nationCode: "TW" }, // 500
  { birthday: "2022-06-19", departureDate: "2026-07-28", prodTourDay: "0 Day 4 Hour", localLastName: "何", localFirstName: "昕宸", twIdNo: "A133910325", nationCode: "TW" }, // 250
];

test("medicalWan：一律 20 萬", () => {
  assert.equal(medicalWan(250), 20);
  assert.equal(medicalWan(500), 20);
});

test("fubonGroupNo：MMDD - {天數}D {保額}", () => {
  const buckets = classifyNamelist(SAMPLE);
  const b500 = buckets.find((b) => b.coverageWan === 500)!;
  assert.equal(fubonGroupNo(b500), "0728 - 1D 500");
});

test("bucketToRoster：欄位與出生日期 YYYYMMDD", () => {
  const buckets = classifyNamelist(SAMPLE);
  const b250 = buckets.find((b) => b.coverageWan === 250)!;
  const rows = bucketToRoster(b250);
  assert.deepEqual(rows[0], {
    姓名: "何昕宸",
    國籍: "本國",
    身分證字號: "A133910325",
    出生日期: "20220619",
  });
});

test("rosterToCsv：含 BOM、標頭正確", () => {
  const buckets = classifyNamelist(SAMPLE);
  const csv = rosterToCsv(bucketToRoster(buckets[0]));
  assert.ok(csv.startsWith("﻿姓名,國籍,身分證字號,出生日期"));
});

test("exportBucket：摘要欄位齊全", () => {
  const buckets = classifyNamelist(SAMPLE);
  const e = exportBucket(buckets.find((b) => b.coverageWan === 500)!);
  assert.equal(e.coverageWan, 500);
  assert.equal(e.medicalWan, 20);
  assert.equal(e.headCount, 1);
  assert.equal(e.leadName, "李日佑");
});

test("旅遊團員代表人：取第一人並刪掉名字橫槓", () => {
  const recs: NamelistRecord[] = [
    { birthday: "1972-04-05", departureDate: "2026-07-02", prodTourDay: "0 Day 4 Hour", enLastName: "WANG", enFirstName: "MING-JEN", twIdNo: "A120832821", nationCode: "TW" },
    { birthday: "1975-01-01", departureDate: "2026-07-02", prodTourDay: "0 Day 4 Hour", enLastName: "KUO", enFirstName: "HSUEH-E", twIdNo: "P222194793", nationCode: "TW" },
  ];
  const e = exportBucket(classifyNamelist(recs)[0]);
  assert.equal(e.leadName, "WANG MINGJEN"); // 橫槓刪掉、空格保留
});
