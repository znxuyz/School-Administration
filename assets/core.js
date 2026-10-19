// 計畫 / 步驟 / 記事的共用判斷邏輯。
//
// 為什麼要獨立成一個檔案:手機提醒是由 GitHub Actions 在雲端跑的,
// 它必須和畫面上看到的完全一致 —— 畫面說「明天到期」,通知就不能說別的。
// 兩邊各寫一份一定會慢慢走鐘,所以這裡是唯一的版本,
// 瀏覽器端的 app.js 和伺服器端的 tools/send-reminders.mjs 都 import 它。
//
// 這個檔案裡不可以出現 DOM、Firebase、或任何只有瀏覽器才有的東西 ——
// Node 也要跑得動。純函式,不碰共用狀態。

import {
  STAGES, STAGE_IDS, STALE_DAYS, STUCK_DAYS, SETTLEMENT_GRACE_DAYS,
  DEFAULT_UNIT, PENDING_UNIT, INCOMING_TITLES
} from "./config.js";

/* ---------------- 日期 ---------------- */

/** 今天的 YYYY-MM-DD(本地時區),用來和 <input type="date"> 的值直接字串比較 */
export function todayStr(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Firestore Timestamp / Date / null → Date | null */
export function toDate(ts) {
  if (!ts) return null;
  if (typeof ts.toDate === "function") return ts.toDate();
  const d = new Date(ts);
  return isNaN(d) ? null : d;
}

/** 兩個 YYYY-MM-DD 相差幾天 */
export function daysBetween(a, b) {
  return Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);
}

/** YYYY-MM-DD 加上 n 天 */
export function addDays(ymd, n) {
  if (!ymd) return "";
  const d = new Date(ymd + "T00:00:00");
  if (isNaN(d)) return "";
  d.setDate(d.getDate() + n);
  return todayStr(d);
}

/* ---------------- 步驟 ---------------- */

/** 本次要做的步驟(排除標記為不適用的) */
export const activeSteps = (plan) => (plan.steps || []).filter((s) => s.status !== "na");

export const stageOf = (step) => (STAGE_IDS.includes(step.stage) ? step.stage : "execute");

export const STAGE_LABEL = Object.fromEntries(STAGES.map((s) => [s.id, s.label]));

/** 舊資料相容:執行結束日先看 endDate,沒有才回頭看早期的 dueDate */
export const deadlineOf = (plan) => plan.endDate || plan.dueDate || "";

/**
 * 結算期限 = 執行結束日 + 寬限天數。
 * 老師填的執行結束日不含送結算的時間,系統自動往後加。
 */
export const settlementDueOf = (plan) => addDays(deadlineOf(plan), SETTLEMENT_GRACE_DAYS);

/**
 * 步驟實際要對照的期限:自己填的優先;
 * 結案階段沒填的話,一律用計畫的結算期限。
 */
export function effectiveDue(step, plan) {
  if (step.due) return step.due;
  return stageOf(step) === "close" ? settlementDueOf(plan) : "";
}

export function progressOf(plan) {
  const steps = activeSteps(plan);          // 不適用的步驟不列入分母
  const done = steps.filter((s) => s.status === "done").length;
  return { done, total: steps.length, pct: steps.length ? Math.round((done / steps.length) * 100) : 0 };
}

/** 計畫狀態:已完成 > 逾期 > 待更新 > 進行中(today 可指定,方便測試與批次計算) */
export function statusOf(plan, today = todayStr()) {
  const { done, total } = progressOf(plan);
  if (total > 0 && done === total) return "done";

  // 整體期限用「結算期限」(執行結束日 + 寬限期),
  // 結案階段沒填期限的步驟也一律對照結算期限。
  const deadlines = [settlementDueOf(plan), ...activeSteps(plan)
    .filter((s) => s.status !== "done")
    .map((s) => effectiveDue(s, plan))].filter(Boolean);
  if (deadlines.some((d) => d < today)) return "overdue";

  const updated = toDate(plan.updatedAt);
  if (updated && (Date.now() - updated.getTime()) / 86400000 > STALE_DAYS) return "stale";
  return "active";
}

/** 這個計畫最早逾期的那個日期;沒逾期回空字串 */
export function earliestOverdue(plan, today = todayStr()) {
  return [settlementDueOf(plan), ...activeSteps(plan)
    .filter((s) => s.status !== "done")
    .map((s) => effectiveDue(s, plan))]
    .filter((d) => d && d < today)
    .sort()[0] || "";
}

/* ---------------- 公文位置 ---------------- */

/** 名字看起來就是等對方寄來的(核定函那類) */
export const looksIncoming = (title) => INCOMING_TITLES.includes((title || "").trim());

/**
 * 這是不是「等對方寄來」的文件(收文)。
 * 沒有這個欄位的舊資料就照名字猜 —— 這個功能上線前建的計畫,
 * 核定函一樣該當成收文,不用老師回去一個一個補勾。
 * 欄位存在就以欄位為準(包括老師刻意取消勾選的 false)。
 */
