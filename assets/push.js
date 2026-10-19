// 手機提醒的開關。
//
// 整件事分成兩半:這裡只負責「跟瀏覽器要權限、把這台裝置登記起來」,
// 真正在早上把通知送出去的是 GitHub Actions(tools/send-reminders.mjs)。
// 網頁關著的時候沒有任何 JavaScript 在跑,所以一定要有雲端那一半。
//
// ⚠️ iPhone 的限制:iOS 的網頁推播只有在「加到主畫面」之後才會動。
// 用 Safari 開網頁、加書籤都收不到。所以這裡會先檢查,
// 檢查不過就直接把原因講出來,不要讓老師按了按鈕卻什麼都沒發生。

import { APP_BUILD, VAPID_PUBLIC_KEY } from "./config.js";

/** base64url → Uint8Array(PushManager 只吃後者) */
function urlBase64ToUint8Array(base64) {
  const padded = (base64 + "=".repeat((4 - base64.length % 4) % 4))
    .replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/**
 * 這台裝置有沒有可能收到推播。回傳 { ok, why } ——
 * why 是要直接講給老師看的話,不是給工程師看的錯誤碼。
 */
export function pushSupport() {
  if (!("serviceWorker" in navigator)) return { ok: false, why: "這個瀏覽器不支援,換 Chrome 或 Safari 試試。" };
  if (!("PushManager" in window)) {
    // iOS 沒加到主畫面時,PushManager 就是不存在 —— 這是最常見的狀況
    const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
      || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    return {
      ok: false,
      why: iOS
        ? "iPhone / iPad 要先把這個網站「加到主畫面」,從主畫面的圖示打開才收得到通知。"
        : "這個瀏覽器不支援網頁通知。"
    };
  }
  if (!VAPID_PUBLIC_KEY) return { ok: false, why: "系統還沒設定推播金鑰,請管理員看 README 的〈手機提醒〉。" };
  if (Notification.permission === "denied") {
    return { ok: false, why: "通知被瀏覽器擋住了。要到瀏覽器或系統設定裡把這個網站的通知打開。" };
  }
  return { ok: true, why: "" };
}

/** 這台裝置目前有沒有訂閱 */
export async function currentSubscription() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

/**
 * 打開提醒。一定要從使用者的點擊裡呼叫 ——
 * 瀏覽器不接受自己跳出來要權限的網頁。
 * 回傳訂閱物件(要存進 Firestore 的那包),失敗就丟 Error。
 */
export async function enablePush() {
  const s = pushSupport();
  if (!s.ok) throw new Error(s.why);

  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("你剛剛選了不允許。要改的話得到瀏覽器設定裡開。");

  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    // 一定要 true:只送得出「有訊息」卻不顯示通知的推播是不被允許的
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
  });
  return toRecord(sub);
}

/** 關掉提醒。回傳被退訂的 endpoint,好讓呼叫端去資料庫刪掉那一筆 */
export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return "";
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  return endpoint;
}

/** 訂閱物件 → 要存進 Firestore 的欄位 */
export function toRecord(sub) {
  const j = sub.toJSON();
  return {
    endpoint: j.endpoint,
    p256dh: j.keys?.p256dh || "",
    auth: j.keys?.auth || "",
    // 存下來只為了出問題時看得出是哪一台裝置、哪一版訂的
    ua: (navigator.userAgent || "").slice(0, 180),
    build: APP_BUILD
  };
}

/**
 * Firestore 的文件 ID 不能有 "/",而 endpoint 是一串網址。
 * 用它算一個短而穩定的 ID:同一台裝置重複訂閱會蓋掉同一筆,不會愈積愈多。
 */
export async function endpointId(endpoint) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return [...new Uint8Array(buf)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}
