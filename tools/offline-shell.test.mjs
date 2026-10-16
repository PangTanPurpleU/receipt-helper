import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
async function setup(fetcher, { failPut = false } = {}) {
  const events = new Map(),
    entries = new Map(),
    installed = [],
    scope = "https://example.invalid/helper/";
  const caches = {
    open: async () => ({
      addAll: async (requests) => installed.push(...requests),
      match: async (key) =>
        entries.get(typeof key === "string" ? key : key.url)?.clone(),
      put: async (key, value) => {
        if (failPut) throw new Error("cache quota");
        entries.set(key, value);
      },
    }),
  };
  const self = {
    registration: { scope },
    location: { origin: "https://example.invalid" },
    skipWaiting: async () => {},
    addEventListener: (name, handler) => events.set(name, handler),
  };
  const source = (
    await readFile(new URL("../public/sw.js", import.meta.url), "utf8")
  )
    .replace("__SHELL_CACHE__", '"shell"')
    .replace("__OCR_ASSETS__", "[]")
    .replace("__OCR_VERSION__", '"test"');
  vm.runInNewContext(source, { self, caches, URL, Request, fetch: fetcher });
  return {
    entries,
    installed,
    async install() {
      let completion;
      events.get("install")({ waitUntil: (p) => { completion = p; } });
      await completion;
    },
    async get(path, mode = "navigate") {
      let response;
      events.get("fetch")({
        request: { method: "GET", url: scope + path, mode },
        respondWith: (p) => {
          response = p;
        },
      });
      return response;
    },
  };
}
test("cached shell survives HTTP errors and query-string offline launches", async () => {
  const a = await setup(
    async () => new Response("unavailable", { status: 503 }),
  );
  a.entries.set(
    "https://example.invalid/helper/",
    new Response("saved homepage"),
  );
  assert.equal(
    await (await a.get("?source=homescreen")).text(),
    "saved homepage",
  );
  const b = await setup(async () => {
    throw new Error("offline");
  });
  b.entries.set(
    "https://example.invalid/helper/app.js",
    new Response("saved script"),
  );
  assert.equal(
    await (await b.get("app.js?v=1", "same-origin")).text(),
    "saved script",
  );
});
test("cache quota errors never discard a successful network response; genuine HTTP failure is preserved without cache", async () => {
  const a = await setup(async () => new Response("fresh script"), {
    failPut: true,
  });
  assert.equal(
    await (await a.get("app.js", "same-origin")).text(),
    "fresh script",
  );
  const b = await setup(
    async () => new Response("unavailable", { status: 503 }),
  );
  assert.equal((await b.get("app.js")).status, 503);
});

test("shell requests revalidate the HTTP cache instead of persisting a stale app version", async () => {
  const calls = [];
  const app = await setup(async (request, options) => {
    calls.push({url:request.url,cache:options?.cache});
    return new Response(options?.cache === "no-cache" ? "v1.0.3" : "v1.0.2");
  });
  app.entries.set("https://example.invalid/helper/app.js", new Response("v1.0.2"));
  assert.equal(await (await app.get("app.js", "same-origin")).text(), "v1.0.3");
  assert.equal(await app.entries.get("https://example.invalid/helper/app.js").text(), "v1.0.3");
  assert.equal(calls[0].cache, "no-cache");
});

test("installing a new shell bypasses old HTTP entries for every shell asset", async () => {
  const app = await setup(async () => new Response("fresh"));
  await app.install();
  assert.equal(app.installed.length, 5);
  assert.ok(app.installed.every(request => request.cache === "reload"));
  assert.ok(app.installed.some(request => request.url.endsWith("/app.js")));
});
