// 「今天要送什麼給誰」的測試:node test/deliveries.test.mjs
//
// 重點在「不該收到的人收不到」—— 推播是推到別人手機上的,
// 這裡弄錯就是把私人記事送到全校。

import { planDeliveries, vapidSubject } from "../tools/deliveries.mjs";

let 失敗 = 0;
const ok = (name, pass, detail = "") => {
  console.log(`${pass ? "  ✓" : "  ✗"} ${name}${detail ? "  " + detail : ""}`);
  if (!pass) 失敗++;
};

const TODAY = "2026-05-10";
const 名單 = [
  { id: "a@x.tw", name: "甲", dept: "教務處" },
  { id: "b@x.tw", name: "乙", dept: "學務處" }
];
const 裝置 = (email, n = 1) => Array.from({ length: n }, (_, i) => ({
  id: `d${i}`, ownerEmail: email, endpoint: `https://push/${email}/${i}`,
  p256dh: "k", auth: "a"
}));
const 今天的記事 = (over) => ({ id: "n1", date: TODAY, text: "到校訪視", ...over });

console.log("\n【基本】");
{
  const r = planDeliveries({
    allowlist: 名單, subs: 裝置("a@x.tw", 2),
    notes: [今天的記事({ scope: "all", ownerEmail: "b@x.tw", dept: "學務處" })],
    today: TODAY
  });
  ok("有事就送,一個人兩台裝置算一則兩台", r.length === 1 && r[0].devices.length === 2);
  ok("通知內容帶得出來", !!r[0].payload?.title, r[0]?.payload?.title);

  ok("今天沒事就不吵他",
     planDeliveries({ allowlist: 名單, subs: 裝置("a@x.tw"), today: TODAY }).length === 0);

  ok("已經被移出名單的人不會收到",
     planDeliveries({
       allowlist: [], subs: 裝置("a@x.tw"),
       notes: [今天的記事({ scope: "all" })], today: TODAY
     }).length === 0);

  ok("沒有 ownerEmail 的壞資料直接跳過",
     planDeliveries({
       allowlist: 名單, subs: [{ id: "x", endpoint: "https://push/x" }],
       notes: [今天的記事({ scope: "all" })], today: TODAY
     }).length === 0);
}

console.log("\n【處室一律以名單為準】");
{
  // 乙在名單上是學務處,但他的裝置紀錄還留著舊的教務處。
  // 照裝置發的話,他會收到教務處的同處室記事 —— 這就是要擋的。
  const 舊裝置 = [{
    id: "d0", ownerEmail: "b@x.tw", dept: "教務處",
    endpoint: "https://push/b/0", p256dh: "k", auth: "a"
  }];
  const 教務處記事 = 今天的記事({ scope: "dept", ownerEmail: "a@x.tw", dept: "教務處" });

  ok("裝置上的舊處室不算數,調走之後就收不到原處室的記事",
     planDeliveries({ allowlist: 名單, subs: 舊裝置, notes: [教務處記事], today: TODAY }).length === 0);

  ok("同處室的本人收得到",
     planDeliveries({
       allowlist: 名單, subs: 裝置("a@x.tw"), notes: [教務處記事], today: TODAY
     }).length === 1);
}

console.log("\n【私人記事不外流】");
{
  const 私人 = 今天的記事({ scope: "self", ownerEmail: "a@x.tw", dept: "教務處" });
  ok("別人的「只有自己」記事不會送到我手機",
     planDeliveries({ allowlist: 名單, subs: 裝置("b@x.tw"), notes: [私人], today: TODAY }).length === 0);
  ok("自己的「只有自己」記事自己收得到",
     planDeliveries({ allowlist: 名單, subs: 裝置("a@x.tw"), notes: [私人], today: TODAY }).length === 1);
}

console.log("\n【別人的計畫】");
{
  const 乙的逾期計畫 = {
    id: "p", title: "乙的計畫", ownerEmail: "b@x.tw",
    endDate: "2026-01-01", updatedAt: new Date(`${TODAY}T08:00:00`),
    steps: [{ title: "活動辦理", stage: "execute", status: "doing" }], flow: []
  };
  ok("別人承辦的計畫逾期不會推到我手機",
     planDeliveries({ allowlist: 名單, subs: 裝置("a@x.tw"), plans: [乙的逾期計畫], today: TODAY }).length === 0);
  ok("自己的計畫逾期會收到",
     planDeliveries({ allowlist: 名單, subs: 裝置("b@x.tw"), plans: [乙的逾期計畫], today: TODAY }).length === 1);
}

console.log("\n【聯絡方式打錯不能炸掉整天的通知】");
{
  // web-push 收到不合法的 subject 會直接丟例外,那天全校一則都收不到,
  // 而唯一的線索是 Actions 上一個紅色叉叉。一個選填欄位不該有這種殺傷力。
  const 預設 = "mailto:admin@example.com";
  const 合法 = (v) => /^(mailto:|https:\/\/)/.test(v);

  ok("正常填就原樣用", vapidSubject("mailto:a@chc.edu.tw").subject === "mailto:a@chc.edu.tw");
  ok("https 也可以", vapidSubject("https://chc.edu.tw").subject === "https://chc.edu.tw");

  const 漏了前綴 = vapidSubject("a@chc.edu.tw");
  ok("只填信箱會自動補 mailto:", 漏了前綴.subject === "mailto:a@chc.edu.tw", 漏了前綴.subject);
  ok("而且要講一聲", !!漏了前綴.warn, 漏了前綴.warn);

  ok("沒填就用預設值", vapidSubject("").subject === 預設);
  ok("只有空白也算沒填", vapidSubject("   ").subject === 預設);

  const 亂填 = vapidSubject("隨便打的");
  ok("看不懂就退回預設值,不要讓它炸掉", 亂填.subject === 預設, 亂填.subject);
  ok("看不懂也要講一聲", !!亂填.warn, 亂填.warn);

  // 最重要的一條:不管填什麼,出來的東西一定是 web-push 收得下去的格式
  const 各種亂填 = ["", "   ", "abc", "隨便打的", "a@b.c", "mailto:x@y.z", "https://a.b",
                   null, undefined, "   a@b.co  ", "ftp://x"];
  ok("不管填什麼,算出來的一定是合法格式",
     各種亂填.every((v) => 合法(vapidSubject(v).subject)),
     JSON.stringify(各種亂填.map((v) => vapidSubject(v).subject)));
}

console.log(失敗 ? `\n有 ${失敗} 條沒過\n` : "\n全部通過\n");
process.exit(失敗 ? 1 : 0);
