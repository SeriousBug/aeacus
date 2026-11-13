// Safari has no unpacked extension to load; its extensions ship inside an app, and this is the
// project that wraps one. Xcode builds the app around dist/safari, so it is not a copy: the page is
// rebuilt by the normal build and the project picks it up.

import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

// execFile's promisified overload drops stdio, which is how the converter's output reaches the
// terminal.
const run = /** @type {(file: string, args: string[], options: { stdio: "inherit" }) =>
  Promise<unknown>} */ (promisify(execFile));

const root = path.resolve(import.meta.dirname, "..");
const project = path.join(root, "safari");
const app = path.join(project, "Aeacus", "Aeacus");
const icons = path.join(app, "Assets.xcassets", "AppIcon.appiconset");
const resources = path.join(app, "Resources");

await run(process.execPath, [path.join(root, "build.mjs")], { stdio: "inherit" });
await run("xcrun", [
  "safari-web-extension-converter", path.join(root, "dist", "safari"),
  "--project-location", project,
  "--app-name", "Aeacus",
  "--bundle-identifier", "dev.bgenc.aeacus",
  "--swift", "--macos-only", "--no-open", "--no-prompt", "--force",
], { stdio: "inherit" });

// The converter fills the app icon set with placeholders; ours carries the same mark as the browser
// action, at every size the set asks for.
const { images } = JSON.parse(await readFile(path.join(icons, "Contents.json"), "utf8"));
for (const image of images) {
  const size = Number.parseInt(image.size, 10) * Number.parseInt(image.scale, 10);
  const source = path.join(root, "src", "icons", `icon-${size}.png`);
  await writeFile(path.join(icons, image.filename), await readFile(source));
}
await writeFile(path.join(resources, "Icon.png"),
  await readFile(path.join(root, "src", "icons", "icon-512.png")));

// The window the app opens only says whether the extension is on. One line above that says what it
// is for.
const html = path.join(resources, "Base.lproj", "Main.html");
const page = await readFile(html, "utf8");
const after = 'alt="Aeacus Icon">';
if (!page.includes(after)) throw new Error(`${html} is not what the converter used to write`);
const lede = "\n    <p class=\"lede\">Aeacus detects which parts of text on a page are likely AI generated, "
  + "and which are likely human written. Everything it reads stays on this Mac.</p>";
if (!page.includes(lede)) {
  await writeFile(html, page.replace(after, after + lede));
}
const style = path.join(resources, "Style.css");
const css = await readFile(style, "utf8");
if (!css.includes(".lede {")) {
  await writeFile(style, `${css}\n.lede {\n    max-width: 34em;\n    margin: 0;\n    opacity: 0.7;\n}\n`);
}
console.log(`safari project ${project}`);
