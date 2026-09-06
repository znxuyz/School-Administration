// ---------------------------------------------------------------
// 主題色。點頂欄左上的品牌圖示就能換色,選擇存在這台裝置上。
//
// 為什麼不寫進 Firestore:換色是「這台電腦看起來順眼」的偏好,
// 不是要跟同事共用的資料。老師在辦公室電腦跟家裡選不一樣色也合理,
// 而且不連線也要能立刻生效,所以跟 saveView() 一樣走 localStorage。
//
// 每一種配色只提供一個主色,--accent-strong / -track / -wash 由主色推算,
// 這樣不必為二十組配色各寫四個色階,深色模式也能沿用同一套算法。
// ---------------------------------------------------------------

const STORE_KEY = "admin-tracker:accent";
const THEME_KEY = "admin-tracker:theme";

/** 單色。deep 是 hover 用的深階,ink 是壓在主色上的文字色。 */
export const ACCENT_SOLIDS = [
  { id: "teal",   name: "湖水綠", c: "#12a594", deep: "#0c7d70" },
  { id: "blue",   name: "資訊藍", c: "#2a78d6", deep: "#1c5cab" },
  { id: "green",  name: "松綠",   c: "#1a8a4c", deep: "#12683a" },
  { id: "lime",   name: "青檸",   c: "#5c8f0a", deep: "#446a07" },
  { id: "gold",   name: "金黃",   c: "#a97c00", deep: "#815e00" },
  { id: "orange", name: "琥珀橙", c: "#c96a1a", deep: "#9d5113" },
  { id: "red",    name: "硃紅",   c: "#c53030", deep: "#9b2424" },
  { id: "pink",   name: "桃粉",   c: "#c0246e", deep: "#951a55" },
  { id: "violet", name: "紫羅蘭", c: "#7c3aed", deep: "#5f2bb8" },
  { id: "indigo", name: "靛藍",   c: "#4f46e5", deep: "#3b34b5" },
  { id: "cyan",   name: "天青",   c: "#0e7490", deep: "#0a5870" },
  { id: "slate",  name: "石墨",   c: "#4b5a6b", deep: "#374553" },
  { id: "brown",  name: "咖啡",   c: "#8a5a2b", deep: "#6a4520" },
  { id: "mint",   name: "薄荷",   c: "#0f8f7a", deep: "#0b6e5e" }
];

/**
 * 漸層。只用在品牌圖示與主要按鈕這種大色塊上;
 * 進度條、標籤這些小面積仍用 c(漸層的起始色),避免細長元件上看不出漸層只顯得髒。
 */
export const ACCENT_GRADIENTS = [
  { id: "aurora",   name: "極光", c: "#2a9d8f", deep: "#1f7168", fill: "linear-gradient(135deg, #3ec9b0, #2a78d6 55%, #8b5cf6)" },
  { id: "sunset",   name: "夕燒", c: "#d9534f", deep: "#a83b38", fill: "linear-gradient(135deg, #f2a13b, #e2574c 55%, #c62a63)" },
  { id: "ocean",    name: "深海", c: "#1a6fb5", deep: "#12558c", fill: "linear-gradient(135deg, #2bb3d4, #2a78d6 50%, #3b3fb5)" },
  { id: "neon",     name: "霓虹", c: "#8b5cf6", deep: "#6a41c4", fill: "linear-gradient(135deg, #e879f9, #818cf8 50%, #22d3ee)" },
  { id: "citrus",   name: "柑橘", c: "#7a9a12", deep: "#5c750d", fill: "linear-gradient(135deg, #a3cc32, #7a9a12 45%, #d98b0d)" },
  { id: "graphite", name: "鋼藍", c: "#4b5a6b", deep: "#333f4c", fill: "linear-gradient(135deg, #8fa0b3, #4b5a6b 55%, #26313d)" }
];

const ALL = [...ACCENT_SOLIDS, ...ACCENT_GRADIENTS];
const DEFAULT_ID = "teal";

/* ---------------- 色彩換算 ---------------- */

function toRgb(hex) {
  const h = String(hex).replace("#", "");
  const n = h.length === 3 ? h.split("").map((x) => x + x).join("") : h;
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
}

const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));
const hex = ([r, g, b]) => "#" + [r, g, b].map((x) => clamp(x).toString(16).padStart(2, "0")).join("");

/** 往白色或黑色混,用來推 -track(淺)與 -strong(深)。 */
const mix = (rgb, target, amount) => rgb.map((v, i) => v + (target[i] - v) * amount);

const WHITE = [255, 255, 255];
const BLACK = [0, 0, 0];

