/* KWS offline support.
   App files: network first (so updates arrive at once), the saved copy when offline.
   Libraries and fonts from CDNs: saved copy first (they never change at a fixed version).
   Everything else (translation, voices from the internet) goes straight to the network. */
const CACHE = "kws-v4";
const APP = ["./", "./index.html", "./KWS.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png"];
const LIBS = [
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js",
];
const CDN_HOSTS = ["cdnjs.cloudflare.com", "fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(APP);
    // the libraries are needed for PDF and Word files; if one can't be fetched now it is saved on first use
    await Promise.all(LIBS.map(u => c.add(new Request(u, { mode: "cors" })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

const save = (req, res) => { if (res && (res.ok || res.type === "opaque")) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return res; };

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    // "no-cache": always ask the server whether the file changed (cheap), so a new KWS.html shows up at once
    e.respondWith(fetch(req, { cache: "no-cache" }).then(res => save(req, res)).catch(async () =>
      (await caches.match(req, { ignoreSearch: true })) || (req.mode === "navigate" ? caches.match("./KWS.html") : Response.error())));
  } else if (CDN_HOSTS.includes(url.hostname)) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => save(req, res))));
  }
});

/* ---------- review reminders ----------
   KWS.html writes {on, hour, dues: [timestamps], last, title, body} under "reminder" in IndexedDB "kws"/"f".
   When Chrome wakes us up (periodic sync, installed app only), show one notification a day if something is due. */
function idbReq(mode, fn) {
  return new Promise(res => {
    const rq = indexedDB.open("kws", 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore("f");
    rq.onerror = () => res(null);
    rq.onsuccess = () => {
      try {
        const tx = rq.result.transaction("f", mode), r = fn(tx.objectStore("f"));
        tx.oncomplete = () => res(r && r.result !== undefined ? r.result : null);
        tx.onerror = tx.onabort = () => res(null);
      } catch (e) { res(null); }
    };
  });
}
async function remind() {
  const r = await idbReq("readonly", st => st.get("reminder"));
  if (!r || !r.on) return;
  const now = new Date(), today = now.toDateString();
  const n = (r.dues || []).filter(d => d <= now.getTime()).length;
  if (!n || r.last === today || now.getHours() < (r.hour ?? 6)) return;
  // a different encouraging sentence each day (not the same one twice in a row)
  const pool = Array.isArray(r.bodies) && r.bodies.length ? r.bodies : [r.body || "{n}"];
  let i = Math.floor(Math.random() * pool.length);
  if (pool.length > 1 && i === r.lastBody) i = (i + 1) % pool.length;
  r.lastBody = i;
  await self.registration.showNotification(r.title || "KWS", {
    body: String(pool[i]).replace("{n}", n), icon: r.icon || "icon-192.png", badge: "icon-192.png", tag: "kws-review",
  });
  r.last = today;
  await idbReq("readwrite", st => st.put(r, "reminder"));
}
self.addEventListener("periodicsync", e => { if (e.tag === "kws-review") e.waitUntil(remind()); });
self.addEventListener("message", e => { if (e.data === "kws-remind-check") e.waitUntil(remind()); });
// tapping the notification opens KWS straight on the review quiz
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const target = new URL("KWS.html#review", self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) { if ("focus" in w) { await w.focus(); try { await w.navigate(target); } catch (err) {} return; } }
    await clients.openWindow(target);
  })());
});
