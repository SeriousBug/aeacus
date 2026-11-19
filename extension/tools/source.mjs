// Packs the source AMO asks for beside the add-on it builds: the extension's own files, the tokenizer
// it shares with the website and the CLI, the license, and a README saying how to build it.
//   node tools/source.mjs

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = /** @type {(file: string, args: string[], options?: { cwd: string }) =>
  Promise<{ stdout: string }>} */ (promisify(execFile));

const HERE = path.resolve(import.meta.dirname, "..");
const UP = path.resolve(HERE, "..");
const OUT = path.join(HERE, "artifacts");

const { version } = JSON.parse(await fs.readFile(path.join(HERE, "package.json"), "utf8"));
const NAME = `aeacus-${version}-source`;

// What `pnpm install --frozen-lockfile && pnpm build firefox` reads, and nothing it does not: no
// node_modules, no dist, no store artwork, no tests.
const PACKED = [".gitignore", "README.md", "build.mjs", "eslint.config.js", "manifests",
  "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "src", "tsconfig.json",
  "tsconfig.tools.json"];
const SHARED = ["LICENSE", "shared/tokenizer.js"];

const work = await fs.mkdtemp(path.join(os.tmpdir(), "aeacus-source-"));
const root = path.join(work, NAME);
await fs.mkdir(path.join(root, "extension"), { recursive: true });
for (const entry of PACKED) {
  await fs.cp(path.join(HERE, entry), path.join(root, "extension", entry), { recursive: true });
}
for (const entry of SHARED) {
  await fs.cp(path.join(UP, entry), path.join(root, entry), { recursive: true });
}

// The archive's README is the one file in it that is not source, and it names the versions the pack
// ran on, which are the ones the build is known to work with.
const template = await fs.readFile(path.join(HERE, "docs", "amo-source.md"), "utf8");
const pnpm = (await run("pnpm", ["--version"])).stdout.trim();
await fs.writeFile(path.join(root, "README.md"), template
  .replaceAll("{{version}}", version)
  .replaceAll("{{node}}", process.version.replace(/^v/, ""))
  .replaceAll("{{pnpm}}", pnpm));

await fs.mkdir(OUT, { recursive: true });
const zip = path.join(OUT, `${NAME}.zip`);
await fs.rm(zip, { force: true });
await run("zip", ["-r", "-X", "-q", zip, NAME], { cwd: work });
const { size } = await fs.stat(zip);
console.log(`${path.relative(HERE, zip)} ${(size / 1e3).toFixed(0)} kB`);
await fs.rm(work, { recursive: true, force: true });
