/**
 * 司機／導遊電話的顯示格式——**只有一份實作**。
 *
 * 為什麼抽出來（2026-08-20）：原本這段只活在 namelist-html.ts 裡面，所以名單 PDF 上
 * 印的是 `080-9560-2157`，而信本文那行剛加上電話時印的是原始的 `08095602157`。
 * 同一封信裡同一支電話兩種寫法，看的人會懷疑哪一個才對。
 *
 * ⚠️ **只有司機與導遊的電話可以由我們補橫槓**——那確定是日本號碼。
 * 客人電話一律照原樣印：2026-08-15 一度套用日本的 3-3-4，把台灣手機 0912000000
 * 切成 091-200-0000（正確是 0912-000-000）。來源是訂單，各國分段規則不同。
 */

/** 日本號碼補橫槓；長度不符就原樣回傳（寧可不好唸，也不要切錯）。 */
export function prettyPhone(v?: string): string {
  const d = String(v ?? "").replace(/\D/g, "");
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return String(v ?? "");
}

/**
 * 「姓名（電話）」——名單信本文那行摘要用（Winnie 2026-08-20 提的需求）。
 *
 * 沒有姓名就回空字串，讓呼叫端用 `.filter(Boolean)` 濾掉。
 * 為什麼要特別處理：Portal 是有可能只填到一半的（我們的核對表就在抓「沒填司機姓名」），
 * 而「有電話沒姓名」若照拼就會印出「司機 （080-…）」——一個沒有人的括號。
 */
export function driverLabel(d: { name?: string; phone?: string }): string {
  const name = String(d.name ?? "").trim();
  if (!name) return "";
  const phone = String(d.phone ?? "").trim();
  return phone ? `${name}（${prettyPhone(phone)}）` : name;
}

/**
 * 「車號／司機」那一行——**按語言組**（Ina 2026-08-20）。
 *
 * 為什麼不能在外面組好一整串再塞進信裡（原本的做法）：那串字是中文寫死的，
 * 於是日文信裡出現「車両・運転手：車號 札幌200か1234｜司機 テスト太郎」——
 * 標籤是日文、內容是中文。收信的是日本車公司與日本導遊，那一句對他們是外文。
 * 標籤與內容必須在同一個地方、用同一種語言產生，才不會再分岔。
 */
export function vehicleLine(
  lang: "ja" | "zh",
  veh: { plate?: string; drivers?: { name?: string; phone?: string }[] },
): string {
  const L = lang === "ja"
    ? { plate: "車両番号", driver: "運転手", none: "－" }
    : { plate: "車號", driver: "司機", none: "－" };
  const names = (veh.drivers ?? []).map(driverLabel).filter(Boolean).join("、");
  return [
    `${L.plate} ${veh.plate || L.none}`,
    ...(names ? [`${L.driver} ${names}`] : []),
  ].join("｜");
}
