// Drawing the scores back over the page with the CSS Custom Highlight API, which styles ranges of
// text without touching the page's own DOM.

import { rangeFor } from "./page-text.js";
import { verdict } from "./scoring.js";

// How many steps of color strength each side has; content.css has a rule for every one of them.
const LEVELS = 4;

const nameFor = (band, level) => (band === "unsure" ? "aeacus-unsure" : `aeacus-${band}-${level}`);

export class Painter {
  constructor() {
    this.blocks = new Map();
    this.drawn = new Map();
    this.owned = new Map();
    this.highlights = new Map();
  }

  static supported() {
    return Boolean(globalThis.CSS?.highlights && globalThis.Highlight && globalThis.Range);
  }

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
  setTokens(index, { text, nodes, starts, ends }) {
    const nodeStarts = new Map();
    for (const entry of nodes) {
      nodeStarts.set(entry.node, entry.start);
      this.owned.set(entry.node, index);
    }
    this.blocks.set(index, { text, nodes, starts, ends, nodeStarts, probs: null, words: 0 });
  }

  setText(index, text) {
    const block = this.blocks.get(index);
    if (block) block.text = text;
  }

  // Repaints one block: consecutive tokens of the same band and strength become one range, which
  // keeps a long article to a few hundred ranges instead of thousands.
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
      const range = rangeFor(block, entry.start, entry.end);
      if (!range) continue;
      const name = nameFor(entry.band, entry.level);
      this.#highlight(name).add(range);
      drawn.push({ name, range });
    }
    this.drawn.set(index, drawn);
  }

  #forget(index) {
    const previous = this.drawn.get(index);
    if (!previous) return;
    for (const { name, range } of previous) this.highlights.get(name)?.delete(range);
    this.drawn.delete(index);
  }

  // What Aeacus thinks of the character the pointer is on, as a calibrated probability.
  at(node, offset) {
    if (!node || node.nodeType !== Node.TEXT_NODE) return null;
    const index = this.owned.get(node);
    if (index === undefined) return null;
    const block = this.blocks.get(index);
    if (!block?.probs) return null;
    const position = block.nodeStarts.get(node) + offset;
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
export function label(p, thresholds) {
  if (p > thresholds.low && p < thresholds.high) return "Unsure";
  const aiSide = p >= 0.5;
  const percent = (aiSide ? p : 1 - p) * 100;
  const side = aiSide ? "AI" : "human";
  return percent >= 99.5 ? `99%+ likely ${side}` : `${Math.round(percent)}% likely ${side}`;
}

// A tooltip of its own, in a shadow root, so no page's styles reach it and it reaches no page.
export class Tooltip {
  #host = null;
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

  show(text, x, y) {
    if (!this.#host?.isConnected) this.#build();
    this.#tip.textContent = text;
    this.#tip.hidden = false;
    // Measured at the corner first, then moved above the pointer, or below it when there is no room,
    // and never off the side.
    this.#tip.style.left = "0px";
    this.#tip.style.top = "0px";
    const box = this.#tip.getBoundingClientRect();
    const margin = 10;
    const left = Math.min(Math.max(margin, x - box.width / 2), innerWidth - box.width - margin);
    const top = y - box.height - margin < margin ? y + 18 : y - box.height - margin;
    this.#tip.style.left = `${left}px`;
    this.#tip.style.top = `${top}px`;
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
