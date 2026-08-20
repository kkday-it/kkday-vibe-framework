/**
 * Slack 訊息的排版規則。
 *
 * 讀的人是 **Klo／Winnie／Demi**，在手機上、在做別的事、一天收好幾則。
 * 他們要的答案只有兩個：**「有沒有我要做的事？」**「要做的話，點哪裡？」
 *
 * 形狀（Ina 2026-08-18 第三版定案）：
 *
 *   標題行     **類型圖示** ＋ 哪一天 ＋ 這則是什麼
 *   測試提示   只在測試期間出現
 *   要看的人   單獨一行
 *   一句話     幾團（拆車的話加上幾台車）、幾件要處理
 *   明細       每台車兩行，行首 🔴／✅
 *   待處理     一件一行，動詞開頭，連結接在同一行末尾
 *   連結       一行一條，**用途本身就是連結**
 *
 * 四個刻意的規則，都是從踩過的坑來的：
 *  ① **圖示只用在兩個地方：標題的類型、每台車的紅綠。** 其餘一律純文字。
 *     這是兩次修正之後的落點——先前滿版圖示「焦點很亂」，全部拿掉又變成
 *     「一大塊字、沒有視覺錨點、分不出哪一則是什麼」（Ina 2026-08-18）。
 *     所以圖示只回答兩個問題：**這是哪一則**、**哪一台要動手**。
 *     狀態本身仍然是文字（「待補」「不需用車」），不靠記憶圖示的意思。
 *  ② **正常的東西不要展開解釋。** 表格裡佔一列就好，解釋留給待處理那段。
 *  ③ **連結跟它的用途放在同一行**，而且用途本身就是可點的字。
 *     分成兩行的話手機上要捲、要對照，團一多整段就變兩倍長。
 *  ④ **沒事就要明講「沒事」。** 不能只是不發——收不到訊息跟「機器人壞了」
 *     長得一模一樣，而人會預設是後者，然後跑來問。
 *
 * ⚠️ Slack mrkdwn：粗體是單一個 `*`，連結是 `<url|文字>`。
 *    **不要用程式碼區塊**：連結會失效，而且手機上會換行（見 detail）。
 */

/** 要人動手的一件事。`link` 會接在同一行末尾。 */
export type Action = { text: string; link?: string; linkText?: string };

/** 明細的一台車。`alert` 決定要不要標「要處理」。 */
export type BusRow = {
  code: string;
  product: string;
  pax: number;
  /** 帶團的人（導遊或司兼導）。 */
  crew: string;
  /** 司機與車號的狀態：「司機待補」「品川300あ12-34 山田太郎」「不需用車」… */
  status: string;
  alert?: boolean;
  /**
   * 這台車要人做的事。**接在這台車後面**，不另外開一個區塊
   *（Ina 2026-08-18：「可以直接放在那團後面，不用額外再新增一個區塊」）。
   * 分成上下兩塊的話，同一個團號會出現兩次，看的人得自己把兩邊湊起來。
   */
  todo?: Action;
  /**
   * 這台車寄出去的那封信（Gmail 永久連結）。
   * 名單 PDF 回答「內容是什麼」，這條回答「到底寄了沒、寄給誰」——是兩個問題
   *（Ina 2026-08-18：FNL 那則做得到，名單這邊也要）。
   */
  mailUrl?: string;
  /** 「純司機」或「司兼導」——齊備的團也要看得出來（Ina 2026-08-18）。 */
  mode?: string;
  /** 車公司名稱。齊備的那行也要有，AM 要知道這團是誰的車。 */
  company?: string;
};

/** 這一則是什麼類型 —— 決定標題那個圖示。滑過去要分得出哪則是哪則。 */
export const KIND = {
  名單: "📋", 催件: "⏰",
  // SCM＝客人在 App／憑證上看到司導是誰 → 用手機而不是車（Ina 2026-08-18 要求換掉 🚗）
  SCM: "📲",
  // 體檢＝出團前把該有的東西找一遍 → 放大鏡（原本的 🩺 像在講健康）
  體檢: "🔍",
  警報: "🚨",
} as const;
export type Kind = keyof typeof KIND;

