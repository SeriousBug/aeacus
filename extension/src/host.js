import { createRunner } from "./infer.js";

const api = globalThis.browser ?? globalThis.chrome;

// Owns the model for this extension context. A worker is what the model wants: WebGPU is only
// reachable from one, and a minute of inference in it does not hold up the rest of the extension. A
// service worker has no Worker to make, so there the same runner runs here, on WebAssembly.
export function startHost(post) {
  if (typeof Worker === "undefined") {
    const runner = createRunner(post);
    return { send: (message) => runner.handle(message) };
  }
  const worker = new Worker(api.runtime.getURL("infer-worker.js"));
  worker.addEventListener("message", ({ data }) => post(data));
  worker.addEventListener("error", (event) => {
    const message = String(event.message ?? "the model stopped");
    post({ type: "model", state: "error", message });
    post({ type: "error", message });
  });
  return { send: (message) => worker.postMessage(message) };
}
