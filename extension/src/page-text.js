// Reading a page: which parts of it are prose worth checking, and where each character sits in the
// DOM, so a score can be drawn back over the text. No extension APIs here, so it can be tested in
// a plain page.

import { MIN_WORDS } from "./config.js";

const SKIP_TAGS = new Set([
  "SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "TEXTAREA", "INPUT", "SELECT", "OPTION", "BUTTON",
  "CODE", "PRE", "KBD", "SAMP", "VAR", "SVG", "CANVAS", "IFRAME", "OBJECT", "EMBED", "VIDEO",
  "AUDIO", "MAP", "HEAD", "META", "LINK", "TITLE", "BR", "HR", "IMG",
]);

// Containers that usually hold a paragraph, a list item or a table cell of prose.
const CANDIDATES = "p, li, blockquote, dd, dt, td, th, figcaption, caption, summary, h1, h2, h3, h4, h5, h6, div";

// Menus, banners and forms are not the page's writing, and a block in them is never what someone
// opened the extension for.
const IGNORED = "nav, header, footer, aside, form, dialog, [role='navigation'], [role='banner'], "
  + "[role='contentinfo'], [role='menu'], [role='search'], [aria-hidden='true'], [hidden], "
  + "[contenteditable='true'], [contenteditable='']";

// Much of the web writes in divs. A container is read around the paragraphs inside it rather than
// swallowing them, which matters for the pages that put an article in one div with line breaks and
// the odd heading: the headings and the loose sentences still belong to the writing around them, and
// a wrapper whose own text is short is dropped for saying nothing of its own.
export function findBlocks({ root = document.body, minWords = MIN_WORDS, maxBlocks = 400 } = {}) {
  if (!root) return [];
  const candidates = [...root.querySelectorAll(CANDIDATES)];
  const containers = new Set();
  for (const element of candidates) {
    if (element.querySelector(CANDIDATES)) containers.add(element);
  }

  const blocks = [];
  const accepted = new Set();

  const usable = (element) => !SKIP_TAGS.has(element.tagName) && element.isConnected
    && !element.closest(IGNORED) && element.getClientRects().length > 0;

  const innermost = candidates.filter((element) => !containers.has(element));
  const around = candidates.filter((element) => containers.has(element));
  for (const element of [...innermost, ...around]) {
    if (blocks.length >= maxBlocks) break;
    if (!usable(element)) continue;
    const block = readBlock(element, accepted);
    if (!block) continue;
    if (block.words < minWords) continue;
    if (block.linkShare > 0.5) continue;
    accepted.add(element);
    blocks.push(block);
  }
  return blocks.sort((a, b) => (a.element.compareDocumentPosition(b.element)
    & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
}

// The text of one container, plus where each text node starts in it. Adjacent inline elements are
// joined with a space, which keeps the offsets exact and the tokenizer on prose.
function readBlock(element, skip = null) {
  const nodes = [];
  let text = "";
  let linkChars = 0;
  let allChars = 0;

  function walk(parent, inLink) {
    for (let child = parent.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === Node.TEXT_NODE) {
        const data = child.data;
        if (!data) continue;
        if (text && /\S$/.test(text) && /^\S/.test(data)) text += " ";
        nodes.push({ node: child, start: text.length, end: text.length + data.length });
        text += data;
        allChars += data.replace(/\s+/g, "").length;
        if (inLink) linkChars += data.replace(/\s+/g, "").length;
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        if (SKIP_TAGS.has(child.tagName)) continue;
        if (skip?.has(child)) continue;
        if (child.hasAttribute("hidden") || child.getAttribute("aria-hidden") === "true") continue;
        walk(child, inLink || child.tagName === "A");
      }
    }
  }
  walk(element, false);

  const lead = text.length - text.trimStart().length;
  const trimmed = text.trim();
  if (!trimmed) return null;
  for (const entry of nodes) {
    entry.start -= lead;
    entry.end -= lead;
  }
  const kept = nodes.filter((entry) => entry.end > 0);
  for (const entry of kept) {
    entry.start = Math.max(0, entry.start);
    entry.end = Math.min(trimmed.length, entry.end);
  }
  return {
    element,
    text: trimmed,
    nodes: kept,
    words: (trimmed.match(/\S+/g) ?? []).length,
    linkShare: allChars ? linkChars / allChars : 0,
  };
}

// A single container can hold a whole article, especially on pages written in divs and line breaks.
// Windows are 510 tokens, so a block is cut where a sentence ends, well before it gets that long.
const CHUNK_CHARS = 4500;

export function splitBlock(block, maxChars = CHUNK_CHARS) {
  if (block.text.length <= maxChars) {
    return [{ ...block, base: 0, nodes: localNodes(block.nodes, 0, block.text.length) }];
  }
  const chunks = [];
  let from = 0;
  while (from < block.text.length) {
    let to = Math.min(block.text.length, from + maxChars);
    // A tail too short to be worth a window of its own stays with the chunk before it.
    if (block.text.length - to < maxChars * 0.25) to = block.text.length;
    if (to < block.text.length) {
      const floor = from + Math.floor(maxChars * 0.55);
      const window = block.text.slice(floor, to);
      const cut = Math.max(window.lastIndexOf(". "), window.lastIndexOf("! "),
        window.lastIndexOf("? "), window.lastIndexOf("\n"));
      if (cut > 0) to = floor + cut + 1;
    }
    const raw = block.text.slice(from, to);
    const lead = raw.length - raw.trimStart().length;
    const text = raw.trim();
    if (text) {
      const start = from + lead;
      chunks.push({
        element: block.element,
        base: start,
        text,
        nodes: localNodes(block.nodes, start, start + text.length),
        words: (text.match(/\S+/g) ?? []).length,
        linkShare: block.linkShare,
      });
    }
    from = Math.max(to, from + 1);
  }
  return chunks;
}

// The text nodes of [from, to), with the offsets counted from `from` instead of from the block.
function localNodes(nodes, from, to) {
  const out = [];
  for (const entry of nodes) {
    const start = Math.max(entry.start, from);
    const end = Math.min(entry.end, to);
    if (end <= start) continue;
    out.push({ node: entry.node, start: start - from, end: end - from });
  }
  return out;
}

// The range covering [start, end) of a block's text, or null when it falls outside it.
export function rangeFor(block, start, end) {
  const from = locateStart(block.nodes, start);
  const to = locateEnd(block.nodes, end);
  if (!from || !to) return null;
  const range = document.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  return range;
}

function locateStart(nodes, offset) {
  let low = 0;
  let high = nodes.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const entry = nodes[middle];
    if (offset < entry.start) high = middle - 1;
    else if (offset >= entry.end) low = middle + 1;
    else return { node: entry.node, offset: offset - entry.start };
  }
  return null;
}

// The caret position at `offset`, which is the boundary after the character before it, so it can sit
// on the end of a node.
function locateEnd(nodes, offset) {
  let low = 0;
  let high = nodes.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const entry = nodes[middle];
    if (offset <= entry.start) high = middle - 1;
    else if (offset > entry.end) low = middle + 1;
    else return { node: entry.node, offset: offset - entry.start };
  }
  const first = nodes[0];
  if (first && offset <= first.start) return { node: first.node, offset: 0 };
  return null;
}
