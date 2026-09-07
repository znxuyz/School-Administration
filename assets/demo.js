// 預覽模式的假資料。只在網址帶 ?demo=1 時才會用到,
// 目的是讓沒有帳號的人也能看到每一頁長什麼樣子,不會寫進資料庫。

const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const shift = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const stampAt = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };

const YEAR = (() => {
  const d = new Date();
  const roc = d.getFullYear() - 1911;
  return d.getMonth() + 1 >= 8 ? roc : roc - 1;
})();

export const DEMO_MEMBER = {
  name: "示範帳號", dept: "教務處", role: "admin", email: "demo@example.com"
};

export const DEMO_USER = { email: "demo@example.com", displayName: "示範帳號" };

export const DEMO_MEMBERS = [
  { email: "demo@example.com", name: "示範帳號", dept: "教務處", role: "admin" },
  { email: "lin@example.com", name: "林淑芬", dept: "教務處", role: "director" },
  { email: "chen@example.com", name: "陳建成", dept: "學務處", role: "staff" },
  { email: "wu@example.com", name: "吳雅婷", dept: "總務處", role: "staff" },
  { email: "huang@example.com", name: "黃志明", dept: "輔導室", role: "director" }
];

export const DEMO_NOTES = [
  { id: "n1", date: shift(2), text: "教育處到校訪視,上午九點於會議室", scope: "all",
    ownerEmail: "demo@example.com", ownerName: "示範帳號", dept: "教務處" },
  { id: "n2", date: shift(9), text: "課程發展委員會(記得先發開會通知)", scope: "dept",
    ownerEmail: "lin@example.com", ownerName: "林淑芬", dept: "教務處" },
  { id: "n3", date: shift(-3), text: "消防設備申報資料要在月底前送出", scope: "all",
    ownerEmail: "wu@example.com", ownerName: "吳雅婷", dept: "總務處" }
];

const S = (stage, title, status, extra = {}) => ({
  stage, title, status, location: "", sentAt: "", doneAt: "", startedAt: "", note: "", ...extra
});