export type SlackBrief = {
  /** 這一則是什麼（決定標題圖示）。 */
  kind?: Kind;
  /** 要 tag 的人（已經是 `<@U…>` 形式）。 */
  who?: string;
  /** 這則在講哪一天的團。 */
  date: string;
  /** 一句話：這則是什麼。例：「12:00 名單已產出」 */
  headline: string;
  /** 每台車一列。 */
  rows?: BusRow[];
  /**
   * 今天有幾**團**。看的人想的單位是團不是車（Ina 2026-08-18）——
   * 「2 台車」可能是兩團各一台，也可能是同一團拆兩台，工作量差很多。
   * 團數等於車數時只講團數，多出來的車才另外點出來。
   */
  tours?: number;
  /** 要人動手的事。空陣列＝都正常。 */
  actions?: Action[];
  /** 底部連結。label 本身會變成可點的字。 */
  links?: { label: string; url: string }[];
  /** 尾巴的補充說明，最多一兩句。 */
  notes?: string[];
  /**
   * 正文段落（不是待辦、也不是小灰字）。給 FNL 那種「這則本身就是一份報告」的訊息用。
   */
  body?: string[];
  /** 測試期間的標記。 */
  /**
   * 測試期間的橫幅。`true` ＝標準那句（信不寄＋SCM 只寫測試台）；
   * 給字串 ＝只講這一則相關的那部分。
   *
   * 為什麼要能換掉（Ina 2026-08-20）：本機那支 SCM 通知講的只有 SCM，
   * 標準那句還提「不寄信給導遊」，跟這則無關，看的人得自己過濾。
   */
  testing?: boolean | string;
};

/**
 * 每台車兩行的明細。
 *
 * 🔴 **不要用等寬表格**（Ina 2026-08-18）。程式碼區塊在手機上會換行或橫向捲動，
 * 欄位一歪，對齊帶來的好處全部消失，而且比原本更難讀——那個排版只在桌機成立。
 * Slack 官方對這件事的建議也是一樣：複雜的表格改放連結或 canvas，
 * 訊息本體用會自然斷行的純文字。
 *
 * 所以改成**每台車兩行**：第一行「是哪一團」、第二行「誰帶、車況」。
 * 每一行都短到手機一行放得下；真的放不下時斷行也還讀得懂，因為欄位有名字，
 * 不是靠位置對齊。
 *
 * 要處理的那台在第二行結尾標「← 要處理」——放行尾而不是行首，是因為
 * 掃的時候眼睛沿著左邊走，標記在左邊會跟團號搶第一眼。
 */
export function detail(rows: BusRow[]): string[] {
  return rows.flatMap((r, i) => [
    ...(i ? [""] : []),
    `${r.alert ? "🔴" : "✅"} *${r.code}*　${r.product}　${r.pax} 人`,
    `　${[r.crew, r.status].filter(Boolean).join("・")}${r.mailUrl ? `　<${r.mailUrl}|寄出的信>` : ""}`,
    ...(r.todo ? [`　⏰ ${r.todo.text}${r.todo.link ? `　<${r.todo.link}|${r.todo.linkText ?? "開啟"}>` : ""}`] : []),
  ]);
}

