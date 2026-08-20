/**
 * 把「客服追加備註」與「分車」疊到名單上。
 *
 * 為什麼要分開一層：buildNamelist 只認 SCM／Data Team 出的 CSV，
 * 而追加備註與車輛資訊在大表（人工維護）→ 兩邊來源不同、失敗方式也不同，
 * 混在一起會很難查是哪邊出錯。這層只做合併，不改原本任一邊的邏輯。
 */
import type { ProductGroup, NamelistRow } from "./guide-namelist.ts";
import { toTraditional } from "./guide-namelist.ts";
import type { CsNote } from "./cs-notes.ts";
import { notesByMid, companionGroups } from "./cs-notes.ts";
import type { BusBucket } from "./bus-buckets.ts";
import { PLAN_SPLIT_PRODUCTS, planOf, plansOnCar, isOddPlanLetter } from "./plan-split.ts";
import { buildParties, splitToBuses, type Party } from "./assign-buses.ts";

export type BusGroup = {
  tourCode: string; carLetter: string; capacity: number | null;
  rows: NamelistRow[]; total: number;
  /**
   * 大表導遊欄空白＝司兼導。收件人因此完全不同（Ina 2026-08-06）：
   *   純司機 → 名單寄我方導遊；司兼導 → 名單寄車公司窗口（開車的人就是帶團的人）。
   * 從 bucket 帶過來，不在這層重新判斷。
   */
  serviceMode: "司兼導" | "純司機";
  /** 大表車型欄原文，之後拿去對車公司名單 */
  busText: string;
};

export type EnrichedGroup = ProductGroup & {
  /** 分車結果；只有一台車時也會有一筆（車別碼為空）。 */
  buses: BusGroup[];
  /** 這團的同行群組：訂單編號 → 群組代號（給導遊排座位用）。 */
  companions: Map<string, string>;
  extraNoteCount: number;
};

/** 追加備註接在原備註後面，用「｜客服追加：」明確分隔，導遊才知道是後來加的。 */
export function mergeCsNotes(groups: ProductGroup[], notes: CsNote[]): { groups: ProductGroup[]; merged: number } {
  const byMid = notesByMid(notes);
  let merged = 0;
  for (const g of groups) for (const r of g.rows) {
    const extra = byMid.get(r.bookingNo.trim().toUpperCase());
    if (!extra?.text) continue;
    const t = toTraditional(extra.text);
    if (r.note.includes(t)) continue;          // 已經寫在原備註裡就不重覆
    r.note = r.note ? `${r.note}｜客服追加：${t}` : `客服追加：${t}`;
    merged++;
  }
  return { groups, merged };
}

/**
 * 分車。buckets 為空或容量抓不到時，回傳單一「未分車」群組並帶 warning，
 * 絕不自己猜——名單分錯車比名單晚出更嚴重。
 */
export function splitGroup(g: ProductGroup, buckets: BusBucket[], notes: CsNote[]): EnrichedGroup {
  const comp = companionGroups(notes);
  const paxByMid = new Map<string, number>();
  for (const r of g.rows) paxByMid.set(r.bookingNo, (paxByMid.get(r.bookingNo) ?? 0) + 1);

  const parties = buildParties(paxByMid, comp);

  // 方案分車（目前只有 528834）：團號結尾字母代表行程而不是第幾台車，
  // 買 C／D 的客人只能上帶 C 的那台。詳見 plan-split.ts。
  if (PLAN_SPLIT_PRODUCTS.has(g.productNo) && buckets.length > 1) {
    return byPlan(g, buckets, notes, comp);
  }
  // 不用車的商品（例 30651 嵐山：小火車＋遊船＋馬車，沒有巴士）本來就沒有車可分。
  // 對它喊「無法分車」是假警報，會混在真的缺漏裡讓人失去戒心（Ina 2026-08-15 指正）。
  // 只認明確的 false——欄位沒帶到時（測試 fixture、將來新欄位）預設「有車」，
  // 寧可多分一次車，也不要把該分車的團誤判成不用車而安靜不分。
  const noVehicle = buckets.length > 0 && buckets.every((b) => b.usesVehicle === false);
  const res = noVehicle
    ? { assignments: [], overflow: [], warnings: [] }
    : splitToBuses(parties, buckets);
  const warnings = [...g.warnings, ...res.warnings];

  const rowsOf = (ps: Party[]) => {
    const mids = new Set(ps.flatMap((p) => p.mids));
    return g.rows.filter((r) => mids.has(r.bookingNo));
  };

  let buses: BusGroup[];
  if (res.assignments.length === 0) {
    buses = [{
      tourCode: buckets[0]?.tourCode ?? "", carLetter: "", capacity: null, rows: g.rows, total: g.rows.length,
      serviceMode: buckets[0]?.serviceMode ?? "純司機", busText: buckets[0]?.busText ?? "",
    }];
    if (buckets.length > 1 && !noVehicle) warnings.push(`這天有 ${buckets.length} 台車但自動分車失敗 → 名單先不分，請人工分`);
  } else {
    buses = res.assignments.map((a) => {
      const rows = rowsOf(a.parties);
      const bk = buckets.find((b) => b.tourCode === a.tourCode && b.carLetter === a.carLetter);
      return {
        tourCode: a.tourCode, carLetter: a.carLetter, capacity: a.capacity, rows, total: rows.length,
        serviceMode: bk?.serviceMode ?? "純司機", busText: bk?.busText ?? "",
      };
    });
    for (const o of res.overflow) warnings.push(`訂單 ${o.mids.join("、")}（${o.size} 人）沒有車可以放`);
  }

  return { ...g, warnings: [...new Set(warnings)], buses, companions: onlyOurs(g, comp), extraNoteCount: 0 };
}


