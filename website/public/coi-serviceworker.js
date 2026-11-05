// Cross-origin isolation, for hosts that cannot send response headers (GitHub Pages). Where the
// host does send them (the Vite servers, Cloudflare Pages), this does nothing: the page is already
// isolated, and the script under `self` never runs.
//
// The worker adds the two headers from `_headers` to every same-origin response it passes back, so
// a reload of the page it controls is isolated and WebAssembly can use several threads.
if (typeof window === "undefined") {
  self.addEventListener("install", () => self.skipWaiting());
  self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
  self.addEventListener("fetch", (event) => {
    const { request } = event;
    // Rejecting this one is what fetch() would have done itself, and re-issuing it would throw.
    if (request.cache === "only-if-cached" && request.mode !== "same-origin") return;
    event.respondWith(fetch(request).then((response) => {
      // A cross-origin response cannot be read or rewritten here. It needs no help: COEP is happy
      // with a response that passes CORS, which is how the model and ORT come off the Hub.
      if (response.type !== "basic") return response;
      const headers = new Headers(response.headers);
      headers.set("Cross-Origin-Opener-Policy", "same-origin");
      headers.set("Cross-Origin-Embedder-Policy", "require-corp");
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }));
  });
} else if (!window.crossOriginIsolated && window.isSecureContext && navigator.serviceWorker) {
  // A document is isolated by the headers it was served with, so the first visit registers the
  // worker and reloads once. `?coi` marks the reload, so a browser that keeps handing back the
  // unisolated page cannot loop.
  const reload = () => {
    const url = new URL(location.href);
    if (url.searchParams.has("coi")) return;
    url.searchParams.set("coi", "");
    location.replace(url);
  };
  navigator.serviceWorker.register(document.currentScript.src, { scope: "./" }).then((registration) => {
    if (registration.active) return reload();
    const worker = registration.installing ?? registration.waiting;
    if (!worker) return;
    worker.addEventListener("statechange", () => {
      if (worker.state === "activated") reload();
    });
  });
}
