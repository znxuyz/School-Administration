// 行政工作進度追蹤系統
// Firebase JS SDK 從 Google CDN 以 ES module 載入,不需要 npm 或建置工具。
// 若要升級 SDK,請一併修改下方三行的版本號。
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

import { firebaseConfig, DEPARTMENTS, STALE_DAYS } from "./config.js";

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

const TERM_LABEL = { "1": "上學期", "2": "下學期", "0": "全學年" };
const STEP_LABEL = { todo: "未開始", doing: "進行中", done: "已完成" };
const STEP_MARK = { todo: "○", doing: "◐", done: "●" };

const STATUS_META = {
  active:  { label: "進行中", icon: "▶", cls: "badge-active",  color: "var(--accent)" },
  overdue: { label: "逾期",   icon: "⚠", cls: "badge-overdue", color: "var(--status-critical)" },
  stale:   { label: "待更新", icon: "◷", cls: "badge-stale",   color: "var(--status-warning)" },
  done:    { label: "已完成", icon: "✓", cls: "badge-done",    color: "var(--status-good)" }
};

function progressOf(plan) {
  const steps = plan.steps || [];
  const done = steps.filter((s) => s.status === "done").length;
  return { done, total: steps.length, pct: steps.length ? Math.round((done / steps.length) * 100) : 0 };
}

/** 計畫狀態:已完成 > 逾期 > 待更新 > 進行中 */
function statusOf(plan) {
  const { done, total } = progressOf(plan);
  if (total > 0 && done === total) return "done";

  const today = todayStr();
  const deadlines = [plan.dueDate, ...(plan.steps || [])
    .filter((s) => s.status !== "done")
    .map((s) => s.due)].filter(Boolean);
  if (deadlines.some((d) => d < today)) return "overdue";

  const updated = toDate(plan.updatedAt);
  if (updated && (Date.now() - updated.getTime()) / 86400000 > STALE_DAYS) return "stale";
  return "active";
}

/* ---------------- 應用狀態 ---------------- */

const state = {
  user: null,        // Firebase Auth 使用者
  member: null,      // allowlist 中的成員資料
  plans: [],
  members: [],
  tab: "dashboard",
  expanded: new Set(),          // 展開步驟的計畫 id
  filters: { year: String(currentAcademicYear()), dept: "", owner: "", status: "", q: "" },
  unsubscribe: []
};

const isAdmin = () => state.member?.role === "admin";
const canEdit = (plan) => plan.ownerUid === state.user?.uid || isAdmin();

/* ---------------- 登入流程 ---------------- */

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
      ? "這個網址尚未被加入 Firebase 的授權網域,請聯絡系統管理者。"
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
    `${state.member.name}${state.member.dept ? "・" + state.member.dept : ""}`;
  $$(".admin-only").forEach((el) => { el.hidden = !isAdmin(); });

  showView("app");
  subscribeData();
  setTab(state.tab);
});

/* ---------------- 資料訂閱 ---------------- */

function subscribeData() {
  state.unsubscribe.push(
    onSnapshot(query(collection(db, "plans"), orderBy("updatedAt", "desc")), (snap) => {
      state.plans = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      fillOwnerFilter();
      renderDashboard();
      renderMine();
    }, (e) => console.error("讀取計畫失敗", e))
  );

  state.unsubscribe.push(
    onSnapshot(collection(db, "allowlist"), (snap) => {
      state.members = snap.docs.map((d) => ({ email: d.id, ...d.data() }));
      renderMembers();
    }, (e) => console.error("讀取成員失敗", e))
  );
}

/* ---------------- 分頁切換 ---------------- */

function setTab(tab) {
  state.tab = tab;
  $$(".tab").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
  for (const p of ["dashboard", "mine", "members"]) show($(`#panel-${p}`), p === tab);
}
$$(".tab").forEach((btn) => btn.addEventListener("click", () => setTab(btn.dataset.tab)));

/* ---------------- 選單填充 ---------------- */

function yearOptions() {
  const y = currentAcademicYear();
  return [y + 1, y, y - 1, y - 2, y - 3];
}

function fillSelect(sel, items, { placeholder } = {}) {
  const keep = sel.value;
  sel.innerHTML = (placeholder ? `<option value="">${placeholder}</option>` : "") +
    items.map((it) => {
      const [v, label] = Array.isArray(it) ? it : [it, it];
      return `<option value="${esc(v)}">${esc(label)}</option>`;
    }).join("");
  if ([...sel.options].some((o) => o.value === keep)) sel.value = keep;
}

