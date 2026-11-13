// Reading a page: which parts of it are prose worth checking, and where each character sits in the
// DOM, so a score can be drawn back over the text. No extension APIs here, so it can be tested in
// a plain page.

import { MAX_BLOCKS } from "./config.js";
import { regionsFor, ruleFor } from "./sites.js";

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
  + "[role='contentinfo'], [role='complementary'], [role='menu'], [role='dialog'], [role='alert'], "
  + "[role='search'], [aria-hidden='true'], [aria-modal='true'], [hidden], [inert], "
  + "[contenteditable='true'], [contenteditable='']";

// Words that name a piece of page chrome in an element's class or id. Themes and frameworks reuse
// them, so they catch menus and widgets that are divs and carry no role. Matched against whole
// words, and stopped at the edge of a region, because `comment-content` is writing while
// `comment-reply-title` is the form under it, and a review card on Amazon sits in a carousel.
const CHROME_WORDS = [
  "nav", "menu", "sidebar", "breadcrumb", "footer", "header", "masthead", "toolbar", "pagination",
  "share", "related", "social", "cookie", "newsletter", "subscribe", "promo", "banner", "advert",
  "sponsor", "modal", "popup", "overlay", "drawer", "skip", "screen-reader", "visually-hidden", "sr",
  "respond", "reply", "submit", "meta", "byline", "rating", "vote", "actions", "search", "widget",
  "tab", "carousel", "slider", "sticky", "paywall",
];
const CHROME = new RegExp(`(^|[^a-z0-9])(${CHROME_WORDS.join("|")})([^a-z0-9]|$)`, "i");

// A name can run two words together, as `jp-relatedposts` and `sharedaddy` do, and the longer words
// are matched as the start of a name for that. Only those, because `tab` would then claim `table`.
const CHROME_START = new RegExp(
  `(^|[^a-z0-9])(${CHROME_WORDS.filter((word) => word.length >= 5).join("|")})`, "i",
);

/** @param {Element} element @returns {string} */
const names = (element) => `${element.getAttribute("class") ?? ""} ${element.id}`;

/** @param {Element} element @returns {boolean} */
const chrome = (element) => {
  const name = names(element);
  return CHROME.test(name) || CHROME_START.test(name);
};

// Why an element is not writing, as one test, so the walk and the block filter agree on it.
/**
 * @param {Element} element
 * @param {string} drop
 * @returns {boolean}
 */
const refuse = (element, drop) => SKIP_TAGS.has(element.tagName) || element.matches(IGNORED)
  || chrome(element) || (Boolean(drop) && element.matches(drop));

/**
 * @param {Element} element
 * @param {Element} region
 * @param {(node: Element) => boolean} test
 * @returns {boolean}
 */
function within(element, region, test) {
  /** @type {Element | null} */
  let node = element;
  for (; node; node = node.parentElement) {
    if (test(node)) return true;
    if (node === region) break;
  }
  return false;
}

// The container a page itself calls its writing, which is the whole body when it names none.
/** @param {Element} root @returns {Element} */
function mainOf(root) {
  return root.querySelector("main, [role='main']") ?? root;
}

/**
 * @param {{ root?: Element | null, maxBlocks?: number, rule?: SiteRule | null }} [options]
 * @returns {PageBlock[]}
 */
