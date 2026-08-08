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
  UNIT_GROUPS, ALL_UNITS, DEFAULT_UNIT,
  STAGES, STAGE_IDS, STEP_SUGGESTIONS, TEMPLATES,
  ROLES, DEFAULT_ROLE
  // ?v= 一樣要跟著改版更新,否則瀏覽器會沿用快取裡的舊設定檔
} from "./config.js?v=2026.08.08.5";

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
const STAGE_LABEL = Object.fromEntries(STAGES.map((s) => [s.id, s.label]));

const STATUS_META = {
  active:  { label: "進行中", icon: "▶", cls: "badge-active",  color: "var(--accent)" },
  overdue: { label: "逾期",   icon: "⚠", cls: "badge-overdue", color: "var(--status-critical)" },
  stale:   { label: "待更新", icon: "◷", cls: "badge-stale",   color: "var(--status-warning)" },
  done:    { label: "已完成", icon: "✓", cls: "badge-done",    color: "var(--status-good)" }
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
 * 還在外面的文件:有指定所在單位、而且不是「承辦人手上」、也還沒完成的步驟。
 * 公文位置是掛在每一份文件(步驟)上的,不是整個計畫共用一個位置。
 */
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
 * 但進度、公文位置、日期全部歸零,第一個步驟直接設為進行中。
 */
function resetStepsForCopy(steps) {
  return (steps || []).map((s, i) => ({
    title: s.title,
    stage: stageOf(s),
    status: i === 0 ? "doing" : "todo",
    bundleWithPrev: !!s.bundleWithPrev,
    note: "", due: "", location: "", doneAt: "", startedAt: ""
  }));
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

// 行事曆上的三種日期。用調色盤前三個色階,彼此在色盲模擬下也分得開;
// 每個標籤都帶文字,不是只靠顏色辨識。
const EVENT_TYPES = {
  start:  { label: "開始",   icon: "▶", color: "#2a78d6" },
  end:    { label: "結束",   icon: "■", color: "#eb6834" },
  settle: { label: "送結算", icon: "✓", color: "#1baf7a" }
};

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

/** 下一個要處理的步驟:第一個還沒完成、也不是「本次不適用」的 */
function nextStep(plan) {
  return activeSteps(plan).find((s) => s.status !== "done") || null;
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

/** 計畫狀態:已完成 > 逾期 > 待更新 > 進行中 */
function statusOf(plan) {
  const { done, total } = progressOf(plan);
  if (total > 0 && done === total) return "done";

  // 整體期限用「結算期限」(執行結束日 + 寬限期),
  // 結案階段沒填期限的步驟也一律對照結算期限。
  const today = todayStr();
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

const state = {
  user: null,        // Firebase Auth 使用者
  member: null,      // allowlist 中的成員資料
  plans: [],
  members: [],
  tab: "dashboard",
  expanded: new Set(),          // 展開步驟的計畫 id
  cal: { y: new Date().getFullYear(), m: new Date().getMonth(), picked: "" },
  filters: {
    year: String(currentAcademicYear()),
    dept: "", owner: "", stage: "", unit: "", status: "", q: "", stuck: false
  },
  unsubscribe: []
};

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

onAuthStateChanged(auth, async (user) => {
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

  let snap;
  try {
    snap = await getDoc(doc(db, "allowlist", email));
  } catch {
    // 讀取被規則擋下,一樣視為未授權
    snap = { exists: () => false };
  }

  if (!snap.exists()) {
    $("#denied-email").textContent = user.email || "";
    showView("denied");
    return;
  }

  state.member = snap.data();
  $("#user-name").textContent =
    `${state.member.name}${state.member.dept ? "・" + state.member.dept : ""}` +
    `(${ROLE_LABEL[roleOf(state.member)]})`;
  $$(".admin-only").forEach((el) => { el.hidden = !isAdmin(); });

  applyScopeLabels();
  showView("app");
  subscribeData();
  setTab(state.tab);
});

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
    // 多個查詢可能撈到同一筆,用 id 去重後依最後更新時間排序
    const byId = new Map();
    buckets.flat().forEach((p) => byId.set(p.id, p));
    state.plans = [...byId.values()]
      .filter(canSee)              // 第二道防線,見 canSee 的說明
      .sort((a, b) => (toDate(b.updatedAt)?.getTime() || 0) - (toDate(a.updatedAt)?.getTime() || 0));
    fillOwnerFilter();
    renderDashboard();
    renderMine();
    renderMembers();   // 成員表的「名下計畫」件數會跟著計畫變動
    if (state.tab === "calendar") renderCalendar();
  };

  queries.forEach((q, i) => {
    state.unsubscribe.push(onSnapshot(q, (snap) => {
      buckets[i] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      merge();
    }, (e) => console.error("讀取計畫失敗", e)));
  });

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

function setTab(tab) {
  state.tab = tab;
  $$(".tab").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
  for (const p of ["dashboard", "calendar", "mine", "members"]) show($(`#panel-${p}`), p === tab);
  if (tab === "calendar") renderCalendar();
}
$$(".tab").forEach((btn) => btn.addEventListener("click", () => setTab(btn.dataset.tab)));

/* ---------------- 選單填充 ---------------- */

function yearOptions() {
  const y = currentAcademicYear();
  return [y + 1, y, y - 1, y - 2, y - 3];
}

function optionsHtml(items) {
  return items.map((it) => {
    const [v, label] = Array.isArray(it) ? it : [it, it];
    return `<option value="${esc(v)}">${esc(label)}</option>`;
  }).join("");
}

function fillSelect(sel, items, { placeholder } = {}) {
  const keep = sel.value;
  sel.innerHTML = (placeholder ? `<option value="">${esc(placeholder)}</option>` : "") + optionsHtml(items);
  if ([...sel.options].some((o) => o.value === keep)) sel.value = keep;
}

/** 公文單位選單,依 config 的分組顯示 */
function unitOptionsHtml() {
  return UNIT_GROUPS.map((g) =>
    `<optgroup label="${esc(g.label)}">${optionsHtml(g.units)}</optgroup>`).join("");
}

function fillUnitSelect(sel, { placeholder } = {}) {
  const keep = sel.value;
  sel.innerHTML = (placeholder ? `<option value="">${esc(placeholder)}</option>` : "") + unitOptionsHtml();
  if ([...sel.options].some((o) => o.value === keep)) sel.value = keep;
}

function fillOwnerFilter() {
  const owners = [...new Set(state.plans.map((p) => (p.ownerEmail || "").toLowerCase()))]
    .filter(Boolean)
    .map((email) => {
      const p = state.plans.find((x) => (x.ownerEmail || "").toLowerCase() === email);
      return [email, p?.ownerName || email];
    })
    .sort((a, b) => a[1].localeCompare(b[1], "zh-Hant"));
  fillSelect($("#f-owner"), owners, { placeholder: "全部" });
}

function buildDatalists() {
  $("#datalists").innerHTML = STAGES.map((st) =>
    `<datalist id="sug-${st.id}">${optionsHtml(STEP_SUGGESTIONS[st.id] || [])}</datalist>`).join("");
}

function initSelects() {
  buildDatalists();

  fillSelect($("#f-year"), yearOptions().map((y) => [String(y), `${y} 學年度`]), { placeholder: "全部學年" });
  $("#f-year").value = state.filters.year;
  fillSelect($("#f-dept"), DEPARTMENTS, { placeholder: "全部" });
  fillSelect($("#f-stage"), STAGES.map((s) => [s.id, s.label]), { placeholder: "全部" });
  fillUnitSelect($("#f-unit"), { placeholder: "全部" });

  fillSelect($('#form-plan select[name="dept"]'), DEPARTMENTS, { placeholder: "請選擇" });
  fillSelect($('#form-plan select[name="year"]'), yearOptions().map((y) => [String(y), `${y} 學年度`]));
  fillSelect($("#plan-template"), TEMPLATES.map((t) => [t.id, t.label]));

  fillSelect($('#form-member select[name="dept"]'), DEPARTMENTS, { placeholder: "請選擇" });
  fillSelect($("#member-role"), ROLES.map((r) => [r.id, r.label]));
}
initSelects();
$("#app-version").textContent = `v${APP_VERSION}`;

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
  stage: "#f-stage", unit: "#f-unit", status: "#f-status", q: "#f-q"
};
for (const [key, sel] of Object.entries(FILTER_FIELDS)) {
  $(sel).addEventListener("input", (e) => {
    state.filters[key] = e.target.value;
    renderDashboard();
  });
}
// 點統計磚等同於切換狀態篩選;再點一次取消
$("#stat-row").addEventListener("click", (e) => {
  const tile = e.target.closest("[data-stat]");
  if (!tile) return;
  const key = tile.dataset.stat;
  if (key === "stuck") {
    // 卡關是獨立的篩選條件,不屬於計畫狀態
    state.filters.stuck = !state.filters.stuck;
  } else {
    state.filters.status = state.filters.status === key ? "" : key;
    $("#f-status").value = state.filters.status;
  }
  renderDashboard();
});

$("#f-reset").addEventListener("click", () => {
  state.filters = {
    year: String(currentAcademicYear()),
    dept: "", owner: "", stage: "", unit: "", status: "", q: "", stuck: false
  };
  for (const [key, sel] of Object.entries(FILTER_FIELDS)) $(sel).value = state.filters[key];
  renderDashboard();
});

/** 桌機一律展開篩選,手機收起來省空間;收起時在標題顯示還有幾個條件生效 */
function syncFilterBox() {
  const box = $("#filter-box");
  const wide = window.innerWidth > 720;
  if (wide) box.open = true;
  else if (!box.dataset.touched) box.open = false;

  const active = Object.entries(state.filters)
    .filter(([k, v]) => v && !(k === "year" && v === String(currentAcademicYear()))).length;
  $("#filter-count").textContent = active ? `已套用 ${active} 項` : "";
}
$("#filter-box").addEventListener("toggle", (e) => {
  // 使用者自己開合過就不要再自動幫他收起來
  if (window.innerWidth <= 720) e.target.dataset.touched = "1";
});
window.addEventListener("resize", syncFilterBox);

function applyFilters(plans) {
  const { year, dept, owner, stage, unit, status, q, stuck } = state.filters;
  const kw = q.trim().toLowerCase();
  return plans.filter((p) => {
    if (stuck && !hasStuckDoc(p)) return false;
    if (year && String(p.year) !== year) return false;
    if (dept && p.dept !== dept) return false;
    if (owner && (p.ownerEmail || "").toLowerCase() !== owner) return false;
    if (unit && !unitsOf(p).includes(unit)) return false;
    if (stage && currentStage(p)?.id !== stage) return false;
    if (status && statusOf(p) !== status) return false;
    if (kw && !`${p.title} ${p.note || ""}`.toLowerCase().includes(kw)) return false;
    return true;
  });
}

/* ---------------- 畫面繪製 ---------------- */

function renderStats(plans) {
  const counts = { total: plans.length, active: 0, overdue: 0, stale: 0, done: 0 };
  plans.forEach((p) => { counts[statusOf(p)]++; });

  const stuck = plans.filter((p) => hasStuckDoc(p)).length;

  const tiles = [
    { key: "", label: "計畫總數", value: counts.total, color: "var(--text-muted)" },
    { key: "active", label: "進行中", value: counts.active, color: STATUS_META.active.color },
    { key: "overdue", label: "逾期", value: counts.overdue, color: STATUS_META.overdue.color },
    { key: "stale", label: "待更新", value: counts.stale, color: STATUS_META.stale.color },
    { key: "done", label: "已完成", value: counts.done, color: STATUS_META.done.color },
    { key: "stuck", label: "公文卡關", value: stuck, color: "var(--status-serious)", separate: true }
  ];

  // 統計磚同時是篩選捷徑:點「逾期」就只看逾期的計畫
  $("#stat-row").innerHTML = tiles.map((t) => `
    <button type="button" class="stat" data-stat="${esc(t.key)}"
            aria-pressed="${t.separate ? state.filters.stuck : state.filters.status === t.key}">
      <span class="stat-label">
        <span class="dot" style="background:${t.color}"></span>${esc(t.label)}
      </span>
      <span class="stat-value">${t.value}</span>
    </button>`).join("");
}

/** 四階段進度條 */
function stageBarHtml(plan) {
  const cur = currentStage(plan);
  return `<div class="stage-bar" role="list" aria-label="計畫階段">` +
    stageProgress(plan).map((r) => {
      // 注意:修飾類別不要用 empty,會撞到「查無資料」佔位框的 .empty
      const cls = r.total === 0 ? "blank" : r.complete ? "complete" : (cur && cur.id === r.id ? "current" : "pending");
      const count = r.total ? `${r.done}/${r.total}` : "—";
      return `
        <div class="stage-cell ${cls}" role="listitem" title="${esc(r.hint)}">
          <span class="stage-name">${esc(r.label)}</span>
          <span class="stage-count">${count}</span>
        </div>`;
    }).join("") + `</div>`;
}

function meterHtml(plan) {
  const { done, total, pct } = progressOf(plan);
  return `
    <div class="meter">
      <div class="meter-head">
        <span>${total ? `已完成 ${done} / ${total} 個步驟` : "尚未建立步驟"}</span>
        <span class="meter-value">${pct}%</span>
      </div>
      <div class="meter-track" role="progressbar" aria-label="完成度"
           aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
        <div class="meter-fill" style="width:${pct}%"></div>
      </div>
    </div>`;
}

/** 單位下拉選單的選項(第一個是「承辦人手上」,值為空字串) */
function unitOptions(loc) {
  return `<option value=""${loc === DEFAULT_UNIT ? " selected" : ""}>${esc(DEFAULT_UNIT)}</option>` +
    UNIT_GROUPS.filter((g) => g.label !== "承辦人").map((g) =>
      `<optgroup label="${esc(g.label)}">${g.units.map((u) =>
        `<option value="${esc(u)}"${loc === u ? " selected" : ""}>${esc(u)}</option>`).join("")}</optgroup>`).join("");
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

  const sub = [
    running,
    dueHtml,
    na ? `<span class="na-note">本次不需要辦理</span>` : "",
    s.status === "done" && s.doneAt ? `<span class="done-at">✓ ${esc(s.doneAt)} 完成</span>` : "",
    s.note ? `<span>${esc(s.note)}</span>` : ""
  ].filter(Boolean).join("");

  const loc = s.location || DEFAULT_UNIT;
  const statusSelect = `
    <select class="step-status" data-plan="${esc(plan.id)}" data-step="${s._i}" aria-label="步驟狀態">
      ${STEP_STATUSES.map((v) =>
        `<option value="${v}"${s.status === v ? " selected" : ""}>${STEP_LABEL[v]}</option>`).join("")}
    </select>`;

  const controls = editable
    ? `<div class="step-controls">
         ${inBundle || na ? "" : `
           <select class="step-loc" data-plan="${esc(plan.id)}" data-step="${s._i}" aria-label="這份文件目前在哪">
             ${unitOptions(loc)}
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
                     aria-label="這批文件目前在哪">${unitOptions(loc)}</select>
             ${daysTag}
           </div>`
        : (live.length
            ? `<div class="bundle-foot"><span class="muted small">這批文件目前在 ${esc(loc)}</span>${daysTag}</div>`
            : "");

      return `
        <div class="bundle">
          <div class="bundle-head">
            <span class="bundle-tag"><span aria-hidden="true">📎</span>一起送件</span>
            <span class="muted small">${live.length} 份文件併成一份公文${naCount ? `,另 ${naCount} 份本次不適用` : ""}</span>
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

/** 公文流轉紀錄 */
function flowHtml(plan) {
  const flow = [...(plan.flow || [])].sort((a, b) => String(b.date).localeCompare(String(a.date)));
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
          </li>`).join("")}
      </ol>
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
  const nxt = nextStep(plan);
  const nextChip = nxt
    ? `<span class="next-chip"><span aria-hidden="true">▶</span>下一步:<b>${esc(nxt.title)}</b></span>`
    : ((plan.steps || []).length ? `<span class="next-chip done"><span aria-hidden="true">✓</span>全部步驟已完成</span>` : "");

  // 紙本跑完掃描上傳雲端後貼的連結
  const drive = safeUrl(plan.driveUrl);
  const driveChip = drive
    ? `<a class="drive-chip" href="${esc(drive)}" target="_blank" rel="noopener noreferrer">
         <span aria-hidden="true">📁</span>掃描檔<span class="ext" aria-hidden="true">↗</span></a>`
    : "";

  const outRow = (nextChip || out.length || legacy || driveChip)
    ? `<div class="loc-row">
         ${nextChip}
         ${driveChip}
         ${out.map((d) => `<span class="loc-chip${d.stuck ? " stuck" : ""}">
             <span aria-hidden="true">${d.stuck ? "⚠" : "📄"}</span>${esc(d.title)}
             <span aria-hidden="true">→</span> <b>${esc(d.unit)}</b>${
               d.days === null ? "" : `<span class="loc-days">${d.days} 天${d.stuck ? "・卡關" : ""}</span>`}
           </span>`).join("")}
         ${legacy}
       </div>`
    : "";

  const bits = [
    plan.dept,
    `${plan.year} 學年度 ${TERM_LABEL[String(plan.term)] || ""}`.trim(),
    plan.ownerName || plan.ownerEmail,
    period,
    settlementText(plan),
    plan.budget ? `核定 ${money(plan.budget)} 元` : "",
    relativeDays(toDate(plan.updatedAt))
  ].filter(Boolean);

  return `
    <article class="plan" data-status="${st}" data-id="${esc(plan.id)}">
      <div class="plan-top">
        <div style="min-width:0">
          <h3 class="plan-title">${esc(plan.title)}</h3>
          <div class="plan-meta">${bits.map((b) => `<span>${esc(b)}</span>`).join("")}</div>
        </div>
        <div class="plan-actions">
          <span class="badge ${meta.cls}"><span aria-hidden="true">${meta.icon}</span>${meta.label}</span>
          <button class="btn btn-sm" data-act="copy" data-id="${esc(plan.id)}"
                  title="以這個計畫為範本,複製一份到新學年">複製</button>
          ${editable ? `
            <button class="btn btn-sm" data-act="edit" data-id="${esc(plan.id)}">編輯</button>
            <button class="btn btn-sm btn-danger" data-act="delete" data-id="${esc(plan.id)}">刪除</button>` : ""}
        </div>
      </div>

      ${outRow}
      ${stageBarHtml(plan)}
      ${meterHtml(plan)}
      ${plan.note ? `<p class="plan-note">${esc(plan.note)}</p>` : ""}

      <button class="toggle-steps" data-act="toggle" data-id="${esc(plan.id)}">
        ${open ? "▲ 收合明細" : `▼ 展開明細(${(plan.steps || []).length} 個步驟)`}
      </button>
      ${open ? stepsHtml(plan, editable) + flowHtml(plan) + handoverHtml(plan) : ""}
    </article>`;
}

function renderDashboard() {
  const plans = applyFilters(state.plans);
  syncFilterBox();
  renderStats(plans);
  $("#dashboard-list").innerHTML = plans.length
    ? plans.map((p) => planCard(p, { editable: canEdit(p) })).join("")
    : `<div class="empty">目前沒有符合篩選條件的計畫。</div>`;
}

function renderMine() {
  const mine = state.plans.filter(isMine);
  $("#mine-list").innerHTML = mine.length
    ? mine.map((p) => planCard(p, { editable: true })).join("")
    : `<div class="empty">你還沒有建立任何計畫,點上方「＋ 新增計畫」開始。</div>`;
}

/* ---------------- 行事曆 ---------------- */

const DOW = ["日", "一", "二", "三", "四", "五", "六"];

function renderCalendar() {
  const { y, m } = state.cal;
  const today = todayStr();

  // 把看得到的計畫的所有日期,依日期歸位
  const byDate = new Map();
  state.plans.forEach((p) => eventsOf(p).forEach((ev) => {
    if (!byDate.has(ev.date)) byDate.set(ev.date, []);
    byDate.get(ev.date).push(ev);
  }));

  $("#cal-title").textContent = `${y} 年 ${m + 1} 月`;
  $("#cal-legend").innerHTML = Object.entries(EVENT_TYPES).map(([k, t]) =>
    `<span class="cal-key"><span class="cal-dot" style="background:${t.color}"></span>${esc(t.label)}</span>`).join("");

  const cells = monthCells(y, m, today);

  // 本月摘要
  const inMonth = cells.filter((c) => c.inMonth).flatMap((c) => byDate.get(c.ymd) || []);
  const count = (t) => inMonth.filter((e) => e.type === t).length;
  $("#cal-summary").textContent = inMonth.length
    ? `本月 ${count("start")} 件開始、${count("end")} 件結束、${count("settle")} 件要送結算`
    : "本月沒有任何日期";

  $("#cal-grid").innerHTML =
    DOW.map((d, i) => `<div class="cal-dow${i === 0 || i === 6 ? " weekend" : ""}">${d}</div>`).join("") +
    cells.map((c) => {
      const evs = byDate.get(c.ymd) || [];
      const cls = [
        "cal-cell",
        c.inMonth ? "" : "outside",
        c.isToday ? "today" : "",
        c.dow === 0 || c.dow === 6 ? "weekend" : "",
        state.cal.picked === c.ymd ? "picked" : "",
        evs.length ? "has-events" : ""
      ].filter(Boolean).join(" ");

      const chips = evs.slice(0, 3).map((ev) => {
        const t = EVENT_TYPES[ev.type];
        return `<span class="cal-chip${ev.done ? " is-done" : ""}" style="--chip:${t.color}"
                      title="${esc(ev.plan.title)}・${esc(t.label)}">
                  <span class="cal-dot" style="background:${t.color}"></span>
                  <span class="cal-chip-text">${esc(ev.plan.title)}</span>
                </span>`;
      }).join("");

      return `
        <button type="button" class="${cls}" data-date="${c.ymd}"
                aria-label="${c.ymd} 有 ${evs.length} 個項目">
          <span class="cal-day">${c.day}</span>
          ${chips}
          ${evs.length > 3 ? `<span class="cal-more">還有 ${evs.length - 3} 項</span>` : ""}
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
  box.innerHTML = `
    <div class="cal-detail-head">
      <strong>${esc(d)}</strong>
      <button type="button" class="btn btn-sm btn-ghost" id="cal-clear">關閉</button>
    </div>
    ${evs.length ? `<ul class="cal-list">${evs.map((ev) => {
      const t = EVENT_TYPES[ev.type];
      const st = STATUS_META[statusOf(ev.plan)];
      return `<li>
        <span class="cal-dot" style="background:${t.color}"></span>
        <span class="cal-list-type">${esc(t.label)}</span>
        <span class="cal-list-title">${esc(ev.plan.title)}</span>
        <span class="muted">${esc(ev.plan.dept)}・${esc(ev.plan.ownerName || ev.plan.ownerEmail || "")}</span>
        <span class="badge ${st.cls}"><span aria-hidden="true">${st.icon}</span>${st.label}</span>
      </li>`;
    }).join("")}</ul>` : `<p class="muted small">這一天沒有項目。</p>`}`;
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
$("#cal-detail").addEventListener("click", (e) => {
  if (!e.target.closest("#cal-clear")) return;
  state.cal.picked = "";
  renderCalendar();
});

/** 某位成員名下的計畫 */
const plansOwnedBy = (email) =>
  state.plans.filter((p) => (p.ownerEmail || "").toLowerCase() === String(email).toLowerCase());

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
  dlgHo.showModal();
}

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

  try {
    // 一筆一筆更新;中途失敗要讓使用者知道已經轉了幾筆
    let ok = 0;
    for (const id of picked) {
      const plan = state.plans.find((p) => p.id === id);
      if (!plan) continue;
      await updateDoc(doc(db, "plans", id), {
        ownerEmail: to.email,
        ownerName: to.name,
        handovers: [...(plan.handovers || []), entry],
        updatedAt: serverTimestamp()
      });
      ok++;
    }
    dlgHo.close();
    alert(`已將 ${ok} 個計畫移交給 ${to.name}。`);
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

document.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const plan = state.plans.find((p) => p.id === btn.dataset.id);
  if (!plan) return;

  const act = btn.dataset.act;
  if (act === "toggle") {
    state.expanded.has(plan.id) ? state.expanded.delete(plan.id) : state.expanded.add(plan.id);
    renderDashboard();
    renderMine();
  } else if (act === "edit") {
    openPlanDialog(plan);
  } else if (act === "copy") {
    openPlanDialog(plan, { copy: true });
  } else if (act === "delete") {
    if (!confirm(`確定要刪除「${plan.title}」嗎?此動作無法復原。`)) return;
    try {
      await deleteDoc(doc(db, "plans", plan.id));
    } catch (err) {
      alert(`刪除失敗:${err.message}`);
    }
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

  // 要一起變動的步驟索引:整批送件會有好幾個
  const targets = isBundle
    ? sel.dataset.steps.split(",").filter(Boolean).map(Number)
    : [Number(sel.dataset.step)];
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

  // 一個步驟完成後,自動把後面第一個「未開始」的步驟接成「進行中」
  // (本次不適用的步驟會被跳過)
  if (!isLoc && sel.value === "done") {
    const idx = targets[0];
    const next = steps.findIndex((s, i) => i > idx && s.status === "todo");
    if (next !== -1) steps[next] = { ...steps[next], status: "doing", startedAt: todayStr() };
  }

  const patch = { steps, updatedAt: serverTimestamp() };

  // 位置有變動就自動留下一筆流轉紀錄,老師不必額外填表
  if (isLoc) {
    const first = all[targets[0]];
    const from = first.location || DEFAULT_UNIT;
    const to = sel.value || DEFAULT_UNIT;
    if (from !== to) {
      patch.flow = [...(plan.flow || []), {
        date: todayStr(), from, to,
        step: targets.length > 1 ? `${first.title} 等 ${targets.length} 份` : first.title,
        stage: stageOf(first),
        note: ""
      }];
    }
  }

  try {
    await updateDoc(doc(db, "plans", plan.id), patch);
  } catch (err) {
    alert(`更新失敗:${err.message}`);
  }
});

/* ---------------- 計畫編輯對話框 ---------------- */

const dlgPlan = $("#dlg-plan");
const formPlan = $("#form-plan");
let editingPlanId = null;
let draftSteps = [];
let draftTouched = false;      // 使用者有沒有手動改過步驟(決定換範本要不要先確認)
let lastTemplateId = "";

// 用 elements.namedItem 取欄位:直接寫 form.title / form.name 會和
// HTMLFormElement 自身的 title、name 屬性混淆。
const pf = (name) => formPlan.elements.namedItem(name);

function renderStepEditor() {
  $("#steps-editor").innerHTML = draftSteps.map((s, i) => `
    <div class="step-edit" data-i="${i}">
      <select data-k="stage" aria-label="所屬階段">
        ${STAGES.map((st) =>
          `<option value="${st.id}"${stageOf(s) === st.id ? " selected" : ""}>${esc(st.label)}</option>`).join("")}
      </select>
      <input value="${esc(s.title)}" data-k="title" list="sug-${stageOf(s)}"
             placeholder="輸入或從清單選擇" maxlength="80" aria-label="步驟名稱">
      <select data-k="status" aria-label="步驟狀態">
        ${STEP_STATUSES.map((v) =>
          `<option value="${v}"${s.status === v ? " selected" : ""}>${STEP_LABEL[v]}</option>`).join("")}
      </select>
      <label class="same-doc" title="與上一個步驟併成同一份公文一起送">
        <input type="checkbox" data-k="bundleWithPrev"${s.bundleWithPrev ? " checked" : ""}${i === 0 ? " disabled" : ""}>
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
    </div>`).join("") ||
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

function applyTemplate(tpl) {
  // 第一個步驟預設就是「進行中」,後面全部「未開始」
  draftSteps = tpl.steps.map((s, i) => ({
    ...s, note: "", status: i === 0 ? "doing" : "todo"
  }));
  draftTouched = false;          // 範本原封不動,還不算使用者的心血
  lastTemplateId = tpl.id;
  $("#template-hint").textContent = tpl.desc;
  renderStepEditor();
}

// 切換範本。只有在使用者已經動手改過步驟時才需要確認,
// 否則(例如剛開啟對話框、步驟還是範本原樣)直接換掉。
$("#plan-template").addEventListener("change", (e) => {
  const tpl = TEMPLATES.find((t) => t.id === e.target.value);
  if (!tpl) return;

  if (draftTouched && draftSteps.some((s) => s.title.trim())
      && !confirm("套用範本會取代你目前填寫的步驟,確定嗎?")) {
    e.target.value = lastTemplateId;   // 退回原本選的範本,不要變成空白
    return;
  }
  applyTemplate(tpl);
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

  $("#dlg-plan-title").textContent = isCopy ? "複製計畫到新學年" : (plan ? "編輯計畫" : "新增計畫");
  show($("#plan-error"), false);
  show($("#copy-hint"), isCopy);
  formPlan.reset();

  // 範本只在從頭新增時提供;編輯或複製都已經有步驟來源,顯示出來只會誤觸覆蓋
  show($("#template-field"), !plan);
  $("#template-hint").textContent = "";

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
    .sort((a, b) => STAGE_IDS.indexOf(a.stage) - STAGE_IDS.indexOf(b.stage));

  const startDate = pf("startDate").value || "";
  const endDate = pf("endDate").value || "";

  const payload = {
    title: pf("title").value.trim(),
    dept: pf("dept").value,
    year: Number(pf("year").value),
    term: pf("term").value,
    startDate,
    endDate,
    budget: Number(pf("budget").value) || 0,
    driveUrl: safeUrl(pf("driveUrl").value),
    note: pf("note").value.trim(),
    steps,
    updatedAt: serverTimestamp()
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
    }
    // 存到別的學年度時把篩選切過去,不然剛建好的計畫會被目前的學年篩選擋住
    if (state.filters.year && state.filters.year !== String(payload.year)) {
      state.filters.year = String(payload.year);
      $("#f-year").value = state.filters.year;
      renderDashboard();
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
      alert("不能移除自己,以免系統失去管理員。");
      return;
    }
    const n = plansOwnedBy(m.email).length;
    if (n && !confirm(`${m.name} 名下還有 ${n} 個計畫。\n移出名單後這些計畫會沒有人能維護,建議先按「移交」轉給接手的同仁。\n\n仍要移除嗎?`)) return;
    if (!confirm(`確定要把 ${m.name}(${m.email})移出名單嗎?\n該帳號將無法再登入,但已建立的計畫會保留。`)) return;
    try {
      await deleteDoc(doc(db, "allowlist", m.email));
    } catch (err) {
      alert(`移除失敗:${err.message}`);
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
