// 行政工作進度追蹤系統
// Firebase JS SDK 從 Google CDN 以 ES module 載入,不需要 npm 或建置工具。
// 若要升級 SDK,請一併修改下方三行的版本號。
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, where, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

import {
  APP_VERSION, firebaseConfig, DEPARTMENTS, STALE_DAYS, SETTLEMENT_GRACE_DAYS, STUCK_DAYS,
  UNIT_GROUPS, DEFAULT_UNIT,
  STAGES, STAGE_IDS, STEP_SUGGESTIONS, TEMPLATES,
  ROLES, DEFAULT_ROLE, RECURRENCES, RECUR_LEAD_DAYS
  // ?v= 由 ./bump.sh 一併更新,否則瀏覽器會沿用快取裡的舊設定檔
} from "./config.js?v=43";

// 主題色(頂欄品牌圖示 → 選色面板)。只影響 CSS 變數,不動任何資料。
import { initAccentPicker, initThemeToggle } from "./theme.js?v=43";

// 預覽模式:網址帶 ?demo=1 時跳過登入,直接用假資料把每一頁畫出來。
// 任何寫入都會被擋下,只是給人看畫面用的 —— 改版時對照畫面、
// 或是想給人看系統長什麼樣子但不方便給帳號的時候用。
const DEMO = new URLSearchParams(location.search).has("demo");

/**
 * 預覽模式下擋掉寫入。回傳 true 表示「已經擋掉並說明了,呼叫端請直接 return」。
 *
 * 每一個會寫進 Firestore 的地方都要先問過這一句 —— 只擋一部分的話,
 * 沒擋到的那些會真的送出去,然後被安全規則退回來,
 * 使用者看到的是一句「權限不足」的紅字,完全看不懂發生什麼事。
 */
function demoBlocked() {
  if (!DEMO) return false;
  toast("預覽模式,不會存進資料庫");
  return true;
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

/* ---------------- 共用小工具 ---------------- */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));

const show = (el, visible) => { el.hidden = !visible; };

/**
 * 畫面下方的提示條。取代 alert:手機上按 alert 要多點一次才回得去,
 * 而且會擋住剛剛在改的那一列。錯誤留久一點,點一下可以提早關掉。
 */
function toast(msg, kind = "info") {
  const box = $("#toasts");
  if (!box) return;
  const el = document.createElement("div");
  el.className = `toast toast-${kind}`;
  el.textContent = msg;
  el.addEventListener("click", () => el.remove());
  box.appendChild(el);
  // 連續操作(例如一直按「完成」)不要讓提示條疊成一片牆
  while (box.children.length > 3) box.firstElementChild.remove();
  // 錯誤要看得夠久;成功訊息瞄一眼就好
  setTimeout(() => el.remove(), kind === "error" ? 9000 : 4500);
}

/** 只給螢幕閱讀器聽的播報(畫面上看不到) */
function announce(msg) {
  const el = $("#live");
  if (el) el.textContent = msg;
}