export const DEMO_PLANS = [
  {
    id: "p1",
    title: "本土語文教學支援人員鐘點費補助計畫",
    dept: "教務處", year: YEAR,
    ownerEmail: "demo@example.com", ownerName: "示範帳號",
    startDate: shift(-96), endDate: shift(-12),
    budget: "128000", recurring: "",
    note: "第二期款核銷資料要在結算期限前送齊,缺一張講師領據。",
    updatedAt: stampAt(-2), updatedByName: "示範帳號",
    steps: [
      S("plan", "計畫書撰寫", "done", { doneAt: shift(-92) }),
      S("plan", "經費概算表", "done", { doneAt: shift(-92), bundleWithPrev: true }),
      S("approve", "上級核定函收文", "done", { doneAt: shift(-70), incoming: true }),
      S("approve", "呈送領據", "done", { doneAt: shift(-64) }),
      S("execute", "活動辦理", "done", { doneAt: shift(-14) }),
      S("execute", "成果照片蒐集", "done", { doneAt: shift(-12) }),
      S("close", "核銷資料彙整", "doing", { startedAt: shift(-9) }),
      S("close", "經費支出結算表", "todo", { bundleWithPrev: true }),
      S("close", "支出憑證—財務請購", "todo", { bundleWithPrev: true }),
      S("close", "支出憑證—薪水動簽", "todo", { bundleWithPrev: true }),
      S("close", "支出憑證—勞保勞退", "na", { bundleWithPrev: true }),
      S("close", "剩餘款繳回", "todo", { bundleWithPrev: true }),
      S("close", "結案函報上級", "todo")
    ],
    flow: [
      { date: shift(-92), from: "承辦人手上", to: "教務處", step: "計畫書撰寫", stage: "plan", note: "" },
      { date: shift(-88), from: "教務處", to: "校長室", step: "計畫書撰寫", stage: "plan", note: "" },
      { date: shift(-84), from: "校長室", to: "彰化縣政府教育處", step: "計畫書撰寫", stage: "plan", note: "核備" },
      { date: shift(-70), from: "彰化縣政府教育處", to: "承辦人手上", step: "上級核定函收文", stage: "approve", note: "核定函到" }
    ]
  },
  {
    id: "p2",
    title: "校園消防安全設備定期檢修申報",
    dept: "總務處", year: YEAR,
    ownerEmail: "wu@example.com", ownerName: "吳雅婷",
    startDate: shift(-40), endDate: shift(18),
    budget: "46000", recurring: "half",
    note: "",
    updatedAt: stampAt(-1), updatedByName: "吳雅婷",
    steps: [
      S("plan", "計畫書撰寫", "done", { doneAt: shift(-36) }),
      S("plan", "簽陳校長核可", "done", { doneAt: shift(-30) }),
      S("approve", "核定/公告周知", "doing", { startedAt: shift(-22), location: "彰化縣政府教育處",
        sentAt: shift(-22), note: "申報書已送縣府" }),
      S("execute", "活動辦理", "todo"),
      S("execute", "成果照片蒐集", "todo"),
      S("close", "成果報告撰寫上傳", "todo")
    ],
    flow: [
      { date: shift(-36), from: "承辦人手上", to: "總務處", step: "計畫書撰寫", stage: "plan", note: "" },
      { date: shift(-30), from: "總務處", to: "校長室", step: "簽陳校長核可", stage: "plan", note: "" },
      { date: shift(-22), from: "校長室", to: "彰化縣政府教育處", step: "核定/公告周知", stage: "approve", note: "掛號寄出" }
    ]
  },
  {
    id: "p3",
    title: "學生輔導諮商中心到校服務實施計畫",
    dept: "輔導室", year: YEAR,
    ownerEmail: "huang@example.com", ownerName: "黃志明",
    startDate: shift(-25), endDate: shift(62),
    budget: "", recurring: "year",
    note: "",
    updatedAt: stampAt(-21), updatedByName: "黃志明",
    steps: [
      S("plan", "計畫書撰寫", "done", { doneAt: shift(-20) }),
      S("plan", "簽陳校長核可", "doing", { startedAt: shift(-18), location: "校長室", sentAt: shift(-18) }),
      S("approve", "核定/公告周知", "todo"),
      S("execute", "活動辦理", "todo"),
      S("execute", "成果照片蒐集", "todo"),
      S("close", "成果報告撰寫上傳", "todo")
    ],
    flow: [
      { date: shift(-20), from: "承辦人手上", to: "輔導室", step: "計畫書撰寫", stage: "plan", note: "" },
      { date: shift(-18), from: "輔導室", to: "校長室", step: "簽陳校長核可", stage: "plan", note: "等批" }
    ]
  },
  {
    // 等核定函的例子:概算送上去了,核定函是縣府那邊寄下來的,還沒到手上
    id: "p3b",
    title: "校園網路電路費計畫",
    dept: "教務處", year: YEAR,
    ownerEmail: "demo@example.com", ownerName: "示範帳號",
    startDate: shift(-30), endDate: shift(150),
    budget: "", recurring: "year",
    note: "",
    updatedAt: stampAt(-6), updatedByName: "示範帳號",
    steps: [
      S("plan", "計畫書撰寫", "done", { doneAt: shift(-24) }),
      S("plan", "經費概算表", "done", { doneAt: shift(-24), bundleWithPrev: true }),
      S("approve", "上級核定函收文", "doing",
        { startedAt: shift(-24), incoming: true, location: "尚未收到" }),
      S("approve", "呈送領據", "todo"),
      S("execute", "採購/請購作業", "todo"),
      S("close", "核銷資料彙整", "todo")
    ],
    flow: [
      { date: shift(-28), from: "承辦人手上", to: "教務處", step: "計畫書撰寫 等 2 份", stage: "plan", note: "" },
      { date: shift(-26), from: "教務處", to: "校長室", step: "計畫書撰寫 等 2 份", stage: "plan", note: "" },
      { date: shift(-24), from: "校長室", to: "彰化縣政府教育處", step: "計畫書撰寫 等 2 份", stage: "plan", note: "報府核定" }
    ]
  },
  {
    id: "p4",
    title: "友善校園週宣導活動",
    dept: "學務處", year: YEAR,
    ownerEmail: "chen@example.com", ownerName: "陳建成",
    startDate: shift(-58), endDate: shift(-34),
    budget: "8000", recurring: "",
    note: "",
    updatedAt: stampAt(-16), updatedByName: "陳建成",
    driveUrl: "https://drive.google.com/drive/folders/example",
    steps: [
      S("plan", "計畫書撰寫", "done", { doneAt: shift(-56) }),
      S("plan", "簽陳校長核可", "done", { doneAt: shift(-52) }),
      S("approve", "核定/公告周知", "done", { doneAt: shift(-48) }),
      S("execute", "活動辦理", "done", { doneAt: shift(-36) }),
      S("execute", "成果照片蒐集", "done", { doneAt: shift(-34) }),
      S("close", "成果報告撰寫上傳", "done", { doneAt: shift(-30) })
    ],
    flow: [
      { date: shift(-56), from: "承辦人手上", to: "學務處", step: "計畫書撰寫", stage: "plan", note: "" },
      { date: shift(-52), from: "學務處", to: "校長室", step: "簽陳校長核可", stage: "plan", note: "" },
      { date: shift(-48), from: "校長室", to: "承辦人手上", step: "核定/公告周知", stage: "approve", note: "已核可" }
    ]
  },
  {
    id: "p5",
    title: "十二年國教課程計畫備查",
    dept: "教務處", year: YEAR,
    ownerEmail: "lin@example.com", ownerName: "林淑芬",
    startDate: shift(-12), endDate: shift(40),
    budget: "", recurring: "year",
    note: "各領域課程計畫收齊後彙整成一份送縣府備查。",
    updatedAt: stampAt(-4), updatedByName: "林淑芬",
    steps: [
      S("plan", "計畫書撰寫", "doing", { startedAt: shift(-10) }),
      S("plan", "簽陳校長核可", "todo"),
      S("approve", "核定/公告周知", "todo"),
      S("execute", "活動辦理", "todo"),
      S("execute", "成果照片蒐集", "todo"),
      S("close", "成果報告撰寫上傳", "todo")
    ],
    flow: []
  },
  {
    id: "p6",
    title: "教職員工健康檢查(去年版,已刪除)",
    dept: "人事室", year: YEAR - 1,
    ownerEmail: "demo@example.com", ownerName: "示範帳號",
    startDate: shift(-320), endDate: shift(-240),
    budget: "", recurring: "",
    note: "",
    updatedAt: stampAt(-200), updatedByName: "示範帳號",
    deletedAt: shift(-198), deletedBy: "示範帳號",
    steps: [
      S("plan", "計畫書撰寫", "done", { doneAt: shift(-316) }),
      S("approve", "核定/公告周知", "done", { doneAt: shift(-300) }),
      S("execute", "活動辦理", "done", { doneAt: shift(-250) }),
      S("close", "成果報告撰寫上傳", "todo")
    ],
    flow: []
  }
];
