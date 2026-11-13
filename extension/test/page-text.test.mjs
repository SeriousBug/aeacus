// Cutting what a container holds into pieces a window can read, keeping every character's place.

import assert from "node:assert/strict";
import test from "node:test";

import { rangesFor, splitBlock } from "../src/page-text.js";

const UNIT = "This paragraph exists so that a block of text has real sentences in it, and so that a "
  + "cut can land on a full stop instead of in the middle of a word. ";

function blockOf(text, nodeLength = 400) {
  const nodes = [];
  for (let from = 0; from < text.length; from += nodeLength) {
    const to = Math.min(text.length, from + nodeLength);
    nodes.push({ node: { data: text.slice(from, to) }, start: from, end: to, run: 0, base: 0 });
  }
  return { element: null, text, nodes, words: (text.match(/\S+/g) ?? []).length, linkShare: 0 };
}

// Every character of every node lands on the same character of its chunk, which is what lets a
// painted range cover the words it scored.
function assertNodesMatch(block, chunk) {
  for (const entry of chunk.nodes) {
    const original = block.nodes.find((node) => node.node === entry.node);
    assert.ok(original, "a chunk node came from the block");
    assert.ok(entry.start >= 0 && entry.end <= chunk.text.length, "node inside the chunk");
    for (let at = entry.start; at < entry.end; at++) {
      assert.equal(entry.node.data[original.base + chunk.base + at - original.start], chunk.text[at],
        `character ${at} of the chunk lines up`);
    }
  }
}

// rangesFor asks the document for each range and nothing else, so a recorder can stand in for one and
// keep the offsets it was handed.
function recorded() {
  /** @type {{ start: [any, number] | null, end: [any, number] | null }[]} */
  const ranges = [];
  globalThis.document = {
    createRange() {
      const range = {
        start: null,
        end: null,
        /** @param {any} node @param {number} offset */
        setStart(node, offset) { this.start = [node, offset]; },
        /** @param {any} node @param {number} offset */
        setEnd(node, offset) { this.end = [node, offset]; },
      };
      ranges.push(range);
      return range;
    },
  };
  return ranges;
}

// The text one recorded range covers, which is what a reader sees marked.
function covered(range) {
  const [node, from] = /** @type {[any, number]} */ (range.start);
  const [, to] = /** @type {[any, number]} */ (range.end);
  return node.data.slice(from, to);
}

test("a block that fits a window is left whole", () => {
  const text = "One short paragraph of prose, with enough words in it to be worth a look.";
  const block = blockOf(text);
  const chunks = splitBlock(block);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].text, text);
  assert.equal(chunks[0].base, 0);
  assert.deepEqual(chunks[0].nodes, block.nodes);
});

test("a long block is cut at sentence ends and no character is lost", () => {
  const text = UNIT.repeat(90);
  const block = blockOf(text);
  const chunks = splitBlock(block);
  assert.ok(chunks.length >= 3, `expected several chunks, got ${chunks.length}`);
  let next = 0;
  for (const chunk of chunks) {
    assert.ok(chunk.text.length <= 4500 * 1.25, `chunk of ${chunk.text.length} characters`);
    assert.equal(block.text.slice(chunk.base, chunk.base + chunk.text.length), chunk.text);
    assert.equal(chunk.text, chunk.text.trim());
    assert.ok(chunk.base >= next, "chunks do not overlap");
    next = chunk.base + chunk.text.length;
    assert.equal(chunk.words, (chunk.text.match(/\S+/g) ?? []).length);
    assert.ok(chunk.nodes.length > 0, "a chunk keeps the nodes it covers");
    assertNodesMatch(block, chunk);
  }
  for (const chunk of chunks.slice(0, -1)) assert.equal(chunk.text.at(-1), ".");
});

test("a tail too short to be worth a window stays with the chunk before it", () => {
  const text = UNIT.repeat(31);
  assert.ok(text.length > 4500 && text.length < 4500 * 1.25, `fixture is ${text.length}`);
  const chunks = splitBlock(blockOf(text));
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].text, text.trim());
});

test("a custom width is honoured", () => {
  const chunks = splitBlock(blockOf(UNIT.repeat(90)), 1000);
  assert.ok(chunks.every((chunk) => chunk.text.length <= 1000));
  assert.ok(chunks.length >= 10);
  assert.ok(chunks.reduce((sum, chunk) => sum + chunk.words, 0) > 30);
});

// The indentation readBlock trims off the front of a block is not in the block's text, so a range
// has to start past it in the node. A page that indents its markup, which most do, is otherwise
// marked that many characters to the left, and a short block loses its last words.
test("a range starts where the block starts, not where its indentation did", () => {
  const node = { data: "\n      I've tried so far:\n    " };
  const block = { nodes: [{ node, start: 0, end: 18, run: 0, base: 7 }] };
  recorded();
  const ranges = rangesFor(block, 0, 18);
  assert.equal(ranges.length, 1);
  assert.equal(covered(ranges[0]), "I've tried so far:");
  delete globalThis.document;
});

test("a block that spans two nodes keeps both of their places", () => {
  const first = { data: "\n    the beginning of it" };
  const second = { data: " and the end" };
  const block = { nodes: [
    { node: first, start: 0, end: 19, run: 0, base: 5 },
    { node: second, start: 20, end: 32, run: 0, base: 0 },
  ] };
  recorded();
  const ranges = rangesFor(block, 0, 32);
  assert.equal(ranges.length, 1, "one run, one range");
  assert.equal(ranges[0].start[0], first);
  assert.equal(ranges[0].start[1], 5);
  assert.equal(ranges[0].end[0], second);
  assert.equal(ranges[0].end[1], 12);
  const tail = rangesFor(block, 20, 32);
  assert.equal(tail.length, 1);
  assert.equal(tail[0].start[0], second);
  assert.equal(tail[0].start[1], 0);
  assert.equal(tail[0].end[1], 12);
  delete globalThis.document;
});

test("a chunk of an indented block still lands on the same characters", () => {
  const text = UNIT.repeat(90).trim();
  const node = { data: `\n    ${text}\n  ` };
  const block = { element: null, text, words: 0, linkShare: 0,
    nodes: [{ node, start: 0, end: text.length, run: 0, base: 5 }] };
  const chunks = splitBlock(block);
  assert.ok(chunks.length >= 3, `expected several chunks, got ${chunks.length}`);
  for (const chunk of chunks) {
    for (const entry of chunk.nodes) {
      for (let at = entry.start; at < entry.end; at++) {
        assert.equal(node.data[5 + chunk.base + at], chunk.text[at],
          `character ${at} of the chunk lines up`);
      }
    }
  }
  recorded();
  for (const chunk of chunks) {
    const ranges = rangesFor(chunk, 0, chunk.text.length);
    assert.equal(ranges.map(covered).join(""), chunk.text);
  }
  delete globalThis.document;
});
