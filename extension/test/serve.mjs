// A static server for the tests, with the content types a browser will not guess.
//   node test/serve.mjs [directory] [port]

import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".onnx": "application/octet-stream",
  ".png": "image/png",
};

export function serve(directory, port = 0) {
  const root = path.resolve(directory);
  const server = http.createServer((request, response) => {
    const file = path.join(root, decodeURIComponent(request.url.split("?")[0]));
    if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      response.writeHead(404).end("not found");
      return;
    }
    const stat = fs.statSync(file);
    response.writeHead(200, {
      "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream",
      "Content-Length": stat.size,
      "Cache-Control": "no-store",
    });
    fs.createReadStream(file).pipe(response);
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      resolve({ port: server.address().port, close: () => new Promise((done) => server.close(done)) });
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const running = await serve(process.argv[2] ?? ".", Number(process.argv[3] ?? 8766));
  console.log(`http://127.0.0.1:${running.port}/`);
}