export function brief(b: SlackBrief): string {
  const acts = b.actions ?? [];
  const rows = b.rows ?? [];
  /**
   * 這一句同時回答兩件事：**今天整體多大**（幾團）與**要不要動手**（幾件）。
   * 只講待辦的話，看的人不知道那是四團裡的一件還是一團裡的一件——
   * 兩者的心情完全不同，而那個分母只有這裡看得到。
   */
  const scale = b.tours
    ? `${b.tours} 團${rows.length > b.tours ? `、${rows.length} 台車` : ""}`
    : rows.length ? `${rows.length} 台車` : "";
  // 待辦有兩種：掛在某台車上的（跟著那台車印）與沒有對象的（下面自成一段）。
  // 摘要那句要把兩種都算進去，不然分母會少。
  const rowTodos = rows.filter((r) => r.todo).length;
  const todoCount = rowTodos + acts.length;
  const state = todoCount ? `🔴 ${todoCount} 件待處理` : "✅ 全部齊備，不需動作";
  return [
    `${b.kind ? KIND[b.kind] + " " : ""}*${b.date} 出團｜${b.headline}*`,
    /**
     * 測試期間要講的是**「你今天照舊怎麼做」**，不是只講系統做了什麼
     *（Ina 2026-08-18）。只寫「不會收到信」的話，看的人不知道 SCM 那邊
     * 也還是空的，會以為客人端已經有司導了。
     */
    ...(b.testing
      ? [`目前還在測試期間：${typeof b.testing === "string"
          ? b.testing
          : "導遊與車公司*都還不會收到信*，SCM 只寫*測試台*、*不動正式台*"} → 請照舊填回 KGRP`]
      : []),
    ...(b.who ? [b.who] : []),
    "",
    [scale, state].filter(Boolean).join("，"),
    ...(rows.length ? ["", ...detail(rows)] : []),
    ...(acts.length
      /**
       * **一件一行，連結接在同一行末尾**（Ina 2026-08-18）。
       * 原本拆成兩行是想讓動作那行短一點，但團一多就變兩倍長——
       * 而待辦正是最需要一眼掃完的那一段。
       */
      ? ["", "*待處理*", ...acts.map((a) => `⏰ ${a.text}${a.link ? `　<${a.link}|${a.linkText ?? "開啟"}>` : ""}`)]
      : []),
    ...(b.notes?.length ? ["", ...b.notes] : []),
    // 用途本身就是連結 —— 後面再掛一個「開啟」是同一件事講兩次（Ina 2026-08-18）
    ...(b.links?.length ? ["", "*連結*", ...b.links.map((l) => `<${l.url}|${l.label}>`)] : []),
  ].join("\n");
}

/**
 * ─────────────────────────────────────────────────────────────
 * Block Kit 版（Ina 2026-08-18 選的方向 A：「只講要做的事」）
 * ─────────────────────────────────────────────────────────────
 *
 * 純文字版的問題不是字寫得不好，是**每台車佔的版面一樣大**：
 * 齊備的那台跟要動手的那台各兩行、各一個圖示，所以只能一字一句看完
 * 才知道哪台要做事，而 ✅ 每天出現在大多數行上，變成噪音（Ina：「打勾出現的很突兀」）。
 *
 * 改法是把版面**按重要性分配**，這也是 Slack 官方對通知類訊息的建議
 *（header 立即辨識、section 放內容與按鈕、context 放小灰字的次要資訊、divider 分段）：
 *
 *   header    大字：哪一天、這則是什麼            ← 不用 emoji，字本身夠大
 *   section   一句：幾件要處理（＋要 tag 的人）
 *   divider
 *   section   **只有要動手的車**，一台一段，右邊掛按鈕直接開表單
 *   divider
 *   context   齊備的團收合成一行小灰字（連結還在，點得到寄出的信）
 *   context   測試期說明、底部連結
 *
 * 齊備的東西**不佔正文版面**——它要回答的是「有沒有漏掉哪一團」，
 * 掃一眼確認團數就夠，不需要逐台讀。
 *
 * ⚠️ webhook 也吃 blocks，不用等 bot token。`text` 仍要帶（通知列與舊版 client 用）。
 */
type Block = Record<string, unknown>;

/**
 * Slack 的硬限制。**超過就整則 400，沒有人會收到任何東西**——
 * 而「沒收到」跟「今天沒事」長得一模一樣，所以寧可自己先截斷。
 * 官方數字：一則最多 50 個 block、section 文字 3000 字、header 純文字 150 字。
 */
const MAX_BLOCKS = 48;      // 留 2 個給截斷說明與尾巴
const MAX_TEXT = 2900;
const MAX_HEADER = 140;

