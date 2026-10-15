const SHELL = __SHELL_CACHE__,
  MODEL_CACHE = "receipt-ocr-v5-v1",
  ASSETS = __OCR_ASSETS__,
  MODEL_VERSION = __OCR_VERSION__;
const absolute = (p) => new URL(p, self.registration.scope).href;
self.addEventListener("install", (e) =>
  e.waitUntil(
    (async () => {
      const c = await caches.open(SHELL);
      await c.addAll(
        ["", "app.js", "style.css", "icon.png", "manifest.webmanifest"].map(
          absolute,
        ),
      );
      await self.skipWaiting();
    })(),
  ),
);
self.addEventListener("activate", (e) =>
  e.waitUntil(
    (async () => {
      await self.clients.claim();
      await Promise.all(
        (await caches.keys())
          .filter((k) => k.startsWith("receipt-shell-") && k !== SHELL)
          .map((k) => caches.delete(k)),
      ); /* Legacy receipt-pages caches are kept until the page verifies and migrates their model resources. */
    })(),
  ),
);
self.addEventListener("message", (e) => {
  if (e.data === "model-cache-version")
    e.ports[0]?.postMessage(MODEL_CACHE + ":" + MODEL_VERSION);
});
self.addEventListener("fetch", (e) => {
  const request = e.request,
    requestURL = new URL(request.url);
  if (request.method !== "GET" || requestURL.origin !== self.location.origin)
    return;
  const asset = ASSETS.find((a) => absolute(a.path) === request.url);
  const shellPaths = [
    "",
    "index.html",
    "app.js",
    "style.css",
    "icon.png",
    "manifest.webmanifest",
  ].map(absolute);
  const shellKey = new URL(requestURL);
  shellKey.search = "";
  shellKey.hash = "";
  const key = shellKey.href;
  if (!asset && !shellPaths.includes(key)) return;
  e.respondWith(
    (async () => {
      if (asset) {
        const c = await caches.open(MODEL_CACHE),
          r = await c.match(request);
        if (r?.ok && r.headers.get("x-receipt-sha256") === asset.sha256)
          return r;
        return fetch(request);
      }
      let c;
      try {
        c = await caches.open(SHELL);
      } catch {
        return fetch(request);
      }
      try {
        const r = await fetch(request);
        if (!r.ok) {
          const saved =
            (await c.match(key)) ||
            (request.mode === "navigate" ? await c.match(absolute("")) : null);
          if (saved) return saved;
          return r;
        }
        try {
          await c.put(key, r.clone());
        } catch {
          /* A full cache must not discard a usable network response. */
        }
        return r;
      } catch (error) {
        const saved =
          (await c.match(key)) ||
          (request.mode === "navigate" ? await c.match(absolute("")) : null);
        if (saved) return saved;
        throw error;
      }
    })(),
  );
});
