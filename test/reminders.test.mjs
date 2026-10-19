// 提醒挑選邏輯的測試:node test/reminders.test.mjs
//
// 這一段不碰瀏覽器,所以用純資料跑。會出錯的地方幾乎都在這裡 ——
// 日期邊界、該不該提醒、別人的私人記事有沒有外流。

import { remindersFor, notificationFor } from "../assets/reminders.js";

let 失敗 = 0;
const ok = (name, pass, detail = "") => {
  console.log(`${pass ? "  ✓" : "  ✗"} ${name}${detail ? "  " + detail : ""}`);
  if (!pass) 失敗++;
};
const 種類 = (items) => items.map((i) => i.kind).join(",");

const 我 = { email: "a@x.tw", dept: "教務處" };
const 同事 = { email: "b@x.tw", dept: "教務處" };
const 別處室 = { email: "c@x.tw", dept: "學務處" };
const TODAY = "2026-05-10";

/** 一個最小可用的計畫:兩個步驟,都還沒完成 */
const 計畫 = (over = {}) => ({
  id: "p", title: "測試計畫", ownerEmail: 我.email, dept: "教務處",
  endDate: "2026-12-31",
  updatedAt: new Date(`${TODAY}T08:00:00`),
  steps: [
    { title: "計畫書撰寫", stage: "plan", status: "done", doneAt: "2026-05-01" },
    { title: "活動辦理", stage: "execute", status: "doing" }
  ],
  flow: [],
  ...over
});

console.log("\n【該不該提醒】");
{
  // 結算期限 = endDate + 14 天。endDate 設在 today-11,結算就落在 today+3
  const 快到 = 計畫({ endDate: addDaysLocal(TODAY, -11) });
  const r = remindersFor({ member: 我, plans: [快到], today: TODAY });
  ok("結算期限在 3 天內會提醒", r.some((i) => i.kind === "due"), 種類(r));

  const 還早 = 計畫({ endDate: addDaysLocal(TODAY, -10) });   // 結算在 today+4
  const r2 = remindersFor({ member: 我, plans: [還早], today: TODAY });
  ok("結算期限第 4 天還不提醒", !r2.some((i) => i.kind === "due"), 種類(r2));

  const 剛好今天 = 計畫({ endDate: addDaysLocal(TODAY, -14) });
  const r3 = remindersFor({ member: 我, plans: [剛好今天], today: TODAY });
  ok("結算期限就是今天會提醒", r3.some((i) => i.kind === "due" && i.detail.includes("今天")), 種類(r3));

  const 過期 = 計畫({ endDate: addDaysLocal(TODAY, -20) });
  const r4 = remindersFor({ member: 我, plans: [過期], today: TODAY });
  ok("已經逾期的報逾期,不再報「快到期」",
     r4.some((i) => i.kind === "overdue") && !r4.some((i) => i.kind === "due"), 種類(r4));
}

console.log("\n【不該吵的情況】");
{
  const 別人的 = 計畫({ ownerEmail: 同事.email, endDate: addDaysLocal(TODAY, -20) });
  ok("別人承辦的不會推到我手機",
     remindersFor({ member: 我, plans: [別人的], today: TODAY }).length === 0);

  const 刪掉的 = 計畫({ endDate: addDaysLocal(TODAY, -20), deletedAt: TODAY });
  ok("丟進垃圾桶的不提醒",
     remindersFor({ member: 我, plans: [刪掉的], today: TODAY }).length === 0);

  const 做完的 = 計畫({
    endDate: addDaysLocal(TODAY, -20),
    steps: [{ title: "活動辦理", stage: "execute", status: "done", doneAt: "2026-05-01" }]
  });
  ok("已結案的不提醒",
     remindersFor({ member: 我, plans: [做完的], today: TODAY }).length === 0);

  // 「本次不適用」的步驟不列入判斷:它自己的期限過了也不算逾期。
  // (計畫整體的結算期限另算 —— 這裡刻意把它設在很後面,才量得準)
  const 不適用 = 計畫({
    endDate: addDaysLocal(TODAY, 300),
    steps: [
      { title: "剩餘款繳回", stage: "close", status: "na", due: addDaysLocal(TODAY, -5) },
      { title: "活動辦理", stage: "execute", status: "doing" }
    ]
  });
  const r = remindersFor({ member: 我, plans: [不適用], today: TODAY });
  ok("本次不適用的步驟過期了也不算逾期", !r.some((i) => i.kind === "overdue"), 種類(r));

  // 對照組:同一個期限,但步驟是「進行中」就該報逾期
  const 真的過期 = 計畫({
    endDate: addDaysLocal(TODAY, 300),
    steps: [{ title: "剩餘款繳回", stage: "close", status: "doing", due: addDaysLocal(TODAY, -5) }]
  });
  ok("同樣的期限,沒標不適用就會報逾期",
     remindersFor({ member: 我, plans: [真的過期], today: TODAY }).some((i) => i.kind === "overdue"));
}

