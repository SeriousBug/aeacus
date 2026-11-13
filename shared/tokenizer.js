// Byte-level BPE matching the model's tokenizer.json, returning each token's character offsets
// (UTF-16, for slicing JS strings) so predictions can be drawn over the text. Shared by the website
// and the browser extension; the CLI carries its own copy, since npm publishes only its src/.

/**
 * @typedef {{ model: { vocab: Record<string, number>, merges: (string | [string, string])[] },
 *   added_tokens: { content: string, id: number }[] }} TokenizerJson
 * @typedef {{ ids: number[], starts: number[], ends: number[] }} Encoding
 */

const PRETOKENIZE = /'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu;

function byteToUnicode() {
  const bytes = [];
  for (let b = 33; b <= 126; b++) bytes.push(b);
  for (let b = 161; b <= 172; b++) bytes.push(b);
  for (let b = 174; b <= 255; b++) bytes.push(b);
  const chars = bytes.slice();
  let n = 0;
  for (let b = 0; b < 256; b++) {
    if (!bytes.includes(b)) {
      bytes.push(b);
      chars.push(256 + n++);
    }
  }
  const map = new Array(256);
  bytes.forEach((b, i) => { map[b] = String.fromCharCode(chars[i]); });
  return map;
}

export class Tokenizer {
  /** @param {TokenizerJson} json */
  constructor(json) {
    /** @type {Map<string, number>} */
    this.vocab = new Map(Object.entries(json.model.vocab));
    /** @type {Map<string, number>} */
    this.ranks = new Map(json.model.merges.map((m, i) => /** @type {[string, number]} */ (
      [Array.isArray(m) ? m.join(" ") : m, i])));
    this.added = new Map(json.added_tokens.map((t) => [t.content, t.id]));
    const escaped = [...this.added.keys()].sort((a, b) => b.length - a.length)
      .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    this.addedPattern = new RegExp(escaped.join("|"), "g");
    this.byteChars = byteToUnicode();
    this.cache = new Map();
    /** @type {number} */
    this.clsId = this.added.get("[CLS]") ?? 0;
    /** @type {number} */
    this.sepId = this.added.get("[SEP]") ?? 0;
  }

  // Returns {ids, starts, ends} for the text without [CLS]/[SEP]. The text should already be
  // NFC-normalized, as the tokenizer's normalizer expects.
  /** @param {string} text @returns {Encoding} */
  encode(text) {
    /** @type {number[]} */ const ids = [];
    /** @type {number[]} */ const starts = [];
    /** @type {number[]} */ const ends = [];
    let pos = 0;
    /** @param {number} end */
    const plain = (end) => {
      if (end > pos) this.#encodePlain(text, pos, end, ids, starts, ends);
    };
    for (const m of text.matchAll(this.addedPattern)) {
      plain(m.index);
      ids.push(this.added.get(m[0]) ?? 0);
      starts.push(m.index);
      ends.push(m.index + m[0].length);
      pos = m.index + m[0].length;
    }
    plain(text.length);
    return { ids, starts, ends };
  }

  /**
   * @param {string} text
   * @param {number} from
   * @param {number} to
   * @param {number[]} ids
   * @param {number[]} starts
   * @param {number[]} ends
   */
  #encodePlain(text, from, to, ids, starts, ends) {
    const segment = text.slice(from, to);
    const encoder = new TextEncoder();
    for (const m of segment.matchAll(PRETOKENIZE)) {
      const piece = m[0];
      // For each UTF-8 byte of the piece, the UTF-16 index of the character it belongs to.
      const byteChar = [];
      let chars = "";
      for (let i = 0; i < piece.length;) {
        const cp = piece.codePointAt(i) ?? 0;
        const width = cp > 0xffff ? 2 : 1;
        for (const b of encoder.encode(String.fromCodePoint(cp))) {
          byteChar.push([i, width]);
          chars += this.byteChars[b];
        }
        i += width;
      }
      const base = from + m.index;
      let byte = 0;
      for (const token of this.#bpe(chars)) {
        const first = byteChar[byte];
        const last = byteChar[byte + token.length - 1];
        ids.push(this.vocab.get(token) ?? 0);
        starts.push(base + first[0]);
        ends.push(base + last[0] + last[1]);
        byte += token.length;
      }
    }
  }

  /** @param {string} word @returns {string[]} */
  #bpe(word) {
    const cached = this.cache.get(word);
    if (cached) return cached;
    let parts = [...word];
    while (parts.length > 1) {
      let best = -1, bestRank = Infinity;
      for (let i = 0; i < parts.length - 1; i++) {
        const rank = this.ranks.get(parts[i] + " " + parts[i + 1]);
        if (rank !== undefined && rank < bestRank) {
          bestRank = rank;
          best = i;
        }
      }
      if (best < 0) break;
      const merged = parts[best] + parts[best + 1];
      const next = [];
      for (let i = 0; i < parts.length; i++) {
        if (i < parts.length - 1 && parts[i] + parts[i + 1] === merged
            && this.ranks.get(parts[i] + " " + parts[i + 1]) === bestRank) {
          next.push(merged);
          i++;
        } else {
          next.push(parts[i]);
        }
      }
      parts = next;
    }
    if (this.cache.size < 50000) this.cache.set(word, parts);
    return parts;
  }
}
