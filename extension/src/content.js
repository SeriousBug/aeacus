// What runs on the page: gather the prose, ask the model behind the extension's background, and draw
// the answers back where they came from.

import { MIN_WORDS } from "./config.js";
import { Painter, Tooltip, label } from "./highlight.js";
import { findBlocks, splitBlock } from "./page-text.js";

const api = globalThis.browser ?? globalThis.chrome;

let settings = { auto: true, minWords: MIN_WORDS, tooltips: true };
const painter = Painter.supported() ? new Painter() : null;
const tooltip = new Tooltip();

let thresholds = null;
let blocks = [];
let running = false;
let runId = null;
let port = null;
let state = { phase: "idle" };
const popups = new Set();

function publish(next) {
  state = { ...state, ...next };
  for (const popup of popups) {
    try {
      popup.postMessage(state);
    } catch {
      popups.delete(popup);
    }
  }
}

function fail(message) {
  running = false;
  disconnect();
  publish({ phase: "error", message });
}

// The model lives behind the background's port: one connection per check, so nothing stays running
// on a page that was only read.
function connect() {
  const opened = api.runtime.connect({ name: "aeacus" });
  opened.onMessage.addListener(receive);
  opened.onDisconnect.addListener(() => {
    port = null;
    if (running) fail("Aeacus stopped unexpectedly. Try checking the page again.");
  });
  port = opened;
  return opened;
}

function disconnect() {
  port?.disconnect();
  port = null;
}

function receive(message) {
  if (!message || message.id !== runId) {
    if (message?.type === "model") publish({ model: message });
    return;
  }
  try {
    handle(message);
  } catch (error) {
    console.error("Aeacus couldn't draw a result", error);
    fail(String(error?.message ?? error));
  }
}

function handle(message) {
  switch (message.type) {
    case "total":
      thresholds = { low: message.low, high: message.high };
      publish({ progress: { done: 0, total: message.windows }, tokens: message.tokens });
      break;
    case "tokens": {
      const block = blocks[message.block];
      if (block) painter?.setTokens(message.block, { text: block.text, nodes: block.nodes,
        starts: message.starts, ends: message.ends });
      break;
    }
    case "progress":
      if (thresholds) painter?.paint(message.block, message.probs, thresholds);
      publish({ progress: { done: message.done, total: message.total } });
      break;
    case "block":
      if (!thresholds) throw new Error("the model sent scores without its thresholds");
      painter?.paint(message.block, message.probs, thresholds);
      collect(message);
      break;
    case "done":
      finish(message);
      break;
    case "error":
      fail(message.message);
      break;
  }
}

// Totals for the popup, counted band by band over every token that was scored.
const totals = { tokens: 0, ai: 0, human: 0, unsure: 0, blocks: 0, aiBlocks: 0, words: 0, sum: 0 };

function resetTotals() {
  Object.assign(totals, { tokens: 0, ai: 0, human: 0, unsure: 0, blocks: 0, aiBlocks: 0, words: 0, sum: 0 });
}

function collect({ probs, words }) {
  let ai = 0;
  let human = 0;
  let unsure = 0;
  let sum = 0;
  for (const p of probs) {
    if (!Number.isFinite(p)) continue;
    sum += p;
    if (p >= thresholds.high) ai++;
    else if (p <= thresholds.low) human++;
    else unsure++;
  }
  const tokens = ai + human + unsure;
  totals.tokens += tokens;
  totals.ai += ai;
  totals.human += human;
  totals.unsure += unsure;
  totals.sum += sum;
  totals.words += words;
  totals.blocks++;
  if (ai > human && ai > unsure) totals.aiBlocks++;
  publish({ summary: summary() });
}

function summary() {
  if (!totals.tokens) return null;
  return {
    blocks: totals.blocks,
    words: totals.words,
    aiBlocks: totals.aiBlocks,
    aiShare: totals.ai / totals.tokens,
    humanShare: totals.human / totals.tokens,
    unsureShare: totals.unsure / totals.tokens,
    score: totals.sum / totals.tokens,
  };
}

