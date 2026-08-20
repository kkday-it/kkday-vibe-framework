// 富邦「出團通知書」表單的精確 DOM 定位（2026-07-27 由實際頁面原始碼勘查）。
// 表單：<form name="lazyForm" id="form" action="/cas/tl/create.do?actionType=step2">
// 未來 Playwright 自動填單依此操作，欄位名稱/選項值都對齊真實頁面。

/** 表單欄位（皆以 name 定位，input[name="..."]）。 */
export const FUBON_FIELD = {
  旅行社: "agencyName", // readonly，帳號預填
  選擇其他費率按鈕: "agencyBtn",
  承辦人: "caseOwner",
  團號: "traNo", // ← 桶名（如 "0727 - 1D 500"）填這欄；頁面標籤寫「備註」，Ina 拿來當團號用，maxlength 100
  領隊導遊: "leader",
  領隊導遊證號: "leaderNo",
  旅遊團員代表人: "representMem", // 不可含橫槓（checkForm 用 regNoSymboForName 擋 "-"）
  旅遊團員人數: "totalMem",
  國家地區: "countryArea", // select，onchange 觸發 ajax 載入 travelArea
  旅遊地區: "travelArea", // select，動態載入，用可見文字「日本」選
  旅遊目的地: "travelDest", // 選 travelArea 後自動帶「日本」
  出發日: "effDate", // 民國日期，如 "115/07/28"
  出發時: "effHour", // select，"00"
  結束日: "expDate", // 民國日期；或用天數按鈕自動算
  結束時: "expHour",
  天數: "traPeriod", // input id="traPeriod"
  自動算結束日按鈕: "countBtn", // onclick autoDate()
  交通工具: "transportAry", // checkbox，遊覽車 value="4"
  死亡失能: "insAmount1", // select
  醫療費用: "insAmount2", // select
  名冊方式: "namelistType", // radio，"K"=輸入/上傳（預設），"F"=傳真
  名冊檔_民國excel: "namelistFile2", // a. .xls
  名冊檔_西元excel: "namelistFile3", // b. .xls
  名冊檔_PDF其他: "namelistFile1", // c. word/PDF/其他 ← 上傳 PDF 用這個
  手動名冊_姓名: "rosterName",
  手動名冊_國籍: "rosterCustType", // select，"1"=本國、"2"=外國
  手動名冊_身分證: "rosterIdno",
  手動名冊_生日: "rosterBirthday",
  下一步按鈕: "next", // onclick doNext()
} as const;

/**
 * 登入頁（b2b.518fb.com/ec，會自動導到 /ec/b2b_index.jsp）欄位。
 * ✅ 2026-07-27 以現場 snapshot 校正：登入頁已改版為單頁 <form name="LoginForm" action="/ec/Login.do">，
 * 不再是 frameset，也不再需要生日。送出走 onsubmit="checkout(this)"（前端把 xpassword 加密進 hidden
 * encryptedPassword 後才 POST），所以只要點登入圖示鈕讓表單自送即可，不必自行加密。
 * 欄位：公司別/工會代號 unionNum（預填 eApply1-111）→ 帳號 employNum → 密碼 xpassword（逐字鍵入）→ 驗證碼 kaptcha。
 */
