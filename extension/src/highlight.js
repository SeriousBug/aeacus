// Drawing the scores back over the page with the CSS Custom Highlight API, which styles ranges of
// text without touching the page's own DOM.

import { DEBUG } from "./config.js";
import { rangesFor } from "./page-text.js";
import { verdict } from "./scoring.js";

// How many steps of color strength each side has; content.css has a rule for every one of them.
const LEVELS = 4;

/**
 * @param {Band} band
 * @param {number} level
 * @returns {string}
 */
const nameFor = (band, level) => (band === "unsure" ? "aeacus-unsure" : `aeacus-${band}-${level}`);

// A drawn range's text, cut in the middle so one line of console shows both of its ends.
/** @param {string} text @returns {string} */
const short = (text) => (text.length <= 64 ? text : `${text.slice(0, 34)} … ${text.slice(-26)}`);

/** @typedef {{ text: string, nodes: TextNodeSpan[], starts: number[], ends: number[] }} TokenLayout */

export class Painter {
  constructor() {
    /** @type {Map<number, TokenLayout & { nodeStarts: Map<Text, number>,
      probs: number[] | null, words: number }>} */
    this.blocks = new Map();
    /** @type {Map<number, { name: string, range: Range }[]>} */
    this.drawn = new Map();
    /** @type {Map<Text, number>} */
    this.owned = new Map();
    /** @type {Map<string, Highlight>} */
    this.highlights = new Map();
  }

  static supported() {
    return Boolean(globalThis.CSS?.highlights && globalThis.Highlight && globalThis.Range);
  }

  /** @param {string} name @returns {Highlight} */
  #highlight(name) {
    let highlight = this.highlights.get(name);
    if (!highlight) {
      highlight = new Highlight();
      this.highlights.set(name, highlight);
      CSS.highlights.set(name, highlight);
    }
    return highlight;
  }

  // Registers where a block's tokens are, so ranges can be made from them as scores arrive.
  /**
   * @param {number} index
   * @param {TokenLayout} layout
   */
  setTokens(index, { text, nodes, starts, ends }) {
    const nodeStarts = new Map();
    for (const entry of nodes) {
      nodeStarts.set(entry.node, entry.start);
      this.owned.set(entry.node, index);
    }
    this.blocks.set(index, { text, nodes, starts, ends, nodeStarts, probs: null, words: 0 });
  }

  /** @param {number} index @param {string} text */
  setText(index, text) {
    const block = this.blocks.get(index);
    if (block) block.text = text;
  }

  // Repaints one block: consecutive tokens of the same band and strength become one range, which
  // keeps a long article to a few hundred ranges instead of thousands.
  /**
   * @param {number} index
   * @param {number[]} probs
   * @param {Bands} thresholds
   */
  paint(index, probs, thresholds) {
    const block = this.blocks.get(index);
    if (!block) return;
    block.probs = probs;
    this.#forget(index);
    const runs = [];
    let run = null;
    for (let i = 0; i < probs.length; i++) {
      if (!Number.isFinite(probs[i])) {
        if (run) runs.push(run);
        run = null;
        continue;
      }
      const [band, strength] = verdict(probs[i], thresholds);
      const level = band === "unsure" ? 0 : Math.min(LEVELS - 1, Math.floor(strength * LEVELS));
      if (run && run.band === band && run.level === level) {
        run.end = block.ends[i];
        continue;
      }
      if (run) runs.push(run);
      run = { band, level, start: block.starts[i], end: block.ends[i] };
    }
    if (run) runs.push(run);

    const drawn = [];
    for (const entry of runs) {
      const name = nameFor(entry.band, entry.level);
      const highlight = this.#highlight(name);
      for (const range of rangesFor(block, entry.start, entry.end)) {
        highlight.add(range);
        drawn.push({ name, range });
      }
    }
    this.drawn.set(index, drawn);
    if (DEBUG) {
      console.debug("aeacus:block", {
        index,
        chars: block.text.length,
        tokens: probs.length,
        lastEnd: block.ends[probs.length - 1],
        spans: block.nodes.map((entry) => [entry.start, entry.end, entry.run]),
        runs: runs.map((entry) => `${entry.band}${entry.level} ${entry.start}-${entry.end}`),
        drawn: drawn.map(({ name, range }) => `${name} ${JSON.stringify(short(range.toString()))}`),
        text: block.text,
      });
    }
  }

  /** @param {number} index */
  #forget(index) {
    const previous = this.drawn.get(index);
    if (!previous) return;
    for (const { name, range } of previous) this.highlights.get(name)?.delete(range);
    this.drawn.delete(index);
  }

  // What Aeacus thinks of the character the pointer is on, as a calibrated probability.
  /**
   * @param {Node | null} node
   * @param {number} offset
   * @returns {number | null}
   */
  at(node, offset) {
    if (!node || node.nodeType !== Node.TEXT_NODE) return null;
    const text = /** @type {Text} */ (node);
    const index = this.owned.get(text);
    if (index === undefined) return null;
    const block = this.blocks.get(index);
    const start = block?.nodeStarts.get(text);
    if (!block?.probs || start === undefined) return null;
    const position = start + offset;
    let low = 0;
    let high = block.starts.length - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (position < block.starts[middle]) high = middle - 1;
      else if (position >= block.ends[middle]) low = middle + 1;
      else {
        const p = block.probs[middle];
        return Number.isFinite(p) ? p : null;
      }
    }
    return null;
  }

  get painted() {
    let count = 0;
    for (const highlight of this.highlights.values()) count += highlight.size;
    return count;
  }

  clear() {
    for (const [name] of this.highlights) CSS.highlights.delete(name);
    this.highlights.clear();
    this.drawn.clear();
    for (const block of this.blocks.values()) block.probs = null;
  }

  forget() {
    this.clear();
    this.blocks.clear();
    this.owned.clear();
  }
}

