import { run } from "./perf.js";

self.addEventListener("message", async (event) => {
  event.ports[0]?.postMessage(await run("service worker"));
});

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