function finish(message) {
  running = false;
  disconnect();
  const scored = summary();
  if (!scored) {
    publish({ phase: "empty", progress: null, summary: null,
      message: "None of this page's paragraphs could be checked." });
    return;
  }
  publish({
    phase: "done",
    progress: null,
    provider: message.provider,
    seconds: Math.round(message.inferenceMs / 100) / 10,
    summary: { ...scored, skipped: message.skipped },
  });
}

async function begin() {
  if (running) return;
  if (!painter) {
    publish({ phase: "unsupported" });
    return;
  }
  const found = findBlocks({ minWords: settings.minWords }).flatMap((block) => splitBlock(block));
  if (!found.length) {
    publish({ phase: "empty", message: "" });
    return;
  }
  painter.forget();
  tooltip.hide();
  blocks = found;
  resetTotals();
  running = true;
  runId = randomId();
  publish({ phase: "checking", progress: { done: 0, total: 0 }, summary: null, message: "",
    model: state.model, tokens: 0, skipped: 0 });
  connect().postMessage({
    type: "check",
    id: runId,
    blocks: blocks.map((block, index) => ({ index, text: block.text, words: block.words })),
  });
}

function clear() {
  if (runId) port?.postMessage({ type: "cancel", id: runId });
  runId = null;
  running = false;
  disconnect();
  painter?.forget();
  tooltip.hide();
  blocks = [];
  resetTotals();
  publish({ phase: "idle", progress: null, summary: null, message: "" });
}

api.runtime.onConnect.addListener((popup) => {
  if (popup.name !== "aeacus-popup") return;
  popups.add(popup);
  popup.onDisconnect.addListener(() => popups.delete(popup));
  popup.onMessage.addListener((message) => {
    if (message?.type === "run") begin();
    else if (message?.type === "clear") clear();
  });
  popup.postMessage(state);
});

api.runtime.onMessage.addListener((message) => {
  if (message?.type === "run") begin();
});

// Pointing at the text says what Aeacus thinks of that word, the way the website's tooltip does.
let pointer = null;
let waiting = false;

addEventListener("pointermove", (event) => {
  if (!settings.tooltips || !painter) return;
  pointer = { x: event.clientX, y: event.clientY };
  if (event.pointerType === "touch") return;
  if (waiting) return;
  waiting = true;
  requestAnimationFrame(() => {
    waiting = false;
    showTooltip();
  });
}, { passive: true });

addEventListener("scroll", () => tooltip.hide(), { passive: true });
document.addEventListener("pointerleave", () => tooltip.hide(), { capture: true });

function showTooltip() {
  if (!pointer || !thresholds) return;
  const caret = caretAt(pointer.x, pointer.y);
  const p = caret ? painter.at(caret.node, caret.offset) ?? painter.at(caret.node, caret.offset - 1) : null;
  if (p === null || p === undefined) {
    tooltip.hide();
    return;
  }
  tooltip.show(label(p, thresholds), pointer.x, pointer.y);
}

function caretAt(x, y) {
  if (document.caretPositionFromPoint) {
    const position = document.caretPositionFromPoint(x, y);
    return position && { node: position.offsetNode, offset: position.offset };
  }
  const range = document.caretRangeFromPoint?.(x, y);
  return range && { node: range.startContainer, offset: range.startOffset };
}

// crypto.randomUUID is only there on secure origins, and plenty of pages are not.
function randomId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// The model is already on this machine, so pages are checked without being asked; a first visit
// waits for a click, which is when the download is explained.
async function init() {
  const stored = await api.storage.local.get(["settings", "modelReady"]);
  settings = { ...settings, ...(stored.settings ?? {}) };
  if (!settings.auto || !stored.modelReady) return;
  setTimeout(() => {
    if (!running && state.phase === "idle") begin();
  }, 600);
}

init();
