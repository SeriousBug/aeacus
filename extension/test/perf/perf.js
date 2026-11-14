// Times a 512-token window through ONNX Runtime Web in a dedicated worker, which is where the
// extension runs its model. Every setting is an argument rather than module state, because ORT reads
// its env once per context: a variant only counts if it gets a worker of its own.

const BUNDLE = "ort.webgpu.bundle.min.mjs";
const WASM = "ort-wasm-simd-threaded.asyncify.wasm";
const SEQUENCE = 512;
// A run that takes longer than this is reported and not repeated, so a slow setting does not hold the
// summary up for minutes.
const REPEAT_UNDER = 5000;

function url(name) {
  return new URL(name, self.location.href).href;
}

/**
 * @param {string} label
 * @param {{ threads?: number, provider?: "webgpu" | "wasm" }} [setting]
 */
export async function run(label, { threads = 1, provider = "webgpu" } = {}) {
  const result = {
    label,
    asked: provider,
    threadsWanted: threads,
    crossOriginIsolated: self.crossOriginIsolated,
    sharedArrayBuffer: typeof SharedArrayBuffer !== "undefined",
    hasGpu: typeof navigator !== "undefined" && Boolean(navigator.gpu),
  };
  const ort = await import(url(`ort/${BUNDLE}`));
  ort.env.wasm.numThreads = threads;
  ort.env.wasm.wasmPaths = url("ort/");
  ort.env.logLevel = "error";

  const [wasm, model] = await Promise.all([
    fetch(url(`ort/${WASM}`)).then((r) => r.arrayBuffer()),
    fetch(url("model_q4f16.onnx")).then((r) => r.arrayBuffer()),
  ]);
  ort.env.wasm.wasmBinary = wasm;

  let session = null;
  const started = performance.now();
  if (provider === "webgpu" && result.hasGpu) {
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
  result.threadsUsed = ort.env.wasm.numThreads;

  const input = new BigInt64Array(SEQUENCE).fill(1000n);
  const mask = new BigInt64Array(SEQUENCE).fill(1n);
  result.runsMs = [];
  do {
    const t = performance.now();
    const out = await session.run({
      input_ids: new ort.Tensor("int64", input, [1, SEQUENCE]),
      attention_mask: new ort.Tensor("int64", mask, [1, SEQUENCE]),
    });
    result.runsMs.push(Math.round(performance.now() - t));
    out.logits.dispose?.();
  } while (result.runsMs.length < 3 && result.runsMs[0] < REPEAT_UNDER);

  result.tokensPerSecond = Math.round(SEQUENCE / (Math.min(...result.runsMs) / 1000));
  return result;
}
