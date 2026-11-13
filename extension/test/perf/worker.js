import { run } from "./perf.js";

postMessage(await run("dedicated worker"));