export const isIncoming = (step) =>
  step.incoming === undefined ? looksIncoming(step.title) : !!step.incoming;

/** 收文還沒到手上 —— 位置停在「尚未收到」而且還沒完成 */
export const isWaiting = (step) =>
  isIncoming(step) && step.location === PENDING_UNIT && step.status !== "done" && step.status !== "na";

/**
 * 等這份文件等了幾天。從「進行中」的起算日算起 ——
 * 送出去的文件從送出那天算,等別人寄來的當然從開始等那天算。
 */
export function daysWaiting(step, today = todayStr()) {
  if (!isWaiting(step) || !step.startedAt) return null;
  return daysBetween(step.startedAt, today);
}

/** 這個計畫正在等哪些文件寄來 */
export function documentsWaiting(plan) {
  return activeSteps(plan).filter(isWaiting).map((s) => ({
    title: s.title,
    days: daysWaiting(s)
  }));
}

/**
 * 這份文件是哪天送出去的。
 * 新資料直接看 sentAt;舊資料沒有這個欄位,就回頭查流轉紀錄裡
 * 最後一次送到目前這個單位的日期。
 */
export function sentAtOf(step, plan) {
  // 「尚未收到」不是我們送出去的,沒有送出日期可言
  if (!step.location || step.location === DEFAULT_UNIT || step.location === PENDING_UNIT) return "";
  if (step.sentAt) return step.sentAt;
  const hit = [...(plan.flow || [])]
    .filter((f) => f.to === step.location)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
  return hit?.date || "";
}

/** 這份文件已經在對方那裡放了幾天;null = 不在外面或算不出來 */
export function daysAway(step, plan, today = todayStr()) {
  if (step.status === "done" || step.status === "na") return null;
  const at = sentAtOf(step, plan);
  return at ? daysBetween(at, today) : null;
}

export const isStuck = (step, plan, today = todayStr()) => {
  const d = daysAway(step, plan, today);
  return d !== null && d >= STUCK_DAYS;
};

/** 這個計畫有沒有卡關的公文 */
export function hasStuckDoc(plan, today = todayStr()) {
  return activeSteps(plan).some((s) => isStuck(s, plan, today));
}

/** 卡最久的那一份:{ title, unit, days };沒有就回 null */
export function worstStuck(plan, today = todayStr()) {
  return activeSteps(plan)
    .filter((s) => isStuck(s, plan, today))
    .map((s) => ({ title: s.title, unit: s.location, days: daysAway(s, plan, today) }))
    .sort((a, b) => b.days - a.days)[0] || null;
}

/**
 * 還在外面的文件:有指定所在單位、而且不是「承辦人手上」、也還沒完成的步驟。
 * 公文位置是掛在每一份文件(步驟)上的,不是整個計畫共用一個位置。
 */
export function documentsOut(plan, today = todayStr()) {
  const byUnit = new Map();
  activeSteps(plan)
    .filter((s) => s.location && s.location !== DEFAULT_UNIT
      && s.location !== PENDING_UNIT && s.status !== "done")
    .forEach((s) => {
      const cur = byUnit.get(s.location) || { titles: [], days: null };
      cur.titles.push(s.title);
      const d = daysAway(s, plan, today);
      if (d !== null && (cur.days === null || d > cur.days)) cur.days = d;
      byUnit.set(s.location, cur);
    });
  // 同一個單位的多份文件收成一則,卡片才不會被一長串小標籤淹沒
  return [...byUnit].map(([unit, v]) => ({
    unit,
    title: v.titles.length === 1 ? v.titles[0] : `${v.titles[0]} 等 ${v.titles.length} 份`,
    days: v.days,
    stuck: v.days !== null && v.days >= STUCK_DAYS
  }));
}

/* ---------------- 行事曆記事 ---------------- */

export const NOTE_SCOPES = [
  { id: "self", label: "只有自己" },
  { id: "dept", label: "同處室" },
  { id: "all",  label: "全校可看" }
];

/**
 * 舊記事沒有 scope 欄位,一律視為全校可看 —— 當初寫的時候就是全校共看,
 * 不能因為加了範圍功能就讓它們突然對所有人消失。
 */
export const noteScopeOf = (n) => (NOTE_SCOPES.some((x) => x.id === n.scope) ? n.scope : "all");

/**
 * 這個人看不看得到這則記事。
 * 「只有自己」的只有寫的人看得到,「同處室」的只有同處室的人看得到。
 * 資料層已經用查詢條件和安全規則擋過一次,這裡是第二道防線 ——
 * 發手機提醒時也走這一關,不能把別人的私人記事推到全校的手機上。
 */
export function canSeeNote(n, member) {
  const me = (member?.email || "").toLowerCase();
  if (me && (n.ownerEmail || "").toLowerCase() === me) return true;
  const scope = noteScopeOf(n);
  if (scope === "all") return true;
  if (scope === "dept") return !!n.dept && n.dept === member?.dept;
  return false;
}
