

import api from "./api.js";

/**
 * @template {HTMLElement} T
 * @param {string} id
 * @returns {T}
 */
const $ = (id) => /** @type {any} */ (document.getElementById(id));

/** @type {{
 *   lede: HTMLElement, shares: HTMLElement, shareHuman: HTMLElement, shareUnsure: HTMLElement,
 *   shareAi: HTMLElement, legend: HTMLElement, valueHuman: HTMLElement, valueUnsure: HTMLElement,
 *   valueAi: HTMLElement, stats: HTMLElement, progress: HTMLElement, bar: HTMLElement,
 *   fill: HTMLElement, progressLabel: HTMLElement, check: HTMLButtonElement,
 *   clear: HTMLButtonElement, note: HTMLElement, settings: HTMLAnchorElement
 * }} */
const elements = {
  lede: $("lede"),
  shares: $("shares"),
  shareHuman: $("share-human"),
  shareUnsure: $("share-unsure"),
  shareAi: $("share-ai"),
  legend: $("legend"),
  valueHuman: $("value-human"),
  valueUnsure: $("value-unsure"),
  valueAi: $("value-ai"),
  stats: $("stats"),
  progress: $("progress"),
  bar: $("bar"),
  fill: $("fill"),
  progressLabel: $("progress-label"),
  check: $("check"),
  clear: $("clear"),
  note: $("note"),
  settings: $("settings"),
};

/** @type {chrome.runtime.Port | null} */
let port = null;
/** @type {PageState} */
let state = { phase: "idle", message: "", progress: null, summary: null };
let modelReady = false;
let answered = false;

/** @param {number} share @returns {string} */
const percent = (share) => `${Math.round(share * 100)}%`;
/** @param {number} bytes @returns {string} */
const megabytes = (bytes) => `${Math.round(bytes / 1e6)} MB`;

/** @param {string} text @param {boolean} [error] */
function note(text, error = false) {
  elements.note.textContent = text;
  elements.note.classList.toggle("error", error);
  elements.note.hidden = !text;
}

// The same numbers the website shows under its stats toggle, on one line.
/** @param {PageState} run @returns {string} */
function stats(run) {
  const device = run.provider === "webgpu"
    ? "GPU (WebGPU)"
    : `CPU (WebAssembly${run.threads ? `, ${run.threads} threads` : ""})`;
  const tokens = run.tokens ?? 0;
  const parts = [device, `${tokens.toLocaleString()} tokens`];
  const ms = run.milliseconds ?? 0;
  if (ms > 0) {
    const seconds = ms / 1000;
    parts.push(`${seconds.toFixed(1)} s`, `${Math.round(tokens / seconds)} tok/s`);
  }
  return parts.join(" · ");
}