/** 相對亮度,決定壓在主色上的字要黑要白 */
function luminance(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const systemPrefersDark = () => !!window.matchMedia?.("(prefers-color-scheme: dark)").matches;

/** "dark" | "light" | "" (跟隨系統) */
function readTheme() {
  try { return localStorage.getItem(THEME_KEY) || ""; } catch { return ""; }
}

/** 目前實際生效的模式 */
function effectiveTheme() {
  const saved = readTheme();
  return saved || (systemPrefersDark() ? "dark" : "light");
}

/**
 * 色階要跟「畫面上真正的底色」對齊,不能只信 matchMedia ——
 * 在 iframe 或還沒套上 color-scheme 的瞬間,matchMedia 可能還回報淺色,
 * 但 CSS 的深色規則已經生效,結果就是深底配淺色階(白色進度條、看不見的分頁)。
 * 所以直接量 --page 的亮度:那是 CSS 自己算出來的結果,一定同步。
 */
function renderedDark() {
  try {
    const page = getComputedStyle(document.documentElement).getPropertyValue("--page").trim();
    if (page) {
      const rgb = toRgb(page);
      if (rgb) return luminance(rgb) < 0.5;
    }
  } catch { /* 量不到就退回偏好設定 */ }
  return effectiveTheme() === "dark";
}

const isDarkMode = () => renderedDark();

/**
 * CSS 的深色是寫在 @media (prefers-color-scheme: dark) 裡、加上
 * :root:not([data-theme="light"]) 這個條件。所以:
 *   選淺色 → 掛 data-theme="light",擋掉整段深色規則
 *   選深色 → 掛 data-theme="dark",另有一段對應規則接手
 * 兩個都不掛就回到跟隨系統。
 */
function applyTheme() {
  const saved = readTheme();
  const root = document.documentElement;
  if (saved) root.setAttribute("data-theme", saved);
  else root.removeAttribute("data-theme");

  const btn = document.querySelector("#btn-theme");
  if (btn) {
    const dark = isDarkMode();
    btn.textContent = dark ? "☀" : "☾";
    btn.title = dark ? "切換成淺色" : "切換成深色";
  }
  // 主色的色階跟著模式重算(深色底下的 track 比淺色深很多)
  applyAccent();
}

export function initThemeToggle() {
  applyTheme();
  // 第一格算出來的模式可能還是舊的(iframe、字型/樣式尚未套用),下一格再校正一次
  requestAnimationFrame(() => applyAccent());
  const btn = document.querySelector("#btn-theme");
  if (btn) {
    btn.addEventListener("click", () => {
      const next = isDarkMode() ? "light" : "dark";
      try { localStorage.setItem(THEME_KEY, next); } catch { /* 無痕模式:當次仍生效 */ }
      applyTheme();
    });
  }
  // 沒有自己選過的人,跟著系統一起換
  window.matchMedia?.("(prefers-color-scheme: dark)")
    .addEventListener?.("change", () => { if (!readTheme()) applyTheme(); });
}

/**
 * 淺色底上，醒色系的主色（琥珀橙、金黃）当小字用會不夠對比。
 * 一次往黑色混一成，混到達 4.5:1 才停，最多壓八次。
 * 大色塊（品牌圖示、主要按鈕）不經過這道，保留原色的魯利。
 */
function legibleOn(rgb, bg) {
  let out = rgb;
  const bgLum = luminance(bg);
  for (let i = 0; i < 8; i++) {
    if ((bgLum + 0.05) / (luminance(out) + 0.05) >= 4.5) break;
    out = out.map((v) => v * 0.9);
  }
  return out;
}

/** 把一個主色展開成四個色階 + 文字色 */
function ramp(c) {
  const rgb = toRgb(c);
  const dark = isDarkMode();
  // 淺色模式下，--accent 會被當成文字色用在 11px 的小標題上，先壓到看得見
  const readable = dark ? rgb : legibleOn(rgb, [252, 252, 251]);
  return {
    accent: hex(readable),
    // 深色模式底下,hover 要更亮才看得出變化;淺色模式則是更深
    strong: hex(mix(rgb, dark ? WHITE : BLACK, 0.34)),
    track: hex(mix(rgb, dark ? BLACK : WHITE, dark ? 0.55 : 0.76)),
    wash: hex(mix(rgb, dark ? BLACK : WHITE, dark ? 0.82 : 0.94)),
    // 壓深後的單色底要用自己算出來的字色,不能沿用為原亮色配的近黑色
    ink: luminance(readable) > 0.45 ? "#0b0b0b" : "#ffffff",
    // 漸層(--accent-fill)沒被壓深,字色照原色算
    inkOnFill: luminance(rgb) > 0.45 ? "#0b0b0b" : "#ffffff"
  };
}

/* ---------------- 讀寫偏好 ---------------- */

function read() {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    if (v && (v.custom || v.id)) return v;
  } catch { /* 壞掉的內容忽略,用預設色 */ }
  return { id: DEFAULT_ID, custom: "" };
}

