/* KWS offline support.
   App files: network first (so updates arrive at once), the saved copy when offline.
   Libraries and fonts from CDNs: saved copy first (they never change at a fixed version).
   Everything else (translation, voices from the internet) goes straight to the network. */
const CACHE = "kws-v2";
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
