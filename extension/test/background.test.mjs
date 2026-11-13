// The relay between pages and the one model, with the browser's own API stood up by hand: who gets
// which score, and what happens to a check whose page has gone.

import assert from "node:assert/strict";
import test from "node:test";

function event() {
  const listeners = [];
  return {
    addListener: (listener) => listeners.push(listener),
    fire: (...args) => listeners.map((listener) => listener(...args)),
  };
}

function port(name) {
  return {
    name,
    sent: [],
    onMessage: event(),
    onDisconnect: event(),
    postMessage(message) {
      this.sent.push(message);
    },
  };
}

// Every import of background.js is its own module instance, so each test starts with no ports, no
// owners and no open document. The API itself is loaded once by the modules and held on to, so the
// cases fill this one object in turn instead of replacing it.
const fake = { runtime: {}, offscreen: {}, storage: {}, tabs: {} };
globalThis.browser = fake;

async function load(caseName, { slow = 0 } = {}) {
  const stored = [];
  const connects = [];
  fake.runtime = {
    onConnect: event(),
    connect({ name }) {
      const opened = port(name);
      connects.push(opened);
      return opened;
    },
  };
  fake.offscreen = {
    createDocument: async () => {},
    hasDocument: async () => {
      if (slow) await new Promise((resolve) => setTimeout(resolve, slow));
      return true;
    },
  };
  fake.storage = {
    local: {
      get: async () => ({}),
      set: async (values) => stored.push(values),
      remove: async () => {},
    },
  };
  fake.tabs = { query: async () => [], sendMessage: async () => {} };
  globalThis.self = { location: { href: `file:///tmp/aeacus-bg-${caseName}/infer-worker.js` } };
  await import(`../src/background.js?case=${caseName}`);
  return { api: fake, connects, stored };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const model = (connects) => connects.find((opened) => opened.name === "aeacus-offscreen");

test("a page gets the scores it asked for", async () => {
  const { api, connects, stored } = await load("routing");
  const page = port("aeacus");
  api.runtime.onConnect.fire(page);
  assert.equal(page.sent.at(-1).type, "model", "a new page is told where the model stands");

  page.onMessage.fire({ type: "check", id: "c1", blocks: [{ index: 0, text: "words" }] });
  await tick();
  const host = model(connects);
  assert.deepEqual(host.sent.at(-1),
    { message: { type: "check", id: "c1", blocks: [{ index: 0, text: "words" }] } });

  host.onMessage.fire({ message: { type: "tokens", id: "c1", block: 0, starts: [0], ends: [5] } });
  assert.equal(page.sent.at(-1).type, "tokens");
  assert.equal(page.sent.at(-1).id, "c1");

  host.onMessage.fire({ message: { type: "model", state: "ready", provider: "webgpu" } });
  assert.deepEqual(stored, [{ modelReady: true }], "the model is remembered as downloaded");
  assert.ok(page.sent.some((message) => message.state === "ready"), "every page hears the model");

  host.onMessage.fire({ message: { type: "done", id: "c1" } });
  const after = page.sent.length;
  host.onMessage.fire({ message: { type: "progress", id: "c1", block: 0, from: 0, probs: [0.2] } });
  assert.equal(page.sent.length, after, "a finished check delivers nothing more");
});

test("a page that goes away stops its check", async () => {
  const { api, connects } = await load("leaving");
  const page = port("aeacus");
  api.runtime.onConnect.fire(page);
  page.onMessage.fire({ type: "check", id: "c2", blocks: [{ index: 0, text: "words" }] });
  await tick();
  const host = model(connects);
  assert.equal(host.sent.at(-1).message.type, "check");

  page.onDisconnect.fire();
  await tick();
  assert.deepEqual(host.sent.at(-1), { message: { type: "cancel", id: "c2" } });
});

test("a check is dropped when its page goes away before the model opens", async () => {
  const { api, connects } = await load("opening", { slow: 20 });
  const page = port("aeacus");
  api.runtime.onConnect.fire(page);
  page.onMessage.fire({ type: "check", id: "c4", blocks: [{ index: 0, text: "words" }] });
  page.onDisconnect.fire();
  await new Promise((resolve) => setTimeout(resolve, 60));
  const host = model(connects);
  assert.ok(host, "the model did open");
  assert.deepEqual(host.sent.filter((message) => message.message.type === "check"), [],
    "the check never left for a page that is gone");
});

test("a cancel does not open the model to say there is nothing to cancel", async () => {
  const { api, connects } = await load("cancel");
  const page = port("aeacus");
  api.runtime.onConnect.fire(page);
  page.onMessage.fire({ type: "cancel", id: "c3" });
  await tick();
  assert.deepEqual(connects, [], "no offscreen document was opened");
});

test("two pages are served one after the other", async () => {
  const { api, connects } = await load("tabs");
  const first = port("aeacus");
  const second = port("aeacus");
  api.runtime.onConnect.fire(first);
  api.runtime.onConnect.fire(second);
  first.onMessage.fire({ type: "check", id: "a", blocks: [] });
  second.onMessage.fire({ type: "check", id: "b", blocks: [] });
  await tick();
  const host = model(connects);
  assert.deepEqual(host.sent.map((message) => message.message.id), ["a", "b"]);

  host.onMessage.fire({ message: { type: "block", id: "b", block: 0, probs: [0.9] } });
  assert.equal(first.sent.at(-1).type, "model", "the other page is not sent b's scores");
  assert.equal(second.sent.at(-1).type, "block");
});
