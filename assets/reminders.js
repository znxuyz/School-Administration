// 「今天該提醒誰、提醒什麼」。
//
// 純函式,沒有 Firebase、沒有 DOM —— 瀏覽器和 GitHub Actions 都跑得動,
// 判斷依據全部來自 core.js,所以通知說的話和畫面上看到的一定一致。

import {
  todayStr, addDays, daysBetween,
  settlementDueOf, deadlineOf, statusOf, earliestOverdue,
  worstStuck, canSeeNote
} from "./core.js";

// 期限在幾天內就開始提醒(含當天)
export const REMIND_LEAD_DAYS = 3;

// 一則通知最多列幾件,其餘收成「還有 N 件」。
// 手機的通知列放不下太多字,列太多等於什麼都沒看到。
export const REMIND_MAX_ITEMS = 4;

const 急迫 = { overdue: 0, stuck: 1, due: 2, note: 3, end: 4 };

/**
 * 這個人今天該收到哪些提醒。
 *
 * @param member  { email, dept }  —— 收件人
 * @param plans   全部計畫(呼叫端不必先過濾,這裡只看他自己承辦的)
 * @param notes   這個人讀得到的記事(範圍判斷在這裡再做一次)
 * @param today   YYYY-MM-DD
 */
export function remindersFor({ member, plans = [], notes = [], today = todayStr(),
                               leadDays = REMIND_LEAD_DAYS } = {}) {
  const me = (member?.email || "").toLowerCase();
  const items = [];
  const 到期界線 = addDays(today, leadDays);

  // 只提醒自己承辦的計畫。主任看得到同處室的進度,但「該你動手」的還是自己的 ——
  // 把別人的事推到他手機上只會讓他關掉通知。
  const mine = plans.filter((p) =>
    !p.deletedAt && (p.ownerEmail || "").toLowerCase() === me);

  mine.forEach((plan) => {
    const st = statusOf(plan, today);
    if (st === "done") return;

    if (st === "overdue") {
      const when = earliestOverdue(plan, today);
      items.push({
        kind: "overdue", planId: plan.id, title: plan.title, date: when,
        detail: when ? `已逾期(${when})` : "已逾期"
      });
      return;                     // 已經逾期了,再講「快到期」是多的
    }

    const 結算 = settlementDueOf(plan);
    if (結算 && 結算 >= today && 結算 <= 到期界線) {
      const d = daysBetween(today, 結算);
      items.push({
        kind: "due", planId: plan.id, title: plan.title, date: 結算,
        detail: d === 0 ? "今天要送結算" : `${d} 天後要送結算`
      });
    }

    const 結束 = deadlineOf(plan);
    if (結束 && 結束 >= today && 結束 <= 到期界線) {
      const d = daysBetween(today, 結束);
      items.push({
        kind: "end", planId: plan.id, title: plan.title, date: 結束,
        detail: d === 0 ? "今天是執行結束日" : `${d} 天後執行結束`
      });
    }

    const 卡 = worstStuck(plan, today);
    if (卡) {
      items.push({
        kind: "stuck", planId: plan.id, title: plan.title, date: today,
        detail: `「${卡.title}」停在${卡.unit} ${卡.days} 天`
      });
    }
  });

  // 今天的行事曆記事。範圍在這裡再擋一次 ——
  // 推播是推到別人手機上的,不能靠呼叫端記得過濾。
  notes
    .filter((n) => n.date === today && canSeeNote(n, member))
    .forEach((n) => items.push({
      kind: "note", noteId: n.id, title: n.text, date: n.date,
      detail: (n.ownerEmail || "").toLowerCase() === me ? "今天的記事" : `今天的記事・${n.ownerName || ""}`.trim()
    }));

  items.sort((a, b) => (急迫[a.kind] - 急迫[b.kind]) || String(a.date).localeCompare(String(b.date)));
  return items;
}

/** 把提醒收成一則通知的標題與內文;沒有東西好提醒就回 null */
export function notificationFor(items, max = REMIND_MAX_ITEMS) {
  if (!items.length) return null;

  const 逾期 = items.filter((i) => i.kind === "overdue").length;
  const 卡關 = items.filter((i) => i.kind === "stuck").length;

  // 標題講「有幾件、最急的是哪一種」,內文才列名字。
  // 鎖定畫面上多半只看得到標題那一行。
  const 重點 = 逾期 ? `${逾期} 件逾期` : 卡關 ? `${卡關} 件公文卡關` : "";
  const title = 重點
    ? `有 ${items.length} 件要注意・${重點}`
    : `今天有 ${items.length} 件要注意`;

  const 列 = items.slice(0, max).map((i) => `${i.detail}:${i.title}`);
  if (items.length > max) 列.push(`還有 ${items.length - max} 件`);

  return { title, body: 列.join("\n") };
}
