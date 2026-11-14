// Loads the built Chrome extension in a throwaway profile, checks the test page the way a person
// would, and reports what the popup and the page ended up showing. It opens a window, since Chrome
// loads no unpacked extension in headless mode.
//   node test/e2e.mjs [--keep]
//
// Google Chrome ignores --load-extension from version 137 on, so CHROME has to name Chromium or
// Chrome for Testing.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { serve } from "./serve.mjs";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const EXTENSION = path.join(HERE, "..", "dist", "chrome");
const FIXTURES = path.join(HERE, "fixtures");
const keep = process.argv.includes("--keep");

const CHROMES = [
  process.env.CHROME,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class Cdp {
  static connect(url) {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      socket.addEventListener("open", () => resolve(new Cdp(socket)));
      socket.addEventListener("error", () => reject(new Error(`couldn't connect to ${url}`)));
    });
  }

  constructor(socket) {
    this.socket = socket;
    this.next = 1;
    this.pending = new Map();
    this.listeners = new Set();
    socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(data);
      const waiting = message.id ? this.pending.get(message.id) : null;
      if (waiting) {
        this.pending.delete(message.id);
        if (message.error) waiting.reject(new Error(message.error.message));
        else waiting.resolve(message.result);
        return;
      }
      for (const listener of this.listeners) listener(message);
    });
  }

  send(method, params = {}, timeout = 120000) {
    const id = this.next++;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${method} timed out`)), timeout);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
    });
  }

  on(listener) {
    this.listeners.add(listener);
  }

  close() {
    this.socket.close();
  }
}

// Site access arrives with a click on the action, and a script cannot make that click. So the
// harness loads a copy of the build that also names the page it serves, and that can read tab URLs
// to find it.
async function loadable(source) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "aeacus-load-"));
  await fs.cp(source, dir, { recursive: true });
  const file = path.join(dir, "manifest.json");
  const manifest = JSON.parse(await fs.readFile(file, "utf8"));
  manifest.host_permissions = [...manifest.host_permissions, "http://127.0.0.1/*"];
  manifest.permissions = [...manifest.permissions, "tabs"];
  await fs.writeFile(file, JSON.stringify(manifest, null, 2));
  return dir;
}

// An unpacked extension is named after the folder it came from, and Chrome writes that name down
// only when it shuts down. Its own page lists what it has loaded, which is where the name is until
// then.
async function extensionId(browser, targets, dir) {
  const page = await browser.send("Target.createTarget", { url: "chrome://extensions-internals" });
  const target = await waitFor("chrome://extensions-internals", async () =>
    (await targets()).find((candidate) => candidate.id === page.targetId), { timeout: 15000 });
  const session = await Cdp.connect(target.webSocketDebuggerUrl);
  const id = await waitFor("the extension to be listed", async () => {
    const text = await evaluate(session, "document.body.innerText").catch(() => "");
    try {
      return JSON.parse(text).find((entry) => entry.path === dir)?.id ?? null;
    } catch {
      return null;
    }
  }, { timeout: 15000, every: 500 });
  session.close();
  await browser.send("Target.closeTarget", { targetId: page.targetId });
  return id;
}

// Nothing runs until the reader asks, so no worker exists at start. Opening the popup in a tab is
// what asks, which wakes one, and the tab is closed again.
async function wake(browser, targets, id) {
  const popup = await browser.send("Target.createTarget", { url: `chrome-extension://${id}/popup.html` });
  const worker = await waitFor("the extension's service worker", async () =>
    (await targets()).find((target) => target.url === `chrome-extension://${id}/background.js`),
    { timeout: 30000 });
  await browser.send("Target.closeTarget", { targetId: popup.targetId });
  return worker;
}

async function evaluate(session, expression, options = {}) {
  const result = await session.send("Runtime.evaluate",
    { expression, awaitPromise: true, returnByValue: true, userGesture: true, ...options });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  }
  return result.result.value;
}

