import { readSettings, writeSettings } from "./settings.js";
import api from "./api.js";

/**
 * @template {HTMLElement} T
 * @param {string} id
 * @returns {T}
 */
const $ = (id) => /** @type {any} */ (document.getElementById(id));

/** @type {HTMLInputElement} */
const auto = $("auto");
/** @type {HTMLInputElement} */
const tooltips = $("tooltips");
/** @type {HTMLInputElement} */
const minWords = $("minWords");
/** @type {HTMLElement} */
const status = $("model-status");
/** @type {HTMLButtonElement} */
const download = $("download");

/** @param {number} bytes @returns {string} */
const megabytes = (bytes) => `${Math.round(bytes / 1e6)} MB`;

/** @type {chrome.runtime.Port | null} */
let port = null;

async function start() {
  const settings = await readSettings();
  auto.checked = settings.auto;
  tooltips.checked = settings.tooltips;
  minWords.value = String(settings.minWords);
  const stored = await api.storage.local.get(["modelReady"]);
  status.textContent = stored.modelReady
    ? "Aeacus is on this computer, so checks run offline."
    : "Aeacus is downloaded the first time you check a page, and stays on this computer after that.";
  download.disabled = Boolean(stored.modelReady);
}

async function save() {
  const words = Math.min(200, Math.max(10, Math.round(Number(minWords.value) || 30)));
  minWords.value = String(words);
  await writeSettings({ auto: auto.checked, tooltips: tooltips.checked, minWords: words });
}

for (const input of [auto, tooltips, minWords]) input.addEventListener("change", save);

download.addEventListener("click", () => {
  port ??= api.runtime.connect({ name: "aeacus" });
  port.onMessage.addListener((message) => {
    if (message.type !== "model") return;
    if (message.state === "downloading") {
      status.textContent = `Downloading Aeacus (${megabytes(message.loaded ?? 0)}`
        + `${message.total ? ` of ${megabytes(message.total)}` : ""}).`;
      download.disabled = true;
    } else if (message.state === "starting") {
      status.textContent = "Starting Aeacus…";
    } else if (message.state === "ready") {
      status.textContent = "Aeacus is on this computer, so checks run offline.";
      download.disabled = true;
    } else if (message.state === "error") {
      status.textContent = `Aeacus couldn't be downloaded: ${message.message}`;
      download.disabled = false;
    }
  });
  port.postMessage({ type: "warm" });
  download.disabled = true;
});

start();