function write(v) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(v)); } catch { /* 無痕模式不能寫,當次仍生效 */ }
}

/** 目前選到的配色物件 */
export function currentAccent() {
  const saved = read();
  if (saved.custom) {
    return { id: "custom", name: "自訂", c: saved.custom, deep: saved.custom, fill: saved.custom };
  }
  const found = ALL.find((x) => x.id === saved.id) || ALL[0];
  return { ...found, fill: found.fill || `linear-gradient(150deg, ${found.c}, ${found.deep})` };
}

/** 把配色寫進 :root,全站的 var(--accent*) 立刻跟著換 */
export function applyAccent() {
  const a = currentAccent();
  const r = ramp(a.c);
  const s = document.documentElement.style;
  s.setProperty("--accent", r.accent);
  // hover 的深階:淺色模式用手挑的 deep(比算出來的好看);
  // 深色模式不能用 —— deep 一律比主色暗,套在深色底上等於 hover 之後更看不見,
  // 那邊要的是「更亮」,所以改用 ramp() 為深色算好的那一階。
  s.setProperty("--accent-strong",
    !isDarkMode() && a.deep && a.id !== "custom" ? a.deep : r.strong);
  s.setProperty("--accent-track", r.track);
  s.setProperty("--accent-wash", r.wash);
  // 深色模式的 wash 要夠暗才能當底色,淺色模式要夠亮 —— ramp() 已依模式算好
  s.setProperty("--accent-fill", a.fill);
  s.setProperty("--accent-ink", r.inkOnFill);   // 壓在漸層大色塊上
  s.setProperty("--accent-ink-flat", r.ink);    // 壓在壓深後的單色上
  const mark = document.querySelector("#btn-accent");
  if (mark) mark.setAttribute("aria-label", `更換主題色(目前:${a.name})`);
}

function choose(patch) {
  write({ id: patch.id || "", custom: patch.custom || "" });
  applyAccent();
  renderSwatches();
}

/* ---------------- 選色面板 ---------------- */

function swatch(item, current) {
  const on = item.id === current.id;
  const fill = item.fill || `linear-gradient(150deg, ${item.c}, ${item.deep})`;
  return `<button type="button" class="swatch${on ? " on" : ""}" data-accent="${item.id}"
    style="background:${fill}" title="${item.name}" aria-label="${item.name}"
    aria-pressed="${on}"></button>`;
}

function renderSwatches() {
  const box = document.querySelector("#accent-menu");
  if (!box) return;
  const cur = currentAccent();
  box.querySelector("[data-solids]").innerHTML = ACCENT_SOLIDS.map((s) => swatch(s, cur)).join("");
  box.querySelector("[data-gradients]").innerHTML = ACCENT_GRADIENTS
    .map((g) => `<button type="button" class="swatch swatch-wide${g.id === cur.id ? " on" : ""}"
        data-accent="${g.id}" style="background:${g.fill}" aria-pressed="${g.id === cur.id}"
        title="${g.name}">${g.name}</button>`)
    .join("");
  box.querySelector("#accent-custom").value = cur.c;
  box.querySelector("#accent-current").textContent = cur.name;
}

const showMenu = (open) => {
  const menu = document.querySelector("#accent-menu");
  const btn = document.querySelector("#btn-accent");
  if (!menu || !btn) return;
  menu.hidden = !open;
  btn.setAttribute("aria-expanded", String(open));
};

/** 頂欄的品牌圖示 = 換色入口。在 app.js 啟動時呼叫一次。 */
export function initAccentPicker() {
  applyAccent();
  renderSwatches();

  const btn = document.querySelector("#btn-accent");
  const menu = document.querySelector("#accent-menu");
  if (!btn || !menu) return;

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    showMenu(menu.hidden);
  });

  menu.addEventListener("click", (e) => {
    e.stopPropagation();
    const sw = e.target.closest("[data-accent]");
    if (sw) { choose({ id: sw.dataset.accent }); return; }
    if (e.target.closest("#accent-reset")) { choose({ id: DEFAULT_ID }); return; }
    if (e.target.closest("#accent-done")) showMenu(false);
  });

  menu.querySelector("#accent-custom").addEventListener("input", (e) => {
    choose({ custom: e.target.value });
  });

  document.addEventListener("click", () => showMenu(false));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !menu.hidden) { showMenu(false); btn.focus(); }
  });

}