async function waitFor(what, check, { timeout = 600000, every = 1000 } = {}) {
  const until = Date.now() + timeout;
  let last;
  while (Date.now() < until) {
    last = await check();
    if (last) return last;
    await sleep(every);
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function main() {
  const chrome = CHROMES.find((candidate) => existsSync(candidate));
  if (!chrome) throw new Error(`no Chrome found, set CHROME to one: tried ${CHROMES.join(", ")}`);

  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "aeacus-e2e-"));
  const extension = await loadable(EXTENSION);
  const child = spawn(chrome, [
    `--user-data-dir=${profile}`,
    `--load-extension=${extension}`,
    `--disable-extensions-except=${extension}`,
    "--remote-debugging-port=0",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-search-engine-choice-screen",
    "--window-size=1200,900",
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  child.stderr.on("data", () => {});

  const devtools = path.join(profile, "DevToolsActivePort");
  const port = await waitFor("Chrome to start", async () => {
    try {
      return Number((await fs.readFile(devtools, "utf8")).split("\n")[0]) || null;
    } catch {
      return null;
    }
  }, { timeout: 60000, every: 200 });

  const targets = async () => (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const browser = await Cdp.connect((await (await fetch(`http://127.0.0.1:${port}/json/version`)).json())
    .webSocketDebuggerUrl);

  const id = await extensionId(browser, targets, extension);
  console.log(`extension ${id}`);
  const worker = await wake(browser, targets, id);

  const sw = await Cdp.connect(worker.webSocketDebuggerUrl);
  await sw.send("Runtime.enable");
  const logs = [];
  const watch = (name) => (message) => {
    if (message.method === "Runtime.exceptionThrown") {
      logs.push(`${name} exception: ${message.params.exceptionDetails.text} `
        + `${message.params.exceptionDetails.exception?.description ?? ""}`);
    }
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
      logs.push(`${name} console: ${message.params.args.map((a) => a.value ?? a.description).join(" ")}`);
    }
  };
  sw.on(watch("background"));

  const server = await serve(FIXTURES);
  await browser.send("Target.createTarget", { url: `http://127.0.0.1:${server.port}/page.html` });

  const page = await waitFor("the test page", async () => {
    const list = await targets();
    return list.find((target) => target.url.endsWith("/page.html"));
  }, { timeout: 30000 });

  const pageSession = await Cdp.connect(page.webSocketDebuggerUrl);
  await pageSession.send("Runtime.enable");
  pageSession.on(watch("page"));
  const contexts = new Map();
  pageSession.on((message) => {
    if (message.method === "Runtime.executionContextCreated") {
      contexts.set(message.params.context.id, message.params.context);
    }
  });

  await waitFor("the page to finish loading", async () =>
    (await evaluate(pageSession, "document.readyState")) === "complete", { timeout: 30000 });

  const tabs = await evaluate(sw, "chrome.tabs.query({}).then((tabs) => tabs.map((t) => ({ id: t.id, url: t.url })))");
  const tab = tabs.find((candidate) => candidate.url?.endsWith("/page.html"));
  if (!tab) throw new Error(`the test page is not a tab: ${JSON.stringify(tabs)}`);

  // What the background does on the click that opens the popup.
  await evaluate(sw, `chrome.scripting.insertCSS({ target: { tabId: ${tab.id} }, files: ["content.css"] })
    .then(() => chrome.scripting.executeScript({ target: { tabId: ${tab.id}, files: ["content.js"] } }))`);

  // The content script runs in an isolated world, whose origin is the page's; what tells it apart is
  // chrome.runtime, so the contexts are asked.
  const contentContext = await waitFor("the content script", async () => {
    for (const context of contexts.values()) {
      if (context.auxData?.isDefault) continue;
      const probe = await evaluate(pageSession,
        "typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id", { contextId: context.id })
        .catch(() => null);
      if (probe === id) return context;
    }
    return null;
  }, { timeout: 60000 });

  // The popup's own side of the content script's port, so the state a person would see can be read
  // without opening the popup.
  const watching = evaluate(sw, `new Promise((resolve, reject) => {
    const port = chrome.tabs.connect(${tab.id}, { name: "aeacus-popup" });
    const timer = setTimeout(() => resolve({ phase: "timeout" }), 900000);
    port.onMessage.addListener((state) => {
      if (["done", "error", "empty", "unsupported"].includes(state.phase)) {
        clearTimeout(timer);
        resolve(state);
      }
    });
  })`, {});

  const started = Date.now();
  await evaluate(sw, `chrome.tabs.sendMessage(${tab.id}, { type: "run" })`);
  console.log("checking…");

  const state = await watching;
  console.log(`checked in ${Math.round((Date.now() - started) / 1000)}s`);
  if (state.phase !== "done") {
    console.log(JSON.stringify(state, null, 2));
    throw new Error(`the check ended as ${state.phase}: ${state.message ?? ""}`);
  }

  const highlights = await evaluate(pageSession, `(() => {
    const out = {};
    for (const [name, highlight] of CSS.highlights) out[name] = highlight.size;
    return out;
  })()`, { contextId: contentContext.id });

  // What the markers landed on: no range may cover a picture, and none may sit in the nav or the
  // footer of the test page.
  const drawn = await evaluate(pageSession, `(() => {
    const counts = { ranges: 0, overPicture: 0, inChrome: 0 };
    for (const [name, highlight] of CSS.highlights) {
      if (!name.startsWith("aeacus-")) continue;
      for (const range of highlight) {
        counts.ranges++;
        if (range.cloneContents().querySelector("img, picture, video, svg, button, pre, code")) {
          counts.overPicture++;
        }
        const start = range.startContainer;
        const element = start.nodeType === Node.TEXT_NODE ? start.parentElement : start;
        if (element.closest("nav, footer")) counts.inChrome++;
      }
    }
    return counts;
  })()`, { contextId: contentContext.id });

  const offscreen = (await targets()).find((target) => target.url.endsWith("/offscreen.html"));
  const stored = await evaluate(sw, "chrome.storage.local.get(null)");

  const report = {
    summary: state.summary,
    provider: state.provider,
    milliseconds: state.milliseconds,
    highlights,
    drawn,
    offscreenDocument: Boolean(offscreen),
    modelReady: stored.modelReady,
    consoleErrors: logs,
  };
  console.log(JSON.stringify(report, null, 2));

  const problems = [];
  if (!state.summary) problems.push("no summary reached the popup");
  if (!(state.summary?.blocks >= 4)) {
    problems.push(`only ${state.summary?.blocks} blocks were read, and the page has four`);
  }
  if (!(state.summary?.aiShare > 0)) problems.push("nothing on the page was read as AI");
  if (!(state.summary?.humanShare > 0)) problems.push("nothing on the page was read as human");
  if (!Object.keys(highlights).some((name) => name.startsWith("aeacus-ai"))) {
    problems.push("nothing was marked on the page as AI");
  }
  if (!Object.keys(highlights).some((name) => name.startsWith("aeacus-human"))) {
    problems.push("nothing was marked on the page as human");
  }
  if (!(drawn.ranges > 0)) problems.push("no range was drawn");
  if (drawn.overPicture) problems.push(`${drawn.overPicture} markers were drawn over a picture`);
  if (drawn.inChrome) problems.push(`${drawn.inChrome} markers were drawn in the nav or the footer`);
  if (!offscreen) problems.push("the model never got its offscreen document");
  if (!stored.modelReady) problems.push("the model was not marked as downloaded");
  if (logs.length) problems.push(`${logs.length} console errors`);

  server.close();
  browser.close();
  pageSession.close();
  sw.close();
  child.kill();
  if (!keep) {
    for (const dir of [profile, extension]) {
      await fs.rm(dir, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
    }
  }

  if (problems.length) {
    console.error(`\nFAILED:\n  ${problems.join("\n  ")}`);
    process.exitCode = 1;
  } else {
    console.log("\nPASSED");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
  process.exit(1);
});