function fillOwnerFilter() {
  const owners = [...new Set(state.plans.map((p) => p.ownerUid))]
    .map((uid) => {
      const p = state.plans.find((x) => x.ownerUid === uid);
      return [uid, p?.ownerName || p?.ownerEmail || "未知"];
    })
    .sort((a, b) => a[1].localeCompare(b[1], "zh-Hant"));
  fillSelect($("#f-owner"), owners, { placeholder: "全部" });
}

function initSelects() {
  fillSelect($("#f-year"), yearOptions().map((y) => [String(y), `${y} 學年度`]), { placeholder: "全部學年" });
  $("#f-year").value = state.filters.year;
  fillSelect($("#f-dept"), DEPARTMENTS, { placeholder: "全部" });
  fillSelect($('#form-plan select[name="dept"]'), DEPARTMENTS, { placeholder: "請選擇" });
  fillSelect($('#form-member select[name="dept"]'), DEPARTMENTS, { placeholder: "請選擇" });
  fillSelect($('#form-plan select[name="year"]'), yearOptions().map((y) => [String(y), `${y} 學年度`]));
}
initSelects();

/* ---------------- 篩選列 ---------------- */

const FILTER_FIELDS = { year: "#f-year", dept: "#f-dept", owner: "#f-owner", status: "#f-status", q: "#f-q" };
for (const [key, sel] of Object.entries(FILTER_FIELDS)) {
  $(sel).addEventListener("input", (e) => {
    state.filters[key] = e.target.value;
    renderDashboard();
  });
}
$("#f-reset").addEventListener("click", () => {
  state.filters = { year: String(currentAcademicYear()), dept: "", owner: "", status: "", q: "" };
  for (const [key, sel] of Object.entries(FILTER_FIELDS)) $(sel).value = state.filters[key];
  renderDashboard();
});

function applyFilters(plans) {
  const { year, dept, owner, status, q } = state.filters;
  const kw = q.trim().toLowerCase();
  return plans.filter((p) => {
    if (year && String(p.year) !== year) return false;
    if (dept && p.dept !== dept) return false;
    if (owner && p.ownerUid !== owner) return false;
    if (status && statusOf(p) !== status) return false;
    if (kw && !`${p.title} ${p.note || ""}`.toLowerCase().includes(kw)) return false;
    return true;
  });
}

/* ---------------- 畫面繪製 ---------------- */

