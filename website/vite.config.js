import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { defineConfig } from "vite";

const ORT_DIST = path.resolve("node_modules/onnxruntime-web/dist");
// The bundle starts its WebAssembly threads by loading itself as a worker, so it is served
// unbundled under its own name.
const ORT_SCRIPT = "ort.webgpu.bundle.min.mjs";
// Over Cloudflare Pages' 25 MiB file limit, so it ships gzipped and the worker unpacks it.
const ORT_WASM = "ort-wasm-simd-threaded.asyncify.wasm";
const MODEL_DIR = path.resolve(process.env.MODEL_DIR ?? "../model");

function pagesHeaders() {
  return fs.readFileSync("public/_headers", "utf8").split("\n")
    .filter((line) => /^\s+\S+:/.test(line))
    .map((line) => line.trim().split(/:\s*/, 2));
}

function ortFiles() {
  let gzipped;
  const files = () => ({
    [`ort/${ORT_SCRIPT}`]: () => fs.readFileSync(path.join(ORT_DIST, ORT_SCRIPT)),
    [`ort/${ORT_WASM}.gz`]: () => (gzipped ??= zlib.gzipSync(
      fs.readFileSync(path.join(ORT_DIST, ORT_WASM)), { level: 9 })),
  });
  return {
    name: "ort-files",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const file = files()[req.url.split("?")[0].slice(1)];
        if (!file) return next();
        for (const [name, value] of pagesHeaders()) res.setHeader(name, value);
        res.setHeader("Content-Type", req.url.includes(".mjs") ? "text/javascript" : "application/gzip");
        res.end(file());
      });
    },
    generateBundle() {
      for (const [fileName, read] of Object.entries(files())) {
        this.emitFile({ type: "asset", fileName, source: read() });
      }
    },
  };
}

// Serves a local model folder at /model/, laid out as it is on R2.
function localModel() {
  const serve = (server) => {
    server.middlewares.use("/model", (req, res, next) => {
    const file = path.join(MODEL_DIR, decodeURIComponent(req.url.split("?")[0]));
    if (!file.startsWith(MODEL_DIR) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      return next();
    }
    for (const [name, value] of pagesHeaders()) res.setHeader(name, value);
    res.setHeader("Content-Length", fs.statSync(file).size);
    fs.createReadStream(file).pipe(res);
    });
  };
  return { name: "local-model", configureServer: serve, configurePreviewServer: serve };
}

// index.html says how much the browser has to download before Aeacus can run, so the build reads
// the size out of the model folder and writes it in, instead of the page asking for it.
function modelSize() {
  return {
    name: "model-size",
    transformIndexHtml(html) {
      const file = path.join(MODEL_DIR, "onnx", "model_q4f16.onnx");
      if (!fs.existsSync(file)) {
        this.warn(`${file} is missing, so the size in index.html is left as it is`);
        return html.replaceAll("%MODEL_SIZE%", "87 MB");
      }
      const mb = Math.round(fs.statSync(file).size / 1e6);
      return html.replaceAll("%MODEL_SIZE%", `${mb} MB`);
    },
  };
}

export default defineConfig({
  plugins: [ortFiles(), localModel(), modelSize()],
  server: { headers: Object.fromEntries(pagesHeaders()) },
  preview: { headers: Object.fromEntries(pagesHeaders()) },
  worker: { format: "es" },
});
