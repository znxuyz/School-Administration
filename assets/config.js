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

// 承辦計畫的處室(建立計畫時選)
export const DEPARTMENTS = [
  "校長室",
  "教導處",
  "教務處",
  "學務處",
  "總務處",
  "輔導室",
  "人事室",
  "會計室",
  "幼兒園",
  "其他"
];

// 公文可能流到的單位。分成校內與校外兩組,顯示時會分群。
export const UNIT_GROUPS = [
  {
    label: "承辦人",
    units: ["承辦人手上"]
  },
  {
    label: "校內處室",
    units: ["校長室", "教導處", "教務處", "學務處", "總務處", "輔導室", "人事室", "會計室", "幼兒園"]
  },
  {
    label: "校外單位",
    units: ["彰化縣政府教育處", "彰化縣政府(其他處室)", "彰化縣政府主計處", "其他外部單位"]
  }
];

export const ALL_UNITS = UNIT_GROUPS.flatMap((g) => g.units);
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
    steps: [
      { stage: "plan",    title: "計畫書撰寫" },
      { stage: "plan",    title: "經費概算表" },
      { stage: "plan",    title: "簽陳校長核可" },
      { stage: "plan",    title: "計畫函報上級" },
      { stage: "approve", title: "上級核定函收文" },
      { stage: "approve", title: "核定金額確認" },
      { stage: "approve", title: "呈送領據" },
      { stage: "approve", title: "經費撥入確認" },
      { stage: "execute", title: "採購/請購作業" },
      { stage: "execute", title: "活動辦理" },
      { stage: "execute", title: "成果照片蒐集" },
      { stage: "close",   title: "核銷資料彙整" },
      { stage: "close",   title: "經費支出結算表" },
      { stage: "close",   title: "支出憑證—財務請購" },
      { stage: "close",   title: "支出憑證—薪水動簽" },
      { stage: "close",   title: "支出憑證—勞保勞退" },
      { stage: "close",   title: "剩餘款繳回" },
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

// 超過這個天數沒有更新,且尚未完成的計畫會被標為「待更新」。
export const STALE_DAYS = 14;