/** 今天的 YYYY-MM-DD(本地時區),用來和 <input type="date"> 的值直接字串比較 */
function todayStr(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 民國學年度:8 月起算新學年 */
function currentAcademicYear(d = new Date()) {
  const roc = d.getFullYear() - 1911;
  return d.getMonth() + 1 >= 8 ? roc : roc - 1;
}

/** Firestore Timestamp / Date / null → Date | null */
function toDate(ts) {
  if (!ts) return null;
  if (typeof ts.toDate === "function") return ts.toDate();
  const d = new Date(ts);
  return isNaN(d) ? null : d;
}

function relativeDays(date) {
  if (!date) return "尚未更新";
  const days = Math.floor((Date.now() - date.getTime()) / 86400000);
  if (days <= 0) return "今天更新";
  if (days === 1) return "昨天更新";
  if (days < 30) return `${days} 天前更新`;
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} 更新`;
}

/** 兩個 YYYY-MM-DD 相差幾天 */
function daysBetween(a, b) {
  return Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);
}

const money = (n) => Number(n).toLocaleString("zh-Hant-TW");

/** 只放行 http/https 連結,避免 javascript: 之類的網址被塞進卡片 */
function safeUrl(u) {
  const s = String(u || "").trim();
  if (!s) return "";
  try {
    const url = new URL(s);
    return (url.protocol === "http:" || url.protocol === "https:") ? url.href : "";
  } catch {
    return "";
  }
}

const TERM_LABEL = { "1": "上學期", "2": "下學期", "0": "全學年" };
// na = 本次不適用(例如這次沒有剩餘款、沒有薪資支出),
// 保留步驟但不列入進度、不算逾期,比直接刪掉更清楚。
const STEP_LABEL = { todo: "未開始", doing: "進行中", done: "已完成", na: "本次不適用" };
const STEP_MARK = { todo: "○", doing: "◐", done: "●", na: "—" };
const STEP_STATUSES = Object.keys(STEP_LABEL);

/** 本次要做的步驟(排除標記為不適用的) */
const activeSteps = (plan) => (plan.steps || []).filter((s) => s.status !== "na");

/** 沒被丟進垃圾桶的計畫。刪除是可還原的,平常的畫面一律不顯示已刪除的 */
const livePlans = () => state.plans.filter((p) => !p.deletedAt);
const STAGE_LABEL = Object.fromEntries(STAGES.map((s) => [s.id, s.label]));

const STATUS_META = {
  active:  { label: "進行中", code: "ACTIVE",  icon: "▶", cls: "badge-active",  color: "var(--accent)" },
  overdue: { label: "逾期",   code: "OVERDUE", icon: "⚠", cls: "badge-overdue", color: "var(--status-critical)" },
  stale:   { label: "待更新", code: "STALE",   icon: "◷", cls: "badge-stale",   color: "var(--status-warning)" },
  done:    { label: "已完成", code: "CLOSED",  icon: "✓", cls: "badge-done",    color: "var(--status-good)" }
};

/** 舊資料相容:執行結束日先看 endDate,沒有才回頭看早期的 dueDate */
const deadlineOf = (plan) => plan.endDate || plan.dueDate || "";

/** YYYY-MM-DD 加上 n 天 */
function addDays(ymd, n) {
  if (!ymd) return "";
  const d = new Date(ymd + "T00:00:00");
  if (isNaN(d)) return "";
  d.setDate(d.getDate() + n);
  return todayStr(d);
}

/** YYYY-MM-DD 加上 n 個月(月底日期會自動收斂,例如 1/31 加一個月是 2/28) */
function addMonths(ymd, n) {
  if (!ymd) return "";
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return "";
  const dt = new Date(y, m - 1 + n, 1);
  const lastDay = new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate();
  dt.setDate(Math.min(d, lastDay));
  return todayStr(dt);
}

const RECUR_MONTHS = Object.fromEntries(RECURRENCES.map((r) => [r.id, r.months]));
const RECUR_LABEL = Object.fromEntries(RECURRENCES.map((r) => [r.id, r.label]));

/** 這個重複性計畫下一次該辦的日期(以這次的執行結束日往後推一個週期) */
function nextRoundDate(plan) {
  const months = RECUR_MONTHS[plan.recurring] || 0;
  const base = deadlineOf(plan);
  return months && base ? addMonths(base, months) : "";
}

/**
 * 這個計畫是不是「該辦下一次了」:
 * 設了重複週期、這一次已經結案,而且已經接近下一次的時間。
 */
function recurDue(plan, today = todayStr()) {
  if (!plan.recurring || plan.deletedAt) return null;
  if (statusOf(plan) !== "done") return null;
  const next = nextRoundDate(plan);
  if (!next) return null;
  return today >= addDays(next, -RECUR_LEAD_DAYS) ? next : null;
}

/**
 * 結算期限 = 執行結束日 + 寬限天數。
 * 老師填的執行結束日不含送結算的時間,系統自動往後加。
 */
const settlementDueOf = (plan) => addDays(deadlineOf(plan), SETTLEMENT_GRACE_DAYS);

/**
 * 步驟實際要對照的期限:自己填的優先;
 * 結案階段沒填的話,一律用計畫的結算期限。
 */
function effectiveDue(step, plan) {
  if (step.due) return step.due;
  return stageOf(step) === "close" ? settlementDueOf(plan) : "";
}

/**
 * 這份文件是哪天送出去的。
 * 新資料直接看 sentAt;舊資料沒有這個欄位,就回頭查流轉紀錄裡
 * 最後一次送到目前這個單位的日期。
 */
function sentAtOf(step, plan) {
  if (!step.location || step.location === DEFAULT_UNIT) return "";
  if (step.sentAt) return step.sentAt;
  const hit = [...(plan.flow || [])]
    .filter((f) => f.to === step.location)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
  return hit?.date || "";
}

/** 這份文件已經在對方那裡放了幾天;null = 不在外面或算不出來 */
function daysAway(step, plan, today = todayStr()) {
  if (step.status === "done" || step.status === "na") return null;
  const at = sentAtOf(step, plan);
  return at ? daysBetween(at, today) : null;
}

const isStuck = (step, plan, today = todayStr()) => {
  const d = daysAway(step, plan, today);
  return d !== null && d >= STUCK_DAYS;
};

/** 這個計畫有沒有卡關的公文 */
function hasStuckDoc(plan, today = todayStr()) {
  return activeSteps(plan).some((s) => isStuck(s, plan, today));
}

/**
 * 還在外面的文件:有指定所在單位、而且不是「承辦人手上」、也還沒完成的步驟。
 * 公文位置是掛在每一份文件(步驟)上的,不是整個計畫共用一個位置。
 */
function documentsOut(plan) {
  const byUnit = new Map();
  activeSteps(plan)
    .filter((s) => s.location && s.location !== DEFAULT_UNIT && s.status !== "done")
    .forEach((s) => {
      const cur = byUnit.get(s.location) || { titles: [], days: null };
      cur.titles.push(s.title);
      const d = daysAway(s, plan);
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

/**
 * 複製到新學年時把標題裡的學年度換掉:
 * 「114 學年度課程計畫備查」複製到 115 就變成「115 學年度課程計畫備查」。
 * 先找「數字 + 學年」的寫法,找不到才退而求其次換獨立出現的數字。
 */
function retitleForYear(title, from, to) {
  const t = String(title || "");
  if (!to) return t;

  // 1. 標題裡就是來源學年度的寫法
  if (from && from !== to && new RegExp(`${from}\\s*學年`).test(t)) {
    return t.replace(new RegExp(`${from}(\\s*學年)`, "g"), `${to}$1`);
  }
  // 2. 標題的學年度和 year 欄位對不起來時,換掉任何「數字 + 學年」
  if (/\d{2,3}\s*學年/.test(t)) return t.replace(/\d{2,3}(\s*學年)/g, `${to}$1`);
  // 3. 標題沒寫「學年」,才退而求其次換獨立出現的來源年度數字
  if (from && from !== to) return t.replace(new RegExp(`\\b${from}\\b`, "g"), String(to));
  return t;
}

/**
 * 複製計畫時重設步驟:保留名稱、階段、批次設定,
 * 但進度、公文位置、日期全部歸零,第一批公文直接設為進行中。
 */
function resetStepsForCopy(steps) {
  const rows = (steps || []).map((s) => ({
    title: s.title,
    stage: stageOf(s),
    status: "todo",
    bundleWithPrev: !!s.bundleWithPrev,
    note: "", due: "", location: "", doneAt: "", startedAt: ""
  }));
  return startFirstBundle(rows);
}

/** 第一批公文預設就是「進行中」;一起送件的整批一起開始 */
function startFirstBundle(rows) {
  (bundlesOf(rows)[0] || []).forEach((i) => { rows[i].status = "doing"; });
  return rows;
}

/** 把同一階段內「與上一個一起送」的步驟合併成一批公文 */
function groupBundles(rows) {
  const out = [];
  rows.forEach((s) => {
    if (s.bundleWithPrev && out.length) out[out.length - 1].push(s);
    else out.push([s]);
  });
  return out;
}

/**
 * 整份步驟清單切成一批一批的公文,順序與畫面上完全一致:
 * 先照階段排,再把「與上一個一起送」的併進同一批。
 * 回傳每一批的原始索引,例如 [[0,1],[2],[3]]。
 */
function bundlesOf(steps) {
  const indexed = (steps || []).map((s, i) => ({ ...s, _i: i }));
  const out = [];
  STAGES.forEach((st) => {
    groupBundles(indexed.filter((s) => stageOf(s) === st.id))
      .forEach((b) => out.push(b.map((s) => s._i)));
  });
  return out;
}

/** 這批公文辦完了沒;整批都是「本次不適用」也算過去了 */
function bundleDone(steps, idxs) {
  return idxs
    .map((i) => steps[i])
    .filter((s) => s && s.status !== "na")
    .every((s) => s.status === "done");
}

/**
 * 步驟的排序限制。公文是一份接一份跑的,前一批還沒完成就不該先動後面的,
 * 但同一批一起送的文件不互相等待。
 * 回傳 { locked:要不要擋, lead:是不是這批的第一份, waitFor:在等哪一份 }
 */
function gateOf(steps, i) {
  const bundles = bundlesOf(steps);
  const b = bundles.findIndex((idxs) => idxs.includes(i));
  const out = { locked: false, lead: b === -1 || bundles[b][0] === i, waitFor: "" };
  if (b <= 0) return out;

  const prev = bundles[b - 1];
  if (bundleDone(steps, prev)) return out;
  const title = steps[prev[0]]?.title || "前一份公文";
  return { ...out, locked: true, waitFor: prev.length > 1 ? `${title} 等 ${prev.length} 份` : title };
}

/** 一份文件改狀態時要跟著動的其他文件:同一批一起送的都同步 */
function syncTargets(steps, i, value) {
  const bundle = bundlesOf(steps).find((idxs) => idxs.includes(i)) || [i];
  // 標成「本次不適用」是單一份文件的事,不能把整批都關掉;
  // 其他狀態則整批同步,但已標不適用的維持不適用。
  if (value === "na") return [i];
  return bundle.filter((k) => k === i || steps[k]?.status !== "na");
}

/** 一批公文辦完後,下一批(整批)自動接成進行中;整批不適用的就跳過 */
function advanceAfter(steps, i, today = todayStr()) {
  const bundles = bundlesOf(steps);
  const b = bundles.findIndex((idxs) => idxs.includes(i));
  if (b === -1 || !bundleDone(steps, bundles[b])) return steps;

  for (let k = b + 1; k < bundles.length; k++) {
    const live = bundles[k].filter((n) => steps[n].status !== "na");
    if (!live.length) continue;                       // 整批本次不適用,再往後找
    if (live.every((n) => steps[n].status === "todo")) {
      live.forEach((n) => {
        steps[n] = { ...steps[n], status: "doing", startedAt: steps[n].startedAt || today };
      });
    }
    break;                                            // 只推進下一批,更後面的維持原狀
  }
  return steps;
}

// 行事曆上的三種日期。用調色盤前三個色階,彼此在色盲模擬下也分得開;
// 每個標籤都帶文字,不是只靠顏色辨識。
const EVENT_TYPES = {
  start:  { label: "開始",   icon: "▶", color: "#2a78d6" },
  end:    { label: "結束",   icon: "■", color: "#eb6834" },
  settle: { label: "送結算", icon: "✓", color: "#1baf7a" }
};

// 行事曆上的記事:和計畫無關的提醒(訪視、預演、開學日…)
const NOTE_COLOR = "#7c5cd6";

// 記事的可見範圍,由窄到寬排。
// 預設「只有自己」—— 寫錯範圍的代價不對等:不小心寫窄了頂多自己再改開,
// 不小心寫寬了整校都看過了,收不回來。要給別人看是一個明確的動作。
const NOTE_SCOPES = [
  { id: "self", label: "只有自己" },
  { id: "dept", label: "同處室" },
  { id: "all",  label: "全校可看" }
];
const NOTE_SCOPE_LABEL = Object.fromEntries(NOTE_SCOPES.map((x) => [x.id, x.label]));
const NOTE_SCOPE_DEFAULT = "self";

/**
 * 舊記事沒有 scope 欄位,一律視為全校可看 —— 當初寫的時候就是全校共看,
 * 這是還原它原本的意思,和新記事的預設值(只有自己)是兩回事。
 */
const noteScopeOf = (n) => (NOTE_SCOPES.some((x) => x.id === n.scope) ? n.scope : "all");

/** 某一天的記事,新增順序在前的先列 */
const notesOn = (notes, date) =>
  (notes || []).filter((n) => n.date === date)
    .sort((a, b) => String(a.createdAtDay || "").localeCompare(String(b.createdAtDay || "")));

/** 一個計畫在行事曆上會出現的日期 */
function eventsOf(plan) {
  const done = statusOf(plan) === "done";
  const rows = [
    { type: "start", date: plan.startDate || "" },
    { type: "end", date: deadlineOf(plan) },
    { type: "settle", date: settlementDueOf(plan) }
  ];
  return rows.filter((r) => r.date).map((r) => ({ ...r, plan, done }));
}

/** 把一個月的日期排成月曆用的格子(從週日開始,整週為單位) */
function monthCells(y, m, today = todayStr()) {
  const first = new Date(y, m, 1);
  const start = new Date(y, m, 1 - first.getDay());
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    cells.push({
      ymd: todayStr(d),
      day: d.getDate(),
      inMonth: d.getMonth() === m,
      isToday: todayStr(d) === today,
      dow: d.getDay()
    });
  }
  // 尾端整週都不屬於本月的就砍掉,月曆不會多出空白列
  let n = cells.length;
  while (n > 7 && !cells.slice(n - 7, n).some((c) => c.inMonth)) n -= 7;
  return cells.slice(0, n);
}

/**
 * 結案日期:最後一個步驟完成的那一天。
 * 計畫本身沒有「結案日」欄位 —— 老師按完最後一步就是結案,
 * 再叫他填一次日期只是多一道手續。
 */
function closedAt(plan) {
  return (plan.steps || [])
    .map((s) => s.doneAt || "")
    .filter(Boolean)
    .sort()
    .pop() || "";
}

/** 已結案的清單照結案日期由新到舊;沒有日期的(舊資料)排最後 */
function sortByClosed(plans) {
  return [...plans].sort((a, b) => {
    const x = closedAt(a), y = closedAt(b);
    if (x === y) return String(a.title || "").localeCompare(String(b.title || ""), "zh-Hant");
    if (!x) return 1;
    if (!y) return -1;
    return x < y ? 1 : -1;
  });
}

// 清單排序方式。預設照結算期限,最急的排前面 ——
// 若預設照「最近更新」排,老師每改一個步驟那張卡片就會跳到最上面,
// 清單會在手指下面亂動,很難一件一件往下處理。
const SORTS = [
  { id: "due", label: "結算期限最近" },
  { id: "updated", label: "最近更新" },
  { id: "title", label: "計畫名稱" }
];

function sortPlans(plans, mode = "due") {
  const byUpdated = (a, b) =>
    (toDate(b.updatedAt)?.getTime() || 0) - (toDate(a.updatedAt)?.getTime() || 0);
  const rows = [...plans];

  if (mode === "updated") return rows.sort(byUpdated);
  if (mode === "title") {
    return rows.sort((a, b) => String(a.title || "").localeCompare(String(b.title || ""), "zh-Hant"));
  }
  // 沒有日期的計畫排最後;同一天到期的再照最近更新
  return rows.sort((a, b) => {
    const x = settlementDueOf(a), y = settlementDueOf(b);
    if (x === y) return byUpdated(a, b);
    if (!x) return 1;
    if (!y) return -1;
    return x < y ? -1 : 1;
  });
}

/**
 * 位置變動要寫進公文流轉紀錄。
 * 同一天、同一份文件又改一次視為「更正」:蓋掉當天那一筆,不會多留一筆錯的;
 * 改回原本的位置(繞回起點)就整筆拿掉。
 */
function mergeFlow(flow, entry) {
  const rows = [...(flow || [])];
  let i = -1;
  rows.forEach((f, k) => { if (f.date === entry.date && f.step === entry.step) i = k; });
  if (i === -1) return [...rows, entry];

  const fixed = { ...rows[i], to: entry.to, stage: entry.stage };
  if (fixed.from === fixed.to) return rows.filter((_, k) => k !== i);
  rows[i] = fixed;
  return rows;
}

/** 這個計畫最早是哪一天開始逾期的(結算期限與各步驟期限取最早的) */
function overdueSince(plan, today = todayStr()) {
  return [settlementDueOf(plan), ...activeSteps(plan)
    .filter((s) => s.status !== "done")
    .map((s) => effectiveDue(s, plan))]
    .filter((d) => d && d < today)
    .sort()[0] || "";
}

// 本週待辦的四種事由,由急到緩。統計磚只給數字,這裡要講出是「哪幾件」。
const TODO_TYPES = {
  overdue: { label: "已逾期", icon: "⚠", cls: "critical" },
  stuck:   { label: "公文卡關", icon: "⚠", cls: "serious" },
  settle:  { label: "要送結算", icon: "✓", cls: "warning" },
  end:     { label: "執行結束", icon: "■", cls: "info" }
};
const TODO_ORDER = Object.keys(TODO_TYPES);

/**
 * 這一週該注意的事情。
 * 只看還沒結案的計畫,一個計畫只列最急的那一件事,免得同一個標題出現四次。
 */
function weekTodos(plans, today = todayStr(), days = 7) {
  const until = addDays(today, days);
  const rows = [];

  plans.forEach((plan) => {
    const st = statusOf(plan, today);
    if (st === "done") return;
    const settle = settlementDueOf(plan);
    const end = deadlineOf(plan);

    let type = "";
    let date = "";
    // 逾期的判定和統計磚一致(步驟自己的期限也算),否則磚上寫 1 件、
    // 待辦卻沒列出來,看的人會不知道該信哪一個
    if (st === "overdue") { type = "overdue"; date = overdueSince(plan, today); }
    else if (hasStuckDoc(plan, today)) { type = "stuck"; date = ""; }
    else if (settle && settle <= until) { type = "settle"; date = settle; }
    else if (end && end >= today && end <= until) { type = "end"; date = end; }
    if (type) rows.push({ plan, type, date });
  });

  // 先照急迫程度分組,同一組再照日期
  return rows.sort((a, b) =>
    TODO_ORDER.indexOf(a.type) - TODO_ORDER.indexOf(b.type) ||
    String(a.date).localeCompare(String(b.date)));
}

/** 搜尋比對的範圍:計畫本身、承辦人,以及每個步驟的名稱與備註 */
function searchText(plan) {
  return [
    plan.title, plan.note, plan.dept, plan.ownerName,
    ...(plan.steps || []).flatMap((s) => [s.title, s.note])
  ].filter(Boolean).join(" ").toLowerCase();
}

/** 下一個要處理的步驟:第一個還沒完成、也不是「本次不適用」的 */
function nextStep(plan) {
  return activeSteps(plan).find((s) => s.status !== "done") || null;
}

/**
 * 卡片上「下一步」指的那一批公文:第一個還沒完成的步驟,
 * 連同和它一起送的其他文件(標為本次不適用的不算在內)。
 * 回傳 { idxs, titles, text };全部做完就回 null。
 */
function nextBundle(plan) {
  const steps = plan.steps || [];
  const nxt = nextStep(plan);
  if (!nxt) return null;

  const i = steps.indexOf(nxt);
  const idxs = (bundlesOf(steps).find((b) => b.includes(i)) || [i])
    .filter((k) => steps[k] && steps[k].status !== "na");
  const titles = idxs.map((k) => steps[k].title);
  return {
    idxs,
    titles,
    // 兩份就兩個都寫出來,再多就只寫第一份加份數,免得卡片被一長串名稱撐開
    text: titles.length > 2 ? `${titles[0]} 等 ${titles.length} 份` : titles.join("、")
  };
}

/** 這個步驟距離期限還有幾天;null = 沒期限、已完成或本次不適用 */
function daysLeft(step, today = todayStr(), plan = {}) {
  if (step.status === "done" || step.status === "na") return null;
  const due = effectiveDue(step, plan);
  return due ? daysBetween(today, due) : null;
}

/** 這個計畫目前有文件停在哪些單位(篩選用,含舊格式的計畫層級位置) */
function unitsOf(plan) {
  const units = documentsOut(plan).map((d) => d.unit);
  if (plan.location && plan.location !== DEFAULT_UNIT) units.push(plan.location);
  return [...new Set(units)];
}

const stageOf = (step) => (STAGE_IDS.includes(step.stage) ? step.stage : "execute");

function progressOf(plan) {
  const steps = activeSteps(plan);          // 不適用的步驟不列入分母
  const done = steps.filter((s) => s.status === "done").length;
  return { done, total: steps.length, pct: steps.length ? Math.round((done / steps.length) * 100) : 0 };
}

/** 每個階段的完成度 */
function stageProgress(plan) {
  return STAGES.map((st) => {
    const steps = activeSteps(plan).filter((s) => stageOf(s) === st.id);
    const done = steps.filter((s) => s.status === "done").length;
    return { ...st, done, total: steps.length, complete: steps.length > 0 && done === steps.length };
  });
}

/** 目前走到哪個階段:第一個還沒全部完成的階段 */
function currentStage(plan) {
  const rows = stageProgress(plan).filter((r) => r.total > 0);
  return rows.find((r) => !r.complete) || null;
}

/** 計畫狀態:已完成 > 逾期 > 待更新 > 進行中(today 可指定,方便測試與批次計算) */
function statusOf(plan, today = todayStr()) {
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

/** 執行期間的文字描述 */
function periodText(plan) {
  const { startDate: s, endDate: e } = plan;
  if (!s && !e) return deadlineOf(plan) ? `期限 ${deadlineOf(plan)}` : "";
  if (s && !e) return `${s} 起`;
  if (!s && e) return `至 ${e}`;

  const today = todayStr();
  let tail = "";
  if (today < s) tail = `,尚未開始(${daysBetween(today, s)} 天後)`;
  else if (today > e) tail = ",已過結束日";
  else tail = `,剩 ${daysBetween(today, e)} 天`;
  return `${s} ～ ${e}${tail}`;
}

/** 結算期限的文字描述,讓老師知道還有多久要送結算 */
function settlementText(plan) {
  const due = settlementDueOf(plan);
  if (!due) return "";
  const { done, total } = progressOf(plan);
  if (total > 0 && done === total) return "";

  const left = daysBetween(todayStr(), due);
  if (left < 0) return `結算期限 ${due}(已逾期 ${-left} 天)`;
  if (left === 0) return `結算期限 ${due}(今天到期)`;
  return `結算期限 ${due}(還有 ${left} 天)`;
}

/* ---------------- 應用狀態 ---------------- */

/**
 * 篩選條件的預設值。初始化和「重設」按鈕共用同一份,以後加欄位不會漏改。
 * 學年度預設是「全部」—— 這些條件現在只服務「搜尋」分頁,
 * 而會用搜尋多半就是不知道那件事在哪一年;本學年度的看板是「總覽」的事。
 */
const defaultFilters = () => ({
  year: "", dept: "", owner: "", stage: "", unit: "", status: "", stuck: false, trash: false
});

const state = {
  user: null,        // Firebase Auth 使用者
  member: null,      // allowlist 中的成員資料
  plans: [],
  members: [],
  templates: [],    // 管理員存下來的自訂步驟範本(全校共用)
  notes: [],        // 行事曆記事(全校共用)
  editingNote: "",  // 正在改哪一則記事(空字串 = 新增)
  loadError: "",     // 讀取失敗時顯示在總覽上,不要讓老師只看到空白
  tab: "mine",       // 登入後先看自己承辦的工作
  expanded: new Set(),          // 展開步驟的計畫 id
  cal: { y: new Date().getFullYear(), m: new Date().getMonth(), picked: "" },
  filters: defaultFilters(),
  sort: "due",       // 排序是檢視方式,不算篩選條件,所以不放在 filters 裡
  query: "",         // 搜尋分頁的關鍵字。搜尋不受學年度等條件限制,所以也不放在 filters
  unsubscribe: []
};

/**
 * 每次寫入都蓋一個「誰在什麼時候動的」的章。
 * 主任看同處室的計畫時,才看得出最後是承辦人自己改的還是管理員代改的。
 */
const stamp = () => ({ updatedAt: serverTimestamp(), updatedByName: state.member?.name || "" });

/* ---------------- 記住上次看到哪裡 ---------------- */

// 篩選條件、排序、展開了哪幾張卡片,存在這台裝置上。
// 老師常常是「改到一半被叫走,回來重新整理」,每次都回到預設很煩。
// 同一台電腦可能不只一位老師用,所以用 Email 分開存。
const viewKey = () => `admin-tracker:view:${myEmail() || "guest"}`;

function saveView() {
  try {
    localStorage.setItem(viewKey(), JSON.stringify({
      // 垃圾桶是臨時檢視,不記住 —— 免得下次打開只看到已刪除的計畫,以為資料不見了
      filters: { ...state.filters, trash: false },
      sort: state.sort,
      expanded: [...state.expanded]
    }));
  } catch { /* 無痕模式或空間滿了都不影響主要功能 */ }
}

function loadView() {
  try {
    const saved = JSON.parse(localStorage.getItem(viewKey()) || "null");
    if (!saved) return;
    // 只收目前認得的欄位,舊版本存的東西不會污染 state
    const f = saved.filters || {};
    const keep = defaultFilters();
    for (const k of Object.keys(keep)) {
      if (k !== "trash" && typeof f[k] === typeof keep[k]) keep[k] = f[k];
    }
    state.filters = keep;
    if (SORTS.some((x) => x.id === saved.sort)) state.sort = saved.sort;
    if (Array.isArray(saved.expanded)) state.expanded = new Set(saved.expanded.slice(0, 200));
  } catch { /* 壞掉的內容直接忽略,用預設值 */ }
}

/** 把 state 裡的篩選條件寫回畫面上的欄位 */
function syncFilterFields() {
  for (const [key, sel] of Object.entries(FILTER_FIELDS)) $(sel).value = state.filters[key];
  $("#f-sort").value = state.sort;
  $("#f-trash").checked = state.filters.trash;
}

/** 舊資料的 teacher 一律視為組長 */
const roleOf = (m) => {
  const r = m?.role;
  return ROLES.some((x) => x.id === r) ? r : DEFAULT_ROLE;
};
const ROLE_LABEL = Object.fromEntries(ROLES.map((r) => [r.id, r.label]));

const isAdmin = () => roleOf(state.member) === "admin";

/**
 * 權限一律以 Email 判定,不用 Firebase 的 uid。
 * 因為職務交接時要把計畫轉給還沒登入過的同仁,那時候拿不到對方的 uid;
 * Email 則是成員名單裡就有的穩定識別。
 */
const myEmail = () => (state.user?.email || "").toLowerCase();
const isMine = (plan) => (plan.ownerEmail || "").toLowerCase() === myEmail();

/**
 * 誰看得到這個計畫:組長只有自己的、主任加上同處室、管理員全部。
 * 資料層已經用查詢條件和安全規則擋過一次,這裡是第二道防線 ——
 * 萬一查詢或快取出問題,畫面也不會把別人的計畫顯示出來。
 */
function canSee(plan) {
  if (!state.user || !state.member) return false;
  const role = roleOf(state.member);
  if (role === "admin") return true;
  if (isMine(plan)) return true;
  if (role === "director") return plan.dept === state.member.dept;
  return false;
}

/** 行事曆記事只有寫的人和管理員能改 */
const canEditNote = (n) => (n.ownerEmail || "").toLowerCase() === myEmail() || isAdmin();

/**
 * 誰看得到這則記事:全校的大家都看得到、自己寫的一定看得到、
 * 「同處室」的只有同處室的人看得到。
 * 資料層已經用查詢條件和安全規則擋過一次,這裡是第二道防線。
 */
function canSeeNote(n) {
  if ((n.ownerEmail || "").toLowerCase() === myEmail()) return true;
  const scope = noteScopeOf(n);
  if (scope === "all") return true;
  if (scope === "dept") return !!n.dept && n.dept === state.member?.dept;
  return false;
}

/**
 * 誰能編輯這個計畫:只有承辦人自己和管理員。
 * 主任看得到同處室的計畫,但不能代為修改 —— 責任歸屬留給承辦人。
 */
function canEdit(plan) {
  if (!state.user || !state.member) return false;
  return isMine(plan) || roleOf(state.member) === "admin";
}

/* ---------------- 登入流程 ---------------- */

/** 總覽的標題要照角色講清楚看得到的範圍,免得以為資料掉了 */
function applyScopeLabels() {
  const role = roleOf(state.member);
  const dept = state.member?.dept || "";
  const map = {
    admin: ["全校行政工作總覽", "全校同仁的行政計畫進度都在這裡,逾期與久未更新的工作會被標示出來。"],
    director: [`${dept}工作總覽`,
      `你是${dept}主任,這裡列出${dept}所有同仁的計畫供你掌握進度;其他處室不會顯示,他人的計畫也只能檢視、不能修改。`],
    staff: ["我的工作總覽", "這裡列出你自己建立的計畫。若要看同處室其他人的進度,請洽處室主任。"]
  };
  const [title, desc] = map[role] || map.staff;
  $("#dashboard-title").textContent = title;
  $("#dashboard-desc").textContent = desc;
}

function showView(name) {
  for (const v of ["loading", "login", "denied", "app"]) show($(`#view-${v}`), v === name);
}

