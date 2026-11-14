// The model: downloaded once, kept in the Cache API, run on whichever engine the machine has. This
// module runs in the inference worker, or in the service worker when there is no worker to be had.

import { Tokenizer } from "../../shared/tokenizer.js";
import { reason } from "./errors.js";
import { MAX_TOKENS, MAX_TOKENS_WASM, MODEL_BASE, MODEL_FILE, WINDOW } from "./config.js";
import { calibrate, summary, windowsFor } from "./scoring.js";

const ORT_BUNDLE = "ort/ort.webgpu.bundle.min.mjs";
// The asyncify build is what the WebGPU bundle expects, and it is its WebAssembly fallback too.
const ORT_WASM = "ort/ort-wasm-simd-threaded.asyncify.wasm";
const CACHE = "aeacus-model";

// One block of a page as the model intends to read it: the tokens, and where each window starts.
/**
 * @typedef {object} Plan
 * @property {BlockTask} block
 * @property {number} words
 * @property {number[]} ids
 * @property {number[]} starts
 * @property {number[]} ends
 * @property {number[]} windows
 */

/**
 * @typedef {object} Loaded
 * @property {any} ort
 * @property {any} session
 * @property {Provider} provider
 * @property {number | null} threads
 * @property {Thresholds} thresholds
 * @property {Tokenizer} tokenizer
 */

const base = self.location.href;

// Extension message channels serialize with JSON in Chrome, where a typed array arrives as an object
// of indices and nothing downstream can read it. Scores are rounded on the way out, which is finer
// than a color band can show.
/**
 * @param {Float32Array} probs
 * @returns {number[]}
 */
function plain(probs) {
  const out = new Array(probs.length);
  for (let i = 0; i < probs.length; i++) out[i] = Math.round(probs[i] * 1000) / 1000;
  return out;
}

/**
 * @param {string} file
 * @returns {string}
 */
function modelURL(file) {
  return new URL(file, MODEL_BASE).href;
}

// Returns { handle }, where handle(message) takes the messages the host forwards: check, cancel and
// state. Replies go through `post`, which the caller points at a worker's postMessage or at the
// extension's message channel.
/**
 * @param {Post} post
 * @returns {{ handle(message: ModelRequest): void }}
 */
