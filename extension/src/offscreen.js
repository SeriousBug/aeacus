import { startHost } from "./host.js";

const api = globalThis.browser ?? globalThis.chrome;

// Long enough to be worth keeping the model in memory across checks, short enough that a page read
// once does not hold a few hundred megabytes for the rest of the session.
const IDLE_CLOSE = 120000;

let idle = null;

function touch() {
  clearTimeout(idle);
  idle = setTimeout(() => window.close(), IDLE_CLOSE);
}

api.runtime.onConnect.addListener((port) => {
  if (port.name !== "aeacus-offscreen") return;
  const host = startHost((message) => port.postMessage({ message }));
  port.onMessage.addListener(({ message }) => {
    touch();
    host.send(message);
  });
  port.onDisconnect.addListener(() => window.close());
  touch();
});