$("#btn-signin").addEventListener("click", async () => {
  const err = $("#login-error");
  show(err, false);
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (e) {
    if (e.code === "auth/popup-closed-by-user" || e.code === "auth/cancelled-popup-request") return;
    err.textContent = e.code === "auth/unauthorized-domain"
      ? "這個網址尚未被加入 Firebase 的授權網域,請聯絡系統管理員。"
      : `登入失敗:${e.message}`;
    show(err, true);
  }
});

const doSignOut = () => signOut(auth);
$("#btn-signout").addEventListener("click", doSignOut);
$("#btn-signout-denied").addEventListener("click", doSignOut);

const authHandler = async (user) => {
  state.unsubscribe.forEach((fn) => fn());
  state.unsubscribe = [];

  if (!user) {
    state.user = null;
    state.member = null;
    showView("login");
    return;
  }

  state.user = user;
  const email = (user.email || "").toLowerCase();

  let snap, readErr = null;
  try {
    snap = await getDoc(doc(db, "allowlist", email));
  } catch (e) {
    // 讀取被規則擋下,一樣視為未授權,但要記下原因
    readErr = e;
    snap = { exists: () => false };
  }

  if (!snap.exists()) {
    $("#denied-email").textContent = user.email || "";
    // 規則沒更新時所有人都會被擋在門外,要講清楚免得誤以為是名單問題
    show($("#denied-rules"), readErr?.code === "permission-denied");
    showView("denied");
    return;
  }

  state.member = snap.data();
  $("#user-name").textContent =
    `${state.member.name}${state.member.dept ? "・" + state.member.dept : ""}` +
    `(${ROLE_LABEL[roleOf(state.member)]})`;
  $$(".admin-only").forEach((el) => { el.hidden = !isAdmin(); });

  loadView();            // 上次的篩選、排序、展開狀態(這台裝置、這個帳號)
  syncFilterFields();
  syncSortUI();
  applyScopeLabels();
  showView("app");
  subscribeData();
  setTab(state.tab);
};

if (!DEMO) onAuthStateChanged(auth, authHandler);

/* ---------------- 資料訂閱 ---------------- */

/**
 * 依角色決定看得到哪些計畫。
 * 這裡下的 where 條件必須和安全規則一致,否則 Firestore 會直接拒絕整個查詢。
 * 主任要看「同處室」加上「自己的」,所以是兩個查詢再合併。
 * 一律不帶 orderBy,改由前端排序,可以省掉建立複合索引的麻煩。
 */
function planQueries() {
  const ref = collection(db, "plans");
  const role = roleOf(state.member);
  if (role === "admin") return [query(ref)];
  if (role === "director") {
    return [
      query(ref, where("dept", "==", state.member.dept || "")),
      query(ref, where("ownerEmail", "==", myEmail()))
    ];
  }
  return [query(ref, where("ownerEmail", "==", myEmail()))];
}

function subscribeData() {
  const queries = planQueries();
  const buckets = queries.map(() => []);

  const merge = () => {
    // 多個查詢可能撈到同一筆,用 id 去重(排序留到畫面上,依老師選的方式)
    const byId = new Map();
    buckets.flat().forEach((p) => byId.set(p.id, p));
    state.plans = [...byId.values()].filter(canSee);   // 第二道防線,見 canSee 的說明
    fillYearSelects();     // 學年度選單要包含資料裡實際出現過的年度
    fillOwnerFilter();
    renderPlanLists();
    if (isAdmin()) renderMembers();   // 成員表的「名下計畫」件數會跟著計畫變動
    if (state.tab === "calendar") renderCalendar();
  };

  queries.forEach((q, i) => {
    state.unsubscribe.push(onSnapshot(q, (snap) => {
      buckets[i] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      state.loadError = "";
      merge();
    }, (e) => {
      console.error("讀取計畫失敗", e);
      // 不要讓老師只看到空白畫面,把原因說出來
      state.loadError = e.code === "permission-denied"
        ? "資料庫拒絕讀取。多半是 Firestore 安全規則還是舊版本,請把專案裡的 firestore.rules 重新貼到 Firebase 主控台並發布。"
        : `讀取計畫失敗:${e.message}`;
      renderDashboard();
    }));
  });

  // 行事曆記事分三種可見範圍,所以要分三個查詢再合併 ——
  // 安全規則會擋掉看不到的,不分開查會整個查詢被拒絕。
  const noteRef = collection(db, "notes");
  const noteQueries = [
    query(noteRef, where("scope", "==", "all")),
    query(noteRef, where("ownerEmail", "==", myEmail())),
    query(noteRef, where("scope", "==", "dept"), where("dept", "==", state.member?.dept || ""))
  ];
  const noteBuckets = noteQueries.map(() => []);
  const mergeNotes = () => {
    const byId = new Map();
    noteBuckets.flat().forEach((n) => byId.set(n.id, n));
    state.notes = [...byId.values()].filter(canSeeNote);   // 第二道防線
    if (state.tab === "calendar") renderCalendar();
  };
  noteQueries.forEach((q, i) => {
    state.unsubscribe.push(onSnapshot(q, (snap) => {
      noteBuckets[i] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      mergeNotes();
    }, (e) => console.error("讀取記事失敗", e)));
  });

  // 自訂範本是全校共用的,每位老師都要讀得到
  state.unsubscribe.push(
    onSnapshot(collection(db, "templates"), (snap) => {
      state.templates = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => String(a.label || "").localeCompare(String(b.label || ""), "zh-Hant"));
      fillTemplateSelect();
    }, (e) => console.error("讀取範本失敗", e))
  );

  // 成員名單只有管理員的畫面用得到
  if (isAdmin()) {
    state.unsubscribe.push(
      onSnapshot(collection(db, "allowlist"), (snap) => {
        state.members = snap.docs.map((d) => ({ email: d.id, ...d.data() }));
        renderMembers();
      }, (e) => console.error("讀取成員失敗", e))
    );
  }
}

/* ---------------- 分頁切換 ---------------- */

// 左側快捷鈕只在會列出計畫的分頁出現。
// 行事曆和成員管理沒有計畫清單可以排序;已結案固定照結案日期排,也不該被改掉。
const FAB_TABS = ["mine", "dashboard", "search"];

function setTab(tab) {
  state.tab = tab;
  $$(".tab").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
  for (const p of ["dashboard", "search", "calendar", "closed", "mine", "members"]) {
    show($(`#panel-${p}`), p === tab);
  }
  // 排序與新增只有一份,搬進當前分頁標題右邊的插槽 ——
  // 這樣按鈕永遠在標題旁邊,而事件處理器不必為每個分頁各綁一次。
  const rail = $("#fab-rail");
  show(rail, FAB_TABS.includes(tab));
  if (FAB_TABS.includes(tab)) {
    const slot = $(`#panel-${tab} [data-action-slot]`);
    if (slot && rail.parentElement !== slot) slot.appendChild(rail);
  }
  showSortMenu(false);
  if (tab === "calendar") renderCalendar();
  // 切到搜尋就直接可以打字,不用再點一次輸入框
  if (tab === "search") $("#search-q").focus();
}
$$(".tab").forEach((btn) => btn.addEventListener("click", () => setTab(btn.dataset.tab)));

/* ---------------- 選單填充 ---------------- */

/**
 * 學年度選單:以今天推算的近幾年為底,再併入資料裡實際出現過的學年。
 * 這樣每年會自動往前推進,而且舊學年不會因為年代久遠就從選單消失。
 */
function yearOptions() {
  const y = currentAcademicYear();
  const fromData = state.plans.map((p) => Number(p.year)).filter((n) => Number.isFinite(n));
  return [...new Set([y + 1, y, y - 1, y - 2, y - 3, ...fromData])].sort((a, b) => b - a);
}

/** 學年度選單會隨資料變動,計畫載入後要重新產生 */
function fillYearSelects() {
  const opts = yearOptions().map((y) => [String(y), `${y} 學年度`]);
  fillSelect($("#f-year"), opts, { placeholder: "全部學年" });
  $("#f-year").value = state.filters.year;
  // 上次記住的學年度可能已經沒有對應選項了,讓 state 跟著畫面走,
  // 否則會出現「選單顯示全部學年、清單卻是空的」這種說不通的畫面
  if ($("#f-year").value !== state.filters.year) state.filters.year = $("#f-year").value;
  fillSelect($('#form-plan select[name="year"]'), opts);
}

function optionsHtml(items) {
  return items.map((it) => {
    const [v, label] = Array.isArray(it) ? it : [it, it];
    return `<option value="${esc(v)}">${esc(label)}</option>`;
  }).join("");
}

/** 換掉選單內容,但盡量保留使用者原本選的值(選項還在的話) */
function fillSelectHtml(sel, html, { placeholder } = {}) {
  const keep = sel.value;
  sel.innerHTML = (placeholder ? `<option value="">${esc(placeholder)}</option>` : "") + html;
  if ([...sel.options].some((o) => o.value === keep)) sel.value = keep;
}

const fillSelect = (sel, items, opts) => fillSelectHtml(sel, optionsHtml(items), opts);

/**
 * 公文單位的選項,卡片與篩選列共用同一份來源。
 * 「承辦人手上」代表沒有送出去,值是空字串:
 *   - 卡片上的位置選單要有它(選了等於文件收回自己手上)
 *   - 篩選列不需要,「公文所在」問的是送到哪裡去了,篩自己手上等於沒篩
 */
function unitOptionsHtml({ selected = null, withDefault = false } = {}) {
  const mark = (v) => (selected !== null && (selected || "") === v ? " selected" : "");
  return (withDefault ? `<option value=""${mark("")}>${esc(DEFAULT_UNIT)}</option>` : "") +
    UNIT_GROUPS
      .filter((g) => !g.units.includes(DEFAULT_UNIT))
      .map((g) => `<optgroup label="${esc(g.label)}">${g.units
        .map((u) => `<option value="${esc(u)}"${mark(u)}>${esc(u)}</option>`).join("")}</optgroup>`)
      .join("");
}

const fillUnitSelect = (sel, opts) => fillSelectHtml(sel, unitOptionsHtml(), opts);

function fillOwnerFilter() {
  // 掃一次就好:同一個 Email 只留第一次看到的姓名
  const byEmail = new Map();
  livePlans().forEach((p) => {
    const email = (p.ownerEmail || "").toLowerCase();
    if (email && !byEmail.has(email)) byEmail.set(email, p.ownerName || email);
  });
  const owners = [...byEmail].sort((a, b) => a[1].localeCompare(b[1], "zh-Hant"));
  fillSelect($("#f-owner"), owners, { placeholder: "全部" });

  // 選單裡已經沒有這個人了(例如計畫全部移交出去),把篩選清掉,
  // 否則畫面會永遠空白而且看不出原因
  if (state.filters.owner && !owners.some(([email]) => email === state.filters.owner)) {
    state.filters.owner = "";
  }
  $("#f-owner").value = state.filters.owner;
}

function buildDatalists() {
  $("#datalists").innerHTML = STAGES.map((st) =>
    `<datalist id="sug-${st.id}">${optionsHtml(STEP_SUGGESTIONS[st.id] || [])}</datalist>`).join("");
}

function initSelects() {
  buildDatalists();

  fillYearSelects();
  fillSelect($("#f-dept"), DEPARTMENTS, { placeholder: "全部" });
  fillSelect($("#f-stage"), STAGES.map((s) => [s.id, s.label]), { placeholder: "全部" });
  fillUnitSelect($("#f-unit"), { placeholder: "全部" });

  fillSelect($('#form-plan select[name="dept"]'), DEPARTMENTS, { placeholder: "請選擇" });
  fillTemplateSelect();
  fillSelect($('#form-plan select[name="recurring"]'), RECURRENCES.map((r) => [r.id, r.label]));

  fillSelect($('#form-member select[name="dept"]'), DEPARTMENTS, { placeholder: "請選擇" });
  fillSelect($("#member-role"), ROLES.map((r) => [r.id, r.label]));
}
initSelects();
initThemeToggle();                             // 深/淺色切換(內部會呼叫 applyAccent)
initAccentPicker();                            // 讀回上次選的主題色並掛上選色面板
$("#app-version").textContent = APP_VERSION;   // 單字代號當版本號,由 ./bump.sh 換下一個

// 註冊 service worker,讓系統可以「加到主畫面」、沒網路時也開得起來。
// 失敗不影響使用(例如用 file:// 開啟時),所以直接忽略錯誤。
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

// 選角色時把說明帶出來
$("#member-role").addEventListener("change", (e) => {
  $("#role-hint").textContent = ROLES.find((r) => r.id === e.target.value)?.desc || "";
});

/* ---------------- 篩選列 ---------------- */

const FILTER_FIELDS = {
  year: "#f-year", dept: "#f-dept", owner: "#f-owner",
  stage: "#f-stage", unit: "#f-unit", status: "#f-status"
};
for (const [key, sel] of Object.entries(FILTER_FIELDS)) {
  $(sel).addEventListener("input", (e) => {
    state.filters[key] = e.target.value;
    afterFilterChange();
  });
}

// 搜尋是逐字輸入,稍等一下再重繪,免得每按一鍵就重建整份清單
let searchTimer;
$("#search-q").addEventListener("input", (e) => {
  state.query = e.target.value;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    renderSearch();
    announce($("#search-count").textContent);
  }, 200);
});
$("#f-sort").addEventListener("change", (e) => setSort(e.target.value));

/* ---------------- 左側浮動快捷鈕 ---------------- */

// 排序只有一個設定值,但有兩個地方可以改(左側快捷鈕、搜尋的篩選區),
// 所以改完一定要把兩邊都同步回來,不然畫面上會出現兩個不一樣的答案。
const SORT_LABEL = Object.fromEntries(SORTS.map((s) => [s.id, s.label]));

function syncSortUI() {
  $("#f-sort").value = state.sort;
  $("#sort-menu").innerHTML =
    `<div class="fab-menu-head">排序方式</div>` +
    SORTS.map((s) => `<button type="button" role="menuitemradio" data-sort="${s.id}"
      aria-checked="${s.id === state.sort}">${esc(s.label)}</button>`).join("");
  $("#btn-sort").title = `排序方式:${SORT_LABEL[state.sort]}`;
  $("#btn-sort").setAttribute("aria-label", `排序方式,目前是${SORT_LABEL[state.sort]}`);
  $("#sort-label").textContent = `排序:${SORT_LABEL[state.sort]}`;
}

function setSort(mode) {
  state.sort = SORTS.some((s) => s.id === mode) ? mode : "due";
  syncSortUI();
  // 排序會影響承辦工作、總覽和搜尋三張清單,不是只有搜尋
  renderPlanLists();
  saveView();
  announce(`已改成依${SORT_LABEL[state.sort]}排序`);
}

function showSortMenu(open) {
  show($("#sort-menu"), open);
  $("#btn-sort").setAttribute("aria-expanded", String(open));
}

