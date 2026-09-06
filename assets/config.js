// ---------------------------------------------------------------
// 版本號:改版時只要把 APP_BUILD 加一,代號會自動換下一個。
// 別忘了執行 ./bump.sh <新的號碼> 讓 index.html 與 sw.js 一起更新,
// 否則老師的瀏覽器會繼續用快取裡的舊程式。
// ---------------------------------------------------------------
export const APP_BUILD = 41;

// 版本代號用單字表示,畫面上不出現阿拉伯數字。
// 一次改版換一個代號,五十個輪完再從「朔」開始。
export const CODENAMES = [
  "朔", "曦", "晦", "寂", "縈", "澄", "漾", "泠", "潛", "洄",
  "霽", "霧", "霜", "岑", "嶼", "隙", "痕", "墜", "浮", "棲",
  "逝", "遙", "徊", "渡", "寧", "妄", "惑", "慕", "憫", "悵",
  "縛", "解", "歸", "離", "契", "寞", "冥", "幽", "燼", "灼",
  "凜", "融", "裂", "湮", "寰", "弦", "紋", "幻", "蛻", "寂"
];

// 代號從第 11 版開始輪(在這之前用的是修仙境界)。
// 版本號本身要一直往上加才擋得住瀏覽器快取,所以不從 1 重來,改用這個起點換算。
export const CODE_BASE = 11;

/** 某一版的代號 */
export function versionFor(build) {
  const n = CODENAMES.length;
  return `代號:${CODENAMES[((build - CODE_BASE) % n + n) % n]}`;
}

export const APP_VERSION = versionFor(APP_BUILD);

// Firebase 專案設定。
// 這段設定屬於公開資訊,放在前端是 Firebase 的正常用法;
// 真正的存取控管由 firestore.rules 與 Authentication 授權網域負責。
export const firebaseConfig = {
  apiKey: "AIzaSyDsrfdv_NlT_9raP4lHqhXqzSM8wZ7CAjc",
  authDomain: "school-administration-39b08.firebaseapp.com",
  projectId: "school-administration-39b08",
  storageBucket: "school-administration-39b08.firebasestorage.app",
  messagingSenderId: "588975168758",
  appId: "1:588975168758:web:7c856a9a7140d3216420d7"
};

// ---------------------------------------------------------------
// 以下都可以自行增刪,改完存檔推上 GitHub,網站就會跟著更新。
// ---------------------------------------------------------------

// 成員角色。可見與可編輯的範圍一致,由小到大遞增。
// 舊資料的 teacher 會自動視為 staff。
export const ROLES = [
  { id: "staff",    label: "組長",   desc: "只看得到、也只能編輯自己建立的計畫" },
  { id: "director", label: "主任",   desc: "看得到同處室所有人的計畫,但只能編輯自己的" },
  { id: "admin",    label: "管理員", desc: "看得到並可編輯全校計畫,並維護成員名單" }
];

export const DEFAULT_ROLE = "staff";

// 承辦計畫的處室(建立計畫時選)
export const DEPARTMENTS = [
  "教務處",
  "學務處",
  "總務處",
  "輔導室",
  "人事室",
  "主計室"
];

// 公文可能流到的單位。分成校內與校外兩組,顯示時會分群。
// 校長室不承辦計畫,但公文會送去核可,所以只出現在這裡。
export const UNIT_GROUPS = [
  {
    label: "承辦人",
    units: ["承辦人手上"]
  },
  {
    label: "校內",
    units: ["校長室", "教務處", "學務處", "總務處", "輔導室", "人事室", "主計室"]
  },
  {
    label: "校外單位",
    units: ["彰化縣政府教育處", "彰化縣政府(其他處室)", "彰化縣政府主計處", "其他外部單位"]
  }
];

export const DEFAULT_UNIT = "承辦人手上";

// 行政計畫的四個固定階段
export const STAGES = [
  { id: "plan",    label: "計畫",  hint: "計畫書、經費概算表" },
  { id: "approve", label: "核定",  hint: "核定函、呈送領據" },
  { id: "execute", label: "執行",  hint: "計畫執行期間" },
  { id: "close",   label: "結案",  hint: "核銷、結算、支出憑證" }
];

