/**
 * 把 `商品編號 商品名｜團號` 這種 label 拆回兩半——**唯一實作**。
 *
 * 🔴 **商品名本身就含「｜」**，這在這個專案是常態不是例外：
 *「155294 【含 1 人成團方案～早鳥限時特惠｜50%OFF】北海道富良野一日遊｜富田農場彩虹花田&
 *  美瑛四季彩之丘&白金青池｜札幌出發｜KK260821-155294」一共有四個。
 *
 * 原本 Slack 那則用**第一個**「｜」切，於是切在商品名中間，前後半整個對調
 *（Ina 2026-08-20 指出）。團號是最後接上去的 → 用**最後一個**。
 *
 * 為什麼要放進 lib：同一個檔案裡本來有兩套——顯示用 lastIndexOf，寫執行紀錄那行用
 * `split("｜").pop()`。同一條規則寫兩次今天已經害過三次（服務方式、電話格式、連結），
 * 所以這次直接一份，兩邊都呼叫它。
 */
export function splitLabel(label: string): { prod: string; tour: string } {
  const i = label.lastIndexOf("｜");
  if (i < 0) return { prod: label, tour: "" };
  const tail = label.slice(i + 1).trim();
  // 尾巴長得像團號才算團號。不像就整串當商品名——寧可少一行，也不要亂切。
  return /^KK\d/.test(tail) ? { prod: label.slice(0, i), tour: tail } : { prod: label, tour: "" };
}
