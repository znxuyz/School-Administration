// 「今天要送什麼給誰」。純邏輯,不碰 Firestore 也不碰網路,所以測得到。
//
// 這裡守的是一條安全性規則:收件人的處室一律以名單(allowlist)為準,
// 不能用裝置登記時存下來的那一份。老師調處室之後,舊的裝置紀錄還留著舊處室,
// 照著它發就會把不該看的同處室記事推到他手機上。

import { remindersFor, notificationFor } from "../assets/reminders.js";
import { todayStr } from "../assets/core.js";

/**
 * @returns [{ email, member, devices, items, payload }] —— 只含真的有東西要講的人
 */
export function planDeliveries({ allowlist = [], plans = [], notes = [], subs = [],
                                 today = todayStr() } = {}) {
  // 一個人可能有好幾台裝置(手機 + 平板),同一則通知要每台都送
  const byOwner = new Map();
  subs.forEach((s) => {
    const k = (s.ownerEmail || "").toLowerCase();
    if (!k) return;
    byOwner.set(k, [...(byOwner.get(k) || []), s]);
  });

  const out = [];
  for (const [email, devices] of byOwner) {
    const member = allowlist.find((m) => (m.id || m.email || "").toLowerCase() === email);
    if (!member) continue;              // 已經被移出名單的人不該再收到通知

    const items = remindersFor({
      member: { email, dept: member.dept || "" },
      plans, notes, today
    });
    const payload = notificationFor(items);
    if (!payload) continue;             // 今天沒事就不要吵他

    out.push({ email, member, devices, items, payload });
  }
  return out;
}

/**
 * VAPID 規格要一個聯絡方式(mailto: 或 https:),推播服務出問題時用它找寄件人。
 *
 * 這裡刻意寫得很寬容:直接把打錯的值丟給 web-push 會整支程式當掉,
 * 那天全校一則通知都收不到,而唯一的線索是 Actions 上一個紅色叉叉。
 * 一個「選填」的欄位不該有這種殺傷力,所以能補就補、補不了就退回預設值。
 *
 * @returns { subject, warn } —— warn 不是空字串就代表有東西要印出來提醒管理員
 */
export function vapidSubject(raw, fallback = "mailto:admin@example.com") {
  const v = String(raw || "").trim();
  if (!v) return { subject: fallback, warn: "" };

  if (/^(mailto:|https:\/\/)/i.test(v)) return { subject: v, warn: "" };

  // 最常見的錯:只填了信箱、忘了前面的 mailto:
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
    return { subject: `mailto:${v}`, warn: `VAPID_SUBJECT 少了 mailto:,已自動補上 → mailto:${v}` };
  }

  return {
    subject: fallback,
    warn: `VAPID_SUBJECT 看不懂(${v}),這次先用預設值。要填的話寫成 mailto:你的信箱`
  };
}
