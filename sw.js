// Service worker:讓系統能「加到主畫面」,並在沒網路時仍打得開畫面。
//
// 刻意採用「網路優先」而不是常見的「快取優先」——
// 快取優先會讓老師改版後拿到舊程式,這個系統踩過那個坑。
// 網路優先:有網路一律拿最新的,順手更新快取;沒網路才拿快取墊檔。

// 版本號請用 ./bump.sh 更新,不要手動改單一檔案
const BUILD = "58";
const CACHE = `admin-tracker-${BUILD}`;

// 首次安裝時先抓起來,離線也開得起來
const PRECACHE = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  `./assets/style.css?v=${BUILD}`,
  `./assets/app.js?v=${BUILD}`,
  `./assets/config.js?v=${BUILD}`,
  `./assets/theme.js?v=${BUILD}`,
  `./assets/core.js?v=${BUILD}`,
  `./assets/push.js?v=${BUILD}`,
  "./assets/icons/favicon.png",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      // 個別檔案抓失敗不該讓整個安裝失敗
      .then((c) => Promise.allSettled(PRECACHE.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  // Firebase 與 Google CDN 的請求交給瀏覽器自己處理,不要碰
  if (new URL(req.url).origin !== self.location.origin) return;

  // no-cache = 每次都跟伺服器確認有沒有更新(通常回 304,很便宜),
  // 這樣就不會被瀏覽器的 HTTP 快取留住舊程式
  let fresh = req;
  try {
    fresh = new Request(req, { cache: "no-cache" });
  } catch { /* 少數請求型態不能改 cache 模式,維持原樣 */ }

  e.respondWith(
    fetch(fresh)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match("./index.html")))
  );
});

/* ---------------- 手機提醒 ---------------- */

// 推播是由 GitHub Actions 每天早上送過來的(見 tools/send-reminders.mjs)。
// 這支 service worker 在網頁關著的時候也會被叫醒來處理,所以通知才收得到。
self.addEventListener("push", (e) => {
  // 伺服器送來的一定是 JSON;真的壞掉也要發得出一則通知,
  // 不然老師只會覺得「怎麼有時候沒聲音」,完全無從查起。
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = {}; }

  const title = d.title || "行政工作進度追蹤";
  const options = {
    body: d.body || "",
    icon: "./assets/icons/icon-192.png",
    badge: "./assets/icons/favicon.png",
    lang: "zh-Hant",
    // 同一天的提醒用同一個 tag:重送時會蓋掉舊的,不會在通知列堆成一排
    tag: d.tag || "daily",
    renotify: true,
    data: { url: d.url || "./" }
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

// 點通知就把網頁叫到前面來;已經開著就不要再開一個分頁
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || "./", self.location.href).href;
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.startsWith(self.location.origin) && "focus" in c) {
          c.navigate?.(target);
          return c.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