$("#btn-sort").addEventListener("click", (e) => {
  e.stopPropagation();
  showSortMenu($("#sort-menu").hidden);
});
$("#sort-menu").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-sort]");
  if (!btn) return;
  setSort(btn.dataset.sort);
  showSortMenu(false);
  $("#btn-sort").focus();
});
// 點別的地方或按 Esc 就收起來
document.addEventListener("click", () => showSortMenu(false));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("#sort-menu").hidden) {
    showSortMenu(false);
    $("#btn-sort").focus();
  }
});

// 篩選或排序改過之後:重畫搜尋結果、記住這次的選擇,
// 並把件數講給螢幕閱讀器聽(看不到清單長度的人才知道篩出幾件)
function afterFilterChange() {
  renderSearch();
  saveView();
  announce($("#search-count").textContent);
}

// 點統計磚 = 「這幾件是哪些?」→ 切到搜尋分頁,條件直接套好。
// 篩選條件都搬到搜尋之後,磚就是通往搜尋的捷徑。兩排(處室總覽、承辦工作)共用這段。
document.addEventListener("click", (e) => {
  const tile = e.target.closest(".stat-row [data-stat]");
  if (!tile) return;
  const key = tile.dataset.stat;
  const mine = tile.closest("#mine-stat-row");   // 承辦工作那排只看自己的

  // 「已完成」有自己的分頁,直接帶過去
  if (key === "done") { setTab("closed"); return; }

  // 範圍要和磚上的數字一致:總覽是本學年度全部人,承辦工作是自己的(不限學年度)
  state.filters = mine
    ? { ...defaultFilters(), owner: myEmail() }
    : { ...defaultFilters(), year: String(currentAcademicYear()) };
  if (key === "stuck") state.filters.stuck = true;   // 卡關是獨立條件,不屬於計畫狀態
  else state.filters.status = key;
  state.query = "";
  $("#search-q").value = "";
  syncFilterFields();
  setTab("search");
  afterFilterChange();
});

$("#f-trash").addEventListener("change", (e) => {
  state.filters.trash = e.target.checked;
  afterFilterChange();
});

$("#f-reset").addEventListener("click", () => {
  state.filters = defaultFilters();
  syncFilterFields();
  afterFilterChange();
});

/** 桌機一律展開篩選,手機收起來省空間;收起時在標題顯示還有幾個條件生效 */
function syncFilterBox() {
  const box = $("#filter-box");
  const wide = window.innerWidth > 720;
  if (wide) box.open = true;
  else if (!box.dataset.touched) box.open = false;

  const active = Object.entries(state.filters).filter(([, v]) => v).length;
  $("#filter-count").textContent = active ? `已套用 ${active} 項` : "";
}
$("#filter-box").addEventListener("toggle", (e) => {
  // 使用者自己開合過就不要再自動幫他收起來
  if (window.innerWidth <= 720) e.target.dataset.touched = "1";
});
window.addEventListener("resize", syncFilterBox);


function applyFilters(plans) {
  const { year, dept, owner, stage, unit, status, stuck, trash } = state.filters;
  return plans.filter((p) => {
    // 垃圾桶是獨立檢視:平常不顯示已刪除的,打開時只顯示已刪除的
    if (trash !== !!p.deletedAt) return false;
    if (stuck && !hasStuckDoc(p)) return false;
    if (year && String(p.year) !== year) return false;
    if (dept && p.dept !== dept) return false;
    if (owner && (p.ownerEmail || "").toLowerCase() !== owner) return false;
    if (unit && !unitsOf(p).includes(unit)) return false;
    if (stage && currentStage(p)?.id !== stage) return false;
    // open = 還在辦(沒結案的都算),其餘就是各自的狀態
    if (status === "open" ? statusOf(p) === "done" : (status && statusOf(p) !== status)) return false;
    return true;
  });
}

/* ---------------- 畫面繪製 ---------------- */

function renderStats(plans, target = "#stat-row") {
  const counts = { total: plans.length, active: 0, overdue: 0, stale: 0, done: 0 };
  plans.forEach((p) => { counts[statusOf(p)]++; });

  const stuck = plans.filter((p) => hasStuckDoc(p)).length;
  // 選取狀態只有處室總覽那排要顯示 —— 承辦工作那排點了就跳走,不會停在選取中
  const pressed = target === "#stat-row";

  // 「進行中」= 這一頁清單上的件數(還沒結案的全部),不是只算沒出狀況的那幾件。
  // 逾期與待更新是它的子集,拿來提醒哪幾件要先處理。
  const tiles = [
    { key: "open", label: "進行中", value: counts.total - counts.done, color: STATUS_META.active.color },
    // 逾期與卡關的數字本身上色 —— 這兩個是要立刻處理的,只有小圓點不夠醒目
    { key: "overdue", label: "逾期", value: counts.overdue, color: STATUS_META.overdue.color, tint: true },
    { key: "stale", label: "待更新", value: counts.stale, color: STATUS_META.stale.color },
    { key: "done", label: "已完成", value: counts.done, color: STATUS_META.done.color },
    { key: "stuck", label: "公文卡關", value: stuck, color: "var(--status-serious)", separate: true, tint: true }
  ];

  // 統計磚同時是篩選捷徑:點「逾期」就只看逾期的計畫
  $(target).innerHTML = tiles.map((t) => `
    <button type="button" class="stat" data-stat="${esc(t.key)}"
            aria-pressed="${pressed && (t.separate ? state.filters.stuck : state.filters.status === t.key)}">
      <span class="stat-label">
        <span class="dot" style="background:${t.color}"></span>${esc(t.label)}
      </span>
      <span class="stat-value" style="${t.tint ? `color:${t.color}` : ""}">${String(t.value).padStart(2, "0")}</span>
    </button>`).join("");
}

/** 四階段進度條 */
/**
 * 四階段進度。格子本身只當細線進度條,名稱與件數列在下方一行,
 * 目前所在的階段標「← 現在」——原本四個色塊面積太大,會搶掉標題。
 */
function stageBarHtml(plan) {
  const cur = currentStage(plan);
  const rows = stageProgress(plan).map((r) => {
    // 注意:修飾類別不要用 empty,會撞到「查無資料」佔位框的 .empty
    const cls = r.total === 0 ? "blank" : r.complete ? "complete" : (cur && cur.id === r.id ? "current" : "pending");
    return { ...r, cls, count: r.total ? `${r.done}/${r.total}` : "—" };
  });

  return `
    <div class="stage-track" role="list" aria-label="計畫階段">
      ${rows.map((r) => {
        const foot = r.cls === "complete" ? "已完成"
          : r.cls === "current" ? "進行中"
          : r.cls === "blank" ? "無步驟" : "未開始";
        return `<div class="stage-node is-${r.cls}" role="listitem"
             title="${esc(r.label)} ${r.count}・${esc(r.hint)}">
          <span class="stage-dot" aria-hidden="true"></span>
          <span class="stage-name">${esc(r.label)}</span>
          <span class="stage-count">${r.count} ・ ${foot}</span>
        </div>`;
      }).join("")}
    </div>`;
}

function meterHtml(plan) {
  const { done, total, pct } = progressOf(plan);
  return `
    <div class="meter">
      <div class="meter-main">
        <div class="meter-track" role="progressbar" aria-label="完成度"
             aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
          <div class="meter-fill" style="width:${pct}%"></div>
        </div>
      </div>
      <div>
        <div class="meter-big">${pct}<small>%</small></div>
        <div class="meter-steps num">${total ? `${done} / ${total} 步驟` : "尚未建立步驟"}</div>
      </div>
    </div>`;
}

/** 步驟狀態的選項。locked = 前一批公文還沒完成,不能選「進行中」「已完成」 */
function statusOptionsHtml(current, locked = false) {
  return STEP_STATUSES.map((v) => {
    // 鎖住的步驟仍可先標「本次不適用」,只是不能搶在前一批公文之前開始
    const off = locked && (v === "doing" || v === "done") && current !== v;
    return `<option value="${v}"${current === v ? " selected" : ""}${off ? " disabled" : ""}>${
      STEP_LABEL[v]}</option>`;
  }).join("");
}

/** 一列步驟。inBundle 為 true 時不顯示個別位置選單,位置由整批共用 */
function stepRowHtml(plan, s, editable, inBundle) {
  const today = todayStr();
  const na = s.status === "na";

  // 期限提示:逾期標紅、七天內標黃,讓老師不用自己算天數
  const due = effectiveDue(s, plan);
  const left = daysLeft(s, today, plan);
  let dueHtml = "";
  if (due && !na) {
    let tail = "", cls = "";
    if (left === null) tail = "";
    else if (left < 0) { tail = "(已逾期)"; cls = "overdue"; }
    else if (left === 0) { tail = "(今天到期)"; cls = "due-soon"; }
    else if (left <= 7) { tail = `(還有 ${left} 天)`; cls = "due-soon"; }
    // 沒自己填期限的結案步驟,標明期限是系統依結算寬限期推算的
    const src = s.due ? "" : "(結算期限)";
    dueHtml = `<span class="${cls}">期限 ${esc(due)}${src}${tail}</span>`;
  }

  // 進行中的步驟改用「已進行 N 天」,不需要每個步驟各自填日期
  const running = s.status === "doing" && s.startedAt
    ? `<span class="running">已進行 ${daysBetween(s.startedAt, today)} 天(${esc(s.startedAt)} 起)</span>`
    : "";

  // 還沒輪到的步驟:前一批公文沒完成前,不讓它改成進行中或已完成
  const gate = gateOf(plan.steps || [], s._i);
  const waitHtml = gate.locked && gate.lead && s.status === "todo"
    ? `<span class="wait-note">等「${esc(gate.waitFor)}」完成</span>`
    : "";

  const sub = [
    running,
    dueHtml,
    waitHtml,
    na ? `<span class="na-note">本次不需要辦理</span>` : "",
    s.status === "done" && s.doneAt ? `<span class="done-at">✓ ${esc(s.doneAt)} 完成</span>` : "",
    s.note ? `<span>${esc(s.note)}</span>` : ""
  ].filter(Boolean).join("");

  const loc = s.location || DEFAULT_UNIT;
  const statusSelect = `
    <select class="step-status" data-plan="${esc(plan.id)}" data-step="${s._i}" aria-label="步驟狀態"${
      gate.locked ? ` title="要等「${esc(gate.waitFor)}」完成"` : ""}>
      ${statusOptionsHtml(s.status, gate.locked)}
    </select>`;

  const controls = editable
    ? `<div class="step-controls">
         ${inBundle || na ? "" : `
           <select class="step-loc" data-plan="${esc(plan.id)}" data-step="${s._i}" aria-label="這份文件目前在哪">
             ${unitOptionsHtml({ selected: s.location || "", withDefault: true })}
           </select>`}
         ${statusSelect}
       </div>`
    : `<div class="step-controls">
         <span class="step-sub">${!inBundle && loc !== DEFAULT_UNIT ? `在 ${esc(loc)}・` : ""}${STEP_LABEL[s.status] || ""}</span>
       </div>`;

  const away = !inBundle && !na && s.location && s.location !== DEFAULT_UNIT && s.status !== "done";
  const gone = daysAway(s, plan);
  const stuck = isStuck(s, plan);
  const awayTag = away
    ? `<span class="away-tag${stuck ? " stuck" : ""}">
         <span aria-hidden="true">${stuck ? "⚠" : "📄"}</span>已送至 ${esc(s.location)}${
           gone === null ? "" : `・${gone} 天${stuck ? "(卡關)" : ""}`}
       </span>`
    : "";

  return `
    <div class="step-row" data-status="${esc(s.status)}">
      <span class="step-marker" aria-hidden="true">${STEP_MARK[s.status] || "○"}</span>
      <div class="step-main">
        <div class="step-title">
          ${esc(s.title)}
          ${awayTag}
        </div>
        ${sub ? `<div class="step-sub">${sub}</div>` : ""}
      </div>
      ${controls}
    </div>`;
}

/** 步驟清單,依階段分組,同一批公文再收成一個框 */
function stepsHtml(plan, editable) {
  const steps = plan.steps || [];
  if (!steps.length) {
    return `<div class="steps"><p class="muted small" style="margin:10px 0 0">這個計畫還沒有步驟。</p></div>`;
  }

  const indexed = steps.map((s, i) => ({ ...s, _i: i }));

  return `<div class="steps">` + STAGES.map((st) => {
    const rows = indexed.filter((s) => stageOf(s) === st.id);
    if (!rows.length) return "";

    const body = groupBundles(rows).map((bundle) => {
      if (bundle.length === 1) return stepRowHtml(plan, bundle[0], editable, false);

      // 整批一起送:位置只有一個共用的選單,改一次全部跟著動
      const live = bundle.filter((s) => s.status !== "na");
      const loc = (live.find((s) => s.location)?.location) || DEFAULT_UNIT;
      const idxs = live.map((s) => s._i).join(",");
      const naCount = bundle.length - live.length;

      // 整批送出去幾天了(取這批裡最久的一份)
      const bundleDays = live.reduce((max, s) => {
        const d = daysAway(s, plan);
        return d !== null && (max === null || d > max) ? d : max;
      }, null);
      const bundleStuck = bundleDays !== null && bundleDays >= STUCK_DAYS;
      const daysTag = loc !== DEFAULT_UNIT && bundleDays !== null
        ? `<span class="away-tag${bundleStuck ? " stuck" : ""}">
             <span aria-hidden="true">${bundleStuck ? "⚠" : "📄"}</span>已送出 ${bundleDays} 天${bundleStuck ? "(卡關)" : ""}
           </span>`
        : "";

      const foot = editable && live.length
        ? `<div class="bundle-foot">
             <span class="muted small">這批文件目前在</span>
             <select class="bundle-loc" data-plan="${esc(plan.id)}" data-steps="${idxs}"
                     aria-label="這批文件目前在哪">${
                       unitOptionsHtml({ selected: loc === DEFAULT_UNIT ? "" : loc, withDefault: true })}</select>
             ${daysTag}
           </div>`
        : (live.length
            ? `<div class="bundle-foot"><span class="muted small">這批文件目前在 ${esc(loc)}</span>${daysTag}</div>`
            : "");

      return `
        <div class="bundle">
          <div class="bundle-head">
            <span class="bundle-tag"><span aria-hidden="true">📎</span>一起送件</span>
            <span class="muted small">${live.length} 份文件併成一份公文,狀態一起更新${
              naCount ? `(另 ${naCount} 份本次不適用)` : ""}</span>
          </div>
          ${bundle.map((s) => stepRowHtml(plan, s, editable, true)).join("")}
          ${foot}
        </div>`;
    }).join("");

    return `
      <div class="stage-group">
        <div class="stage-group-head">${esc(st.label)}階段<span class="muted small">・${esc(st.hint)}</span></div>
        ${body}
      </div>`;
  }).join("") + `</div>`;
}

/** 職務交接紀錄 */
function handoverHtml(plan) {
  const rows = plan.handovers || [];
  if (!rows.length) return "";
  return `
    <div class="flow-log">
      <div class="stage-group-head">職務交接紀錄</div>
      <ol class="flow-list">
        ${[...rows].reverse().map((h) => `
          <li>
            <span class="flow-date">${esc(h.date)}</span>
            <span class="flow-move">${esc(h.fromName)} <span aria-hidden="true">→</span> <b>${esc(h.toName)}</b></span>
            ${h.byName ? `<span class="muted">由 ${esc(h.byName)} 辦理</span>` : ""}
          </li>`).join("")}
      </ol>
    </div>`;
}

/** 公文流轉紀錄。記錄是自動寫的,選錯單位時要能把那一筆刪掉 */
function flowHtml(plan, editable) {
  // 帶著原始索引再排序,刪除時才知道要刪陣列裡的哪一筆
  const flow = (plan.flow || [])
    .map((f, i) => ({ ...f, _i: i }))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || b._i - a._i);
  if (!flow.length) return "";

  return `
    <div class="flow-log">
      <div class="stage-group-head">公文流轉紀錄</div>
      <ol class="flow-list">
        ${flow.map((f) => `
          <li>
            <span class="flow-date">${esc(f.date)}</span>
            ${f.step ? `<span class="flow-step">${esc(f.step)}</span>` : ""}
            <span class="flow-move">${esc(f.from || "—")} <span aria-hidden="true">→</span> <b>${esc(f.to)}</b></span>
            ${f.stage ? `<span class="flow-tag">${esc(STAGE_LABEL[f.stage] || "")}階段</span>` : ""}
            ${f.note ? `<span class="muted">${esc(f.note)}</span>` : ""}
            ${editable ? `<button class="icon-btn icon-danger flow-del" data-act="flow-del"
                    data-id="${esc(plan.id)}" data-flow="${f._i}"
                    title="刪除這筆紀錄" aria-label="刪除這筆流轉紀錄">✕</button>` : ""}
          </li>`).join("")}
      </ol>
    </div>`;
}

