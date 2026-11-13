// Where a known site keeps the writing. A rule names the parts of a page that hold prose, so the
// page-wide pass never has to look at the rest of it; inside a region the general extraction in
// page-text.js still drops buttons, forms, hidden text and rows that are only a link.
//
// docs/sites.md says how each of these was checked, with the block counts it was checked against.

/** @typedef {string | ((root: ParentNode) => Element[])} Keep */

/** @type {SiteRule[]} */
const RULES = [
  {
    host: /(^|\.)github\.com$/,
    keep: [".markdown-body", aboutParagraphs],
  },
  {
    host: /(^|\.)(steampowered|steamcommunity)\.com$/,
    keep: [
      ".game_description_snippet", "#game_area_description", ".apphub_CardTextContent",
      ".forum_op .content", ".commentthread_comment_text", ".subSection", ".workshopItemTitle",
      ".workshopItemDescription",
    ],
    drop: [".date_posted", ".bb_code", ".guideTop", ".subSectionTitle"],
  },
  {
    host: /(^|\.)amazon\.[a-z.]+$/,
    keep: [
      "#feature-bullets", "#productDescription", "#prodDetails", "#detailBullets_feature_div",
      "[data-hook='mobley-review-content']", "[data-hook='review']", ".review-text-content",
    ],
    drop: [
      "[data-hook='genome-widget']", "[data-hook='review-star-rating']", "[data-hook='review-by-line']",
      "[data-hook='review-date']", "[data-hook='format-strip']", "[data-hook='review-badges']",
      "[data-hook='helpful-vote-statement']", "[data-hook='reviewActionBar']",
      ".a-teaser-describedby-collapsed", ".a-teaser-describedby-expanded",
    ],
  },
  {
    host: /(^|\.)reddit\.com$/,
    keep: ["[slot='text-body']", "[slot='comment']", "aside.subreddit-right-rail-community-info details h2"],
  },
  {
    host: /(^|\.)(youtube\.com|youtu\.be)$/,
    keep: ["#description-inline-expander", "#content-text"],
    drop: ["#expand"],
  },
  {
    host: /(^|\.)google\.[a-z.]+$/,
    path: /^\/maps/,
    keep: [".MyEned"],
  },
  {
    host: /(^|\.)yelp\.[a-z.]+$/,
    keep: ['[class^="comment__"], [class*=" comment__"]'],
  },
  {
    host: /(^|\.)bsky\.app$/,
    keep: ['[data-word-wrap="1"]'],
    drop: ["[aria-label^='Post ']"],
  },
];

/**
 * @param {Location} [where]
 * @returns {SiteRule | null}
 */
export function ruleFor(where = globalThis.location) {
  for (const rule of RULES) {
    if (!rule.host.test(where.hostname)) continue;
    if (rule.path && !rule.path.test(where.pathname)) continue;
    return rule;
  }
  return null;
}

// The regions a rule names, with the ones inside another region left out, since everything they
// hold is read either way.
/**
 * @param {SiteRule} rule
 * @param {ParentNode} root
 * @returns {Element[]}
 */
export function regionsFor(rule, root) {
  /** @type {Element[]} */
  const regions = [];
  for (const keep of rule.keep) {
    if (typeof keep === "string") regions.push(...root.querySelectorAll(keep));
    else regions.push(...keep(root));
  }
  return regions.filter((region) => !regions.some((other) => other !== region && other.contains(region)));
}

// GitHub keeps a repository's description in a sidebar cell whose heading reads "About", and the
// class names around it carry a hash, so the heading is what the rule goes by. The page has two
// copies of the cell, one for each width, and the one that is not laid out reads as nothing.
/**
 * @param {ParentNode} root
 * @returns {Element[]}
 */
function aboutParagraphs(root) {
  /** @type {Element[]} */
  const found = [];
  for (const heading of root.querySelectorAll("h2")) {
    if (heading.textContent?.trim() !== "About") continue;
    const cell = heading.parentElement;
    if (cell) found.push(...cell.querySelectorAll("p"));
  }
  return found;
}
