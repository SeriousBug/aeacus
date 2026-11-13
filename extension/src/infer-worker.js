import { createRunner } from "./infer.js";

// The global scope here is a worker's, which the DOM types call a window.
/** @type {{ postMessage(message: unknown): void,
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void }} */
const scope = /** @type {any} */ (self);

const runner = createRunner((/** @type {ModelReply} */ message) => scope.postMessage(message));

scope.addEventListener("message", (event) => runner.handle(event.data));