const clip = (t: string, n = MAX_TEXT) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

/**
 * 按鈕的 url **一定要是真的網址**。大表／設定裡撈出來的可能是一句話
 *（「查不到專屬連結」、公式殘留），送出去 Slack 會回 invalid_blocks，整則發不出去。
 */
const isUrl = (u?: string): u is string => !!u && /^https?:\/\//.test(u.trim());

const mrkdwn = (text: string): Block => ({ type: "section", text: { type: "mrkdwn", text: clip(text) } });
const ctx = (text: string): Block => ({ type: "context", elements: [{ type: "mrkdwn", text: clip(text) }] });

/** header 只吃純文字，且不能 tag 人 —— 日期壓成 8/19 這種短寫法，留位子給標題。 */
function headerText(b: SlackBrief): string {
  const md = b.date.length >= 10 ? `${Number(b.date.slice(5, 7))}/${Number(b.date.slice(8, 10))}` : b.date;
  return clip(`${md} 出團・${b.headline}`, MAX_HEADER);
}

export function blocksOf(b: SlackBrief): Block[] {
  const rows = b.rows ?? [];
  const acts = b.actions ?? [];
  const bad = rows.filter((r) => r.alert || r.todo);
  const ok = rows.filter((r) => !(r.alert || r.todo));
  const todoCount = bad.length + acts.length;

  const out: Block[] = [
    /**
     * 測試期提示**放在最上面**（Ina 2026-08-18：「這樣才不會嚇到大家」）。
     *
     * 放在尾巴的話，讀的人是先看到「導遊已寄出」「SCM 已寫入」才在最後發現
     * 那些其實都沒發生——順序反了。它是**閱讀這則的前提**，不是補充說明。
     * 用小灰字放在標題之上：先看到、但不搶標題的位子。
     */
    /**
     * 測試期間的抬頭要**照實講**（Ina 2026-08-20）。
     * 原本寫「也不回填 SCM」——17:00 那批其實有回填，寫進測試台。結論（客人什麼都收不到、
     * AM 照舊填 KGRP）是對的，但字面跟實際做的事不一樣，而 AM 本來就知道有測試台。
     * 訊息說的話跟系統做的事對不起來時，下次沒有人會相信訊息。
     */
    ...(b.testing
      ? [ctx(`🧪 *測試期間*　${typeof b.testing === "string"
          ? b.testing
          : "系統不寄信給導遊與車公司、SCM 只寫測試台不動正式台"}　→　請照舊填回 KGRP`)]
      : []),
    { type: "header", text: { type: "plain_text", text: headerText(b), emoji: true } },
    // 要 tag 的人自己一行：跟「幾件要處理」擠在一起時，那句話會被一串人名推到看不見
    mrkdwn([
      [
        `*${todoCount ? `${todoCount} 件要處理` : "全部齊備，不需動作"}*`,
        b.tours ? `${b.tours} 團${rows.length > b.tours ? `、${rows.length} 台車` : ""}` : "",
      ].filter(Boolean).join("　"),
      b.who ?? "",
    ].filter(Boolean).join("\n")),
  ];

  // 正文段落（FNL 那種本身就是一份報告的訊息）
  if (b.body?.length) { out.push({ type: "divider" }); for (const t of b.body) out.push(mrkdwn(t)); }

  if (bad.length || acts.length) out.push({ type: "divider" });

  /**
   * 連結一律做成**文字連結**，不用按鈕（Ina 2026-08-18：「AM 沒辦法直接右鍵複製連結吧？」）。
   *
   * 按鈕好看，但 Slack 的 button 只能點、**複製不到網址**——而 AM 對車公司專用表單
   * 做的第一件事就是「把連結轉給對方」。工具長得像可以用，實際上做不到要做的事，
   * 比醜還糟。文字連結可以點、可以右鍵複製、可以直接轉貼。
   */
  const linked = (text: string, a?: Action) =>
    `${text}${isUrl(a?.link) ? `　<${a!.link}|${a!.linkText ?? "開啟"}>` : ""}`;

  // 要動手的車：一台一段，做什麼寫在裡面
  for (const r of bad) {
    out.push(mrkdwn([
      // 人數是 0 多半是「還沒抓到」而不是真的沒人 → 不印，別讓人以為這團沒人報名
      `*${r.code}*　${r.product}${r.pax ? `　${r.pax} 人` : ""}`,
      // 寄出的信不分「這台有沒有問題」都要掛（Ina 2026-08-18）——
      // 要催的那台反而更常被問「所以信到底寄了沒、寄給誰」
      // 車公司也要寫在這一行（Ina 2026-08-19）——要打電話催的就是它，
      // 而原本只有「齊備」那段看得到公司名，**該催的那台反而看不到要催誰**
      `${[r.crew, r.status, r.company].filter(Boolean).join("・")}${r.mailUrl ? `　<${r.mailUrl}|寄出的信>` : ""}`,
      ...(r.todo ? [linked(r.todo.text, r.todo)] : []),
    ].join("\n")));
  }
  // 對不到任何一台車的待辦（例如大表還沒配車）
  for (const a of acts) out.push(mrkdwn(linked(a.text, a)));

  if (ok.length) {
    out.push({ type: "divider" });
    // 齊備的收合成一行：要回答的是「有沒有漏掉哪一團」，不需要逐台讀
    // 一個商品一行（Ina 2026-08-18）：擠成一長串時中間的團號會被吃掉，掃不出漏了誰
    // 沒有要動手的車時不能寫「其他」——沒有「其他」的對照組（Ina 2026-08-18）
    // 齊備的也要看得到誰帶團、純司機還是司兼導、哪一家車公司（Ina 2026-08-18）——
    // 「沒事」不等於「不用知道」：AM 隔天接電話時要認得出這一團是誰的
    out.push(ctx([`${bad.length || acts.length ? "其他 " : ""}${ok.length} 團齊備`, ...ok.flatMap((r) => [
      `${r.code}　${r.product}${r.pax ? `　${r.pax} 人` : ""}${r.mailUrl ? `　<${r.mailUrl}|寄出的信>` : ""}`,
      // 順序＝「這團怎麼跑的」：什麼模式 → 誰帶 → 車況 → 哪家車公司。
      // 分隔符全部用「・」，不要跟全形空白混用——混用會讀成不同層級的分組（Ina 2026-08-18）
      `　${[r.mode, r.crew, r.status, r.company].filter(Boolean).join("・")}`,
    ])].join("\n")));
  }

  const tail = [
    ...(b.notes ?? []),
    // 連結排成一行就好（Ina 2026-08-18）——它們是同一類東西，斷行反而變成四個區塊
    ...(b.links?.length ? [b.links.map((l) => `<${l.url}|${l.label}>`).join("　·　")] : []),
  ];
  for (const t of tail) out.push(ctx(t));

  /**
   * 50 個 block 是硬上限，超過就整則 400、一個字都送不出去。
   * 截的是**中間的明細**：標題那兩塊（今天有幾件要處理）與尾巴（測試期說明、連結）
   * 是不能掉的，掉了看的人會不知道自己現在在看什麼。
   */
  if (out.length > MAX_BLOCKS) {
    const keepTail = tail.length + 1;                       // 尾巴 + 一行截斷說明的位子
    const headLen = (b.testing ? 1 : 0) + 2;                // 測試提示（如果有）＋標題＋摘要
    const head = out.slice(0, headLen);
    const body = out.slice(headLen, out.length - tail.length);
    const rest = out.slice(out.length - tail.length);
    const room = MAX_BLOCKS - head.length - keepTail;
    const dropped = body.length - room;
    return [...head, ...body.slice(0, room),
      ctx(`⚠️ 這則太長，省略了 ${dropped} 段明細 → 完整內容看執行紀錄`), ...rest];
  }
  return out;
}
