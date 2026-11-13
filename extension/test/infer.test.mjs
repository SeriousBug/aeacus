// The model side, run in plain Node: a fake ONNX Runtime, the real tokenizer and thresholds, and a
// fetch that answers from the published weights.

import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { MAX_TOKENS_WASM, WINDOW } from "../src/config.js";
import { windowsFor } from "../src/scoring.js";

// The published weights sit beside the clients repo, the way test/perf symlinks them; a CI run that
// only has this repo skips the model tests.
const MODEL_DIR = process.env.AEACUS_WEIGHTS
  ? path.resolve(process.env.AEACUS_WEIGHTS)
  : path.resolve(import.meta.dirname, "../../../../publish/aeacus-s-1");
const UNIT = "This paragraph exists so that a block of text has real sentences in it, and so that a "
  + "cut can land on a full stop instead of in the middle of a word. ";

async function hasWeights() {
  try {
    await readFile(path.join(MODEL_DIR, "tokenizer.json"));
    return true;
  } catch {
    return false;
  }
}

// A session that answers every window with logits that lean towards AI on every third token, so a
// score can be followed from the tokens through the calibration to the block.
const ORT = `
export const env = { logLevel: "error", wasm: {} };

export class Tensor {
  constructor(type, data, dims) {
    this.type = type; this.data = data; this.dims = dims;
  }
  dispose() {}
}

export const InferenceSession = {
  async create(weights, options) {
    if (options.executionProviders.includes("webgpu")) throw new Error("no adapter after all");
    return {
      async run(feeds) {
        const length = feeds.input_ids.data.length;
        const logits = new Float32Array(length * 2);
        for (let i = 0; i < length; i++) {
          logits[i * 2] = 0;
          logits[i * 2 + 1] = i % 3 === 0 ? 3 : -3;
        }
        return { logits: { data: logits, dispose() {} } };
      },
    };
  },
};
`;

async function prepare() {
  const dir = await mkdtemp(path.join(tmpdir(), "aeacus-infer-"));
  await mkdir(path.join(dir, "ort"), { recursive: true });
  await writeFile(path.join(dir, "ort", "ort.webgpu.bundle.min.mjs"), ORT);

  globalThis.self = { location: { href: `file://${path.join(dir, "infer-worker.js")}` } };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    writable: true,
    value: { hardwareConcurrency: 4, gpu: { requestAdapter: async () => ({}) } },
  });

  const [tokenizer, thresholds] = await Promise.all([
    readFile(path.join(MODEL_DIR, "tokenizer.json")),
    readFile(path.join(MODEL_DIR, "thresholds.json")),
  ]);
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/tokenizer.json")) return new Response(tokenizer);
    if (url.endsWith("/thresholds.json")) return new Response(thresholds);
    if (url.endsWith(".onnx")) return new Response(new Uint8Array(64).fill(7));
    if (url.endsWith(".wasm")) return new Response(new Uint8Array(8));
    return new Response(null, { status: 404 });
  };

  const stored = new Map();
  globalThis.caches = {
    async open() {
      return {
        async match(url) {
          const hit = stored.get(String(url));
          return hit ? new Response(hit) : undefined;
        },
        async put(url, response) {
          stored.set(String(url), new Uint8Array(await response.arrayBuffer()));
        },
      };
    },
  };
  return { thresholds: JSON.parse(thresholds), stored };
}

// A runner whose messages can be read one check at a time, from the first message to done.
function checker(createRunner) {
  const messages = [];
  let finish = null;
  const runner = createRunner((message) => {
    messages.push(message);
    if (message.type === "done" || message.type === "error") finish?.(message);
  });
  async function check(blocks, { words = false } = {}) {
    messages.length = 0;
    const finished = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("the model never finished")), 120_000);
      finish = (message) => {
        clearTimeout(timer);
        resolve(message);
      };
    });
    const id = `check-${Math.random().toString(36).slice(2)}`;
    runner.handle({
      type: "check",
      id,
      blocks: blocks.map((text, index) =>
        (words ? { index, text, words: (text.match(/\S+/g) ?? []).length } : { index, text })),
    });
    return { messages, last: await finished };
  }
  return { runner, check, messages };
}

