#!/usr/bin/env node
// 每天早上把提醒推到老師手機上。由 .github/workflows/reminders.yml 排程執行。
//
// 為什麼要在雲端跑:網頁關著的時候瀏覽器裡沒有任何程式在動,
// 一定要有一個「人不在也會動」的地方去看今天有什麼事、然後把通知送出去。
//
// 要兩把鑰匙(都放在 GitHub Secrets,見 README〈手機提醒〉):
//   FIREBASE_SERVICE_ACCOUNT  讀 Firestore 用。⚠️ 這把鑰匙繞過所有安全規則,
//                             所以「誰看得到什麼」在這支程式裡要自己守住。
//   VAPID_PRIVATE_KEY         推播的寄件人身分,和 assets/push.js 的公鑰成對。
//
// 試跑不送出:DRY_RUN=1 node tools/send-reminders.mjs

import { readFileSync } from "node:fs";

import { todayStr } from "../assets/core.js";
import { planDeliveries, previewAll, vapidSubject } from "./deliveries.mjs";

// 送出的部分才需要這兩個套件(npm install 之後才有)
const { initializeApp, cert } = await import("firebase-admin/app");
const { getFirestore } = await import("firebase-admin/firestore");
const webpush = (await import("web-push")).default;

const DRY = process.env.DRY_RUN === "1";
// 測試模式:不管今天有沒有事,都送一則固定內容給所有已登記的裝置。
// 用途是把「推播這條路通不通」和「今天有沒有事」分開來看 ——
// 剛設定好的時候通常今天剛好沒事,不這樣做根本驗不出來。
const TEST = process.env.TEST_PUSH === "1";
const TODAY = process.env.TODAY || todayStr();

function env(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`缺少 ${name}。請到 GitHub → Settings → Secrets and variables → Actions 設定。`);
    process.exit(1);
  }
  return v;
}

const serviceAccount = JSON.parse(
  process.env.FIREBASE_SERVICE_ACCOUNT?.trim().startsWith("{")
    ? process.env.FIREBASE_SERVICE_ACCOUNT
    : readFileSync(env("FIREBASE_SERVICE_ACCOUNT"), "utf8")
);

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const 全部 = async (name) =>
  (await db.collection(name).get()).docs.map((d) => ({ id: d.id, ...d.data() }));

async function main() {
  const [allowlist, plans, notes, subs] = await Promise.all(
    ["allowlist", "plans", "notes", "pushSubs"].map(全部));

  console.log(`${TODAY}:名單 ${allowlist.length} 人、計畫 ${plans.length} 件、`
    + `記事 ${notes.length} 則、已登記裝置 ${subs.length} 台`
    + `${DRY ? "(試跑)" : ""}${TEST ? "(測試通知)" : ""}`);

  if (TEST && !subs.length) {
    console.log("\n沒有任何已登記的裝置,所以沒有對象可以測。");
    console.log("請先在手機上進「行事曆」分頁按「🔔 開啟手機提醒」。");
    console.log("iPhone 要先把網站「加到主畫面」,再從主畫面的圖示打開才收得到。\n");
    return;
  }

  // 「誰該收到什麼」是純邏輯,抽出去才測得到(見 test/deliveries.test.mjs)。
  // 測試模式則略過判斷,直接發給每一台 —— 要測的是路通不通,不是內容對不對。
  const deliveries = TEST
    ? [...new Set(subs.map((s) => (s.ownerEmail || "").toLowerCase()))].filter(Boolean)
        .map((email) => ({
          email,
          devices: subs.filter((s) => (s.ownerEmail || "").toLowerCase() === email),
          payload: {
            title: "測試通知",
            body: `收到這則就代表手機提醒設定成功了。\n(${TODAY} 手動送出,不是每天的提醒)`
          }
        }))
    : planDeliveries({ allowlist, plans, notes, subs, today: TODAY });

  // 試跑時把名單上每個人今天會收到的內容都印出來 ——
  // 還沒有人登記裝置的階段,這是唯一能確認「接得對不對」的方法
  if (DRY && !TEST) {
    console.log("\n── 今天每個人會收到什麼(不管有沒有登記裝置)──");
    const 台數 = (e) => subs.filter((s) => (s.ownerEmail || "").toLowerCase() === e).length;
    for (const r of previewAll({ allowlist, plans, notes, today: TODAY })) {
      const 裝置 = 台數(r.email);
      const 誰 = `${r.name || r.email}${r.dept ? `(${r.dept})` : ""}・${裝置} 台裝置`;
      if (!r.payload) { console.log(`\n${誰}\n  今天沒事`); continue; }
      console.log(`\n${誰}\n  標題:${r.payload.title}`);
      r.payload.body.split("\n").forEach((l) => console.log(`  ・${l}`));
    }
    console.log("\n────────────────────────────────────\n");
  }

  // 聯絡方式打錯不該讓整天的通知全部發不出去,所以先過一道寬容的處理
  const { subject, warn } = vapidSubject(process.env.VAPID_SUBJECT);
  if (warn) console.warn(`  ⚠ ${warn}`);
  webpush.setVapidDetails(subject, env("VAPID_PUBLIC_KEY"), env("VAPID_PRIVATE_KEY"));

  let 送出 = 0, 清掉 = 0;
  const 跳過 = subs.length - deliveries.reduce((n, d) => n + d.devices.length, 0);

  for (const { email, devices, payload } of deliveries) {
    // 測試通知用不同的 tag,才不會和當天真正的提醒互相蓋掉
    const body = JSON.stringify({
      ...payload, tag: TEST ? `test-${Date.now()}` : `daily-${TODAY}`, url: "./"
    });
    console.log(`  ${email}(${devices.length} 台):${payload.title}`);

    for (const d of devices) {
      if (DRY) { 送出++; continue; }
      try {
        await webpush.sendNotification(
          { endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } },
          body
        );
        送出++;
      } catch (err) {
        // 404 / 410 = 這個訂閱已經失效(使用者移除了應用程式、清了瀏覽器資料)。
        // 留著只會每天重試失敗,直接刪掉。
        if (err.statusCode === 404 || err.statusCode === 410) {
          await db.collection("pushSubs").doc(d.id).delete();
          清掉++;
        } else {
          console.error(`  ✗ ${email} 的一台裝置送不出去(${err.statusCode || err.message})`);
        }
      }
    }
  }

  console.log(`送出 ${送出} 則、沒事可提醒 ${跳過} 台、清掉失效的 ${清掉} 台`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