function renderStats(plans) {
  const counts = { total: plans.length, active: 0, overdue: 0, stale: 0, done: 0 };
  plans.forEach((p) => { counts[statusOf(p)]++; });

  const tiles = [
    { label: "計畫總數", value: counts.total, color: "var(--text-muted)" },
    { label: "進行中", value: counts.active, color: STATUS_META.active.color },
    { label: "逾期", value: counts.overdue, color: STATUS_META.overdue.color },
    { label: "待更新", value: counts.stale, color: STATUS_META.stale.color },
    { label: "已完成", value: counts.done, color: STATUS_META.done.color }
  ];

  $("#stat-row").innerHTML = tiles.map((t) => `
    <div class="stat">
      <div class="stat-label">
        <span class="dot" style="background:${t.color}"></span>${esc(t.label)}
      </div>
      <div class="stat-value">${t.value}</div>
    </div>`).join("");
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

function stepsHtml(plan, editable) {
  const today = todayStr();
  if (!(plan.steps || []).length) return `<div class="steps"><p class="muted small" style="margin:10px 0 0">這個計畫還沒有步驟。</p></div>`;

  return `<div class="steps">` + plan.steps.map((s, i) => {
    const overdue = s.due && s.status !== "done" && s.due < today;
    const sub = [
      s.due ? `<span class="${overdue ? "overdue" : ""}">期限 ${esc(s.due)}${overdue ? "(已逾期)" : ""}</span>` : "",
      s.note ? `<span>${esc(s.note)}</span>` : ""
    ].filter(Boolean).join("");

    const control = editable
      ? `<select class="step-status" data-plan="${esc(plan.id)}" data-step="${i}" aria-label="步驟狀態">
           ${Object.entries(STEP_LABEL).map(([v, l]) =>
             `<option value="${v}"${s.status === v ? " selected" : ""}>${l}</option>`).join("")}
         </select>`
      : `<span class="step-sub">${STEP_LABEL[s.status] || ""}</span>`;

    return `
      <div class="step-row" data-status="${esc(s.status)}">
        <span class="step-marker" aria-hidden="true">${STEP_MARK[s.status] || "○"}</span>
        <div class="step-main">
          <div class="step-title">${esc(s.title)}</div>
          ${sub ? `<div class="step-sub">${sub}</div>` : ""}
        </div>
        ${control}
      </div>`;
  }).join("") + `</div>`;
}

function planCard(plan, { editable }) {
  const st = statusOf(plan);
  const meta = STATUS_META[st];
  const open = state.expanded.has(plan.id);
  const updated = relativeDays(toDate(plan.updatedAt));

  const bits = [
    plan.dept,
    `${plan.year} 學年度 ${TERM_LABEL[String(plan.term)] || ""}`.trim(),
    plan.ownerName || plan.ownerEmail,
    plan.dueDate ? `期限 ${plan.dueDate}` : "",
    updated
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
          ${editable ? `
            <button class="btn btn-sm" data-act="edit" data-id="${esc(plan.id)}">編輯</button>
            <button class="btn btn-sm btn-danger" data-act="delete" data-id="${esc(plan.id)}">刪除</button>` : ""}
        </div>
      </div>
      ${meterHtml(plan)}
      ${plan.note ? `<p class="plan-note">${esc(plan.note)}</p>` : ""}
      <button class="toggle-steps" data-act="toggle" data-id="${esc(plan.id)}">
        ${open ? "▲ 收合步驟" : `▼ 展開步驟(${(plan.steps || []).length})`}
      </button>
      ${open ? stepsHtml(plan, editable) : ""}
    </article>`;
}

function renderDashboard() {
  const plans = applyFilters(state.plans);
  renderStats(plans);
  $("#dashboard-list").innerHTML = plans.length
    ? plans.map((p) => planCard(p, { editable: canEdit(p) })).join("")
    : `<div class="empty">目前沒有符合篩選條件的計畫。</div>`;
}

function renderMine() {
  const mine = state.plans.filter((p) => p.ownerUid === state.user?.uid);
  $("#mine-list").innerHTML = mine.length
    ? mine.map((p) => planCard(p, { editable: true })).join("")
    : `<div class="empty">你還沒有建立任何計畫,點右上角「＋ 新增計畫」開始。</div>`;
}

function renderMembers() {
  const tbody = $("#members-table tbody");
  if (!tbody) return;
  const active = new Set(state.plans.map((p) => (p.ownerEmail || "").toLowerCase()));
  const rows = [...state.members].sort((a, b) =>
    (a.dept || "").localeCompare(b.dept || "", "zh-Hant") || (a.name || "").localeCompare(b.name || "", "zh-Hant"));

  tbody.innerHTML = rows.map((m) => `
    <tr>
      <td>${esc(m.name)}</td>
      <td>${esc(m.email)}</td>
      <td>${esc(m.dept || "")}</td>
      <td>${esc(m.title || "")}</td>
      <td>${m.role === "admin" ? "管理者" : "一般成員"}</td>
      <td>${active.has(m.email) ? "已使用" : "尚未建立計畫"}</td>
      <td>
        <button class="btn btn-sm" data-mact="edit" data-email="${esc(m.email)}">編輯</button>
        <button class="btn btn-sm btn-danger" data-mact="delete" data-email="${esc(m.email)}">移除</button>
      </td>
    </tr>`).join("") || `<tr><td colspan="7" style="color:var(--text-secondary)">名單是空的。</td></tr>`;
}

/* ---------------- 計畫卡互動 ---------------- */

document.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const plan = state.plans.find((p) => p.id === btn.dataset.id);
  if (!plan) return;

  if (btn.dataset.act === "toggle") {
    state.expanded.has(plan.id) ? state.expanded.delete(plan.id) : state.expanded.add(plan.id);
    renderDashboard();
    renderMine();
  } else if (btn.dataset.act === "edit") {
    openPlanDialog(plan);
  } else if (btn.dataset.act === "delete") {
    if (!confirm(`確定要刪除「${plan.title}」嗎?此動作無法復原。`)) return;
    try {
      await deleteDoc(doc(db, "plans", plan.id));
    } catch (err) {
      alert(`刪除失敗:${err.message}`);
    }
  }
});

// 直接在卡片上更新單一步驟狀態
document.addEventListener("change", async (e) => {
  const sel = e.target.closest(".step-status");
  if (!sel) return;
  const plan = state.plans.find((p) => p.id === sel.dataset.plan);
  if (!plan) return;

  const steps = (plan.steps || []).map((s, i) =>
    i === Number(sel.dataset.step) ? { ...s, status: sel.value } : s);
  try {
    await updateDoc(doc(db, "plans", plan.id), { steps, updatedAt: serverTimestamp() });
  } catch (err) {
    alert(`更新失敗:${err.message}`);
  }
});

/* ---------------- 計畫編輯對話框 ---------------- */

const dlgPlan = $("#dlg-plan");
const formPlan = $("#form-plan");
let editingPlanId = null;
let draftSteps = [];

// 用 elements.namedItem 取欄位:直接寫 form.title / form.name 會和
// HTMLFormElement 自身的 title、name 屬性混淆。
const pf = (name) => formPlan.elements.namedItem(name);

function renderStepEditor() {
  $("#steps-editor").innerHTML = draftSteps.map((s, i) => `
    <div class="step-edit" data-i="${i}">
      <input value="${esc(s.title)}" data-k="title" placeholder="步驟名稱,例:場地借用申請" maxlength="80">
      <input value="${esc(s.due || "")}" data-k="due" type="date" aria-label="步驟期限">
      <select data-k="status" aria-label="步驟狀態">
        ${Object.entries(STEP_LABEL).map(([v, l]) =>
          `<option value="${v}"${s.status === v ? " selected" : ""}>${l}</option>`).join("")}
      </select>
      <button type="button" class="btn btn-sm btn-danger" data-del="${i}">刪除</button>
    </div>`).join("");
}

$("#steps-editor").addEventListener("input", (e) => {
  const row = e.target.closest(".step-edit");
  if (!row || !e.target.dataset.k) return;
  draftSteps[Number(row.dataset.i)][e.target.dataset.k] = e.target.value;
});

$("#steps-editor").addEventListener("change", (e) => {
  const row = e.target.closest(".step-edit");
  if (!row || !e.target.dataset.k) return;
  draftSteps[Number(row.dataset.i)][e.target.dataset.k] = e.target.value;
});

$("#steps-editor").addEventListener("click", (e) => {
  const del = e.target.closest("[data-del]");
  if (!del) return;
  draftSteps.splice(Number(del.dataset.del), 1);
  renderStepEditor();
});

$("#btn-add-step").addEventListener("click", () => {
  draftSteps.push({ title: "", due: "", status: "todo", note: "" });
  renderStepEditor();
  $("#steps-editor").lastElementChild?.querySelector("input")?.focus();
});

function openPlanDialog(plan) {
  editingPlanId = plan?.id || null;
  $("#dlg-plan-title").textContent = plan ? "編輯計畫" : "新增計畫";
  show($("#plan-error"), false);
  formPlan.reset();

  pf("title").value = plan?.title || "";
  pf("dept").value = plan?.dept || state.member?.dept || "";
  pf("year").value = String(plan?.year ?? currentAcademicYear());
  pf("term").value = String(plan?.term ?? "1");
  pf("dueDate").value = plan?.dueDate || "";
  pf("note").value = plan?.note || "";

  draftSteps = (plan?.steps || []).map((s) => ({ ...s }));
  if (!draftSteps.length) draftSteps.push({ title: "", due: "", status: "todo", note: "" });
  renderStepEditor();
  dlgPlan.showModal();
}

$("#btn-new-plan").addEventListener("click", () => openPlanDialog(null));
$("#btn-plan-cancel").addEventListener("click", () => dlgPlan.close());

formPlan.addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("#plan-error");
  show(err, false);

  const steps = draftSteps
    .filter((s) => s.title.trim())
    .map((s) => ({
      title: s.title.trim(),
      due: s.due || "",
      status: ["todo", "doing", "done"].includes(s.status) ? s.status : "todo",
      note: (s.note || "").trim()
    }));

  const payload = {
    title: pf("title").value.trim(),
    dept: pf("dept").value,
    year: Number(pf("year").value),
    term: pf("term").value,
    dueDate: pf("dueDate").value || "",
    note: pf("note").value.trim(),
    steps,
    updatedAt: serverTimestamp()
  };

  if (!payload.title || !payload.dept) {
    err.textContent = "請填寫計畫名稱與處室。";
    show(err, true);
    return;
  }

  try {
    if (editingPlanId) {
      await updateDoc(doc(db, "plans", editingPlanId), payload);
    } else {
      await addDoc(collection(db, "plans"), {
        ...payload,
        ownerUid: state.user.uid,
        ownerEmail: (state.user.email || "").toLowerCase(),
        ownerName: state.member?.name || state.user.displayName || "",
        createdAt: serverTimestamp()
      });
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
  mf("role").value = m?.role || "teacher";
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
  } else {
    if (m.email === (state.user.email || "").toLowerCase()) {
      alert("不能移除自己,以免系統失去管理者。");
      return;
    }
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
  const data = {
    name: mf("name").value.trim(),
    dept: mf("dept").value,
    title: mf("title").value.trim(),
    role: mf("role").value === "admin" ? "admin" : "teacher"
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
    err.textContent = `儲存失敗:${e2.message}`;
    show(err, true);
  }
});
