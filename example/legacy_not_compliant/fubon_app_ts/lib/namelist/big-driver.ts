/**
 * 從大表的自由文字欄讀出「車號／司機／電話」。
 *
 * 為什麼需要（Ina 2026-08-15）：Portal 上線有一段**過渡期**——車公司不一定會用 Portal 填，
 * AM 問到情報之後會直接回填大表。這段期間如果只認 Portal，核對表會把
 * 「AM 已經問到了」的團一路標成 🔴 未回報，AM 每天看到自己剛填過的東西還在紅，
 * 很快就會不信任這張表。**大表有寫就算數**（Ina 2026-08-07 已定調）。
 *
 * 格式：實測大表 72 個分頁、4492 個儲存格用這個寫法，主流是三行——
 *   車番：あ863
 *   乗務員：汪彦滕
 *   連絡先：08095602157
 * 但標籤與分隔符都不統一（人手寫的，不該逼人改）：
 *   標籤  車番／車両／車両番号 · 乗務員／氏名／ドライバー／DR／運転手 · 連絡先／電話番号／電話／TEL
 *   分隔  「：」「:」「　」(全形空白)
 *   電話  08095602157 或 080-9560-2157
 * 也有 `DR：姓名` 下一行直接放電話（沒有標籤）的變體。
 *
 * ⚠️ **認不出來就回空，絕不從無標籤的文字猜**。這一欄同時也放著純導遊姓名
 *    （實測 197 格只有一個名字）、集合地點、備註。猜錯會把地點當成司機姓名寄給客人。
 */
export type BigDriver = { plate: string; name: string; phone: string };

/** 標籤 → 欄位。都用「包含」比對，因為實際寫法有「車両番号」「電話番号」這種延伸。 */
const LABELS: { re: RegExp; key: keyof BigDriver }[] = [
  { re: /車番|車両|車輛|車号|車牌/, key: "plate" },
  { re: /乗務員|乘務員|運転手|運轉手|ドライバー|^DR$|氏名|司機/, key: "name" },
  { re: /連絡先|電話番号|電話|TEL|Tel/, key: "phone" },
];

/**
 * 出現這些字就**不是人名**。無標籤那行最常見的另外兩種東西是集合地點與備註，
 * 猜錯會把「新宿西口」當成司機姓名寄給客人（big-driver 檔頭那條規矩）。
 */
const NOT_NAME = /集合|場所|出発|待機|駐車|ホテル|バス|待ち|時間|以降|確認|未定|変更|キャンセル|駅|口$|前$|様$/;

/** 日本手機／市話：0 開頭 10~11 碼，中間可有橫槓或空白。 */
const PHONE_RE = /^0\d{1,3}[-\s]?\d{3,4}[-\s]?\d{3,4}$/;

const clean = (s: string) => String(s ?? "").replace(/[　\s]+/g, " ").trim();

/**
 * 解析一格文字。三個欄位各自獨立——只讀到司機沒讀到車號是正常的
 * （司兼導的團有時只寫人），不要因為缺一項就整格丟掉。
 */
export function parseBigDriver(cell: string): BigDriver {
  const out: BigDriver = { plate: "", name: "", phone: "" };
  const lines = String(cell ?? "").split(/[\n\r]+/);
  /** 沒有標籤、但長得像電話的行——只在「已經看到某個標籤」之後才採用（見下方說明）。 */
  let sawLabel = false;

  for (const raw of lines) {
    const line = clean(raw).replace(/^["'\s]+/, "");
    if (!line) continue;
    // 標籤與值：分隔符可能是 ：、: 或全形空白（前面已被 clean 正規化成半形空白）
    const m = /^([^：:\s]{1,8})\s*[：:]\s*(.*)$/.exec(line) ?? /^([^：:\s]{1,8})\s+(.+)$/.exec(line);
    if (m) {
      const label = m[1].trim();
      const hit = LABELS.find((l) => l.re.test(label));
      if (hit) {
        sawLabel = true;
        if (!out[hit.key]) out[hit.key] = clean(m[2]);
        continue;
      }
    }
    // 無標籤的裸電話：只有在同一格已經出現過標籤時才收
    // （純數字也可能是受付番号／駐車番号，單獨一格時無從分辨 → 不猜）
    if (sawLabel && !out.phone && PHONE_RE.test(line.replace(/\s/g, ""))) out.phone = line;
  }

  /**
   * 第二輪：標籤寫在**後面幾行**時，前面那些沒標籤的行原本全被丟掉。
   * 實測 528834C：「楊鋭（ﾖｳ ｴｲ）／080-6626-7832／車番:足立230き807」——
   * 只讀到車號，司機與電話都掉了，於是名單包判成「還沒有司機／車號」去催車公司，
   * 但體檢那邊看得到（它只問「這格有沒有東西」）。兩邊說法不一致（Ina 2026-08-17）。
   *
   * 只在**這格確實是司導格**（有出現過任何標籤）時才做，維持「不從無標籤文字亂猜」：
   *   電話 —— 長得像日本電話號碼就收，這個幾乎不會認錯
   *   姓名 —— 只收剩下**唯一一行**、且不含數字、長度像人名的那行。
   *            超過一行就放棄：那更可能是集合地點或備註，猜錯會把地點當司機寄給客人。
   */
  if (sawLabel) {
    const leftovers = lines.map((l) => clean(l).replace(/^["'\s]+/, "")).filter(Boolean)
      .filter((l) => !/^([^：:\s]{1,8})\s*[：:]/.test(l));
    if (!out.phone) {
      const ph = leftovers.find((l) => PHONE_RE.test(l.replace(/\s/g, "")));
      if (ph) out.phone = ph;
    }
    if (!out.name) {
      const cand = leftovers.filter((l) => !PHONE_RE.test(l.replace(/\s/g, "")) && !/\d/.test(l))
        // 地點與備註長得也像短短一行中日文 —— 這些字出現就不當人名，寧可留空讓人去查
        .filter((l) => !NOT_NAME.test(l));
      // 括號裡多半是片假名讀音（楊鋭（ﾖｳ ｴｲ）），姓名本身取括號前那段
      if (cand.length === 1 && cand[0].replace(/[（(].*$/, "").trim().length <= 12) {
        out.name = cand[0].trim();
      }
    }
  }

  // 電話統一去掉橫槓與空白，方便比對與撥打
  out.phone = out.phone.replace(/[-\s]/g, "");
  /**
   * 車號後面的座位數註記要拿掉（Ina 2026-08-17）：「足立230き807(正座45+8)」的
   * (正座45+8) 是座位數不是車號的一部分，印在名單上會讓人以為車號長那樣。
   * 現在的填表方式會帶進來，換成 web portal 之後就不會了。
   */
  out.plate = out.plate.replace(/[（(][^）)]*(?:正座|座席|席|名|定員|\+)[^）)]*[）)]\s*$/g, "").trim();
  // 值裡若殘留下一個標籤（例「乗務員：汪彦滕 連絡先：080…」寫在同一行）→ 切掉
  for (const k of ["plate", "name"] as const) {
    out[k] = out[k].replace(/\s*(車番|車両|車輛|乗務員|乘務員|氏名|ドライバー|DR|連絡先|電話番号|電話|TEL)\s*[：:].*$/i, "").trim();
  }
  return out;
}

/** 有任何一項就算「大表已經有情報」。 */
export function hasBigDriver(d: BigDriver): boolean {
  return Boolean(d.plate || d.name || d.phone);
}
