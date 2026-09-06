// 測試用的瀏覽器啟動器。
//
// 為什麼要有這個檔案:這個系統的 bug 幾乎都是「看起來對、量起來錯」——
// 白字配白底、圓點沒對準線、手機換行時線壓到字。這些用讀 CSS 看不出來,
// 一定要真的開瀏覽器量。
//
// 用法:
//   npx http-server -p 8791 -c-1        # 在專案根目錄開一個靜態伺服器
//   node test/check.mjs                 # 另一個視窗跑檢查
//
// 靠 ?demo=1 預覽模式灌假資料,所以不需要 Firebase 帳號,
// 也不會碰到任何真實資料。

// playwright 可能裝在專案裡,也可能是全域安裝(ESM 不吃 NODE_PATH,要自己找)。
// 想指定路徑就設環境變數 PLAYWRIGHT,例如
//   PLAYWRIGHT=/usr/lib/node_modules/playwright/index.js node test/check.mjs
const 候選 = [
  process.env.PLAYWRIGHT,
  "playwright",
  "/usr/lib/node_modules/playwright/index.js",
  "/usr/local/lib/node_modules/playwright/index.js",
  "/opt/node22/lib/node_modules/playwright/index.js"
].filter(Boolean);

let chromium;
for (const 路徑 of 候選) {
  try { ({ chromium } = (await import(路徑)).default ?? await import(路徑)); break; } catch { /* 換下一個 */ }
}
if (!chromium) {
  console.error("找不到 playwright。請先 npm i -D playwright,或設環境變數 PLAYWRIGHT 指到它的 index.js。");
  process.exit(2);
}

export const BASE = process.env.BASE || "http://127.0.0.1:8791";

// Firebase SDK 從 Google CDN 載入,測試環境不一定連得出去,
// 也不該讓測試依賴外網。預覽模式本來就不呼叫這些東西,import 得到就好。
const STUB = {
  "firebase-app.js": "export const initializeApp = () => ({});",
  "firebase-auth.js": `
    export const getAuth = () => ({});
    export class GoogleAuthProvider { setCustomParameters() {} }
    export const signInWithPopup = async () => ({});
    export const signOut = async () => {};
    export const onAuthStateChanged = () => () => {};`,
  "firebase-firestore.js": `
    export const getFirestore = () => ({});
    export const collection = () => ({});
    export const doc = () => ({});
    export const getDoc = async () => ({ exists: () => false });
    export const setDoc = async () => {};
    export const addDoc = async () => ({});
    export const updateDoc = async () => {};
    export const deleteDoc = async () => {};
    export const onSnapshot = () => () => {};
    export const query = () => ({});
    export const where = () => ({});
    export const serverTimestamp = () => new Date();`
};

/** 開一個已經載入預覽資料的頁面。回傳 { b, p, errs },用完請 b.close()。 */
export async function open(opts = {}) {
  const b = await chromium.launch();
  const p = await b.newPage({
    viewport: opts.viewport || { width: 1280, height: 1100 },
    colorScheme: opts.scheme || "light"
  });

  // 主控台的錯誤一律收集起來 —— 畫面看起來正常但主控台在噴錯是常態
  const errs = [];
  p.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 200)); });
  p.on("pageerror", (e) => errs.push("PAGEERROR " + String(e).slice(0, 300)));

  await p.route("**/firebasejs/**", (r) => {
    const name = r.request().url().split("/").pop();
    r.fulfill({ status: 200, contentType: "text/javascript", body: STUB[name] || "export {};" });
  });
  // 字型也不要依賴外網,量幾何時字型換掉沒關係
  await p.route("**/fonts.googleapis.com/**", (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
  await p.route("**/fonts.gstatic.com/**", (r) => r.abort());

  await p.goto(`${BASE}/index.html?demo=1`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await p.waitForTimeout(1500);
  return { b, p, errs };
}
