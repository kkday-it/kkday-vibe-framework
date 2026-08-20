/**
 * 催件那句話怎麼寫。
 *
 * 抽出來的原因是**同一件事有兩個出口**：12:00 掛在那台車後面、16:00／17:00 自成一則。
 * 寫在兩個地方時，其中一邊會慢慢跟另一邊長得不一樣，而看的人以為那是兩件事。
 *
 * 排版（Ina 2026-08-18 定案）：
 *
 *   *團號*　商品　導遊 某某          ← 一團一行，團號先
 *   *團號*　商品　導遊 某某
 *   【司兼導】車公司還沒填…　<連結>   ← 要做什麼＋跟誰要＋連結，一行
 *
 * 四條規則都是從她看樣本的回饋來的：
 *  ① **團號先、斷行**：本來全部擠成一行，最重要的「哪一團」被推到句子中間。
 *  ② **要有導遊名字**：AM 打給車公司時講的是「某某帶的那團」，不是團號。
 *  ③ **句子要短**：動作只講「要什麼」，不解釋制度。
 *  ④ **掛在車後面時不重印團號商品**——上一行剛印過。
 *  ⑤ **自成一則時同一間車公司併一行**：本來就是同一通電話、同一張表單。
 */

export type ChaseItem = {
  /** 「司兼導」或「純司機」。 */
  mode: string;
  kind: "車" | "導遊";
  /** 團號，例：`KK260819-528834A`。 */
  tourCode: string;
  /** 商品短名，例：`京都一日遊`。 */
  product: string;
  /** 誰帶這團，例：`導遊 森山明`／`司導 待車公司回報`。空字串就不印。 */
  guide: string;
  /** 要跟誰要，例：車公司名稱、「班表排的是 王小明」。 */
  tail: string;
  link?: string;
};

export type Action = { text: string; link?: string; linkText?: string };

/** 這件事要什麼（不含對象）。**只講要什麼，不解釋制度**——制度寫在尾巴的小灰字。 */
export function chaseWhat(c: ChaseItem, pass: number): string {
  return c.kind === "導遊" ? "還沒派導遊，請補派並填回大表"
    : pass === 1 ? "還沒填司機姓名／電話／車號"
    : c.mode === "司兼導" ? "還沒填司機姓名／電話／車號，17:00 要給客人"
    // 純司機且已過 16:00：系統不再寄信給導遊，問到的人要自己轉過去
    : "還沒填司機姓名／電話／車號；問到後請直接轉給導遊並填回大表";
}

export function modeTag(c: ChaseItem): string {
  return c.kind === "導遊" ? "" : `【${c.mode}】`;
}

/** 一團一行：團號先，接商品與導遊。 */
export function tourLine(c: ChaseItem): string {
  return `*${c.tourCode}*　${c.product}${c.guide ? `　${c.guide}` : ""}`;
}

/** `inline`＝掛在那台車後面（上一行已經有團號、商品、導遊了）。 */
export function chaseText(c: ChaseItem, pass: number, inline = false): string {
  const act = `${modeTag(c)}${c.tail}${chaseWhat(c, pass)}`;
  return inline ? act : `${tourLine(c)}\n${act}`;
}

/** 自成一則用：同一間車公司（同動作、同連結）併成一段，團號各自一行。 */
export function chaseActions(list: ChaseItem[], pass: number): Action[] {
  const groups = new Map<string, ChaseItem[]>();
  for (const c of list) {
    const k = `${modeTag(c)}|${chaseWhat(c, pass)}|${c.tail}|${c.link ?? ""}`;
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }
  return [...groups.values()].map((g): Action => ({
    text: [...g.map(tourLine), `${modeTag(g[0])}${g[0].tail}${chaseWhat(g[0], pass)}`].join("\n"),
    link: g[0].link,
    linkText: g[0].link ? "車公司專用表單" : undefined,
  }));
}