export const STAGE_IDS = STAGES.map((s) => s.id);

// 各階段的常用步驟。建立步驟時可以從下拉選,也可以自己打字。
export const STEP_SUGGESTIONS = {
  plan: [
    "計畫書撰寫",
    "經費概算表",
    "簽陳校長核可",
    "行政會議討論",
    "校務會議/家長會通過",
    "計畫函報上級"
  ],
  approve: [
    "上級核定函收文",
    "核定金額確認",
    "計畫書依核定修正",
    "呈送領據",
    "經費撥入確認",
    "經費保留申請"
  ],
  execute: [
    "採購/請購作業",
    "簽約或訂購",
    "活動辦理",
    "期中執行報告",
    "成果照片蒐集",
    "執行進度檢核"
  ],
  close: [
    "核銷資料彙整",
    "經費支出結算表",
    "剩餘款繳回",
    "支出憑證—財務請購",
    "支出憑證—薪水動簽",
    "支出憑證—勞保勞退",
    "成果報告撰寫上傳",
    "結案函報上級"
  ]
};

// 建立計畫時可以套用的範本。stage 對應上面的 STAGES。
export const TEMPLATES = [
  {
    id: "full",
    label: "標準行政計畫(含經費核銷)",
    desc: "計畫、核定、執行、結案四階段完整流程,適用有經費補助的計畫。",
    // bundleWithPrev:與上一個步驟併成同一份公文一起送
    steps: [
      { stage: "plan",    title: "計畫書撰寫" },
      { stage: "plan",    title: "經費概算表", bundleWithPrev: true },
      { stage: "approve", title: "上級核定函收文" },
      { stage: "approve", title: "呈送領據" },
      { stage: "execute", title: "活動辦理" },
      { stage: "execute", title: "成果照片蒐集" },
      { stage: "close",   title: "核銷資料彙整" },
      { stage: "close",   title: "經費支出結算表", bundleWithPrev: true },
      { stage: "close",   title: "支出憑證—財務請購", bundleWithPrev: true },
      { stage: "close",   title: "支出憑證—薪水動簽", bundleWithPrev: true },
      { stage: "close",   title: "支出憑證—勞保勞退", bundleWithPrev: true },
      { stage: "close",   title: "剩餘款繳回", bundleWithPrev: true },
      { stage: "close",   title: "結案函報上級" }
    ]
  },
  {
    id: "simple",
    label: "無經費簡易計畫",
    desc: "沒有經費核銷的校內計畫或活動,省略憑證與結算。",
    steps: [
      { stage: "plan",    title: "計畫書撰寫" },
      { stage: "plan",    title: "簽陳校長核可" },
      { stage: "approve", title: "核定/公告周知" },
      { stage: "execute", title: "活動辦理" },
      { stage: "execute", title: "成果照片蒐集" },
      { stage: "close",   title: "成果報告撰寫上傳" }
    ]
  },
  {
    id: "blank",
    label: "空白(自己建立步驟)",
    desc: "不套用任何步驟,全部自己新增。",
    steps: []
  }
];

// 會定期重來的計畫(消防申報每半年、課程計畫每學年…)。
// 結案後到了下一次該辦的時間,系統會主動提示。
export const RECURRENCES = [
  { id: "", label: "不重複", months: 0 },
  { id: "half", label: "每半年(6 個月)", months: 6 },
  { id: "year", label: "每學年(12 個月)", months: 12 }
];

// 下一次該辦的日期前幾天開始提醒。
export const RECUR_LEAD_DAYS = 30;

// 超過這個天數沒有更新,且尚未完成的計畫會被標為「待更新」。
export const STALE_DAYS = 14;

// 公文送出去之後停在同一個單位超過這麼多天,就會被標成「卡關」。
export const STUCK_DAYS = 10;

// 結算寬限期:計畫執行結束後還有幾天可以送結算。
// 老師填的「執行結束日期」不含這段時間,系統會自動往後加。
export const SETTLEMENT_GRACE_DAYS = 14;