test("a check walks every block through the model", async (t) => {
  if (!await hasWeights()) {
    t.skip(`no weights at ${MODEL_DIR}`);
    return;
  }
  const { thresholds, stored } = await prepare();
  const warnings = [];
  const warn = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));
  t.after(() => {
    console.warn = warn;
  });
  const { createRunner } = await import("../src/infer.js");

  await t.test("the model loads on WebAssembly when WebGPU gives no adapter", async () => {
    const { check } = checker(createRunner);
    const { messages } = await check([UNIT.repeat(4)]);
    const ready = messages.find((message) => message.type === "model" && message.state === "ready");
    assert.ok(ready, "the model reports itself ready");
    assert.equal(ready.provider, "wasm");
    assert.equal(ready.low, thresholds.low);
    assert.equal(ready.high, thresholds.high);
    assert.deepEqual(ready.calibration, thresholds.calibration);
    assert.ok(warnings.some((warning) => warning.includes("WebGPU")), "WebGPU was tried first");
    assert.equal(stored.size, 1, "the model went into the cache");
  });

  await t.test("the model loads once and stays", async () => {
    const { check } = checker(createRunner);
    const loads = (messages) => messages.filter((message) =>
      message.type === "model" && ["downloading", "starting"].includes(message.state)).length;
    assert.ok(loads((await check([UNIT.repeat(4)])).messages) > 0, "the first check loads it");
    assert.equal(loads((await check([UNIT.repeat(4)])).messages), 0, "the second check reuses it");
  });

  await t.test("total, tokens, progress and block arrive for every block", async () => {
    const { check } = checker(createRunner);
    const blocks = [UNIT.repeat(4), UNIT.repeat(6)];
    const { messages, last } = await check(blocks, { words: true });
    assert.equal(last.type, "done");
    assert.equal(last.blocks, 2);
    assert.equal(last.skipped, 0);
    assert.equal(last.provider, "wasm");
    assert.ok(last.tokens > 0);
    assert.ok(last.inferenceMs >= 0);

    const total = messages.find((message) => message.type === "total");
    assert.equal(total.blocks, 2);
    assert.equal(total.tokens, last.tokens);
    assert.equal(total.low, thresholds.low);
    assert.equal(total.high, thresholds.high);

    for (const index of [0, 1]) {
      const tokens = messages.find((message) => message.type === "tokens" && message.block === index);
      const block = messages.find((message) => message.type === "block" && message.block === index);
      const progress = messages.filter((message) =>
        message.type === "progress" && message.block === index);
      assert.ok(tokens, `block ${index} sent its tokens`);
      assert.ok(block, `block ${index} sent its scores`);
      assert.equal(tokens.starts.length, block.probs.length);
      assert.equal(tokens.ends.length, block.probs.length);
      assert.equal(progress.length, windowsFor(block.probs.length).length);
      assert.ok(progress.every((message) => message.total === total.windows));
      for (let i = 1; i < progress.length; i++) {
        assert.equal(progress[i].done, progress[i - 1].done + 1, "windows report in order");
      }
      // Chrome serializes port messages with JSON, where a typed array arrives as an object of
      // indices and the page cannot iterate it.
      assert.ok(Array.isArray(block.probs), `block ${index} sent a plain array`);
      assert.ok(Array.isArray(progress.at(-1).probs), `block ${index} sent plain progress`);
      for (const p of block.probs) assert.ok(Number.isFinite(p) && p >= 0 && p <= 1);
      assert.ok(Math.max(...block.probs) > 0.9, "the fake session leans AI");
      assert.ok(Math.min(...block.probs) < 0.2, "and leans human on the rest");
      assert.ok(block.words > 30);
    }
    assert.equal(messages.filter((message) => message.type === "progress").at(-1).done, total.windows);
  });

  await t.test("a block bigger than the budget is scored up to it, not dropped", async () => {
    const { check } = checker(createRunner);
    const { messages, last } = await check([UNIT.repeat(300)]);
    assert.equal(last.type, "done");
    assert.equal(last.blocks, 1);
    assert.equal(last.skipped, 0);
    const block = messages.find((message) => message.type === "block");
    assert.equal(block.probs.length, MAX_TOKENS_WASM);
    assert.ok(block.probs.length > WINDOW);
  });

  await t.test("the budget runs out mid-block and the rest is reported as skipped", async () => {
    const { check } = checker(createRunner);
    const blocks = [UNIT.repeat(60), UNIT.repeat(110), UNIT.repeat(60)];
    const { messages, last } = await check(blocks);
    assert.equal(last.type, "done");
    assert.ok(last.blocks < blocks.length, "not every block fit");
    assert.equal(last.skipped, blocks.length - last.blocks);
    assert.ok(last.tokens <= MAX_TOKENS_WASM);
    assert.equal(messages.filter((message) => message.type === "block").length, last.blocks);
  });

  await t.test("a second check waits its turn instead of cutting the first short", async () => {
    const posts = [];
    const runner = createRunner((message) => posts.push(message));
    runner.handle({ type: "check", id: "a", blocks: [{ index: 0, text: UNIT.repeat(4) }] });
    runner.handle({ type: "check", id: "b", blocks: [{ index: 0, text: UNIT.repeat(4) }] });
    for (let tries = 0; tries < 600; tries++) {
      if (posts.some((message) => message.type === "done" && message.id === "b")) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const done = posts.filter((message) => message.type === "done").map((message) => message.id);
    assert.deepEqual(done, ["a", "b"], "both checks finish, in the order they were asked for");
    const lastOfA = posts.findLastIndex((message) => message.id === "a");
    const firstOfB = posts.findIndex((message) => message.id === "b");
    assert.ok(lastOfA < firstOfB, "the second check starts after the first is done");
  });

  await t.test("a cancelled check posts nothing", async () => {
    const posts = [];
    const other = createRunner((message) => posts.push(message));
    other.handle({ type: "check", id: "a", blocks: [{ index: 0, text: UNIT.repeat(4) }] });
    other.handle({ type: "cancel", id: "a" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(posts, []);
  });
});
