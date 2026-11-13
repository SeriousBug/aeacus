import { createRunner } from "./infer.js";

const runner = createRunner((message) => postMessage(message));

addEventListener("message", ({ data }) => runner.handle(data));
