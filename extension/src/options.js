import { readSettings, writeSettings } from "./settings.js";
import api from "./api.js";

/**
 * @template {HTMLElement} T
 * @param {string} id
 * @returns {T}
 */
const $ = (id) => /** @type {any} */ (document.getElementById(id));

/** @type {HTMLInputElement} */
const gpu = $("gpu");
/** @type {HTMLButtonElement} */
const download = $("download");
/** @type {HTMLElement} */
const progress = $("progress");

/** @param {number} bytes @returns {string} */
const megabytes = (bytes) => `${Math.round(bytes / 1e6)} MB`;

/**
 * @param {string} text
 * @param {boolean} [error]
 */
function note(text, error = false) {
  progress.textContent = text;
  progress.classList.toggle("error", error);
  progress.hidden = !text;
}

function downloaded() {
  download.textContent = "Already downloaded";
  download.disabled = true;
}

/** @type {chrome.runtime.Port | null} */
let port = null;

download.addEventListener("click", () => {
  port ??= api.runtime.connect({ name: "aeacus" });
  port.onDisconnect.addListener(() => {
    port = null;
    if (download.textContent !== "Already downloaded") {
      note("Aeacus stopped before it finished downloading. Try again.", true);
      download.disabled = false;
    }
  });
  port.onMessage.addListener((message) => {
    if (message.type !== "model") return;
    if (message.state === "downloading") {
      const loaded = megabytes(message.loaded ?? 0);
      const total = message.total ? ` of ${megabytes(message.total)}` : "";
      note(`Downloading Aeacus, ${loaded}${total} so far.`);
      download.disabled = true;
    } else if (message.state === "starting") {
      note("Starting Aeacus…");
    } else if (message.state === "ready") {
      note("");
      downloaded();
    } else if (message.state === "error") {
      note(`Aeacus couldn't be downloaded: ${message.message}`, true);
      download.disabled = false;
    }
  });
  port.postMessage({ type: "warm" });
  download.disabled = true;
});

gpu.addEventListener("change", () => {
  writeSettings({ gpu: gpu.checked }).catch((error) => {
    note(`The setting couldn't be saved: ${error.message ?? error}`, true);
  });
});

async function start() {
  const settings = await readSettings();
  gpu.checked = settings.gpu;
  const stored = await api.storage.local.get(["modelReady"]);
  if (stored.modelReady) downloaded();
}

start();