/**
 * 公文流向軌道。把 plan.flow 的流轉紀錄接成一條橫向軌道:
 * 走過的節點、現在停在哪、還沒送出的下一站。
 *
 * 為什麼不用 documentsOut() 的一排小標籤:那只講「現在在誰手上」,
 * 看不出來已經跑過幾關、每一關卡了幾天。主任最常問的是
 * 「這件卡在哪、卡多久了」,一條軌道比幾個標籤直接。
 *
 * 每一關的天數 = 這一筆到下一筆之間的日數;最後一筆(還在外面的那關)
 * 算到今天為止,所以會一天一天長,超過 STUCK_DAYS 就標紅。
 */
function flowTrackHtml(plan, foot = "") {
  const flow = (plan.flow || [])
    .filter((f) => f.to)
    .slice()
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (!flow.length) return "";

  // 現在還在外面的單位(可能有好幾個,取停最久的那個當「現在」)
  const out = documentsOut(plan);
  const liveUnit = out.length
    ? out.slice().sort((a, b) => (b.days ?? 0) - (a.days ?? 0))[0]
    : null;

  const today = new Date();
  const dayGap = (a, b) => {
    const d1 = toDate(a), d2 = b ? toDate(b) : today;
    if (!d1 || !d2) return null;
    return Math.max(0, Math.round((d2 - d1) / 86400000));
  };

  // 起點是第一筆的 from(通常是承辦人手上),之後每一筆的 to 接成一站
  const nodes = [];
  // 起點的「送出」帶上日期 —— 整條軌道的其他站都有天數,只有這一站沒有時間感
  const md = (d) => String(d || "").slice(5).replace("-", "/");
  if (flow[0].from) {
    nodes.push({ unit: flow[0].from, days: null, state: "past",
      note: flow[0].date ? `${md(flow[0].date)} 送出` : "送出" });
  }
  flow.forEach((f, i) => {
    const next = flow[i + 1];
    const days = dayGap(f.date, next ? next.date : null);
    const isLast = !next;
    const live = isLast && liveUnit && liveUnit.unit === f.to;
    nodes.push({
      unit: f.to,
      days,
      date: f.date,
      state: live ? (liveUnit.stuck ? "stuck" : "live") : "past",
      note: live ? (liveUnit.stuck ? "卡關" : "處理中") : "已轉出"
    });
  });

  // 還沒送出的下一站:用下一批文件的位置推,沒有就不畫
  const nxt = nextBundle(plan);
  if (nxt && !liveUnit) nodes.push({ unit: "承辦人手上", days: null, state: "todo", note: "待送出" });

  const worst = nodes.find((n) => n.state === "stuck");
  const head = worst
    ? `<span class="track-warn">⚠ 停在${esc(worst.unit)} ${worst.days} 天,已超過 ${STUCK_DAYS} 天門檻</span>`
    : (liveUnit
        ? `<span class="track-note">在外 ${liveUnit.days ?? 0} 天,正常</span>`
        : `<span class="track-note">目前沒有在外的公文</span>`);

  return `
    <div class="flow-track">
      <div class="track-head">
        <span class="track-label">DOCUMENT FLOW</span>
        ${head}
      </div>
      <div class="track" role="list" aria-label="公文流向">
        ${nodes.map((n) => `
          <div class="track-node is-${n.state}" role="listitem">
            <span class="track-dot" aria-hidden="true"></span>
            <span class="track-unit">${esc(n.unit)}</span>
            <span class="track-days num">${n.days === null ? esc(n.note) : `${n.days} 天・${esc(n.note)}`}</span>
          </div>`).join("")}
      </div>
      ${foot}
    </div>`;
}

function planCard(plan, { editable }) {
  const st = statusOf(plan);
  const meta = STATUS_META[st];
  const open = state.expanded.has(plan.id);
  const period = periodText(plan);

  // 在外文件一覽:哪一份文件送到哪裡去了
  const out = documentsOut(plan);
  const legacy = plan.location && plan.location !== DEFAULT_UNIT && !out.length
    ? `<span class="loc-chip">📄 公文在:<b>${esc(plan.location)}</b></span>` : "";
  // 下一步:一眼看出現在該做什麼,不用展開明細
  // 下一步不只是提示,也可以直接在這裡打勾完成 —— 不必每次都展開明細。
  // 一起送的整批會同時完成,完成後下一批自動接上,卡片上的字跟著換。
  const nxt = nextBundle(plan);
  // 這一批文件現在在哪(整批共用一個位置,取第一個有填的)
  const nextLoc = nxt ? ((plan.steps || []).find((s, i) => nxt.idxs.includes(i) && s.location)?.location || "") : "";
  const nextChip = nxt
    ? `<span class="next-chip">
         <span class="next-label"><span aria-hidden="true">▶</span>下一步:<b>${esc(nxt.text)}</b></span>
         ${editable ? `
           <select class="next-loc bundle-loc" data-plan="${esc(plan.id)}"
                   data-steps="${nxt.idxs.join(",")}"
                   aria-label="這批文件目前在哪" title="這批文件目前在哪">
             ${unitOptionsHtml({ selected: nextLoc, withDefault: true })}
           </select>
           <button class="btn btn-sm next-done" data-act="step-done" data-id="${esc(plan.id)}"
                   title="把「${esc(nxt.titles.join("、"))}」標記為已完成,並自動接下一步">
             <span aria-hidden="true">✓</span>完成
           </button>` : ""}
       </span>`
    : ((plan.steps || []).length ? `<span class="next-chip done"><span aria-hidden="true">✓</span>全部步驟已完成</span>` : "");

  // 紙本跑完掃描上傳雲端後貼的連結
  const drive = safeUrl(plan.driveUrl);
  const driveChip = drive
    ? `<a class="drive-chip" href="${esc(drive)}" target="_blank" rel="noopener noreferrer">
         <span aria-hidden="true">📁</span>掃描檔<span class="ext" aria-hidden="true">↗</span></a>`
    : "";

  // 重複性計畫結案後,到了下一次該辦的時間就在卡片上提示
  const due = recurDue(plan);
  const recurRow = due
    ? `<div class="recur-row">
         <span class="recur-tag"><span aria-hidden="true">🔁</span>該辦下一次了</span>
         <span class="muted small">${esc(RECUR_LABEL[plan.recurring] || "")}・下一次建議在 ${esc(due)} 前開始</span>
         ${editable ? `
           <button class="btn btn-sm btn-primary" data-act="copy" data-id="${esc(plan.id)}">建立下一次</button>
           <button class="btn btn-sm btn-ghost" data-act="recur-done" data-id="${esc(plan.id)}">不再提醒</button>` : ""}
       </div>`
    : "";

  // 徽章旁邊直接講「還剩幾天 / 逾期幾天」—— 這是老師看一張卡片最先要知道的事
  const deadlineNote = settlementText(plan);

  // 有流轉紀錄時,位置選單與完成鈕收進軌道框裡(設計稿的樣子);
  // 沒有紀錄的新計畫沒有軌道可以收,維持原本的膠囊。
  // 兩邊用的是同一組 class 與 data-*,所以事件處理與行為完全一樣。
  // 只有真的畫得出軌道時才把控制項收進去 —— 條件要和 flowTrackHtml() 一致,
  // 不然新計畫(還沒有流轉紀錄)會兩邊都不顯示,下一步就整個不見了。
  const hasFlow = (plan.flow || []).some((f) => f.to);
  const trackFoot = hasFlow && nxt && editable
    ? `<div class="track-foot">
         <label class="track-foot-loc">這批文件目前在
           <select class="next-loc bundle-loc" data-plan="${esc(plan.id)}"
                   data-steps="${nxt.idxs.join(",")}"
                   aria-label="這批文件目前在哪">
             ${unitOptionsHtml({ selected: nextLoc, withDefault: true })}
           </select>
         </label>
         <button class="btn btn-sm btn-primary next-done" data-act="step-done" data-id="${esc(plan.id)}"
                 title="把「${esc(nxt.titles.join("、"))}」標記為已完成,並自動接下一步">
           <span aria-hidden="true">✓</span>完成「${esc(nxt.titles[0])}」${
             nxt.titles.length > 1 ? `等 ${nxt.titles.length} 份` : ""}
         </button>
       </div>`
    : "";
  const trackRow = flowTrackHtml(plan, trackFoot);

  // 沒有流轉紀錄可畫軌道時(例如剛建立的計畫),仍用小標籤講在外文件,
  // 不然那些資訊會整段消失。有軌道時就不重複列一次。
  const outChips = trackRow
    ? ""
    : out.map((d) => `<span class="loc-chip${d.stuck ? " stuck" : ""}">
         <span aria-hidden="true">${d.stuck ? "⚠" : "📄"}</span>${esc(d.title)}
         <span aria-hidden="true">→</span> <b>${esc(d.unit)}</b>${
           d.days === null ? "" : `<span class="loc-days">${d.days} 天${d.stuck ? "・卡關" : ""}</span>`}
       </span>`).join("");

  const outRow = ((trackFoot ? "" : nextChip) || outChips || legacy)
    ? `<div class="loc-row">
         ${trackFoot ? "" : nextChip}
         ${outChips}
         ${legacy}
       </div>`
    : "";

  // num: true 的用等寬體。日期與金額散在各張卡片上,等寬才對得齊、掃得快。
  const bits = [
    { t: plan.dept },
    { t: `${plan.year} 學年度 ${TERM_LABEL[String(plan.term)] || ""}`.trim() },
    { t: plan.ownerName || plan.ownerEmail },
    { t: period, num: true },
    { t: plan.budget ? `核定 ${money(plan.budget)} 元` : "", num: true },
    { t: st === "done" && closedAt(plan) ? `結案 ${closedAt(plan)}` : "", num: true },
    // 最後一次更新的人:主任看同處室的計畫時才知道是誰動的
    { t: relativeDays(toDate(plan.updatedAt)) + (plan.updatedByName ? `・${plan.updatedByName}` : "") }
  ].filter((b) => b.t);

  return `
    <article class="plan" data-status="${st}" data-id="${esc(plan.id)}">
      <div class="plan-top">
        <div class="plan-lead">
          <div class="plan-flags">
            <span class="badge ${meta.cls}" aria-label="${meta.label}">${meta.code}</span>
            ${plan.deletedAt ? `<span class="badge badge-stale"><span aria-hidden="true">🗑</span>已刪除 ${esc(plan.deletedAt)}${plan.deletedBy ? `・${esc(plan.deletedBy)}` : ""}</span>` : ""}
            ${deadlineNote ? `<span class="plan-deadline num">${esc(deadlineNote)}</span>` : ""}
          </div>
          <h3 class="plan-title">${esc(plan.title)}</h3>
          <div class="plan-meta">${bits.map((b) => `<span${b.num ? ' class="num"' : ""}>${esc(b.t)}</span>`).join("")}</div>
        </div>
        <div class="plan-actions">
          ${driveChip}
          ${plan.deletedAt ? `${editable ? `
              <button class="btn btn-sm" data-act="restore" data-id="${esc(plan.id)}">還原</button>
              <button class="btn btn-sm btn-danger" data-act="purge" data-id="${esc(plan.id)}">永久刪除</button>` : ""}
          ` : `
            <button class="btn btn-sm" data-act="copy" data-id="${esc(plan.id)}"
                    title="以這個計畫為範本,複製一份到新學年">複製</button>
            ${editable ? `
              <button class="btn btn-sm" data-act="edit" data-id="${esc(plan.id)}">編輯</button>
              <button class="btn btn-sm btn-danger" data-act="delete" data-id="${esc(plan.id)}">刪除</button>` : ""}
          `}
        </div>
      </div>

      ${recurRow}
      ${trackRow}
      ${outRow}
      ${stageBarHtml(plan)}
      ${meterHtml(plan)}
      ${plan.note ? `<p class="plan-note">${esc(plan.note)}</p>` : ""}

      <button class="toggle-steps" data-act="toggle" data-id="${esc(plan.id)}">
        ${open ? "▲ 收合明細" : `▼ 展開明細(${(plan.steps || []).length} 個步驟)`}
      </button>
      ${open ? stepsHtml(plan, editable) + flowHtml(plan, editable) + handoverHtml(plan) : ""}
    </article>`;
}

/** 總覽最上方的提示:有哪些定期計畫該辦下一次了 */
function renderRecurBanner() {
  const box = $("#recur-banner");
  const due = livePlans().filter((p) => recurDue(p));
  show(box, due.length > 0);
  if (!due.length) return;

  box.innerHTML = `
    <span class="recur-tag"><span aria-hidden="true">🔁</span>該辦下一次了</span>
    <span>${due.length} 個定期計畫到了該再辦一次的時間:
      ${due.slice(0, 3).map((p) => esc(p.title)).join("、")}${due.length > 3 ? ` 等 ${due.length} 件` : ""}</span>
    <button type="button" class="btn btn-sm" id="recur-focus">只看這些</button>`;
}

$("#recur-banner").addEventListener("click", (e) => {
  if (!e.target.closest("#recur-focus")) return;
  // 定期計畫都已結案,切到「已完成」並清掉其他條件才看得到
  state.filters = { ...defaultFilters(), year: "", status: "done" };
  state.query = "";
  $("#search-q").value = "";
  syncFilterFields();
  setTab("search");
  afterFilterChange();
});

/** 本週待辦:統計磚給的是數字,這裡直接列出是哪幾件,點了就跳到那張卡片 */
function renderWeekBox() {
  const box = $("#week-box");
  // 垃圾桶檢視在看已刪除的東西,不需要待辦
  const rows = state.filters.trash ? [] : weekTodos(livePlans());
  show(box, rows.length > 0);
  if (!rows.length) return;

  const shown = rows.slice(0, 6);
  const mine = rows.filter((r) => isMine(r.plan)).length;
  $("#week-sub").textContent =
    `${rows.length} 件${mine && mine !== rows.length ? `,其中 ${mine} 件是你的` : ""}`;

  $("#week-list").innerHTML = shown.map(({ plan, type, date }) => {
    const t = TODO_TYPES[type];
    const who = isMine(plan) ? "" : `<span class="muted small">${esc(plan.ownerName || "")}</span>`;
    return `
      <li>
        <button type="button" class="week-item" data-act="goto" data-id="${esc(plan.id)}">
          <span class="week-tag week-${t.cls}"><span aria-hidden="true">${t.icon}</span>${t.label}</span>
          <span class="week-title">${esc(plan.title)}</span>
          ${date ? `<span class="week-date">${esc(date)}</span>` : ""}
          ${who}
        </button>
      </li>`;
  }).join("") +
    (rows.length > shown.length
      ? `<li class="muted small week-more">還有 ${rows.length - shown.length} 件,往下看完整清單</li>`
      : "");
}

/** 總覽只看本學年度 —— 要換學年度或加條件請用「搜尋」分頁 */
const boardPlans = () =>
  livePlans().filter((p) => String(p.year) === String(currentAcademicYear()));

/**
 * 只畫「還要辦」的清單。結案的計畫會自己跑到「已結案」分頁,
 * 不和還要辦的工作混在一起排隊。
 */
function renderBoard(prefix, plans, editableFn, emptyText) {
  const open = sortPlans(plans.filter((p) => statusOf(p) !== "done"), state.sort);
  const done = plans.length - open.length;

  $(`#${prefix}-list`).innerHTML = open.length
    ? open.map((p) => planCard(p, { editable: editableFn(p) })).join("")
    : `<div class="empty">${esc(done ? "沒有還在進行的計畫,都結案了。" : emptyText)}</div>`;
  return { open: open.length, done };
}

/**
 * 已結案分頁:看得到的計畫裡全部步驟都完成的,依結案日期由新到舊。
 * 不限學年度 —— 這裡就是查閱用的檔案櫃。
 */