/** 只保留這團自己人的同行關係，導遊名單上才不會出現不相干的訂單編號。 */
function onlyOurs(g: ProductGroup, comp: Map<string, string>): Map<string, string> {
  const mine = new Map<string, string>();
  for (const r of g.rows) { const root = comp.get(r.bookingNo); if (root) mine.set(r.bookingNo, root); }
  return mine;
}

/**
 * 依方案把旅客放到對應的車（528834 型）。
 * 認不出方案、或某一方案沒有對應的車 → **整團不分**並講原因，不自己塞：
 * 分錯車的客人會少掉半天行程，而名單看起來完全正常。
 */
function byPlan(
  g: ProductGroup, buckets: BusBucket[], notes: CsNote[], comp: Map<string, string>,
): EnrichedGroup {
  const warnings = [...g.warnings];
  const unknown = new Set<string>();
  const planByMid = new Map<string, string>();
  for (const r of g.rows) {
    const p = planOf(r.packageName);
    if (!p) unknown.add(r.packageName || "(空白套餐名稱)");
    else planByMid.set(r.bookingNo, p);
  }

  const bail = (why: string): EnrichedGroup => ({
    ...g, extraNoteCount: 0,
    buses: [{
      tourCode: buckets[0]?.tourCode ?? "", carLetter: "", capacity: null,
      rows: g.rows, total: g.rows.length,
      serviceMode: buckets[0]?.serviceMode ?? "純司機", busText: buckets[0]?.busText ?? "",
    }],
    companions: onlyOurs(g, comp),
    warnings: [...warnings, `${why} → 名單先不分，請人工依客人買的方案分`],
  });

  if (unknown.size) return bail(`有訂單的套餐名稱看不出方案（${[...unknown].slice(0, 2).join("、")}）`);

  const buses: BusGroup[] = [];
  for (const b of buckets) {
    const want = plansOnCar(b.carLetter);
    if (!want) return bail(`團號 ${b.tourCode} 的車別碼「${b.carLetter}」看不出是哪個行程`);
    // 慣例是 C 行程標 C；標 D 一樣照 C／D 那台處理，但要講出來，否則筆誤會被默默吸收
    if (isOddPlanLetter(b.carLetter)) {
      warnings.push(`${b.tourCode} 的車別碼寫 D（慣例是 C）→ 已當成 C／D 那台處理，請確認大表是不是打錯`);
    }
    const rows = g.rows.filter((r) => want.includes(planByMid.get(r.bookingNo) ?? "＿"));
    buses.push({
      tourCode: b.tourCode, carLetter: b.carLetter, capacity: b.capacity,
      rows, total: rows.length, serviceMode: b.serviceMode, busText: b.busText,
    });
  }
  const placed = buses.reduce((n, x) => n + x.total, 0);
  if (placed !== g.rows.length) return bail(`依方案分完只放進 ${placed} 人，名單有 ${g.rows.length} 人`);
  for (const b of buses) {
    if (b.capacity != null && b.total > b.capacity) {
      warnings.push(`${b.tourCode} 有 ${b.total} 人但位空只有 ${b.capacity} → 請確認是否要加車`);
    }
  }
  warnings.push("已依方案分車：團號帶 C＝C／D 方案（採果＋午餐那條），A 團或不帶字母＝A／B 方案。兩台不可互換。");
  return { ...g, extraNoteCount: 0, buses, companions: onlyOurs(g, comp), warnings: [...new Set(warnings)] };
}
