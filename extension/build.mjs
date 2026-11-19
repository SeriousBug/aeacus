// Builds the extension for each browser into dist/<browser>/.
//   node build.mjs [chrome] [firefox] [safari]

import fs from "node:fs/promises";
import path from "node:path";
import esbuild from "esbuild";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const SRC = path.join(HERE, "src");
const DIST = path.join(HERE, "dist");
const ORT = path.join(HERE, "node_modules", "onnxruntime-web", "dist");

const TARGETS = process.argv.slice(2).length ? process.argv.slice(2) : ["chrome", "firefox", "safari"];

// Where the model comes from, which the tests point at a local folder to stay off the network.
const MODEL_BASE = process.env.AEACUS_MODEL_BASE ?? "";

const ENTRIES = ["background", "content", "offscreen", "popup", "options", "infer-worker",
  "theme-boot"];

// The web pages, shared by both popup and options.
const PAGES = ["popup.html", "popup.css", "options.html", "options.css", "theme.css"];

// What the inference worker loads at runtime: the ONNX Runtime bundle and the WebAssembly build it
// runs the model on, which have to sit in the package to keep the extension's code its own.
const ORT_FILES = [
  "ort.webgpu.bundle.min.mjs",
  "ort-wasm-simd-threaded.asyncify.mjs",
  "ort-wasm-simd-threaded.asyncify.wasm",
];

const ICONS = [16, 32, 48, 128];

async function version() {
  return JSON.parse(await fs.readFile(path.join(HERE, "package.json"), "utf8")).version;
}

/** @param {string} browser @param {string} number */
async function manifest(browser, number) {
  const base = JSON.parse(await fs.readFile(path.join(HERE, "manifests", "base.json"), "utf8"));
  const extra = JSON.parse(await fs.readFile(path.join(HERE, "manifests", `${browser}.json`), "utf8"));
  const merged = { ...base, ...extra, version: number };
  // A build pointed at another model server needs to be allowed to reach it.
  if (MODEL_BASE) {
    merged.host_permissions = [...merged.host_permissions, `${new URL(MODEL_BASE).origin}/*`];
  }
  return merged;
}

/** @param {string} browser */
async function buildOne(browser) {
  const out = path.join(DIST, browser);
  await fs.rm(out, { recursive: true, force: true });
  await fs.mkdir(path.join(out, "icons"), { recursive: true });
  await fs.mkdir(path.join(out, "ort"), { recursive: true });

  await esbuild.build({
    entryPoints: ENTRIES.map((name) => path.join(SRC, `${name}.js`)),
    outdir: out,
    bundle: true,
    format: "iife",
    platform: "browser",
    target: ["chrome116", "firefox140", "safari17"],
    define: { AEACUS_MODEL_BASE: JSON.stringify(MODEL_BASE) },
    legalComments: "none",
    logLevel: "warning",
  });

  for (const page of PAGES) await fs.copyFile(path.join(SRC, page), path.join(out, page));
  await fs.copyFile(path.join(SRC, "content.css"), path.join(out, "content.css"));
  await fs.copyFile(path.join(SRC, "offscreen.html"), path.join(out, "offscreen.html"));
  for (const size of ICONS) {
    await fs.copyFile(path.join(SRC, "icons", `icon-${size}.png`), path.join(out, "icons", `icon-${size}.png`));
  }
  for (const file of ORT_FILES) await fs.copyFile(path.join(ORT, file), path.join(out, "ort", file));

  const json = await manifest(browser, await version());
  await fs.writeFile(path.join(out, "manifest.json"), `${JSON.stringify(json, null, 2)}\n`);
  console.log(`${browser}: ${path.relative(HERE, out)}`);
}

await fs.mkdir(DIST, { recursive: true });
for (const browser of TARGETS) {
  if (!["chrome", "firefox", "safari"].includes(browser)) {
    console.error(`Unknown browser: ${browser}`);
    process.exitCode = 1;
    continue;
  }
  await buildOne(browser);
}