export const FUBON_LOGIN = {
  網址: "https://b2b.518fb.com/",
  公司別: "unionNum", // 預填 "eApply1-111"
  帳號: "employNum",
  密碼: "xpassword", // ⚠️ 用 pressSequentially 逐字鍵入，checkout() 會讀此值加密
  驗證碼: "kaptcha", // OCR 辨識，maxlength 10
  驗證碼圖: "#kaptchaImage", // src /ec/kaptcha.jpg?<uuid>，截這張給 OCR
  換一張: "a#kaptchaChangeLink", // onclick changeKaptchaCode('/ec')，OCR 失敗時點重取
  登入按鈕: "input[type='image'][name='Image1']",
  // 送出後跳生日彈窗（2026-07 富邦新增「登入須輸入身份生日」）：填 7 碼 → 按確認登入
  生日彈窗: "#birthdayCheckModal",
  生日: "#birthdayCheckModal input#birthday", // 7 碼數字，如 0900401
  生日確認登入按鈕: "#birthdayCheckModal button[onclick*='submitBirthdayCheck']",
  // 登入後為 frameset（upper/lower）。選單在 lower frame，點下開 SSO popup。
  下框架名: "lower",
  選單_旅責險: 'td[onclick*="MenuFgisTLForm"]', // 點此 submit MenuFgisTLForm → 開新視窗 create.do?step1
  表單頁網址片段: "cas/tl/create.do", // popup 落地即出團通知書表單（含 traNo）
} as const;

/**
 * 費率選擇窗（按「選擇其他費率」agencyBtn → popQuery 開）。
 * 前置：須先填 effDate/expDate/travelArea，否則 popQuery alert 擋住不開窗。
 * popQuery 是 toggle：winOpen 非 null 會「關窗」，故點前先把 winOpen 設 null。
 * 窗網址含 actionType=agency&summit=Y（summit=N 那個是表單載入時自動開的舊窗，要略過）。
 * 窗內每列費率是 <a href="javascript:selectAgency(name,code,tyGrp,secRecord,caseOwner,tyGrpCname,insAmount1)">，
 * 點下呼叫 window.opener.selectAgency() 回填母表單。要選 tyGrpCname='法定保障_各式附加條款(新)'（T301），
 * 不可選 '來台人士_法定保障_各式附加條款(新)'（T302）。
 */
export const FUBON_RATE = {
  費率別名稱: "法定保障_各式附加條款(新)", // 用 href 中 tyGrpCname 前綴精確比對，排除「來台人士_」
  窗網址片段: "actionType=agency",
  正確窗標記: "summit=Y",
} as const;

/** select 選項的實際 value。 */
export const FUBON_OPTION = {
  // 國家地區（countryArea）
  國家地區_東北亞: "A40101",
  // 死亡失能（insAmount1）萬 → value
  死亡失能: { 250: "2500000.0", 300: "3000000.0", 400: "4000000.0", 500: "5000000.0" } as Record<number, string>,
  // 醫療費用（insAmount2）萬 → value
  醫療費用: { 10: "100000.0", 20: "200000.0" } as Record<number, string>,
  // 交通工具 checkbox value
  交通工具_遊覽車: "4",
  // 旅遊地區「日本」：動態載入，無靜態 value，須用可見文字選取
  旅遊地區_日本文字: "日本",
} as const;

/**
 * 自動填單步驟摘要（給 Playwright 實作對照，非執行碼）：
 * 0. 按「選擇其他費率」(agencyBtn) 跳窗 → 選費率「法定保障_各式附加條款(新)」
 *    （selectAgency 會設 agencyCode/tyGrp，連帶決定醫療保額選項）
 * 1. 團號(traNo) ← 桶名；代表人(representMem) ← 名單首位(刪橫槓)；人數(totalMem) ← 桶人數
 * 2. 國家地區(countryArea)=A40101(東北亞) → 等 travelArea ajax 載入 → 旅遊地區(travelArea)選「日本」→ travelDest 自動帶
 * 3. 出發日(effDate)=民國出發日、出發時=00；天數(traPeriod)=桶天數 → 按 countBtn 自動算結束日
 * 4. 勾交通工具 checkbox value=4（遊覽車）
 * 5. 死亡失能(insAmount1)=依保額、醫療費用(insAmount2)=200000.0（20萬）
 * 6. 名冊方式=K（預設）→ 名冊檔_PDF其他(namelistFile1) 上傳 PDF（用選項 c，免按上傳鈕）
 * 7. 按 下一步(next) → 複核頁直接送出（Ina：不用再勾選）
 * 注意：代表人不可含「-」；結束日不可等於出發日；天數≤30；交通工具至少勾一個。
 */
