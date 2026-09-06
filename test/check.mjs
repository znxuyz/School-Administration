// 改版後跑一次:node test/check.mjs
//
// 每一條都是曾經真的壞掉過的東西,不是為了湊數字寫的:
//   - 選中的分頁白字配白底(改底色時忘了字色)
//   - 進度條圓點沒對準線(絕對定位是相對 padding box,不是 border box)
//   - 卡關的紅線混進主色的紫(漸層從主色起漸)
//   - 線一整段閃而不是漸層閃(用 opacity 疊同色,等於沒在閃)
//   - 手機換行時第二排的線壓在第一排的字上面(flex 沒留 row-gap)
//   - 預覽模式沒擋住寫入,按下去噴一句看不懂的「權限不足」

import { open } from "./probe.mjs";

let 失敗 = 0;
const ok = (name, pass, detail = "") => {
  console.log(`${pass ? "  ✓" : "  ✗"} ${name}${detail ? "  " + detail : ""}`);
  if (!pass) 失敗++;
};

/* ---------- 量測:在瀏覽器裡跑 ---------- */

const 量軌道 = () => {
  const out = { 點線差: [], 溢出: 0, 漸層: [], 動畫: new Set(), 壓字: [] };

  document.querySelectorAll(".track-node, .stage-node").forEach((n) => {
    // 其他分頁裡的卡片是隱藏的,rect 全是 0,量了只會得到假的偏移
    if (!n.getClientRects().length) return;

    const cs = getComputedStyle(n);
    const bw = parseFloat(cs.borderTopWidth);
    const nr = n.getBoundingClientRect();
    const dot = n.querySelector(".track-dot, .stage-dot");

    // 圓點的中心要落在線的中心上。線寬 0 的是終點,沒有線就沒有對齊問題。
    if (bw && dot) {
      const dr = dot.getBoundingClientRect();
      out.點線差.push(+((dr.top + dr.height / 2) - (nr.top + bw / 2)).toFixed(2));
    }

    const a = getComputedStyle(n, "::after");
    if (a.content !== "none" && a.backgroundImage && a.backgroundImage !== "none") {
      out.漸層.push(a.backgroundImage.replace(/\s+/g, " "));
      out.動畫.add(`${a.animationName} ${a.animationDuration} ${a.animationTimingFunction}`);
    }
  });

  document.querySelectorAll(".track-dot, .stage-dot").forEach((d) => {
    if (!d.getClientRects().length) return;
    const cs = getComputedStyle(d);
    if (cs.animationName !== "none") {
      out.動畫.add(`${cs.animationName} ${cs.animationDuration} ${cs.animationTimingFunction}`);
    }
  });

  // 有沒有跑出卡片外
  document.querySelectorAll(".plan").forEach((card) => {
    if (!card.getClientRects().length) return;
    const cr = card.getBoundingClientRect();
    card.querySelectorAll(".track-node, .stage-node").forEach((n) => {
      const r = n.getBoundingClientRect();
      if (r.left < cr.left - 0.5 || r.right > cr.right + 0.5) out.溢出++;
    });
  });

  // 換行後,下一排的圓點(含光暈)不可以壓到上一排的字
  document.querySelectorAll(".track, .stage-track").forEach((box) => {
    const 節點 = [...box.children].filter((n) => n.getClientRects().length);
    節點.forEach((n, i) => {
      const dot = n.querySelector(".track-dot, .stage-dot");
      if (!dot) return;
      const dr = dot.getBoundingClientRect();
      const 光暈 = 4;                       // box-shadow 那一圈
      節點.slice(0, i).forEach((prev) => {
        prev.querySelectorAll("span").forEach((t) => {
          if (t.classList.contains("track-dot") || t.classList.contains("stage-dot")) return;
          const tr = t.getBoundingClientRect();
          if (!tr.height) return;
          const 垂直重疊 = dr.top - 光暈 < tr.bottom && dr.bottom + 光暈 > tr.top;
          const 水平重疊 = dr.left < tr.right && dr.right > tr.left;
          // 同一排本來就會水平交錯,只看「不同排」的情況
          if (垂直重疊 && 水平重疊 && Math.abs(dr.top - tr.top) > 4) {
            out.壓字.push([t.textContent.slice(0, 12), +(tr.bottom - (dr.top - 光暈)).toFixed(1)]);
          }
        });
      });
    });
  });

  out.動畫 = [...out.動畫];
  out.漸層 = [...new Set(out.漸層)];
  return out;
};

const 對比 = () => {
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const L = (s) => { const m = s.match(/\d+(\.\d+)?/g).map(Number); return 0.2126 * lin(m[0]) + 0.7152 * lin(m[1]) + 0.0722 * lin(m[2]); };
  const ratio = (a, b) => { const x = L(a), y = L(b); return +(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05))).toFixed(2); };

  const body = getComputedStyle(document.body).backgroundColor;
  const out = {};
  const tab = document.querySelector(".tab.is-on") || document.querySelector('[aria-selected="true"]');
  if (tab) { const t = getComputedStyle(tab); out.分頁 = ratio(t.color, t.backgroundColor); }
  const dot = document.querySelector(".track-node.is-past .track-dot");
  if (dot) out.走過圓點 = ratio(getComputedStyle(dot).backgroundColor, body);
  return out;
};