export function findBlocks({ root = document.body, maxBlocks = MAX_BLOCKS, rule = ruleFor() } = {}) {
  if (!root) return [];
  const regions = rule ? regionsFor(rule, root) : [];
  if (!regions.length) regions.push(mainOf(root));
  const drop = rule?.drop?.length ? rule.drop.join(", ") : "";

  /** @type {Map<Element, Element>} */
  const homes = new Map();
  for (const region of regions) {
    if (region.matches(CANDIDATES)) homes.set(region, region);
    for (const element of region.querySelectorAll(CANDIDATES)) {
      if (!homes.has(element)) homes.set(element, region);
    }
  }

  // Deepest first, so a wrapper is left with only the text none of its children gave. Links and
  // buttons are already skipped by the walk, and whatever is under an accepted block is skipped too.
  const ordered = [...homes.keys()].sort((a, b) => depth(b) - depth(a));

  /** @type {PageBlock[]} */
  const blocks = [];
  /** @type {Set<Element>} */
  const accepted = new Set();
  for (const element of ordered) {
    if (blocks.length >= maxBlocks) break;
    const region = homes.get(element);
    if (!region) continue;
    if (!element.isConnected || element.getClientRects().length === 0) continue;
    if (within(element, region, (node) => refuse(node, drop))) continue;
    const block = readBlock(element, accepted, drop);
    if (!block) continue;
    if (block.linkShare > 0.5) continue;
    accepted.add(element);
    blocks.push(block);
  }
  return blocks.sort((a, b) => (a.element.compareDocumentPosition(b.element)
    & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
}

/** @param {Element} element @returns {number} */
function depth(element) {
  let levels = 0;
  /** @type {Element | null} */
  let node = element;
  for (; node; node = node.parentElement) levels++;
  return levels;
}

// The text of one container, plus where each text node starts in it. Adjacent inline elements are
// joined with a space, which keeps the offsets exact and the tokenizer on prose. Every run of text
// nodes that is not interrupted by something unread is numbered, so a highlight is never drawn over
// an image, a button or a code block: a range from one run to another would cover them.
/**
 * @param {Element} element
 * @param {Set<Element>} accepted
 * @param {string} drop
 * @returns {PageBlock | null}
 */
function readBlock(element, accepted, drop) {
  /** @type {TextNodeSpan[]} */
  const nodes = [];
  let text = "";
  let linkChars = 0;
  let allChars = 0;
  let run = 0;

  /**
   * @param {Node} parent
   * @param {boolean} inLink
   */
  function walk(parent, inLink) {
    for (let child = parent.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === Node.TEXT_NODE) {
        const node = /** @type {Text} */ (child);
        const data = node.data;
        if (!data) continue;
        if (text && /\S$/.test(text) && /^\S/.test(data)) text += " ";
        nodes.push({ node, start: text.length, end: text.length + data.length, run, base: 0 });
        text += data;
        allChars += data.replace(/\s+/g, "").length;
        if (inLink) linkChars += data.replace(/\s+/g, "").length;
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const inside = /** @type {Element} */ (child);
        if (accepted.has(inside) || refuse(inside, drop)) {
          run++;
          continue;
        }
        walk(inside, inLink || inside.tagName === "A");
      }
    }
  }
  walk(element, false);

  const lead = text.length - text.trimStart().length;
  const trimmed = text.trim();
  if (!trimmed) return null;
  for (const entry of nodes) {
    // The block's first character sits part way into the node that held the indentation, and what is
    // trimmed off has to stay counted here, or a drawn range would start that many characters early.
    entry.base = Math.max(0, lead - entry.start);
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

/**
 * @param {PageBlock} block
 * @param {number} [maxChars]
 * @returns {Block[]}
 */
export function splitBlock(block, maxChars = CHUNK_CHARS) {
  if (block.text.length <= maxChars) {
    return [{ ...block, base: 0, nodes: localNodes(block.nodes, 0, block.text.length) }];
  }
  /** @type {Block[]} */
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
/**
 * @param {TextNodeSpan[]} nodes
 * @param {number} from
 * @param {number} to
 * @returns {TextNodeSpan[]}
 */
function localNodes(nodes, from, to) {
  const out = [];
  for (const entry of nodes) {
    const start = Math.max(entry.start, from);
    const end = Math.min(entry.end, to);
    if (end <= start) continue;
    out.push({ node: entry.node, start: start - from, end: end - from, run: entry.run,
      base: entry.base + (start - entry.start) });
  }
  return out;
}

// The ranges covering [start, end) of a block's text: one per run, since a single range would cover
// whatever sits between two runs as well, which is the image or the button that broke them.
/**
 * @param {{ nodes: TextNodeSpan[] }} block
 * @param {number} start
 * @param {number} end
 * @returns {Range[]}
 */
export function rangesFor(block, start, end) {
  /** @type {Range[]} */
  const ranges = [];
  /** @type {Range | null} */
  let range = null;
  let run = -1;
  for (const entry of block.nodes) {
    const from = Math.max(entry.start, start);
    const to = Math.min(entry.end, end);
    if (to <= from) continue;
    if (!range || entry.run !== run) {
      range = document.createRange();
      range.setStart(entry.node, entry.base + from - entry.start);
      run = entry.run;
      ranges.push(range);
    }
    range.setEnd(entry.node, entry.base + to - entry.start);
  }
  return ranges;
}

