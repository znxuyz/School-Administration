// 改版後跑一次:node test/check.mjs
//
// 每一條都是曾經真的壞掉過的東西,不是為了湊數字寫的:
//   - 選中的分頁白字配白底(改底色時忘了字色)
//   - 進度條圓點沒對準線(絕對定位是相對 padding box,不是 border box)
//   - 卡關的紅線混進主色的紫(漸層跨了色相)
//   - 線一整段閃而不是漸層閃(用 opacity 疊同色,等於沒在閃)
//   - 光暈中間壓暗了一階,線看起來像斷掉一截
//   - 光暈起點是實色,脈動變暗時中間浮出一道邊,線被切成兩段
//   - 整條底線都變成狀態色,而不是「過了一半才慢慢變」
//   - 手機換行時第二排的線壓在第一排的字上面(flex 沒留 row-gap)
//   - 收文(等對方寄來的)被當成「在承辦人手上」,或被寫成「已送至 尚未收到」
//   - 預覽模式沒擋住寫入,按下去噴一句看不懂的「權限不足」

import { open } from "./probe.mjs";

let 失敗 = 0;
const ok = (name, pass, detail = "") => {
  console.log(`${pass ? "  ✓" : "  ✗"} ${name}${detail ? "  " + detail : ""}`);
  if (!pass) 失敗++;
};

/* ---------- 量測:在瀏覽器裡跑 ---------- */

