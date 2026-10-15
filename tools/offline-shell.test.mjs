import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
async function setup(fetcher, { failPut = false } = {}) {
  const events = new Map(),
    entries = new Map(),
    scope = "https://example.invalid/helper/";
  const caches = {
    open: async () => ({
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
    addEventListener: (name, handler) => events.set(name, handler),
  };
  const source = (
    await readFile(new URL("../public/sw.js", import.meta.url), "utf8")
  )
    .replace("__SHELL_CACHE__", '"shell"')
    .replace("__OCR_ASSETS__", "[]")
    .replace("__OCR_VERSION__", '"test"');
  vm.runInNewContext(source, { self, caches, URL, fetch: fetcher });
  return {
    entries,
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
