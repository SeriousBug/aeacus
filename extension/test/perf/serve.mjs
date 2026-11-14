// Serves this folder for the browser perf harness: node test/perf/serve.mjs [port]
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const PORT = Number(process.argv[2] ?? 8765);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".onnx": "application/octet-stream",
};

http.createServer((req, res) => {
  const asked = decodeURIComponent(req.url.split("?")[0]);
  const file = path.join(ROOT, asked === "/" ? "index.html" : asked);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404).end("not found");
    return;
  }
  const stat = fs.statSync(file);
  res.writeHead(200, {
    "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream",
    "Content-Length": stat.size,
    // The extension's pages are isolated, so the harness has to be too for SharedArrayBuffer and
    // therefore wasm threads to exist at all.
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
    "Cross-Origin-Resource-Policy": "same-origin",
  });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`http://localhost:${PORT}/`));
