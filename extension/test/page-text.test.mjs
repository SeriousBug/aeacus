// Cutting what a container holds into pieces a window can read, keeping every character's place.

import assert from "node:assert/strict";
import test from "node:test";

import { splitBlock } from "../src/page-text.js";

const UNIT = "This paragraph exists so that a block of text has real sentences in it, and so that a "
  + "cut can land on a full stop instead of in the middle of a word. ";

function blockOf(text, nodeLength = 400) {
  const nodes = [];
  for (let from = 0; from < text.length; from += nodeLength) {
    const to = Math.min(text.length, from + nodeLength);
    nodes.push({ node: { data: text.slice(from, to) }, start: from, end: to });
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
      assert.equal(entry.node.data[chunk.base + at - original.start], chunk.text[at],
        `character ${at} of the chunk lines up`);
    }
  }
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