function renderClosed() {
  const rows = sortByClosed(livePlans().filter((p) => statusOf(p) === "done"));
  $("#closed-count").textContent = rows.length
    ? `${rows.length} 件・依結案日期由新到舊`
    : "";
  $("#closed-list").innerHTML = rows.length
    ? rows.map((p) => planCard(p, { editable: canEdit(p) })).join("")
    : `<div class="empty">還沒有結案的計畫。把一個計畫的步驟全部完成,它就會自己收到這裡。</div>`;
}

function renderDashboard() {
  // 總覽沒有篩選 UI:一打開就是「現在該看的東西」。
  // 要挑條件、換學年度、看垃圾桶,都到「搜尋」分頁。排序用左側的快捷鈕。
  const plans = boardPlans();
  renderRecurBanner();
  renderWeekBox();
  renderStats(plans);

  if (state.loadError) {
    $("#dashboard-list").innerHTML =
      `<div class="status-line status-critical">${esc(state.loadError)}</div>`;
    show($("#dashboard-done"), false);
    return;
  }
  // 這裡只寫學年度 —— 件數統計磚上就有了,已結案的件數則會一路累積,
  // 寫在這裡只會越變越大,幫不上什麼忙。
  const n = renderBoard("dashboard", plans, canEdit, "這個學年度還沒有計畫。");
  $("#dashboard-scope").textContent = n.open || n.done
    ? `${currentAcademicYear()} 學年度`
    : "";
}

function renderMine() {
  const mine = livePlans().filter(isMine);
  renderStats(mine, "#mine-stat-row");
  renderBoard("mine", mine, () => true,
    "你還沒有建立任何計畫,點左邊的「＋」開始。");
}

/**
 * 搜尋分頁。刻意不套用總覽的篩選條件 ——
 * 會用搜尋多半就是「不知道那件事在哪一年」,再被學年度擋住就沒意義了。
 */
function renderSearch() {
  syncFilterBox();
  const kw = state.query.trim().toLowerCase();
  const filtered = applyFilters(state.plans);
  const hits = sortPlans(kw ? filtered.filter((p) => searchText(p).includes(kw)) : filtered, state.sort);

  $("#search-count").textContent = `找到 ${hits.length} 件`;
  $("#search-list").innerHTML = hits.length
    ? hits.map((p) => planCard(p, { editable: canEdit(p) })).join("")
    : `<div class="empty">${kw
        ? `找不到符合「${esc(state.query.trim())}」的計畫。`
        : "沒有符合這些條件的計畫。"}</div>`;
}

/** 同一張卡片會出現在好幾個分頁,任何一處有變動就一起重畫 */
function renderPlanLists() {
  renderDashboard();
  renderMine();
  renderClosed();
  renderSearch();
}

/* ---------------- 行事曆 ---------------- */

const DOW = ["日", "一", "二", "三", "四", "五", "六"];

// 一格月曆放得下幾行。格子高度固定(style.css 的 --cal-cell-h),
// 兩邊要一起改,不然多出來的那行會被切掉。
const CAL_SLOTS = 3;

function renderCalendar() {
  const { y, m } = state.cal;
  const today = todayStr();

  // 把看得到的計畫的所有日期,依日期歸位
  const byDate = new Map();
  livePlans().forEach((p) => eventsOf(p).forEach((ev) => {
    if (!byDate.has(ev.date)) byDate.set(ev.date, []);
    byDate.get(ev.date).push(ev);
  }));

  $("#cal-title").textContent = `${y} 年 ${m + 1} 月`;
  $("#cal-legend").innerHTML = Object.entries(EVENT_TYPES).map(([k, t]) =>
    `<span class="cal-key"><span class="cal-dot" style="background:${t.color}"></span>${esc(t.label)}</span>`).join("") +
    `<span class="cal-key"><span class="cal-dot" style="background:${NOTE_COLOR}"></span>記事</span>`;

  const cells = monthCells(y, m, today);

  // 本月摘要
  const inMonth = cells.filter((c) => c.inMonth).flatMap((c) => byDate.get(c.ymd) || []);
  const count = (t) => inMonth.filter((e) => e.type === t).length;
  const notesThisMonth = cells.filter((c) => c.inMonth)
    .reduce((n, c) => n + notesOn(state.notes, c.ymd).length, 0);
  $("#cal-summary").textContent = inMonth.length || notesThisMonth
    ? `本月 ${count("start")} 件開始、${count("end")} 件結束、${count("settle")} 件要送結算` +
      (notesThisMonth ? `、${notesThisMonth} 則記事` : "")
    : "本月沒有任何日期";

  $("#cal-grid").innerHTML =
    DOW.map((d, i) => `<div class="cal-dow${i === 0 || i === 6 ? " weekend" : ""}">${d}</div>`).join("") +
    cells.map((c) => {
      const evs = byDate.get(c.ymd) || [];
      const notes = notesOn(state.notes, c.ymd);
      const total = evs.length + notes.length;
      const cls = [
        "cal-cell",
        c.inMonth ? "" : "outside",
        c.isToday ? "today" : "",
        c.dow === 0 || c.dow === 6 ? "weekend" : "",
        state.cal.picked === c.ymd ? "picked" : "",
        total ? "has-events" : ""
      ].filter(Boolean).join(" ");

      // 格子高度是固定的(CSS 的 --cal-cell-h),一格放得下三行。
      // 項目超過三個時,最後一行要留給「還有 N 項」,不然它會被切掉看不到。
      const room = total > CAL_SLOTS ? CAL_SLOTS - 1 : CAL_SLOTS;
      const shownEvs = evs.slice(0, room);
      const shownNotes = notes.slice(0, room - shownEvs.length);
      const shown = shownEvs.length + shownNotes.length;

      const chips = shownEvs.map((ev) => {
        const t = EVENT_TYPES[ev.type];
        return `<span class="cal-chip${ev.done ? " is-done" : ""}" style="--chip:${t.color}"
                      title="${esc(ev.plan.title)}・${esc(t.label)}">
                  <span class="cal-dot" style="background:${t.color}"></span>
                  <span class="cal-chip-text">${esc(ev.plan.title)}</span>
                </span>`;
      }).join("") +
        shownNotes.map((n) => `
          <span class="cal-chip cal-note" style="--chip:${NOTE_COLOR}" title="${esc(n.text)}">
            <span class="cal-dot" style="background:${NOTE_COLOR}"></span>
            <span class="cal-chip-text">${esc(n.text)}</span>
          </span>`).join("");
      return `
        <button type="button" class="${cls}" data-date="${c.ymd}"
                aria-label="${c.ymd} 有 ${total} 個項目">
          <span class="cal-day">${c.day}</span>
          ${chips}
          ${total > shown ? `<span class="cal-more">還有 ${total - shown} 項</span>` : ""}
        </button>`;
    }).join("");

  renderCalDetail(byDate);
}

/** 點選某一天之後,下方列出那天的完整內容 */
function renderCalDetail(byDate) {
  const box = $("#cal-detail");
  const d = state.cal.picked;
  if (!d) {
    box.innerHTML = `<p class="muted small">點選日期可以看當天的詳細項目。</p>`;
    return;
  }
  const evs = (byDate.get(d) || []).slice().sort((a, b) => a.type.localeCompare(b.type));
  const notes = notesOn(state.notes, d);
  const editing = notes.find((n) => n.id === state.editingNote);

  const planRows = evs.map((ev) => {
    const t = EVENT_TYPES[ev.type];
    const st = STATUS_META[statusOf(ev.plan)];
    return `<li>
      <span class="cal-dot" style="background:${t.color}"></span>
      <span class="cal-list-type">${esc(t.label)}</span>
      <span class="cal-list-title">${esc(ev.plan.title)}</span>
      <span class="muted">${esc(ev.plan.dept)}・${esc(ev.plan.ownerName || ev.plan.ownerEmail || "")}</span>
      <span class="badge ${st.cls}"><span aria-hidden="true">${st.icon}</span>${st.label}</span>
    </li>`;
  }).join("");

  // 記事是和計畫無關的提醒,誰寫的就由誰(或管理員)改
  const noteRows = notes.map((n) => {
    const scope = noteScopeOf(n);
    // 預設是「只有自己」,所以不用標;別人看得到的才標出來,一眼就知道哪些會被看到。
    // 加範圍功能之前寫的記事沒存 scope,現在只有自己看得到,單獨標一個提醒。
    const tag = !n.scope ? { text: "舊記事", hint: "這是加可見範圍之前寫的,現在只有你看得到;按 ✎ 重存一次並選範圍就會恢復" }
      : scope === "dept" ? { text: `限 ${n.dept || "同處室"}`, hint: "同處室的人看得到" }
        : scope === "all" ? { text: "全校可看", hint: "名單內所有人都看得到" }
          : null;
    return `
    <li>
      <span class="cal-dot" style="background:${NOTE_COLOR}"></span>
      <span class="cal-list-type">記事</span>
      <span class="cal-list-title">${esc(n.text)}</span>
      ${tag ? `<span class="note-scope" title="${esc(tag.hint)}">${esc(tag.text)}</span>` : ""}
      <span class="muted">${esc(n.ownerName || "")}</span>
      ${canEditNote(n) ? `
        <span class="note-tools">
          <button type="button" class="icon-btn" data-note-edit="${esc(n.id)}"
                  title="修改這則記事" aria-label="修改這則記事">✎</button>
          <button type="button" class="icon-btn icon-danger" data-note-del="${esc(n.id)}"
                  title="刪除這則記事" aria-label="刪除這則記事">✕</button>
        </span>` : ""}
    </li>`;
  }).join("");

  box.innerHTML = `
    <div class="cal-detail-head">
      <strong>${esc(d)}</strong>
      <button type="button" class="btn btn-sm btn-ghost" id="cal-clear">關閉</button>
    </div>
    ${planRows || noteRows
      ? `<ul class="cal-list">${planRows}${noteRows}</ul>`
      : `<p class="muted small">這一天沒有項目。</p>`}
    <form class="note-form" id="note-form">
      <input id="note-text" maxlength="100" autocomplete="off"
             placeholder="${editing ? "修改這則記事…" : "在這一天加一則記事,例:縣府到校訪視"}"
             value="${esc(editing ? editing.text : "")}" aria-label="記事內容">
      <select id="note-scope" aria-label="誰看得到這則記事">
        ${NOTE_SCOPES.map((x) => `<option value="${x.id}"${
          (editing ? noteScopeOf(editing) : NOTE_SCOPE_DEFAULT) === x.id
            ? " selected" : ""}>${x.label}</option>`).join("")}
      </select>
      <button type="submit" class="btn btn-sm btn-primary">${editing ? "儲存" : "新增記事"}</button>
      ${editing ? `<button type="button" class="btn btn-sm btn-ghost" id="note-cancel">取消</button>` : ""}
    </form>
    <p class="muted small note-hint">
      記事預設只有自己看得到,要給別人看再改成同處室或全校;不論哪一種,都只有寫的人和管理員能修改或刪除。
    </p>`;
}

$("#cal-prev").addEventListener("click", () => {
  const d = new Date(state.cal.y, state.cal.m - 1, 1);
  state.cal.y = d.getFullYear(); state.cal.m = d.getMonth();
  renderCalendar();
});
$("#cal-next").addEventListener("click", () => {
  const d = new Date(state.cal.y, state.cal.m + 1, 1);
  state.cal.y = d.getFullYear(); state.cal.m = d.getMonth();
  renderCalendar();
});
$("#cal-today").addEventListener("click", () => {
  const now = new Date();
  // 只把月份切回來,不要順手選中今天(今天多半沒有項目,反而讓下方跳出空訊息)
  state.cal = { y: now.getFullYear(), m: now.getMonth(), picked: "" };
  renderCalendar();
});
$("#cal-grid").addEventListener("click", (e) => {
  const cell = e.target.closest("[data-date]");
  if (!cell) return;
  state.cal.picked = state.cal.picked === cell.dataset.date ? "" : cell.dataset.date;
  renderCalendar();
});
$("#cal-detail").addEventListener("click", async (e) => {
  if (e.target.closest("#cal-clear")) {
    state.cal.picked = "";
    state.editingNote = "";
    renderCalendar();
    return;
  }
  if (e.target.closest("#note-cancel")) {
    state.editingNote = "";
    renderCalendar();
    return;
  }

  const edit = e.target.closest("[data-note-edit]");
  if (edit) {
    state.editingNote = edit.dataset.noteEdit;
    renderCalendar();
    $("#note-text")?.focus();
    return;
  }

  const del = e.target.closest("[data-note-del]");
  if (del) {
    const n = state.notes.find((x) => x.id === del.dataset.noteDel);
    if (!n || demoBlocked()) return;
    if (!confirm(`要刪掉這則記事嗎?\n${n.date} ${n.text}`)) return;
    try {
      await deleteDoc(doc(db, "notes", n.id));
      toast("已刪除記事", "good");
    } catch (err) {
      toast(`刪除失敗:${err.message}`, "error");
    }
  }
});

// 新增或修改記事
$("#cal-detail").addEventListener("submit", async (e) => {
  if (!e.target.closest("#note-form")) return;
  e.preventDefault();

  const text = $("#note-text").value.trim();
  const date = state.cal.picked;
  if (!text || !date) return;

  const picked = $("#note-scope").value;
  // 選單被改壞或送出怪值時,退回最保守的範圍,不要不小心公開出去
  const scope = NOTE_SCOPES.some((x) => x.id === picked) ? picked : NOTE_SCOPE_DEFAULT;
  const editing = state.notes.find((n) => n.id === state.editingNote);
  if (demoBlocked()) return;
  try {
    if (editing) {
      await updateDoc(doc(db, "notes", editing.id), { text, scope, ...stamp() });
      toast(`記事已更新(${NOTE_SCOPE_LABEL[scope]})`, "good");
    } else {
      await addDoc(collection(db, "notes"), {
        date, text, scope,
        // 「同處室」要靠這個欄位比對,寫的當下記下來
        dept: state.member?.dept || "",
        ownerEmail: myEmail(),
        ownerName: state.member?.name || "",
        // 同一天多則記事照新增順序排,所以留一個可排序的欄位
        createdAtDay: new Date().toISOString(),
        createdAt: serverTimestamp(),
        ...stamp()
      });
      toast(`已加入記事(${NOTE_SCOPE_LABEL[scope]})`, "good");
    }
    state.editingNote = "";
    renderCalendar();
    $("#note-text")?.focus();
  } catch (err) {
    toast(`${editing ? "更新" : "新增"}記事失敗:${err.message}`, "error");
  }
});

/** 某位成員名下的計畫 */
const plansOwnedBy = (email) =>
  livePlans().filter((p) => (p.ownerEmail || "").toLowerCase() === String(email).toLowerCase());

function renderMembers() {
  const tbody = $("#members-table tbody");
  if (!tbody) return;
  const rows = [...state.members].sort((a, b) =>
    (a.dept || "").localeCompare(b.dept || "", "zh-Hant") || (a.name || "").localeCompare(b.name || "", "zh-Hant"));

  tbody.innerHTML = rows.map((m) => {
    const n = plansOwnedBy(m.email).length;
    return `
    <tr>
      <td>${esc(m.name)}</td>
      <td>${esc(m.email)}</td>
      <td>${esc(m.dept || "")}</td>
      <td>${esc(m.title || "")}</td>
      <td>${esc(ROLE_LABEL[roleOf(m)])}</td>
      <td>${n ? `${n} 件` : "—"}</td>
      <td>
        ${n ? `<button class="btn btn-sm" data-mact="handover" data-email="${esc(m.email)}">移交</button>` : ""}
        <button class="btn btn-sm" data-mact="edit" data-email="${esc(m.email)}">編輯</button>
        <button class="btn btn-sm btn-danger" data-mact="delete" data-email="${esc(m.email)}">移除</button>
      </td>
    </tr>`;
  }).join("") || `<tr><td colspan="7" style="color:var(--text-secondary)">名單是空的。</td></tr>`;
}

/* ---------------- 職務交接 ---------------- */

const dlgHo = $("#dlg-handover");
const formHo = $("#form-handover");
let handoverFrom = null;

