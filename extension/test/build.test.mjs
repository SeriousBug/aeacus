// A browser refuses a whole extension over one missing file, so the build is checked as a browser
// would read it. Skips until `pnpm build` has run.

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const DIST = path.resolve(import.meta.dirname, "..", "dist");
const BROWSERS = ["chrome", "firefox", "safari"];

// Everything a manifest can point a browser at.
function references(manifest) {
  const files = [];
  const push = (...names) => files.push(...names.filter(Boolean));
  push(...Object.values(manifest.icons ?? {}));
  push(...Object.values(manifest.action?.default_icon ?? {}));
  push(manifest.action?.default_popup, manifest.options_ui?.page);
  for (const content of manifest.content_scripts ?? []) push(...(content.js ?? []), ...(content.css ?? []));
  push(...(manifest.background?.scripts ?? []), manifest.background?.service_worker);
  return files;
}

for (const browser of BROWSERS) {
  test(`the ${browser} build is whole`, async (t) => {
    const dir = path.join(DIST, browser);
    if (!existsSync(path.join(dir, "manifest.json"))) {
      t.skip("not built");
      return;
    }
    const manifest = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8"));
    assert.equal(manifest.manifest_version, 3);
    assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
    assert.ok(manifest.host_permissions?.length, "the model's host permissions are there");
    for (const file of references(manifest)) {
      assert.ok(existsSync(path.join(dir, file)), `${file} is missing`);
    }

    // The worker, the ONNX Runtime files it loads and the offscreen document are named in code
    // rather than in the manifest.
    for (const file of ["infer-worker.js", "ort/ort.webgpu.bundle.min.mjs",
      "ort/ort-wasm-simd-threaded.asyncify.wasm"]) {
      assert.ok(existsSync(path.join(dir, file)), `${file} is missing`);
    }
    if (manifest.background?.service_worker) {
      assert.ok(existsSync(path.join(dir, "offscreen.html")), "offscreen.html is missing");
    }

    // A build pointed at a local model server is for trying the weights out, not for shipping.
    if (!process.env.AEACUS_MODEL_BASE) {
      const worker = await readFile(path.join(dir, "infer-worker.js"), "utf8");
      assert.match(worker, /huggingface\.co/, "the model comes from Hugging Face");
      assert.doesNotMatch(worker, /localhost|127\.0\.0\.1/, "no local model server in the build");
    }
  });
}