/** @param {Partial<PageState>} next */
function draw(next) {
  state = { ...state, ...next };
  if (state.model?.state === "ready") modelReady = true;
  const phase = state.phase ?? "idle";
  const summary = state.summary;
  /** @type {ModelState} */
  const model = state.model ?? { state: "idle" };

  elements.shares.hidden = !summary;
  elements.legend.hidden = !summary;
  elements.stats.hidden = !summary;
  elements.progress.hidden = phase !== "checking";
  elements.check.hidden = phase === "checking";
  elements.check.disabled = false;
  elements.check.textContent = modelReady ? "Check this page" : "Download Aeacus";
  elements.clear.hidden = !(phase === "checking" || summary);

  if (summary) {
    elements.shareHuman.style.flexGrow = String(summary.humanShare);
    elements.shareUnsure.style.flexGrow = String(summary.unsureShare);
    elements.shareAi.style.flexGrow = String(summary.aiShare);
    elements.valueHuman.textContent = percent(summary.humanShare);
    elements.valueUnsure.textContent = percent(summary.unsureShare);
    elements.valueAi.textContent = percent(summary.aiShare);
    elements.stats.textContent = stats(state);

    const paragraphs = `${summary.blocks} ${summary.blocks === 1 ? "paragraph" : "paragraphs"}`;
    elements.lede.textContent = summary.aiBlocks
      ? `Checked ${paragraphs} (${summary.words.toLocaleString()} words).`
      : `Checked ${paragraphs}. None of them read as likely AI.`;
    const skipped = summary.skipped ?? 0;
    if (skipped) {
      note(`The last ${skipped} ${skipped === 1 ? "paragraph was" : "paragraphs were"} left out, to`
        + " keep the check quick.");
    } else {
      note("Aeacus can be wrong both ways. Treat this as one signal, not a verdict.");
    }
  }

  if (phase === "checking") {
    const progress = state.progress ?? { done: 0, total: 0 };
    if (model.state === "downloading") {
      const loadedBytes = model.loaded ?? 0;
      const loaded = megabytes(loadedBytes);
      const total = model.total ? ` of ${megabytes(model.total)}` : "";
      elements.progressLabel.textContent = `Downloading Aeacus (${loaded}${total}). This only happens once.`;
      elements.fill.style.setProperty("--fraction", model.total ? String(loadedBytes / model.total) : "0");
      elements.bar.classList.toggle("indeterminate", !model.total);
    } else if (model.state === "starting") {
      elements.progressLabel.textContent = "Starting Aeacus…";
      elements.bar.classList.add("indeterminate");
    } else if (progress.total) {
      elements.progressLabel.textContent = `Checking this page… ${progress.done} of ${progress.total}`;
      elements.fill.style.setProperty("--fraction", String(progress.done / progress.total));
      elements.bar.classList.remove("indeterminate");
    } else {
      elements.progressLabel.textContent = "Reading the page…";
      elements.bar.classList.add("indeterminate");
    }
    elements.lede.textContent = "Aeacus is checking this page.";
    note("");
  }

  if (phase === "idle") {
    elements.lede.textContent = "Check which parts are likely to be AI-generated, and which parts are"
      + " likely to be written by a human.";
    note(modelReady
      ? "Runs locally inside your browser, no data is sent."
      : "Aeacus S 1 needs to be downloaded from Hugging Face. This only needs to be done once."
        + " 90 MB will be downloaded.");
  }

  if (phase === "empty") {
    elements.lede.textContent = "Aeacus found nothing to read here.";
    note(state.message || "This page has no paragraphs of prose for it to check.");
  }

  if (phase === "home") {
    elements.lede.textContent = "This is Aeacus's own site.";
    note("The extension stays out of the way here. Try any other page.");
    elements.check.hidden = true;
    elements.clear.hidden = true;
  }

  if (phase === "unsupported") {
    elements.lede.textContent = "Aeacus can't check this page.";
    note("Browsers keep extensions out of their own pages and of most PDFs. Try a regular web page.", false);
    elements.check.hidden = true;
    elements.clear.hidden = true;
  }

  if (phase === "error") {
    elements.lede.textContent = "Aeacus couldn't finish the check.";
    note(state.message || "Something went wrong.", true);
  }

  elements.check.disabled = phase === "checking";
}

elements.check.addEventListener("click", () => port?.postMessage({ type: "run" }));
elements.clear.addEventListener("click", () => port?.postMessage({ type: "clear" }));
elements.settings.addEventListener("click", (event) => {
  event.preventDefault();
  api.runtime.openOptionsPage();
});

async function start() {
  const stored = await api.storage.local.get(["modelReady"]);
  modelReady = Boolean(stored.modelReady);
  draw({});

  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) {
    draw({ phase: "unsupported" });
    return;
  }
  // The click that opened this popup is what lets the background put the page script in.
  const loaded = await api.runtime.sendMessage({ type: "load-page", tabId: tab.id })
    .catch(() => null);
  if (!loaded?.ok) {
    draw({ phase: "unsupported" });
    return;
  }
  try {
    port = api.tabs.connect(tab.id, { name: "aeacus-popup" });
  } catch {
    draw({ phase: "unsupported" });
    return;
  }
  port.onDisconnect.addListener(() => {
    port = null;
    if (!answered) draw({ phase: "unsupported" });
  });
  port.onMessage.addListener((message) => {
    answered = true;
    draw(message);
  });
}

start();