function openHandover(m) {
  handoverFrom = m;
  const plans = plansOwnedBy(m.email);
  $("#ho-from").textContent = `${m.name}(${m.email})`;
  show($("#ho-error"), false);

  // 接手人選單:名單裡除了自己以外的人
  fillSelect($("#ho-to"),
    state.members.filter((x) => x.email !== m.email)
      .map((x) => [x.email, `${x.name}・${x.dept || ""}${x.title ? "・" + x.title : ""}`]),
    { placeholder: "請選擇接手的同仁" });
  $("#ho-to").value = "";

  $("#ho-plans").innerHTML = plans.map((p) => {
    const st = STATUS_META[statusOf(p)];
    return `
      <label class="ho-row">
        <input type="checkbox" class="ho-pick" value="${esc(p.id)}" checked>
        <span class="ho-title">${esc(p.title)}</span>
        <span class="muted small">${esc(p.dept)}・${p.year} 學年度</span>
        <span class="badge ${st.cls}"><span aria-hidden="true">${st.icon}</span>${st.label}</span>
      </label>`;
  }).join("");
  $("#ho-all").checked = true;
  $("#ho-dept").checked = true;
  syncHandoverDeptLabel();
  dlgHo.showModal();
}

/** 接手人換了,「一併改處室」的說明也要跟著換 */
function syncHandoverDeptLabel() {
  const to = state.members.find((x) => x.email === $("#ho-to").value);
  $("#ho-dept-label").textContent = to?.dept
    ? `一併把承辦處室改成「${to.dept}」`
    : "一併把承辦處室改成接手人的處室";
}
$("#ho-to").addEventListener("change", syncHandoverDeptLabel);

$("#ho-all").addEventListener("change", (e) => {
  $$(".ho-pick").forEach((c) => { c.checked = e.target.checked; });
});

$("#btn-ho-cancel").addEventListener("click", () => dlgHo.close());

formHo.addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("#ho-error");
  show(err, false);

  const toEmail = $("#ho-to").value;
  const to = state.members.find((m) => m.email === toEmail);
  const picked = $$(".ho-pick").filter((c) => c.checked).map((c) => c.value);

  if (!to) { err.textContent = "請選擇要接手的同仁。"; show(err, true); return; }
  if (!picked.length) { err.textContent = "請至少勾選一個計畫。"; show(err, true); return; }

  const btn = $("#btn-ho-submit");
  btn.disabled = true;
  btn.textContent = "移交中…";

  const entry = {
    date: todayStr(),
    fromName: handoverFrom.name, fromEmail: handoverFrom.email,
    toName: to.name, toEmail: to.email,
    byName: state.member?.name || ""
  };

  // 承辦處室決定哪一位主任看得到,交給別處室的同仁時要一起換,
  // 否則新承辦人的主任看不到、原處室主任卻還看得到。
  const patch = { ownerEmail: to.email, ownerName: to.name };
  if ($("#ho-dept").checked && to.dept) patch.dept = to.dept;
  if (demoBlocked()) return;

  try {
    // 一筆一筆更新;中途失敗要讓使用者知道已經轉了幾筆
    let ok = 0;
    for (const id of picked) {
      const plan = state.plans.find((p) => p.id === id);
      if (!plan) continue;
      await updateDoc(doc(db, "plans", id), {
        ...patch,
        handovers: [...(plan.handovers || []), entry],
        ...stamp()
      });
      ok++;
    }
    dlgHo.close();
    toast(`已將 ${ok} 個計畫移交給 ${to.name}`, "good");
  } catch (e2) {
    err.textContent = e2.code === "permission-denied"
      ? "移交失敗:資料庫拒絕寫入。請確認 Firestore 安全規則已更新為最新版本。"
      : `移交失敗:${e2.message}`;
    show(err, true);
  } finally {
    btn.disabled = false;
    btn.textContent = "移交";
  }
});

/* ---------------- 計畫卡互動 ---------------- */

/**
 * 卡片上的即時更新。一律蓋上「誰在什麼時候改的」,
 * 失敗就把原因講出來 —— 不要讓老師以為存好了,其實沒有。
 */
async function patchPlan(id, patch, what = "更新") {
  if (demoBlocked()) return false;
  try {
    await updateDoc(doc(db, "plans", id), { ...patch, ...stamp() });
    announce(`已${what}`);          // 畫面看得到變化,螢幕閱讀器需要一句話
    return true;
  } catch (err) {
    toast(`${what}失敗:${err.message}`, "error");
    return false;
  }
}

document.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const plan = state.plans.find((p) => p.id === btn.dataset.id);
  if (!plan) return;

  const act = btn.dataset.act;
  if (act === "goto") {
    // 本週待辦點下去:把那張卡片展開並捲過去。
    // 待辦會列出所有學年度,總覽只放本學年度 —— 不在總覽上的就改用搜尋分頁帶過去,
    // 不然按了會像沒反應。
    const onBoard = boardPlans().some((p) => p.id === plan.id);
    if (!onBoard) {
      state.filters = { ...defaultFilters(), year: String(plan.year ?? "") };
      state.query = "";
      $("#search-q").value = "";
      syncFilterFields();
      setTab("search");
      toast(`${plan.year} 學年度的計畫,已用搜尋帶你過去`);
    }
    state.expanded.add(plan.id);
    saveView();
    renderPlanLists();
    const card = $(`#${onBoard ? "dashboard" : "search"}-list .plan[data-id="${plan.id}"]`);
    card?.scrollIntoView({ behavior: "smooth", block: "start" });
    card?.classList.add("flash");
  } else if (act === "toggle") {
    state.expanded.has(plan.id) ? state.expanded.delete(plan.id) : state.expanded.add(plan.id);
    saveView();
    renderPlanLists();
  } else if (act === "edit") {
    openPlanDialog(plan);
  } else if (act === "copy") {
    openPlanDialog(plan, { copy: true });
  } else if (act === "delete") {
    // 丟進垃圾桶而不是真的刪掉,誤刪救得回來
    if (!confirm(`確定要刪除「${plan.title}」嗎?\n會移到垃圾桶,之後可以還原。`)) return;
    await patchPlan(plan.id, { deletedAt: todayStr(), deletedBy: state.member?.name || "" }, "刪除");
  } else if (act === "restore") {
    await patchPlan(plan.id, { deletedAt: "", deletedBy: "" }, "還原");
  } else if (act === "purge") {
    if (demoBlocked()) return;
    if (!confirm(`要永久刪除「${plan.title}」嗎?\n這次是真的刪掉,無法再還原。`)) return;
    try {
      await deleteDoc(doc(db, "plans", plan.id));
    } catch (err) {
      toast(`永久刪除失敗:${err.message}`, "error");
    }
  } else if (act === "step-done") {
    // 卡片上直接把「下一步」那一批打勾完成,不用展開明細
    const nxt = nextBundle(plan);
    if (!nxt) return;
    const today = todayStr();
    const steps = (plan.steps || []).map((s, i) =>
      nxt.idxs.includes(i) ? { ...s, status: "done", doneAt: today } : s);
    advanceAfter(steps, nxt.idxs[0], today);

    if (await patchPlan(plan.id, { steps }, "更新")) {
      const after = nextBundle({ ...plan, steps });
      toast(`已完成:${nxt.text}${after ? `,接著是「${after.text}」` : "・這個計畫全部完成了"}`, "good");
    }
  } else if (act === "flow-del") {
    // 紀錄是位置一改就自動寫的,選錯單位時要刪得掉
    const i = Number(btn.dataset.flow);
    const f = (plan.flow || [])[i];
    if (!f) return;
    if (!confirm(`要刪掉這筆流轉紀錄嗎?\n${f.date} ${f.from || "—"} → ${f.to}\n\n文件目前的位置不會被更動。`)) return;
    await patchPlan(plan.id, { flow: (plan.flow || []).filter((_, k) => k !== i) }, "刪除");
  } else if (act === "recur-done") {
    // 已經另外建好下一次了,不用再提醒
    if (!confirm(`「${plan.title}」不再提醒下一次了嗎?`)) return;
    await patchPlan(plan.id, { recurring: "" }, "更新");
  }
});

// 直接在卡片上更新步驟狀態、單一文件位置,或整批文件的位置
document.addEventListener("change", async (e) => {
  const sel = e.target.closest(".step-status, .step-loc, .bundle-loc");
  if (!sel) return;
  const plan = state.plans.find((p) => p.id === sel.dataset.plan);
  if (!plan) return;

  const all = plan.steps || [];
  const isBundle = sel.classList.contains("bundle-loc");
  const isLoc = isBundle || sel.classList.contains("step-loc");

  const idx = Number(sel.dataset.step);

  // 改狀態時,同一批一起送的文件要一起動;
  // 前一批公文還沒完成就不能先開始(下拉選單已擋,這裡再保險一次)。
  if (!isLoc) {
    if ((sel.value === "doing" || sel.value === "done") && gateOf(all, idx).locked) {
      sel.value = all[idx]?.status || "todo";
      toast("前一份公文還沒完成,這個步驟還不能開始", "error");
      return;
    }
  }

  // 要一起變動的步驟索引:整批送件會有好幾個
  const targets = isBundle
    ? sel.dataset.steps.split(",").filter(Boolean).map(Number)
    : isLoc ? [idx] : syncTargets(all, idx, sel.value);
  if (!targets.length || !all[targets[0]]) return;

  const steps = all.map((s, i) => {
    if (!targets.includes(i)) return s;
    if (isLoc) {
      // 送到新的單位才重算「送出去幾天」;沒換單位就沿用原本的日期
      const same = (s.location || "") === sel.value;
      return {
        ...s,
        location: sel.value,
        sentAt: same ? (s.sentAt || "") : (sel.value ? todayStr() : "")
      };
    }
    const v = sel.value;
    return {
      ...s,
      status: v,
      // 標記完成時記下完成日期,改成其他狀態就清掉
      doneAt: v === "done" ? todayStr() : "",
      // 第一次變成進行中時記下起算日,退回未開始則重來
      startedAt: v === "doing" ? (s.startedAt || todayStr()) : (v === "todo" ? "" : s.startedAt || "")
    };
  });

  // 一批公文辦完後,自動把下一批接成「進行中」(整批不適用的會被跳過)
  if (!isLoc && sel.value === "done") advanceAfter(steps, idx);

  const patch = { steps };

  // 位置有變動就自動留下一筆流轉紀錄,老師不必額外填表。
  // 同一天同一份文件再改一次算更正,不會多留一筆(見 mergeFlow)。
  if (isLoc) {
    const first = all[targets[0]];
    const entry = {
      date: todayStr(),
      from: first.location || DEFAULT_UNIT,
      to: sel.value || DEFAULT_UNIT,
      step: targets.length > 1 ? `${first.title} 等 ${targets.length} 份` : first.title,
      stage: stageOf(first),
      note: ""
    };
    if (entry.from !== entry.to) patch.flow = mergeFlow(plan.flow, entry);
  }

  await patchPlan(plan.id, patch);
});

/* ---------------- 計畫編輯對話框 ---------------- */

const dlgPlan = $("#dlg-plan");
const formPlan = $("#form-plan");
let editingPlanId = null;
let copySourceId = null;    // 複製時記住來源,存檔後把來源的重複提醒交棒過來
let draftSteps = [];
let draftTouched = false;      // 使用者有沒有手動改過步驟(決定換範本要不要先確認)
let lastTemplateId = "";

// 用 elements.namedItem 取欄位:直接寫 form.title / form.name 會和
// HTMLFormElement 自身的 title、name 屬性混淆。
const pf = (name) => formPlan.elements.namedItem(name);

function renderStepEditor() {
  $("#steps-editor").innerHTML = draftSteps.map((s, i) => {
    // 「同批」是和上一個步驟併成同一份公文,所以只有上一列同階段時才勾得動
    const canBundle = i > 0 && stageOf(draftSteps[i - 1]) === stageOf(s);
    return `
    <div class="step-edit" data-i="${i}">
      <select data-k="stage" aria-label="所屬階段">
        ${STAGES.map((st) =>
          `<option value="${st.id}"${stageOf(s) === st.id ? " selected" : ""}>${esc(st.label)}</option>`).join("")}
      </select>
      <input value="${esc(s.title)}" data-k="title" list="sug-${stageOf(s)}"
             placeholder="輸入或從清單選擇" maxlength="80" aria-label="步驟名稱">
      <select data-k="status" aria-label="步驟狀態">${statusOptionsHtml(s.status)}</select>
      <label class="same-doc" title="${canBundle
        ? "與上一個步驟併成同一份公文一起送,狀態也會一起更新"
        : "這是這個階段的第一個步驟,沒有可以併的上一份公文"}">
        <input type="checkbox" data-k="bundleWithPrev"${
          s.bundleWithPrev && canBundle ? " checked" : ""}${canBundle ? "" : " disabled"}>
        <span>同批</span>
      </label>
      <input class="step-note-input" value="${esc(s.note || "")}" data-k="note"
             placeholder="備註(選填),例:缺兩張發票" maxlength="100" aria-label="步驟備註">
      <div class="row-tools">
        <button type="button" class="icon-btn" data-move="up" data-i="${i}"
                title="上移" aria-label="上移這個步驟"${i === 0 ? " disabled" : ""}>↑</button>
        <button type="button" class="icon-btn" data-move="down" data-i="${i}"
                title="下移" aria-label="下移這個步驟"${i === draftSteps.length - 1 ? " disabled" : ""}>↓</button>
        <button type="button" class="icon-btn" data-insert="${i}"
                title="在下方插入一個步驟" aria-label="在下方插入一個步驟">＋</button>
        <button type="button" class="icon-btn icon-danger" data-del="${i}"
                title="刪除" aria-label="刪除這個步驟">✕</button>
      </div>
    </div>`;
  }).join("") ||
    `<p class="muted small">還沒有步驟。可以在上面挑一個範本,或按「＋ 新增步驟」自己加。</p>`;
}

$("#steps-editor").addEventListener("input", (e) => {
  const row = e.target.closest(".step-edit");
  if (!row || !e.target.dataset.k) return;
  draftSteps[Number(row.dataset.i)][e.target.dataset.k] = e.target.value;
  draftTouched = true;
});

$("#steps-editor").addEventListener("change", (e) => {
  const row = e.target.closest(".step-edit");
  if (!row || !e.target.dataset.k) return;
  const k = e.target.dataset.k;
  draftSteps[Number(row.dataset.i)][k] = e.target.type === "checkbox" ? e.target.checked : e.target.value;
  draftTouched = true;
  // 換階段時常用步驟清單要跟著換
  if (k === "stage") renderStepEditor();
});

const blankStep = (stage) => ({ title: "", status: "todo", note: "", stage, bundleWithPrev: false });

/** 把焦點放到第 n 列的名稱欄位,插入後可以直接打字 */
function focusStepRow(n) {
  $(`#steps-editor .step-edit[data-i="${n}"] input[data-k="title"]`)?.focus();
}

$("#steps-editor").addEventListener("click", (e) => {
  const del = e.target.closest("[data-del]");
  const ins = e.target.closest("[data-insert]");
  const mv = e.target.closest("[data-move]");
  if (!del && !ins && !mv) return;
  draftTouched = true;

  if (del) {
    draftSteps.splice(Number(del.dataset.del), 1);
    renderStepEditor();
    return;
  }

  if (ins) {
    // 插在這一列的下方,並沿用同一個階段
    const i = Number(ins.dataset.insert);
    draftSteps.splice(i + 1, 0, blankStep(stageOf(draftSteps[i])));
    renderStepEditor();
    focusStepRow(i + 1);
    return;
  }

  const i = Number(mv.dataset.i);
  const j = mv.dataset.move === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= draftSteps.length) return;

  // 跨階段往上/往下移時,順勢改成鄰居的階段,
  // 否則存檔時會依階段重新排序,看起來像沒有移動。
  const moved = { ...draftSteps[i], stage: stageOf(draftSteps[j]) };
  draftSteps[i] = draftSteps[j];
  draftSteps[j] = moved;
  renderStepEditor();
  focusStepRow(j);
});

$("#btn-add-step").addEventListener("click", () => {
  const last = draftSteps[draftSteps.length - 1];
  draftSteps.push(blankStep(last ? stageOf(last) : "plan"));
  draftTouched = true;
  renderStepEditor();
  focusStepRow(draftSteps.length - 1);
});

