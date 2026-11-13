// What runs on the page: gather the prose, ask the model behind the extension's background, and draw
// the answers back where they came from.

import { Painter, Tooltip, label } from "./highlight.js";
import { findBlocks, splitBlock } from "./page-text.js";
import api from "./api.js";
import { reason } from "./errors.js";
import { readSettings } from "./settings.js";

// Aeacus's own site describes the thing instead of being a page to judge, so nothing is read there.
const OWN_HOST = "aeacus.bgenc.dev";
const ownSite = () => location.hostname === OWN_HOST;

const painter = Painter.supported() ? new Painter() : null;
const tooltip = new Tooltip();

/** @type {Bands | null} */
let thresholds = null;
/** @type {Block[]} */
let blocks = [];
let running = false;
let verbose = false;
/** @type {string | null} */
let runId = null;
/** @type {chrome.runtime.Port | null} */
let port = null;
/** @type {PageState} */
let state = { phase: "idle", message: "", progress: null, summary: null };
/** @type {Set<chrome.runtime.Port>} */
const popups = new Set();

/** @param {Partial<PageState>} next */
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

/** @param {string} message */
function fail(message) {
  running = false;
  disconnect();
  publish({ phase: "error", message });
}

// The model lives behind the background's port: one connection per check, so nothing stays running
// on a page that was only read.
/** @returns {chrome.runtime.Port} */
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

/** @param {ModelReply} message */
function receive(message) {
  if (!message) return;
  if (message.type === "model") publish({ model: message });
  if (!("id" in message) || message.id !== runId) return;
  try {
    handle(message);
  } catch (error) {
    console.error("Aeacus couldn't draw a result", error);
    fail(reason(error));
  }
}

/** @param {ModelReply} message */
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
      if (verbose) {
        console.log("aeacus:tokens", { block: message.block, chars: block?.text.length,
          tokens: message.starts.length, ends: message.ends.length,
          lastEnd: message.ends[message.ends.length - 1], text: block?.text });
      }
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

/** @param {{ probs: number[], words: number }} message */
function collect({ probs, words }) {
  if (!thresholds) return;
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

/** @returns {PageSummary | null} */
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

/** @param {Extract<ModelReply, { type: "done" }>} message */
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
    threads: message.threads,
    milliseconds: message.inferenceMs,
    summary: { ...scored, skipped: message.skipped },
  });
}

async function begin() {
  if (ownSite()) {
    publish({ phase: "home" });
    return;
  }
  if (running) return;
  if (!painter) {
    publish({ phase: "unsupported" });
    return;
  }
  const settings = await readSettings();
  verbose = settings.verbose;
  painter.verbose = verbose;
  const found = findBlocks().flatMap((block) => splitBlock(block));
  if (verbose) {
    console.log("aeacus:page", { blocks: found.length, reads: found.map((block) => ({
      chars: block.text.length, spans: block.nodes.length, text: block.text.slice(0, 80) })) });
  }
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
/** @type {{ x: number, y: number } | null} */
let pointer = null;
let waiting = false;

addEventListener("pointermove", (event) => {
  if (!painter) return;
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

// Leaving the page stops its check, so a page you have moved on from is not still being read behind
// the next one.
addEventListener("pagehide", () => {
  if (runId) port?.postMessage({ type: "cancel", id: runId });
  tooltip.hide();
}, { capture: true });

function showTooltip() {
  if (!pointer || !thresholds || !painter) return;
  const caret = caretAt(pointer.x, pointer.y);
  if (!caret || !onGlyph(caret.node, caret.offset, pointer.x, pointer.y)) {
    tooltip.hide();
    return;
  }
  const p = painter.at(caret.node, caret.offset) ?? painter.at(caret.node, caret.offset - 1);
  if (p === null || p === undefined) {
    tooltip.hide();
    return;
  }
  tooltip.show(label(p, thresholds), pointer.x, pointer.y);
}

// A browser will name a caret position in the empty space beside a line as readily as on its words,
// and a tooltip there hangs over nothing. Only a character the pointer is actually on counts.
/**
 * @param {Node | null} node
 * @param {number} offset
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */
function onGlyph(node, offset, x, y) {
  if (!node || node.nodeType !== Node.TEXT_NODE) return false;
  const text = /** @type {Text} */ (node);
  const last = text.data.length - 1;
  for (let from = Math.max(0, offset - 1); from <= Math.min(offset, last); from++) {
    const range = document.createRange();
    range.setStart(text, from);
    range.setEnd(text, from + 1);
    for (const rect of range.getClientRects()) {
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return true;
    }
  }
  return false;
}

/**
 * @param {number} x
 * @param {number} y
 * @returns {{ node: Node, offset: number } | null}
 */
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

if (ownSite()) publish({ phase: "home" });