/* ---------- 一條一條檢查 ---------- */

const 情境 = [
  ["桌機淺", { scheme: "light" }],
  ["桌機深", { scheme: "dark" }],
  ["手機淺", { scheme: "light", viewport: { width: 390, height: 900 } }],
  ["手機深", { scheme: "dark", viewport: { width: 390, height: 900 } }]
];

for (const [name, opts] of 情境) {
  console.log(`\n【${name}】`);
  const { b, p, errs } = await open(opts);

  ok("主控台沒有錯誤", errs.length === 0, errs.join(" | "));
  ok("畫得出計畫卡", (await p.locator(".plan").count()) > 0);

  const m = await p.evaluate(量軌道);
  const 最大偏移 = Math.max(0, ...m.點線差.map(Math.abs));
  ok("圓點對準線", 最大偏移 < 0.5, `最大偏移 ${最大偏移}px,共量 ${m.點線差.length} 個`);
  ok("沒有跑出卡片外", m.溢出 === 0, `${m.溢出} 個`);
  ok("換行時圓點沒壓到上一排的字", m.壓字.length === 0, JSON.stringify(m.壓字.slice(0, 3)));

  // 漸層一定要從透明起漸;從主色起漸的話,卡關的紅裡面會混到主色
  const 從透明起 = m.漸層.every((g) => /\(90deg, rgba\(0, 0, 0, 0\)/.test(g));
  ok("光暈漸層從透明起漸", 從透明起, m.漸層.join(" / "));

  // 圓點和線段要共用同一組動畫,分開寫兩個久了會一亮一暗
  ok("圓點與線段同一組動畫", m.動畫.length <= 1, JSON.stringify(m.動畫));

  // 減少動態時要全部停下來
  await p.emulateMedia({ reducedMotion: "reduce" });
  await p.waitForTimeout(200);
  const 還在動 = await p.evaluate(() => {
    const s = new Set();
    document.querySelectorAll(".track-dot, .stage-dot").forEach((d) => {
      if (d.getClientRects().length) s.add(getComputedStyle(d).animationName);
    });
    return [...s].filter((x) => x !== "none");
  });
  ok("prefers-reduced-motion 時動畫停住", 還在動.length === 0, JSON.stringify(還在動));
  await p.emulateMedia({ reducedMotion: "no-preference" });

  // 20 個主題色全部掃一遍,不能有白字配白底
  const ids = await p.evaluate(() => [...document.querySelectorAll("#accent-menu .swatch")].map((s) => s.dataset.accent));
  let 最差 = { 分頁: 99, 走過圓點: 99 };
  for (const id of ids) {
    await p.evaluate((i) => document.querySelector(`#accent-menu .swatch[data-accent="${i}"]`).click(), id);
    await p.waitForTimeout(80);
    const r = await p.evaluate(對比);
    for (const k of Object.keys(最差)) if (r[k] != null && r[k] < 最差[k]) { 最差[k] = r[k]; 最差[k + "色"] = id; }
  }
  ok("每個主題色的分頁文字都看得見(≥4.5)", 最差.分頁 >= 4.5, `最差 ${最差.分頁}(${最差.分頁色})`);
  ok("每個主題色的圓點都看得見(≥3)", 最差.走過圓點 >= 3, `最差 ${最差.走過圓點}(${最差.走過圓點色})`);

  await b.close();
}

/* ---------- 預覽模式不可以寫進資料庫 ---------- */

console.log("\n【預覽模式】");
{
  const { b, p, errs } = await open({ scheme: "light" });
  await p.click('.tab[data-tab="mine"]');
  await p.waitForTimeout(300);
  const 原本 = await p.locator("#panel-mine .plan").count();
  await p.click("#btn-new-plan");
  await p.waitForTimeout(400);
  await p.fill('#form-plan [name="title"]', "測試用計畫");
  await p.locator("#form-plan").evaluate((f) => f.requestSubmit());
  await p.waitForTimeout(600);
  const 訊息 = (await p.locator(".toast, #toast").allTextContents()).join("");
  ok("送出後有講清楚為什麼沒存", 訊息.includes("預覽模式"), 訊息);
  ok("計畫沒有真的被新增", (await p.locator("#panel-mine .plan").count()) === 原本);
  ok("主控台沒有錯誤", errs.length === 0, errs.join(" | "));
  await b.close();
}

console.log(失敗 ? `\n有 ${失敗} 條沒過\n` : "\n全部通過\n");
process.exit(失敗 ? 1 : 0);
