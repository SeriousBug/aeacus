import { MODEL_BASE } from "./config.js";
import { Tokenizer } from "./tokenizer.js";

// Served as separate files by the ort-files plugin in vite.config.js.
const ORT_BASE = new URL(`${import.meta.env.BASE_URL}ort/`, location.origin);
const ort = await import(/* @vite-ignore */ new URL("ort.webgpu.bundle.min.mjs", ORT_BASE).href);

// Same windowing as training: 512 tokens including [CLS] and [SEP], overlapping by 128.
const WINDOW = 510;
const STRIDE = 128;
// Stats for nerds names the precision from this file: q4f16 is 4-bit weights in blocks of 32,
// scaled to fp16, with fp16 activations.
const MODEL_FILE = "onnx/model_q4f16.onnx";
const QUANTIZATION = "Q4";
const MODEL_URL = new URL(MODEL_FILE, new URL(MODEL_BASE, location.href)).href;
const TOKENIZER_URL = new URL("tokenizer.json", new URL(MODEL_BASE, location.href)).href;
const THRESHOLDS_URL = new URL("thresholds.json", new URL(MODEL_BASE, location.href)).href;

ort.env.wasm.numThreads = navigator.hardwareConcurrency;
ort.env.logLevel = "error";

let latest = 0;
const ready = load().catch((e) => {
  postMessage({ type: "error", message: String(e.message ?? e) });
  throw e;
});
// A session can't run twice at once, so a new text waits for the previous run to notice it's
// stale and stop.
let queue = ready;

onmessage = ({ data }) => {
  if (data.type === "cancel") {
    latest = data.id;
    return;
  }
  if (data.type !== "run") return;
  latest = data.id;
  queue = queue.then(async (model) => {
    if (data.id !== latest) return model;
    try {
      await run(model.tokenizer, model.session, data.id, data.text, model.provider, model.thresholds);
    } catch (e) {
      postMessage({ type: "error", id: data.id, message: String(e.message ?? e) });
    }
    return model;
  });
};

async function load() {
  const [tokenizerJson, thresholds, model] = await Promise.all([
    fetchJson(TOKENIZER_URL, "the tokenizer"),
    fetchJson(THRESHOLDS_URL, "the model settings"),
    fetchCached(MODEL_URL, (loaded, total) => postMessage({ type: "download", loaded, total })),
  ]);
  postMessage({ type: "starting" });
  ort.env.wasm.wasmBinary = await fetchWasm();
  const tokenizer = new Tokenizer(tokenizerJson);
  const { session, provider } = await createSession(model);
  postMessage({
    type: "ready", low: thresholds.low, high: thresholds.high,
    target: thresholds.target, calibration: thresholds.calibration,
    checks: Object.fromEntries(CHECKS.map((name) => [name, rightShare(thresholds[name])])),
  });
  return { tokenizer, session, provider, thresholds };
}

// The check sets thresholds.json reports on, which the page quotes when saying how well the
// model does: of the tokens it named on a set, the share it named correctly.
const CHECKS = ["test", "heldout", "recent"];

function rightShare(set) {
  const named = set ? set.right + set.wrong : 0;
  return set && named > 0 ? (set.right / named) * 100 : null;
}

async function fetchJson(url, what) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't load ${what} (HTTP ${res.status})`);
  return res.json();
}

async function fetchWasm() {
  const res = await fetch(new URL("ort-wasm-simd-threaded.asyncify.wasm.gz", ORT_BASE));
  if (!res.ok) throw new Error(`Couldn't load ONNX Runtime (HTTP ${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  // A server may already have decoded it with Content-Encoding: gzip.
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes.buffer;
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

async function createSession(model) {
  if (navigator.gpu && await navigator.gpu.requestAdapter()) {
    try {
      const session = await ort.InferenceSession.create(model, { executionProviders: ["webgpu"], logSeverityLevel: 3 });
      return { session, provider: "webgpu" };
    } catch (e) {
      console.warn("WebGPU unavailable, using WebAssembly", e);
    }
  }
  const session = await ort.InferenceSession.create(model, { executionProviders: ["wasm"], logSeverityLevel: 3 });
  return { session, provider: "wasm" };
}

// The model is 80+ MB, so keep it in the Cache API across visits; a new URL replaces it.
async function fetchCached(url, onProgress) {
  let cache;
  try {
    cache = await caches.open("model");
    const hit = await cache.match(url);
    if (hit) return await hit.arrayBuffer();
  } catch {
    cache = null;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't download the model (HTTP ${res.status})`);
  const total = Number(res.headers.get("Content-Length")) || 0;
  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress(loaded, total);
  }
  const blob = new Blob(chunks);
  if (cache) {
    try {
      for (const key of await cache.keys()) await cache.delete(key);
      await cache.put(url, new Response(blob));
    } catch (e) {
      console.warn("Couldn't cache the model", e);
    }
  }
  return blob.arrayBuffer();
}

async function run(tokenizer, session, id, text, provider, thresholds) {
  const { ids, starts, ends } = tokenizer.encode(text);
  postMessage({ type: "tokens", id, starts, ends });
  const windows = [];
  for (let s = 0; ; s += WINDOW - STRIDE) {
    windows.push(s);
    if (s + WINDOW >= ids.length) break;
  }
  const sums = new Float32Array(ids.length);
  const counts = new Uint16Array(ids.length);
  let inferenceMs = 0;
  for (let w = 0; w < windows.length; w++) {
    if (id !== latest) return;
    const from = windows[w];
    const to = Math.min(from + WINDOW, ids.length);
    const input = BigInt64Array.from(
      [tokenizer.clsId, ...ids.slice(from, to), tokenizer.sepId], (x) => BigInt(x));
    const shape = [1, input.length];
    const inferenceStarted = performance.now();
    const out = await session.run({
      input_ids: new ort.Tensor("int64", input, shape),
      attention_mask: new ort.Tensor("int64", new BigInt64Array(input.length).fill(1n), shape),
    });
    inferenceMs += performance.now() - inferenceStarted;
    const logits = out.logits.data;
    for (let i = from; i < to; i++) {
      const k = (i - from + 1) * 2;
      sums[i] += 1 / (1 + Math.exp(logits[k] - logits[k + 1]));
      counts[i]++;
    }
    out.logits.dispose?.();
    const probs = new Float32Array(to - from);
    for (let i = from; i < to; i++) probs[i - from] = sums[i] / counts[i];
    postMessage({ type: "progress", id, done: w + 1, total: windows.length, from, probs });
  }
  postMessage({
    type: "stats", id, provider, tokens: ids.length, windows: windows.length, inferenceMs,
    threads: provider === "wasm" ? ort.env.wasm.numThreads : null,
    quantization: QUANTIZATION,
    low: thresholds.low, high: thresholds.high,
  });
}