export function createRunner(post) {
  /** @type {ModelState} */
  let state = { state: "idle" };
  // Which engine the session that is open was built on, and which one the settings ask for now.
  let gpuAllowed = true;
  let wantGpu = true;
  /** @type {Promise<Loaded> | null} */
  let reading = null;
  /** @type {string | null} */
  let latest = null;
  /** @type {Set<string>} */
  const stopped = new Set();
  let queue = Promise.resolve();

  // The engine is picked when the session is built, so changing the setting closes the session and
  // the next check builds another. Checks are queued, so this never runs beside one.
  function retune() {
    if (latest !== null || wantGpu === gpuAllowed) return;
    gpuAllowed = wantGpu;
    const opened = reading;
    reading = null;
    opened?.then((loaded) => loaded.session.release?.()).catch(() => {});
  }

  /** @param {ModelState} next */
  function announce(next) {
    state = next;
    post({ type: "model", ...next });
  }

  /** @returns {Promise<Loaded>} */
  function model() {
    if (!reading) {
      reading = load().then((opened) => {
        announce({ state: "ready", provider: opened.provider, low: opened.thresholds.low,
          high: opened.thresholds.high, calibration: opened.thresholds.calibration });
        return opened;
      }).catch((error) => {
        reading = null;
        announce({ state: "error", message: reason(error) });
        throw error;
      });
    }
    return reading;
  }

  /** @returns {Promise<Loaded>} */
  async function load() {
    const [tokenizerJson, thresholds, weights] = await Promise.all([
      fetchJson("tokenizer.json", "the tokenizer"),
      fetchJson("thresholds.json", "the model settings"),
      fetchCached(MODEL_FILE, (loaded, total) => {
        announce({ state: "downloading", loaded, total });
      }),
    ]);
    announce({ state: "starting" });
    const ort = await import(new URL(ORT_BUNDLE, base).href);
    const { session, provider, threads } = await openSession(ort, weights, gpuAllowed);
    return { ort, session, provider, threads, thresholds, tokenizer: new Tokenizer(tokenizerJson) };
  }

  /**
   * @param {string} file
   * @param {string} what
   * @returns {Promise<any>}
   */
  async function fetchJson(file, what) {
    const response = await fetch(modelURL(file));
    if (!response.ok) throw new Error(`couldn't load ${what} (HTTP ${response.status})`);
    return response.json();
  }

  /**
   * @param {any} ort
   * @param {ArrayBuffer} weights
   * @param {boolean} gpu
   * @returns {Promise<{ session: any, provider: Provider, threads: number | null }>}
   */
  async function openSession(ort, weights, gpu) {
    ort.env.logLevel = "error";
    ort.env.wasm.wasmPaths = new URL("ort/", base).href;
    // Threads need a SharedArrayBuffer, which an extension page only has when the browser isolates
    // it. Chromium does, Firefox never does (bug 1673477), so there the model runs on one thread.
    const shared = typeof SharedArrayBuffer !== "undefined";
    const threads = shared ? Math.max(1, Math.min(8, navigator.hardwareConcurrency || 1)) : 1;
    ort.env.wasm.numThreads = threads;
    ort.env.wasm.wasmBinary = await fetch(new URL(ORT_WASM, base)).then((response) => {
      if (!response.ok) throw new Error(`couldn't load ONNX Runtime (HTTP ${response.status})`);
      return response.arrayBuffer();
    });
    // ONNX Runtime drives the GPU from an asyncified wasm stack, which has to park on a second
    // thread for every async call. Without one it unwinds the whole stack each time: 3 tok/s on
    // Firefox against 47 for a single-threaded WebAssembly session on the same window.
    if (gpu && shared && typeof navigator !== "undefined" && navigator.gpu
      && await navigator.gpu.requestAdapter()) {
      try {
        const session = await ort.InferenceSession.create(weights,
          { executionProviders: ["webgpu"], logSeverityLevel: 3 });
        return { session, provider: "webgpu", threads: null };
      } catch (error) {
        console.warn("WebGPU unavailable, using WebAssembly", error);
      }
    }
    const session = await ort.InferenceSession.create(weights,
      { executionProviders: ["wasm"], logSeverityLevel: 3 });
    return { session, provider: "wasm", threads };
  }

  // The model is 80+ MB, so it is kept in the Cache API between visits.
  /**
   * @param {string} file
   * @param {(loaded: number, total: number) => void} onProgress
   * @returns {Promise<ArrayBuffer>}
   */
  async function fetchCached(file, onProgress) {
    const url = modelURL(file);
    const cache = await caches.open(CACHE).catch((error) => {
      console.warn("Couldn't read the model cache", error);
      return null;
    });
    const hit = cache ? await cache.match(url).catch(() => null) : null;
    if (hit) {
      announce({ state: "starting", cached: true });
      return hit.arrayBuffer();
    }
    const response = await fetch(url);
    if (!response.ok) throw new Error(`couldn't download the model (HTTP ${response.status})`);
    const total = Number(response.headers.get("Content-Length")) || 0;
    if (!response.body) throw new Error("the model downloaded without a body");
    const reader = response.body.getReader();
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
        await cache.put(url, new Response(blob));
      } catch (error) {
        console.warn("Couldn't cache the model", error);
      }
    }
    return blob.arrayBuffer();
  }

  /** @param {{ id: string, blocks: BlockTask[] }} task */
  async function check({ id, blocks }) {
    const loaded = await model();
    // A window takes a fraction of a second on a GPU and several seconds without one, so a page that
    // would take an hour to read gets the top of it only.
    const budget = loaded.provider === "webgpu" ? MAX_TOKENS : MAX_TOKENS_WASM;
    /** @type {Plan[]} */
    const plans = [];
    let windows = 0;
    let tokens = 0;
    for (const block of blocks) {
      const encoded = loaded.tokenizer.encode(block.text);
      // The budget ends where it ends: the block that crosses it is scored up to it rather than
      // dropped, so the top of a long page still gets marked.
      const room = budget - tokens;
      if (room < 64) break;
      const length = Math.min(encoded.ids.length, room);
      const starts = windowsFor(length);
      plans.push({
        block,
        words: block.words ?? (block.text.match(/\S+/g) ?? []).length,
        ids: encoded.ids.slice(0, length),
        starts: encoded.starts.slice(0, length),
        ends: encoded.ends.slice(0, length),
        windows: starts,
      });
      windows += starts.length;
      tokens += length;
    }
    if (latest !== id) return;
    post({ type: "total", id, windows, tokens, blocks: plans.length,
      low: loaded.thresholds.low, high: loaded.thresholds.high });

    let inferenceMs = 0;
    let done = 0;
    for (const plan of plans) {
      const { block } = plan;
      post({ type: "tokens", id, block: block.index, starts: plan.starts, ends: plan.ends });
      const sums = new Float64Array(plan.ids.length);
      const counts = new Uint16Array(plan.ids.length);
      for (const from of plan.windows) {
        if (latest !== id) return;
        const to = Math.min(from + WINDOW, plan.ids.length);
        const input = BigInt64Array.from(
          [loaded.tokenizer.clsId, ...plan.ids.slice(from, to), loaded.tokenizer.sepId], BigInt);
        const shape = [1, input.length];
        const started = performance.now();
        const output = await loaded.session.run({
          input_ids: new loaded.ort.Tensor("int64", input, shape),
          attention_mask: new loaded.ort.Tensor("int64", new BigInt64Array(input.length).fill(1n), shape),
        });
        inferenceMs += performance.now() - started;
        const logits = output.logits.data;
        for (let i = from; i < to; i++) {
          const k = (i - from + 1) * 2;
          sums[i] += 1 / (1 + Math.exp(logits[k] - logits[k + 1]));
          counts[i]++;
        }
        output.logits.dispose?.();
        const probs = new Float32Array(to - from);
        for (let i = from; i < to; i++) {
          probs[i - from] = calibrate(sums[i] / counts[i], loaded.thresholds.calibration);
        }
        post({ type: "progress", id, block: block.index, from, probs: plain(probs),
          done: ++done, total: windows });
      }
      if (latest !== id) return;
      const probs = new Float32Array(plan.ids.length);
      for (let i = 0; i < probs.length; i++) probs[i] = calibrate(sums[i] / counts[i], loaded.thresholds.calibration);
      const scores = plain(probs);
      post({ type: "block", id, block: block.index, probs: scores, words: plan.words,
        ...summary(scores) });
    }
    post({
      type: "done", id, blocks: plans.length, tokens,
      inferenceMs: Math.round(inferenceMs), provider: loaded.provider, threads: loaded.threads,
      skipped: blocks.length - plans.length,
    });
  }

  return {
    /** @param {ModelRequest} message */
    handle(message) {
      if (!message || typeof message !== "object") return;
      if (message.type === "cancel") {
        stopped.add(message.id);
        if (latest === message.id) latest = null;
        return;
      }
      if (message.type === "state") {
        post({ type: "model", ...state });
        return;
      }
      if (message.type === "warm") {
        if (typeof message.gpu === "boolean") wantGpu = message.gpu;
        retune();
        model().catch(() => {});
        return;
      }
      if (message.type !== "check") return;
      stopped.delete(message.id);
      // One runner for every tab, so a check that arrives while another is running waits its turn
      // rather than cutting it short. Only a page that was left stops part way.
      queue = queue.then(async () => {
        if (stopped.delete(message.id)) return;
        if (typeof message.gpu === "boolean") wantGpu = message.gpu;
        retune();
        latest = message.id;
        try {
          await check(message);
        } catch (error) {
          post({ type: "error", id: message.id, message: reason(error) });
        }
        if (latest === message.id) latest = null;
      });
    },
  };
}
