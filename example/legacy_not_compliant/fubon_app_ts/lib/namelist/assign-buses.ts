/**
 * 把旅客分到 A 團 / B 團。機器人先分，人再調——所以規則要「可解釋」，
 * 不能是黑箱最佳化：AM 要能一眼看出為什麼這張單被放到 B 車。
 *
 * 硬規則（絕不違反）：
 *   1. 同一張訂單的人一定同車。
 *   2. 同行單（客服備註裡互相指名的訂單）一定同車。
 * 軟規則（依序）：
 *   3. 人多的群組先放（先放大的比較不會卡死）。
 *   4. **兩台車盡量人數平均**——一日遊分 A/B 車實務上多半是均分（Ina 2026-08-06），
 *      所以放進「目前剩最多空位」的那台，而不是把一台塞滿。
 *   5. 群組大小相同時，按訂單編號排序，讓每次跑出來的結果一樣（可重現，方便對帳）。
 * 放不下的群組不硬塞 → 列進 overflow，明確告訴人要處理。
 */
import type { BusBucket } from "./bus-buckets.ts";

export type Party = { key: string; mids: string[]; size: number };
export type Assignment = { tourCode: string; carLetter: string; parties: Party[]; used: number; capacity: number | null };
export type SplitResult = { assignments: Assignment[]; overflow: Party[]; warnings: string[] };

/**
 * 把「訂單 → 人數」聚成群組，同行單併成同一群。
 * companionGroups 來自 cs-notes.companionGroups()（mid → 群組代號）。
 */
export function buildParties(paxByMid: Map<string, number>, companionGroups: Map<string, string>): Party[] {
  const byKey = new Map<string, Party>();
  for (const [mid, n] of [...paxByMid.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const key = companionGroups.get(mid) ?? mid;
    const p = byKey.get(key) ?? { key, mids: [], size: 0 };
    p.mids.push(mid); p.size += n;
    byKey.set(key, p);
  }
  return [...byKey.values()];
}

// 註：方案分車（528834、573405 那種團號字母代表行程的）已改由 enrich.byPlan 真的分開放，
// 不再需要在這裡整團拒絕。這支只處理「同行程多台車」的均分。
export function splitToBuses(parties: Party[], buckets: BusBucket[]): SplitResult {
  const warnings: string[] = [];
  if (buckets.length === 0) return { assignments: [], overflow: parties, warnings: ["大表找不到這天這個商品的團號列 → 無法分車"] };


  // 只有一台車就不用分，全部進去（也不檢查容量，超載是大表的問題不是名單的問題）
  if (buckets.length === 1) {
    const b = buckets[0];
    return { assignments: [{ tourCode: b.tourCode, carLetter: b.carLetter, parties, used: sum(parties), capacity: b.capacity }], overflow: [], warnings };
  }

  const noCap = buckets.filter((b) => b.capacity == null);
  if (noCap.length) {
    warnings.push(`這些車在大表沒寫「位空」，容量抓不到，無法自動分：${noCap.map((b) => b.tourCode).join("、")}`);
    return { assignments: [], overflow: parties, warnings };
  }

  const assignments: Assignment[] = buckets.map((b) => ({ tourCode: b.tourCode, carLetter: b.carLetter, parties: [], used: 0, capacity: b.capacity }));
  const overflow: Party[] = [];

  // 大的群組先放；同大小按 key 排 → 結果可重現
  const sorted = [...parties].sort((a, b) => b.size - a.size || a.key.localeCompare(b.key));
  for (const p of sorted) {
    // 放得下的車裡面，挑「剩最多空位」的 → 人數自然被拉平（均分）
    const fit = assignments
      .filter((a) => a.capacity! - a.used >= p.size)
      .sort((x, y) => (y.capacity! - y.used) - (x.capacity! - x.used) || x.carLetter.localeCompare(y.carLetter))[0];
    if (!fit) { overflow.push(p); continue; }
    fit.parties.push(p); fit.used += p.size;
  }

  if (overflow.length) warnings.push(`有 ${overflow.length} 組（${sum(overflow)} 人）放不進任何一台車，請人工處理`);
  const total = sum(parties), cap = assignments.reduce((s, a) => s + (a.capacity ?? 0), 0);
  if (total > cap) warnings.push(`總人數 ${total} 超過總位空 ${cap} → 大表位空可能沒更新`);
  return { assignments, overflow, warnings };
}

const sum = (ps: Party[]) => ps.reduce((s, p) => s + p.size, 0);