const 量軌道 = () => {
  const out = { 點線差: [], 溢出: 0, 動畫: new Set(), 壓字: [] };

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

  // 頂欄的品牌圖示是張圖。路徑打錯的話按鈕會變成一個空框,
  // 但畫面不會報錯,只有真的去量 naturalWidth 才看得出來。
  const 圖示 = await p.evaluate(() => {
    const img = document.querySelector(".brand-mark img");
    return img ? { 載入: img.naturalWidth > 0, 寬: Math.round(img.getBoundingClientRect().width) } : null;
  });
  ok("頂欄品牌圖示載得進來", !!圖示?.載入 && 圖示.寬 > 0, JSON.stringify(圖示));

  // 收文(等對方寄來的文件):預設不能落到「承辦人手上」,
  // 位置選單要給得出「尚未收到」,畫面也要說得出等了幾天。
  const 收文 = await p.evaluate(() => {
    const card = [...document.querySelectorAll("#panel-mine .plan, #panel-dashboard .plan")]
      .find((c) => c.getClientRects().length && /上級核定函收文/.test(c.textContent));
    if (!card) return null;
    const 選單 = [...card.querySelectorAll(".step-loc, .next-loc")]
      .map((s) => ({ 值: s.value, 有尚未收到: [...s.options].some((o) => o.value === "尚未收到") }));
    return {
      有等待字樣: /尚未收到|等對方寄來|等 上級核定函收文/.test(card.textContent),
      沒被當成在外文件: !/已送至 尚未收到/.test(card.textContent),
      收文選單: 選單.filter((x) => x.值 === "尚未收到"),
      非收文誤給選項: 選單.filter((x) => x.值 !== "尚未收到" && x.有尚未收到).length
    };
  });
  if (收文) {
    ok("收文有講「還沒收到」", 收文.有等待字樣, JSON.stringify(收文.有等待字樣));
    ok("收文不會被寫成「已送至」", 收文.沒被當成在外文件);
    ok("收文的位置選單給得出「尚未收到」", 收文.收文選單.length > 0 && 收文.收文選單.every((x) => x.有尚未收到),
       JSON.stringify(收文.收文選單));
    ok("一般步驟不會多出「尚未收到」", 收文.非收文誤給選項 === 0, `多出 ${收文.非收文誤給選項} 個`);
  }

  const m = await p.evaluate(量軌道);
  const 最大偏移 = Math.max(0, ...m.點線差.map(Math.abs));
  ok("圓點對準線", 最大偏移 < 0.5, `最大偏移 ${最大偏移}px,共量 ${m.點線差.length} 個`);
  ok("沒有跑出卡片外", m.溢出 === 0, `${m.溢出} 個`);
  ok("換行時圓點沒壓到上一排的字", m.壓字.length === 0, JSON.stringify(m.壓字.slice(0, 3)));


  // 圓點和線段要共用同一組動畫,分開寫兩個久了會一亮一暗
  ok("圓點與線段同一組動畫", m.動畫.length <= 1, JSON.stringify(m.動畫));

  // 光暈的形狀。四個性質都擋過真的 bug:
  //   兩個停靠點 —— 中間多插一個壓暗的停靠點,線看起來會像斷掉一截
  //   起點全透明 —— 光暈是疊在底線上的,起點只要不是全透明,
  //                 脈動變暗時那個邊界就會浮出來,整條線看起來被切成兩段
  //   色距 —— 末端要和底線分得開。用 sRGB 距離而不是亮度比:狀態色那幾段
  //           是換色相(青→紅),亮度可能差不多,亮度比會誤判成「看不出來」
  //   末端色相 —— 要等於「下一站圓點」的色相。線是漸進變成那一站的顏色,
  //               中途不可以冒出第三個顏色(以前就是這樣讓紅裡混到主色的)
  const 形狀 = await p.evaluate(() => {
    // 停靠點可能是 rgb(),也可能是 color(srgb …)(color-mix 算出來的)
    const 解 = (s) => {
      let m = s.match(/^rgba?\(([^)]+)\)/);
      if (m) { const v = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return [v[0], v[1], v[2], v.length > 3 ? v[3] : 1]; }
      m = s.match(/^color\(srgb ([^)]+)\)/);
      if (m) { const v = m[1].split(/[\s/]+/).filter(Boolean).map(Number); return [v[0] * 255, v[1] * 255, v[2] * 255, v.length > 3 ? v[3] : 1]; }
      return null;
    };
    const 色相 = ([r, g, b]) => {
      r /= 255; g /= 255; b /= 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
      if (!d) return null;
      let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return (h * 60 + 360) % 360;
    };
    const 色距 = (a, b) => +Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]).toFixed(0);

    const out = { 起點不透明: 0, 色距: [], 色差: [], 停靠點數: [] };
    document.querySelectorAll(".track-node, .stage-node").forEach((n) => {
      if (!n.getClientRects().length) return;
      const a = getComputedStyle(n, "::after");
      if (a.content === "none" || !a.backgroundImage || a.backgroundImage === "none") return;
      const 停 = (a.backgroundImage.match(/(?:rgba?|color)\([^)]*\)/g) || []).map(解).filter(Boolean);
      if (停.length !== 2) { out.停靠點數.push(停.length); return; }
      const 尾 = 停[1];
      const 底 = 解(getComputedStyle(n).borderTopColor);
      if (停[0][3] > 0.01) out.起點不透明++;
      out.色距.push(色距(底, 尾));
      // 漸層的末端要變成「下一站圓點」的顏色,不能是第三個顏色
      const 點 = n.nextElementSibling?.querySelector(".track-dot, .stage-dot");
      const h1 = 點 && 色相(解(getComputedStyle(點).backgroundColor)), h2 = 色相(尾);
      if (h1 != null && h2 != null) {
        const d = Math.abs(h1 - h2);
        out.色差.push(+Math.min(d, 360 - d).toFixed(0));
      }
    });
    return out;
  });
  ok("光暈只有兩個停靠點(中間不會凹下去)", 形狀.停靠點數.length === 0 && 形狀.色距.length > 0,
     `異常的段數 ${JSON.stringify(形狀.停靠點數)}、量到 ${形狀.色距.length} 段`);
  ok("光暈起點全透明(接得上底線、不會切成兩段)", 形狀.起點不透明 === 0, `不透明的有 ${形狀.起點不透明} 段`);
  ok("光暈末端就是下一站圓點的顏色(≤20°)", 形狀.色差.length > 0 && Math.max(0, ...形狀.色差) <= 20,
     `量到 ${形狀.色差.length} 段,最大 ${Math.max(0, ...形狀.色差)}°`);
  ok("光暈末端和底線看得出差別(sRGB 距離 ≥40)", Math.min(999, ...形狀.色距) >= 40, `最低 ${Math.min(999, ...形狀.色距)}`);

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
