// Packs what the stores take: one zip per browser, with manifest.json at the zip's root, which is
// where the Chrome Web Store and AMO look for it.
//   node tools/pack.mjs [chrome] [firefox]

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = /** @type {(file: string, args: string[], options?: { cwd: string }) =>
  Promise<unknown>} */ (promisify(execFile));

const HERE = path.resolve(import.meta.dirname, "..");
const DIST = path.join(HERE, "dist");
const OUT = path.join(HERE, "artifacts");
const BROWSERS = process.argv.slice(2).length ? process.argv.slice(2) : ["chrome", "firefox"];

const { version } = JSON.parse(await fs.readFile(path.join(HERE, "package.json"), "utf8"));

await run(process.execPath, [path.join(HERE, "build.mjs"), ...BROWSERS]);
await fs.mkdir(OUT, { recursive: true });

for (const browser of BROWSERS) {
  const zip = path.join(OUT, `aeacus-${browser}-${version}.zip`);
  await fs.rm(zip, { force: true });
  // Zipped from inside the build, so the archive holds the extension's own files and not a folder
  // holding them. -X leaves the zip without the times and owners that would change every build.
  await run("zip", ["-r", "-X", "-q", zip, "."], { cwd: path.join(DIST, browser) });
  const { size } = await fs.stat(zip);
  console.log(`${path.relative(HERE, zip)} ${(size / 1e6).toFixed(1)} MB`);
}
