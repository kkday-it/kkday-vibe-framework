/**
 * 把「班表上的導遊」對到「大表上的車（A／B）」。
 *
 * 資料分工（各取所長，不重複要求人填兩次）：
 *   班表 = 誰今天帶哪個商品 + 姓名 + 電話（電話已經有了，最可靠）
 *   大表 = 這天這個商品有幾台車、車別碼、位空、每台車配哪位導遊
 *
 * 做法：**不從大表拆姓名**（那格常黏著別的字，例「北之旅的票葉家鳳」），
 *      改問「班表這位導遊的名字，有沒有出現在大表這一格裡」→ 含入判斷，前後黏什麼都不怕。
 */

/** 姓名正規化：去空白（含全形）、去括號註記，比對前兩邊都要過一次。 */
export function normName(s: string): string {
  return String(s ?? "").replace(/[（(].*?[）)]/g, "").replace(/[\s　]/g, "").trim();
}

export type RosterGuide = { name: string; phone: string; oid: string; carLetter: string };
export type CarSlot = { tourCode: string; carLetter: string; guideText: string };

export type GuideCarMatch = {
  guide: RosterGuide;
  tourCode: string; carLetter: string;
  via: "班表車別碼" | "大表姓名比對";
};

/**
 * 回傳每位導遊對到哪一台車；對不到的放進 unmatched（附原因），絕不亂配。
 * 優先順序：① 班表格子自己就寫了車別碼（284399A）→ 直接用，最可信
 *          ② 大表某一台車的導遊欄含這位導遊的姓名
 */
export function matchGuidesToCars(guides: RosterGuide[], cars: CarSlot[]): {
  matched: GuideCarMatch[]; unmatched: { guide: RosterGuide; reason: string }[];
} {
  const matched: GuideCarMatch[] = [];
  const unmatched: { guide: RosterGuide; reason: string }[] = [];

  for (const g of guides) {
    if (g.carLetter) {
      const c = cars.find((x) => x.carLetter.toUpperCase() === g.carLetter.toUpperCase());
      if (c) { matched.push({ guide: g, tourCode: c.tourCode, carLetter: c.carLetter, via: "班表車別碼" }); continue; }
      unmatched.push({ guide: g, reason: `班表寫 ${g.carLetter} 車，但大表這天沒有 ${g.carLetter} 車` });
      continue;
    }
    if (cars.length === 1) { // 只有一台車就不用比對
      matched.push({ guide: g, tourCode: cars[0].tourCode, carLetter: cars[0].carLetter, via: "大表姓名比對" });
      continue;
    }
    const n = normName(g.name);
    const hit = n ? cars.filter((c) => normName(c.guideText).includes(n)) : [];
    if (hit.length === 1) { matched.push({ guide: g, tourCode: hit[0].tourCode, carLetter: hit[0].carLetter, via: "大表姓名比對" }); continue; }
    unmatched.push({
      guide: g,
      reason: hit.length > 1
        ? `大表有 ${hit.length} 台車的導遊欄都寫到「${g.name}」→ 請人工指定`
        : `大表 ${cars.length} 台車的導遊欄都沒寫到「${g.name}」→ 不知道他上哪台車`,
    });
  }
  return { matched, unmatched };
}
