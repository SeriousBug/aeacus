// The middle of the extension: pages talk to it, and it keeps the model in the one place that can
// hold it. On Chrome that place is an offscreen document, since a service worker has no page to run a
// worker in; on Firefox and Safari the background page itself is that document.

import { reason } from "./errors.js";
import { startHost } from "./host.js";
import api from "./api.js";

const OFFSCREEN = "offscreen.html";

/** @type {Set<chrome.runtime.Port>} */
const ports = new Set();
/** @type {Map<string, chrome.runtime.Port>} */
const owners = new Map();
/** @type {ModelState} */
let lastModel = { state: "idle" };
/** @type {Host | null} */
let hosting = null;
/** @type {Promise<chrome.runtime.Port> | null} */
let starting = null;

function offscreenAvailable() {
  return Boolean(api.offscreen?.createDocument);
}

/** @returns {Promise<Host>} */
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

/** @returns {Promise<chrome.runtime.Port>} */
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

/** @returns {Promise<boolean>} */
async function hasOffscreen() {
  try {
    return await api.offscreen.hasDocument();
  } catch {
    return false;
  }
}

/** @param {ModelReply} message */
function deliver(message) {
  if (message.type === "model") {
    lastModel = message;
    if (message.state === "ready") api.storage.local.set({ modelReady: true }).catch(() => {});
    if (message.state === "error") api.storage.local.remove("modelReady").catch(() => {});
    for (const port of ports) port.postMessage(message);
    return;
  }
  if (!("id" in message) || !message.id) return;
  const id = message.id;
  const owner = owners.get(id);
  if (!owner) return;
  try {
    owner.postMessage(message);
  } catch {
    // The page went away first, which its disconnect listener has already handled.
  }
  if (message.type === "done" || message.type === "error") owners.delete(id);
}

// A page that is gone has no use for its scores, and the model is one runner for every tab, so
// leaving a page mid-check stops the work rather than leaving it to finish behind the next page.
/** @param {chrome.runtime.Port} port */
function stopOwned(port) {
  for (const [id, owner] of owners) {
    if (owner !== port) continue;
    owners.delete(id);
    hosting?.send({ type: "cancel", id });
  }
}

/**
 * @param {chrome.runtime.Port} port
 * @param {ModelRequest} message
 */
async function receive(port, message) {
  if (!message || typeof message !== "object") return;
  if (message.type === "state") {
    port.postMessage({ type: "model", ...lastModel });
    return;
  }
  if (message.type === "cancel") {
    // Nothing to cancel on this side if the model was never opened, and opening it to say so would
    // cost a document and a download.
    hosting?.send(message);
    return;
  }
  if (message.type === "check" && message.id) owners.set(message.id, port);
  try {
    const target = await host();
    // The page can go away while the offscreen document is still opening.
    if (message.type === "check" && owners.get(message.id) !== port) return;
    target.send(message);
  } catch (error) {
    const id = "id" in message ? message.id : undefined;
    port.postMessage({ type: "error", id, message: reason(error) });
  }
}

api.runtime.onConnect.addListener((port) => {
  if (port.name !== "aeacus") return;
  ports.add(port);
  port.onDisconnect.addListener(() => {
    ports.delete(port);
    stopOwned(port);
  });
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
