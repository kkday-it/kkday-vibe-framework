/**
 * 車公司重填時，比對前後兩批回報，判斷「這是不是變更」。
 *
 * 為什麼由程式判斷、不讓車公司自己勾（Ina 2026-08-15）：
 * 勾選框會變成新的錯誤來源——忘記勾的最多，而系統會因為沒勾就以為是新資料；
 * 勾了卻沒改東西的也有。Portal 是 append-only，同一團重填就多一批列，
 * 前後兩批一比就知道差在哪，比人記得勾可靠。
 *
 * 變更被偵測到之後怎麼走（Ina 2026-08-15 更正，**不卡人工確認**）：
 *   tag Klo & Winnie → **下個小時照樣自動寄出／回填**
 *   他們覺得不對，要在那一小時內反應，或直接到表單裡把那筆刪掉。
 * 也就是預設往前走、有異議才攔——不是等人點頭才動。
 * 卡住等確認的代價是資訊停在系統裡，客人到現場還拿著舊的司機資訊。
 *
 * 之所以仍要通知：SCM 每次儲存都會**自動發通知給旅客**，靜靜覆蓋等於客人收到第二封
 * 通知卻沒有人知道為什麼——至少要有人知道發生過這件事。
 *
 * 只有這三項算「變更」。備註之類的差異不驚動人——那不影響客人在現場找不找得到人。
 */
export type ReportBatch = {
  /** 填寫時間（字串比較即可，格式是 yyyy-MM-dd HH:mm:ss） */
  at: string;
  plate: string;
  /** 這批回報的司機們（一台車最多兩位） */
  drivers: { name: string; phone?: string }[];
};

const norm = (s: unknown) => String(s ?? "").replace(/[\s　\-]/g, "").toUpperCase();
/** 司機比對用：姓名＋電話一起看，同名不同人（換人但同姓）才不會被漏掉。 */
const driverKey = (d: { name: string; phone?: string }) => `${norm(d.name)}/${norm(d.phone)}`;

/**
 * 回傳這次相對上一批改了什麼；沒變就回空陣列。
 * 只有一批（第一次填）也回空——那是新資料，不是變更。
 */
export function diffBatches(prev: ReportBatch | undefined, cur: ReportBatch): string[] {
  if (!prev) return [];
  const out: string[] = [];
  if (norm(prev.plate) !== norm(cur.plate)) {
    out.push(`車號 ${prev.plate || "（空白）"} → ${cur.plate || "（空白）"}`);
  }
  const a = prev.drivers.map(driverKey).sort().join("｜");
  const b = cur.drivers.map(driverKey).sort().join("｜");
  if (a !== b) {
    const show = (ds: ReportBatch["drivers"]) =>
      ds.map((d) => [d.name, d.phone].filter(Boolean).join(" ")).join("、") || "（空白）";
    out.push(`司機 ${show(prev.drivers)} → ${show(cur.drivers)}`);
  }
  return out;
}

/**
 * 把同一團的所有回報列依填寫時間分批，回傳「最新一批」與「上一批」。
 * 同一次送出會寫好幾列（一位司機一列），時間戳相同 → 同一批。
 */
export function splitBatches(
  rows: { at: string; plate: string; name: string; phone?: string }[],
): { cur?: ReportBatch; prev?: ReportBatch } {
  const byAt = new Map<string, ReportBatch>();
  for (const r of rows) {
    if (!byAt.has(r.at)) byAt.set(r.at, { at: r.at, plate: r.plate, drivers: [] });
    if (r.name) byAt.get(r.at)!.drivers.push({ name: r.name, phone: r.phone });
  }
  const sorted = [...byAt.values()].sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0));
  return { cur: sorted[0], prev: sorted[1] };
}