// "92% likely AI", and never a percentage inside the unsure band, which exists to say the model
// cannot tell.
/**
 * @param {number} p
 * @param {Bands} thresholds
 * @returns {string}
 */
export function label(p, thresholds) {
  if (p > thresholds.low && p < thresholds.high) return "Unsure";
  const aiSide = p >= 0.5;
  const percent = (aiSide ? p : 1 - p) * 100;
  const side = aiSide ? "AI" : "human";
  return percent >= 99.5 ? `99%+ likely ${side}` : `${Math.round(percent)}% likely ${side}`;
}

// A tooltip of its own, in a shadow root, so no page's styles reach it and it reaches no page.
export class Tooltip {
  /** @type {HTMLDivElement | null} */
  #host = null;
  /** @type {HTMLDivElement | null} */
  #tip = null;

  #build() {
    const host = document.createElement("div");
    host.setAttribute("aria-hidden", "true");
    host.style.cssText = "all: initial; position: fixed; top: 0; left: 0; width: 0; height: 0; "
      + "z-index: 2147483647; pointer-events: none;";
    const root = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `
      .tip {
        position: fixed; padding: 5px 8px; border-radius: 6px;
        background: #1c1c1f; color: #ffffff; font: 600 12px/1.35 system-ui, -apple-system, sans-serif;
        box-shadow: 0 2px 10px rgb(0 0 0 / 0.25); white-space: nowrap;
      }
      @media (prefers-color-scheme: dark) { .tip { background: #ececef; color: #141416; } }
    `;
    const tip = document.createElement("div");
    tip.className = "tip";
    tip.hidden = true;
    root.append(style, tip);
    document.documentElement.append(host);
    this.#host = host;
    this.#tip = tip;
  }

  /**
   * @param {string} text
   * @param {number} x
   * @param {number} y
   */
  show(text, x, y) {
    if (!this.#host?.isConnected) this.#build();
    const tip = this.#tip;
    if (!tip) return;
    tip.textContent = text;
    tip.hidden = false;
    // Measured at the corner first, then moved above the pointer, or below it when there is no room,
    // and never off the side.
    tip.style.left = "0px";
    tip.style.top = "0px";
    const box = tip.getBoundingClientRect();
    const margin = 10;
    const left = Math.min(Math.max(margin, x - box.width / 2), innerWidth - box.width - margin);
    const top = y - box.height - margin < margin ? y + 18 : y - box.height - margin;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }

  hide() {
    if (this.#tip) this.#tip.hidden = true;
  }

  destroy() {
    this.#host?.remove();
    this.#host = null;
    this.#tip = null;
  }
}
