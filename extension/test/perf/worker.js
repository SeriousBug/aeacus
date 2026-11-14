import { run } from "./perf.js";

const query = new URLSearchParams(self.location.search);
postMessage(await run("dedicated worker", {
  threads: Number(query.get("threads") ?? 1),
  provider: query.get("provider") === "wasm" ? "wasm" : "webgpu",
}));
