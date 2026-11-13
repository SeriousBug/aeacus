// The middle of the extension: pages talk to it, and it keeps the model in the one place that can
// hold it. On Chrome that place is an offscreen document, since a service worker has no page to run a
// worker in; on Firefox and Safari the background page itself is that document.

import { startHost } from "./host.js";

const api = globalThis.browser ?? globalThis.chrome;
const OFFSCREEN = "offscreen.html";

const ports = new Set();
const owners = new Map();
let lastModel = { state: "idle" };
let hosting = null;
let starting = null;

function offscreenAvailable() {
  return Boolean(api.offscreen?.createDocument);
}

async function host() {
  if (hosting) return hosting;
  if (!offscreenAvailable()) {
    hosting = startHost(deliver);
    return hosting;
  }
  starting ??= openOffscreen().catch((error) => {
    starting = null;
    throw error;
  });
  const port = await starting;
  hosting = { send: (message) => port.postMessage({ message }) };
  return hosting;
}

async function openOffscreen() {
  if (!(await hasOffscreen())) {
    try {
      await api.offscreen.createDocument({
        url: OFFSCREEN,
        reasons: ["WORKERS"],
        justification: "Runs the Aeacus model in a worker, away from pages and from this service worker.",
      });
    } catch (error) {
      // Another check may have opened it a moment ago, which is not a problem.
      if (!(await hasOffscreen())) throw error;
    }
  }
  const port = api.runtime.connect({ name: "aeacus-offscreen" });
  port.onMessage.addListener(({ message }) => deliver(message));
  port.onDisconnect.addListener(() => {
    hosting = null;
    starting = null;
  });
  return port;
}

async function hasOffscreen() {
  try {
    return await api.offscreen.hasDocument();
  } catch {
    return false;
  }
}

function deliver(message) {
  if (!message) return;
  if (message.type === "model") {
    lastModel = message;
    if (message.state === "ready") api.storage.local.set({ modelReady: true }).catch(() => {});
    if (message.state === "error") api.storage.local.remove("modelReady").catch(() => {});
  }
  const owner = message.id ? owners.get(message.id) : null;
  if (owner) {
    owner.postMessage(message);
    if (message.type === "done" || message.type === "error") owners.delete(message.id);
    return;
  }
  if (message.type === "model") {
    for (const port of ports) port.postMessage(message);
  }
}

async function receive(port, message) {
  if (!message || typeof message !== "object") return;
  if (message.type === "state") {
    port.postMessage({ type: "model", ...lastModel });
    return;
  }
  if (message.type === "check" && message.id) owners.set(message.id, port);
  try {
    (await host()).send(message);
  } catch (error) {
    port.postMessage({ type: "error", id: message.id, message: String(error?.message ?? error) });
  }
}

api.runtime.onConnect.addListener((port) => {
  if (port.name !== "aeacus") return;
  ports.add(port);
  port.onDisconnect.addListener(() => ports.delete(port));
  port.onMessage.addListener((message) => {
    receive(port, message).catch(() => {});
  });
  port.postMessage({ type: "model", ...lastModel });
});

api.commands?.onCommand.addListener(async (command) => {
  if (command !== "check-page") return;
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (tab?.id !== undefined) api.tabs.sendMessage(tab.id, { type: "run" }).catch(() => {});
});