console.log("\n【公文卡關】");
{
  const 卡 = 計畫({
    steps: [{
      title: "呈送領據", stage: "approve", status: "doing",
      location: "主計室", sentAt: addDaysLocal(TODAY, -12)
    }]
  });
  const r = remindersFor({ member: 我, plans: [卡], today: TODAY });
  ok("停超過十天會報卡關", r.some((i) => i.kind === "stuck" && i.detail.includes("主計室")), JSON.stringify(r[0]?.detail));

  const 還好 = 計畫({
    steps: [{
      title: "呈送領據", stage: "approve", status: "doing",
      location: "主計室", sentAt: addDaysLocal(TODAY, -3)
    }]
  });
  ok("才送出三天不報卡關",
     !remindersFor({ member: 我, plans: [還好], today: TODAY }).some((i) => i.kind === "stuck"));

  const 等核定函 = 計畫({
    steps: [{
      title: "上級核定函收文", stage: "approve", status: "doing",
      incoming: true, location: "尚未收到", startedAt: addDaysLocal(TODAY, -30)
    }]
  });
  ok("等對方寄來的不會被當成卡關",
     !remindersFor({ member: 我, plans: [等核定函], today: TODAY }).some((i) => i.kind === "stuck"));
}

console.log("\n【記事的可見範圍】");
{
  const 記事 = (over) => ({ id: "n", date: TODAY, text: "到校訪視", ...over });
  const 跑 = (n, who) => remindersFor({ member: who, plans: [], notes: [n], today: TODAY });

  ok("全校可看的,大家都收得到",
     跑(記事({ scope: "all", ownerEmail: 別處室.email, dept: "學務處" }), 我).length === 1);

  ok("同處室的,同處室收得到",
     跑(記事({ scope: "dept", ownerEmail: 同事.email, dept: "教務處" }), 我).length === 1);

  ok("同處室的,別處室收不到",
     跑(記事({ scope: "dept", ownerEmail: 同事.email, dept: "教務處" }), 別處室).length === 0);

  ok("只有自己的,別人一定收不到",
     跑(記事({ scope: "self", ownerEmail: 同事.email, dept: "教務處" }), 我).length === 0);

  ok("只有自己的,自己收得到",
     跑(記事({ scope: "self", ownerEmail: 我.email, dept: "教務處" }), 我).length === 1);

  ok("舊記事(沒有 scope)當成全校可看",
     跑(記事({ ownerEmail: 同事.email, dept: "教務處" }), 我).length === 1);

  ok("不是今天的記事不提醒",
     跑(記事({ scope: "all", date: addDaysLocal(TODAY, 1) }), 我).length === 0);
}

console.log("\n【通知的文字】");
{
  ok("沒事就不發通知", notificationFor([]) === null);

  const 多件 = [
    { kind: "overdue", title: "甲計畫", detail: "已逾期(2026-05-01)" },
    { kind: "stuck", title: "乙計畫", detail: "「呈送領據」停在主計室 12 天" },
    { kind: "due", title: "丙計畫", detail: "2 天後要送結算" },
    { kind: "note", title: "到校訪視", detail: "今天的記事" },
    { kind: "end", title: "丁計畫", detail: "今天是執行結束日" },
    { kind: "end", title: "戊計畫", detail: "今天是執行結束日" }
  ];
  const n = notificationFor(多件);
  ok("標題講件數與最急的那一種", n.title.includes("6 件") && n.title.includes("1 件逾期"), n.title);
  ok("內文最多列四件並收尾", n.body.split("\n").length === 5 && n.body.includes("還有 2 件"), JSON.stringify(n.body));

  const 只有記事 = notificationFor([{ kind: "note", title: "到校訪視", detail: "今天的記事" }]);
  ok("只有記事時標題不提逾期", !只有記事.title.includes("逾期"), 只有記事.title);
}

console.log("\n【排序】");
{
  const 逾期 = 計畫({ id: "p1", title: "逾期的", endDate: addDaysLocal(TODAY, -30) });
  const 快到 = 計畫({ id: "p2", title: "快到期的", endDate: addDaysLocal(TODAY, -12) });
  const r = remindersFor({
    member: 我, plans: [快到, 逾期],
    notes: [{ id: "n", date: TODAY, text: "記事", scope: "all" }], today: TODAY
  });
  ok("逾期排最前面、記事排後面", 種類(r) === "overdue,due,note", 種類(r));
}

/** 測試自己的日期加減,不依賴被測程式 */
function addDaysLocal(ymd, n) {
  const d = new Date(ymd + "T00:00:00");
  d.setDate(d.getDate() + n);
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

console.log(失敗 ? `\n有 ${失敗} 條沒過\n` : "\n全部通過\n");
process.exit(失敗 ? 1 : 0);