/* ---------------- 步驟範本 ---------------- */

// 自訂範本的選單值前面加上 saved: 前綴,才不會和內建範本的 id 撞在一起
const savedTemplateId = (id) => `saved:${id}`;

/** 把內建範本與管理員存下來的自訂範本合成一份選單 */
function fillTemplateSelect() {
  const keep = $("#plan-template").value;
  fillSelect($("#plan-template"), [
    ...TEMPLATES.map((t) => [t.id, t.label]),
    ...state.templates.map((t) => [savedTemplateId(t.id), `${t.label}(自訂)`])
  ]);
  if ([...$("#plan-template").options].some((o) => o.value === keep)) $("#plan-template").value = keep;
}

/** 選單的值 → 範本內容。找不到就回 null(例如範本剛被別人刪掉) */
function findTemplate(id) {
  const built = TEMPLATES.find((t) => t.id === id);
  if (built) return built;

  const saved = state.templates.find((t) => savedTemplateId(t.id) === id);
  if (!saved) return null;
  const steps = Array.isArray(saved.steps) ? saved.steps : [];
  return {
    id: savedTemplateId(saved.id),
    label: saved.label,
    desc: `自訂範本・${steps.length} 個步驟${saved.createdBy ? `・由 ${saved.createdBy} 建立` : ""}`,
    steps
  };
}

/** 選到自訂範本時,管理員才看得到刪除鈕 */
function syncTemplateButtons() {
  show($("#btn-del-template"), isAdmin() && $("#plan-template").value.startsWith("saved:"));
}

// 把目前編輯中的步驟存成全校共用的範本。
// 常見的情境是「這個計畫的步驟拆得剛剛好,以後大家照這個開」,
// 所以編輯既有計畫時也存得起來,不限於新增。
$("#btn-save-template").addEventListener("click", async () => {
  const steps = draftSteps.filter((s) => s.title.trim());
  if (!steps.length) {
    toast("目前沒有步驟可以存成範本", "error");
    return;
  }
  const label = (prompt("範本名稱?(全校老師都看得到)", pf("title").value.trim()) || "").trim();
  if (!label) return;
  if (demoBlocked()) return;

  try {
    await addDoc(collection(db, "templates"), {
      label: label.slice(0, 40),
      // 只存「流程」本身:名稱、階段、批次。進度與日期是每個計畫自己的事
      steps: steps.map((s) => ({
        title: s.title.trim(),
        stage: stageOf(s),
        bundleWithPrev: !!s.bundleWithPrev
      })),
      createdBy: state.member?.name || "",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    toast(`已存成範本「${label}」,全校都可以套用`, "good");
  } catch (err) {
    toast(`存範本失敗:${err.message}`, "error");
  }
});

$("#btn-del-template").addEventListener("click", async () => {
  const tpl = findTemplate($("#plan-template").value);
  const id = $("#plan-template").value.replace(/^saved:/, "");
  if (!tpl || !id) return;
  if (demoBlocked()) return;
  if (!confirm(`要刪掉範本「${tpl.label}」嗎?\n已經用這個範本建立的計畫不受影響。`)) return;

  try {
    await deleteDoc(doc(db, "templates", id));
    toast(`已刪除範本「${tpl.label}」`, "good");
    $("#plan-template").value = TEMPLATES[0].id;
    syncTemplateButtons();
  } catch (err) {
    toast(`刪除範本失敗:${err.message}`, "error");
  }
});

function applyTemplate(tpl) {
  // 第一批公文預設就是「進行中」(計畫書與概算表一起送就一起開始),後面全部「未開始」
  draftSteps = startFirstBundle(tpl.steps.map((s) => ({ ...s, note: "", status: "todo" })));
  draftTouched = false;          // 範本原封不動,還不算使用者的心血
  lastTemplateId = tpl.id;
  $("#template-hint").textContent = tpl.desc;
  syncTemplateButtons();
  renderStepEditor();
}

// 切換範本。只有在使用者已經動手改過步驟時才需要確認,
// 否則(例如剛開啟對話框、步驟還是範本原樣)直接換掉。
$("#plan-template").addEventListener("change", (e) => {
  const tpl = findTemplate(e.target.value);
  if (!tpl) return;

  if (draftTouched && draftSteps.some((s) => s.title.trim())
      && !confirm("套用範本會取代你目前填寫的步驟,確定嗎?")) {
    e.target.value = lastTemplateId;   // 退回原本選的範本,不要變成空白
    return;
  }
  applyTemplate(tpl);
  syncTemplateButtons();
});

/** 在結束日期下方即時顯示系統推算出來的結算期限 */
function updateSettlementHint() {
  const end = pf("endDate").value;
  $("#settlement-hint").textContent = end
    ? `結算期限自動算到 ${addDays(end, SETTLEMENT_GRACE_DAYS)}(結束後 ${SETTLEMENT_GRACE_DAYS} 天),這裡只要填執行結束日`
    : `填了之後,結算期限會自動算成結束後 ${SETTLEMENT_GRACE_DAYS} 天`;
}
$('#form-plan input[name="endDate"]').addEventListener("input", updateSettlementHint);

/**
 * plan 為空 → 新增;copy 為 true → 以 plan 為範本複製一份新的(不會動到原計畫)。
 */
function openPlanDialog(plan, { copy = false } = {}) {
  const isCopy = !!(plan && copy);
  editingPlanId = isCopy ? null : (plan?.id || null);
  copySourceId = isCopy ? plan.id : null;

  $("#dlg-plan-title").textContent = isCopy ? "複製計畫到新學年" : (plan ? "編輯計畫" : "新增計畫");
  show($("#plan-error"), false);
  show($("#copy-hint"), isCopy);
  formPlan.reset();

  // 範本只在從頭新增時提供;編輯或複製都已經有步驟來源,顯示出來只會誤觸覆蓋。
  // (「存成範本」不受影響 —— 反過來把現成的步驟存起來給大家用是好事)
  show($("#template-field"), !plan);
  $("#template-hint").textContent = "";
  show($("#btn-del-template"), false);

  // 複製時學年度往後推一年(不超過選單上限),標題裡的學年度也一起換掉
  const newYear = isCopy
    ? Math.min(Number(plan.year) + 1, currentAcademicYear() + 1)
    : (plan?.year ?? currentAcademicYear());

  pf("title").value = isCopy ? retitleForYear(plan.title, plan.year, newYear) : (plan?.title || "");
  pf("dept").value = plan?.dept || state.member?.dept || "";
  pf("year").value = String(newYear);
  pf("term").value = String(plan?.term ?? "1");
  // 複製時日期、經費、雲端連結都要重填,不能沿用去年的
  pf("startDate").value = isCopy ? "" : (plan?.startDate || "");
  pf("endDate").value = isCopy ? "" : (plan?.endDate || deadlineOf(plan || {}) || "");
  pf("budget").value = isCopy ? "" : (plan?.budget || "");
  pf("recurring").value = plan?.recurring || "";   // 重複週期由新的一次接手
  pf("driveUrl").value = isCopy ? "" : (plan?.driveUrl || "");
  pf("note").value = plan?.note || "";      // 計畫依據之類的說明通常可以沿用
  updateSettlementHint();

  if (isCopy) {
    draftSteps = resetStepsForCopy(plan.steps);
    draftTouched = true;
    renderStepEditor();
  } else if (plan) {
    draftSteps = (plan.steps || []).map((s) => ({ ...s, stage: stageOf(s) }));
    draftTouched = true;         // 既有計畫的步驟一律當成不可隨意覆蓋
    renderStepEditor();
  } else {
    $("#plan-template").value = TEMPLATES[0].id;
    applyTemplate(TEMPLATES[0]);
  }
  dlgPlan.showModal();
}

$("#btn-new-plan").addEventListener("click", () => openPlanDialog(null));
$("#btn-plan-cancel").addEventListener("click", () => dlgPlan.close());

formPlan.addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("#plan-error");
  show(err, false);

  // 依階段順序整理,存進資料庫的陣列就是照流程排好的
  const steps = draftSteps
    .filter((s) => s.title.trim())
    .map((s) => {
      const status = STEP_STATUSES.includes(s.status) ? s.status : "todo";
      return {
        title: s.title.trim(),
        stage: stageOf(s),
        status,
        note: (s.note || "").trim(),
        bundleWithPrev: !!s.bundleWithPrev,
        // 步驟不再各自填期限,但舊資料若有就保留,判逾期時仍會優先採用
        due: s.due || "",
        // 以下都是在卡片上維護的,編輯計畫時要原封帶回去,不能被洗掉
        location: s.location || "",
        sentAt: s.sentAt || "",
        doneAt: s.doneAt || "",
        startedAt: status === "doing" ? (s.startedAt || todayStr()) : (s.startedAt || "")
      };
    })
    .sort((a, b) => STAGE_IDS.indexOf(a.stage) - STAGE_IDS.indexOf(b.stage))
    // 每個階段的第一份公文沒有可以併的上一份,順手把殘留的「同批」清掉
    .map((s, i, arr) => ({
      ...s,
      bundleWithPrev: s.bundleWithPrev && i > 0 && arr[i - 1].stage === s.stage
    }));

  const startDate = pf("startDate").value || "";
  const endDate = pf("endDate").value || "";

  const payload = {
    title: pf("title").value.trim(),
    dept: pf("dept").value,
    year: Number(pf("year").value),
    term: pf("term").value,
    startDate,
    endDate,
    // 負數擋在這裡,安全規則也只收 0 以上
    budget: Math.max(0, Number(pf("budget").value) || 0),
    recurring: RECURRENCES.some((r) => r.id === pf("recurring").value) ? pf("recurring").value : "",
    driveUrl: safeUrl(pf("driveUrl").value),
    note: pf("note").value.trim(),
    steps,
    ...stamp()
  };

  if (!payload.title || !payload.dept) {
    err.textContent = "請填寫計畫名稱與承辦處室。";
    show(err, true);
    return;
  }
  if (startDate && endDate && endDate < startDate) {
    err.textContent = "執行結束日期不能早於開始日期。";
    show(err, true);
    return;
  }

  if (demoBlocked()) return;

  try {
    if (editingPlanId) {
      await updateDoc(doc(db, "plans", editingPlanId), payload);
    } else {
      await addDoc(collection(db, "plans"), {
        ...payload,
        flow: [],
        ownerUid: state.user.uid,     // 保留備查,權限判定看 ownerEmail
        ownerEmail: myEmail(),
        ownerName: state.member?.name || state.user.displayName || "",
        createdAt: serverTimestamp()
      });

      // 從重複性計畫複製出下一次之後,來源就不必再提醒了
      const src = copySourceId && state.plans.find((p) => p.id === copySourceId);
      if (src?.recurring) {
        await updateDoc(doc(db, "plans", src.id), { recurring: "" }).catch(() => {});
      }
    }
    // 總覽只顯示本學年度,存到別的學年度會看不到 —— 講清楚,免得以為沒存成功
    if (String(payload.year) !== String(currentAcademicYear())) {
      state.filters = { ...defaultFilters(), year: String(payload.year) };
      syncFilterFields();
      renderSearch();
      toast(`已存到 ${payload.year} 學年度。「處室總覽」只顯示 ${currentAcademicYear()} 學年度,已在「搜尋」幫你列出來`);
    }
    dlgPlan.close();
  } catch (e2) {
    err.textContent = `儲存失敗:${e2.message}`;
    show(err, true);
  }
});

/* ---------------- 成員管理 ---------------- */

const dlgMember = $("#dlg-member");
const formMember = $("#form-member");
let editingEmail = null;

const mf = (name) => formMember.elements.namedItem(name);

function openMemberDialog(m) {
  editingEmail = m?.email || null;
  $("#dlg-member-title").textContent = m ? "編輯成員" : "新增成員";
  show($("#member-error"), false);
  formMember.reset();
  mf("email").value = m?.email || "";
  mf("email").readOnly = !!m;   // Email 是文件 ID,不可修改
  mf("name").value = m?.name || "";
  mf("dept").value = m?.dept || "";
  mf("title").value = m?.title || "";
  mf("role").value = roleOf(m);
  $("#role-hint").textContent = ROLES.find((r) => r.id === roleOf(m))?.desc || "";

  // 不讓管理員把自己降級,否則可能整個系統沒人管得動
  const self = !!m && m.email === (state.user.email || "").toLowerCase();
  mf("role").disabled = self;
  show($("#self-role-note"), self);
  dlgMember.showModal();
}

$("#btn-new-member").addEventListener("click", () => openMemberDialog(null));
$("#btn-member-cancel").addEventListener("click", () => dlgMember.close());

$("#members-table").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-mact]");
  if (!btn) return;
  const m = state.members.find((x) => x.email === btn.dataset.email);
  if (!m) return;

  if (btn.dataset.mact === "edit") {
    openMemberDialog(m);
  } else if (btn.dataset.mact === "handover") {
    openHandover(m);
  } else {
    if (m.email === myEmail()) {
      toast("不能移除自己,以免系統失去管理員", "error");
      return;
    }
    const n = plansOwnedBy(m.email).length;
    if (n && !confirm(`${m.name} 名下還有 ${n} 個計畫。\n移出名單後這些計畫會沒有人能維護,建議先按「移交」轉給接手的同仁。\n\n仍要移除嗎?`)) return;
    if (demoBlocked()) return;
    if (!confirm(`確定要把 ${m.name}(${m.email})移出名單嗎?\n該帳號將無法再登入,但已建立的計畫會保留。`)) return;
    try {
      await deleteDoc(doc(db, "allowlist", m.email));
    } catch (err) {
      toast(`移除失敗:${err.message}`, "error");
    }
  }
});

formMember.addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("#member-error");
  show(err, false);

  const email = (editingEmail || mf("email").value).trim().toLowerCase();
  const self = email === (state.user.email || "").toLowerCase();
  const picked = ROLES.some((r) => r.id === mf("role").value) ? mf("role").value : DEFAULT_ROLE;
  const data = {
    name: mf("name").value.trim(),
    dept: mf("dept").value,
    title: mf("title").value.trim(),
    // 編輯自己時角色一律維持原樣,前端停用之外再擋一次
    role: self ? roleOf(state.member) : picked
  };

  if (!email || !data.name || !data.dept) {
    err.textContent = "請填寫 Email、姓名與處室。";
    show(err, true);
    return;
  }

  if (demoBlocked()) { dlgMember.close(); return; }

  try {
    await setDoc(doc(db, "allowlist", email), data, { merge: true });
    dlgMember.close();
  } catch (e2) {
    err.textContent = e2.code === "permission-denied"
      ? "儲存失敗:資料庫拒絕寫入。多半是 Firestore 的安全規則還是舊版本(舊版只認 teacher/admin 兩種角色),請把專案裡的 firestore.rules 重新貼到 Firebase 主控台並發布。"
      : `儲存失敗:${e2.message}`;
    show(err, true);
  }
});

/* ---------------- 預覽模式 ---------------- */

// 網址帶 ?demo=1 時直接灌假資料進畫面,不連 Firebase、不寫入任何東西。
if (DEMO) {
  const d = await import("./demo.js?v=43");
  state.user = d.DEMO_USER;
  state.member = d.DEMO_MEMBER;
  state.plans = d.DEMO_PLANS;
  state.members = d.DEMO_MEMBERS;
  state.notes = d.DEMO_NOTES;

  $("#user-name").textContent = `${state.member.name}・${state.member.dept}(${ROLE_LABEL[roleOf(state.member)]})`;
  $$(".admin-only").forEach((el) => { el.hidden = false; });

  syncFilterFields();
  syncSortUI();
  applyScopeLabels();
  showView("app");
  fillYearSelects();
  fillOwnerFilter();
  renderPlanLists();
  renderMembers();
  setTab("dashboard");

  // 一眼看得出這不是真的資料
  const tag = document.createElement("span");
  tag.textContent = "預覽模式・示範資料";
  tag.style.cssText =
    "position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:60;" +
    "padding:6px 14px;border-radius:999px;font-size:13px;letter-spacing:.04em;" +
    "background:var(--accent,#0f766e);color:#fff;box-shadow:0 4px 16px rgba(0,0,0,.24);pointer-events:none";
  document.body.appendChild(tag);
}
