// Dependency-free localhost preview of the already built website.
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../dist/", import.meta.url));
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".wasm": "application/wasm",
};
const port = process.argv[2] === "--port" ? Number(process.argv[3]) : 8080;
if (!Number.isInteger(port) || port < 0 || port > 65535)
  throw new Error("Invalid --port (0–65535)");
const server = createServer(async (req, res) => {
  if (!["GET", "HEAD"].includes(req.method)) {
    res.writeHead(405, { Allow: "GET, HEAD" });
    res.end();
    return;
  }
  try {
    const pathname = decodeURIComponent(
        new URL(req.url, "http://localhost").pathname,
      ),
      path = resolve(root, pathname === "/" ? "index.html" : pathname.slice(1));
    if (!path.startsWith(resolve(root) + sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    const info = await stat(path);
    if (!info.isFile()) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, {
      "Content-Type": types[extname(path)] || "application/octet-stream",
      "Content-Length": info.size,
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    });
    if (req.method === "HEAD") res.end();
    else
      createReadStream(path)
        .on("error", () => res.destroy())
        .pipe(res);
  } catch (error) {
    res.writeHead(error instanceof URIError ? 400 : 404);
    res.end();
  }
});
server.on("error", (error) => {
  console.error(
    error.code === "EADDRINUSE"
      ? "Port is busy. Use: node tools/serve.mjs --port 8081"
      : error.message,
  );
  process.exitCode = 1;
});
server.listen(port, "127.0.0.1", () =>
  console.log(
    "Receipt Helper: http://127.0.0.1:" +
      server.address().port +
      "/\nKeep this terminal open. Press Ctrl+C to stop.",
  ),
);
