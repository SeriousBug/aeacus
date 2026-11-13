// Times a 512-token window through ONNX Runtime Web in whatever context loads it (page, dedicated
// worker, service worker), which is the question the extension's design hangs on.

const query = new URLSearchParams(self.location.search);
const BUNDLE = query.get("ort") ?? "ort.webgpu.bundle.min.mjs";
const WASM = query.get("wasm") ?? "ort-wasm-simd-threaded.asyncify.wasm";
const THREADS = Number(query.get("threads") ?? 1);
const SEQUENCE = 512;

function url(name) {
  return new URL(name, self.location.href).href;
}

export async function run(label) {
  const result = {
    label,
    bundle: BUNDLE,
    wasm: WASM,
    threadsWanted: THREADS,
    crossOriginIsolated: self.crossOriginIsolated,
    sharedArrayBuffer: typeof SharedArrayBuffer !== "undefined",
    hasGpu: typeof navigator !== "undefined" && Boolean(navigator.gpu),
    hasWorker: typeof Worker !== "undefined",
  };
  const ort = await import(url(`ort/${BUNDLE}`));
  ort.env.wasm.numThreads = THREADS;
  ort.env.wasm.wasmPaths = url("ort/");
  ort.env.logLevel = "error";

  const [wasm, model] = await Promise.all([
    fetch(url(`ort/${WASM}`)).then((r) => r.arrayBuffer()),
    fetch(url("model_q4f16.onnx")).then((r) => r.arrayBuffer()),
  ]);
  ort.env.wasm.wasmBinary = wasm;

  let session = null;
  const started = performance.now();
  if (result.hasGpu) {
    try {
      session = await ort.InferenceSession.create(model, { executionProviders: ["webgpu"], logSeverityLevel: 3 });
      result.provider = "webgpu";
    } catch (e) {
      result.webgpuError = String(e?.message ?? e);
    }
  }
  if (!session) {
    try {
      session = await ort.InferenceSession.create(model, { executionProviders: ["wasm"], logSeverityLevel: 3 });
      result.provider = "wasm";
    } catch (e) {
      result.sessionError = String(e?.message ?? e);
      return result;
    }
  }
  result.loadMs = Math.round(performance.now() - started);

  const input = new BigInt64Array(SEQUENCE).fill(1000n);
  const mask = new BigInt64Array(SEQUENCE).fill(1n);
  result.runsMs = [];
  for (let i = 0; i < 3; i++) {
    const t = performance.now();
    const out = await session.run({
      input_ids: new ort.Tensor("int64", input, [1, SEQUENCE]),
      attention_mask: new ort.Tensor("int64", mask, [1, SEQUENCE]),
    });
    result.runsMs.push(Math.round(performance.now() - t));
    out.logits.dispose?.();
  }
  result.tokensPerSecond = Math.round(SEQUENCE / (Math.min(...result.runsMs) / 1000));
  return result;
}
