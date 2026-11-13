const api = globalThis.browser ?? globalThis.chrome;

const $ = (id) => document.getElementById(id);
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
  progress: $("progress"),
  bar: $("bar"),
  fill: $("fill"),
  progressLabel: $("progress-label"),
  check: $("check"),
  clear: $("clear"),
  note: $("note"),
  settings: $("settings"),
};

let port = null;
let state = { phase: "idle" };
let modelReady = false;
let answered = false;

const percent = (share) => `${Math.round(share * 100)}%`;
const megabytes = (bytes) => `${Math.round(bytes / 1e6)} MB`;

function note(text, error = false) {
  elements.note.textContent = text;
  elements.note.classList.toggle("error", error);
  elements.note.hidden = !text;
}

function draw(next) {
  state = { ...state, ...next };
  if (state.model?.state === "ready") modelReady = true;
  const phase = state.phase ?? "idle";
  const summary = state.summary;
  const model = state.model ?? {};

  elements.shares.hidden = !summary;
  elements.legend.hidden = !summary;
  elements.progress.hidden = phase !== "checking";
  elements.check.hidden = phase === "checking";
  elements.check.disabled = false;
  elements.clear.hidden = !(phase === "checking" || summary);

  if (summary) {
    elements.shareHuman.style.flexGrow = String(summary.humanShare);
    elements.shareUnsure.style.flexGrow = String(summary.unsureShare);
    elements.shareAi.style.flexGrow = String(summary.aiShare);
    elements.valueHuman.textContent = percent(summary.humanShare);
    elements.valueUnsure.textContent = percent(summary.unsureShare);
    elements.valueAi.textContent = percent(summary.aiShare);

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
      const loaded = megabytes(model.loaded ?? 0);
      const total = model.total ? ` of ${megabytes(model.total)}` : "";
      elements.progressLabel.textContent = `Downloading Aeacus (${loaded}${total}). This only happens once.`;
      elements.fill.style.setProperty("--fraction", model.total ? String(model.loaded / model.total) : "0");
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

  if (phase === "idle" || phase === "unknown") {
    elements.lede.textContent = "See which parts of this page read as written by a person and which"
      + " by AI.";
    note(modelReady
      ? "The check runs on this computer. Nothing is sent anywhere."
      : "The first check downloads Aeacus, about 87 MB, and keeps it on this computer.");
  }

  if (phase === "empty") {
    elements.lede.textContent = "There isn't enough text on this page to check.";
    note(state.message || "Aeacus checks paragraphs of prose, and this page has none long enough.");
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
