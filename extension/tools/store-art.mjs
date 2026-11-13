// Draws the store artwork: the screenshots from `store/sources` framed in a window, with the words
// outside the frame and never over it.
//   node tools/store-art.mjs [side|top] [--without-copy]
//
// Each store takes its own sizes from the same composition: Chrome and AMO at 1280×800, the Mac at
// 2560×1600, and Chrome's two promo tiles are drawn from the icon instead of a shot.

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = /** @type {(file: string, args: string[], options?: { cwd?: string }) =>
  Promise<unknown>} */ (promisify(execFile));

const HERE = path.resolve(import.meta.dirname, "..");
const STORE = path.join(HERE, "store");
const SOURCES = path.join(STORE, "sources");
const ART = path.join(STORE, "art");
const ICON = path.join(HERE, "src", "icons", "icon-128.png");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const MAGICK = "/opt/homebrew/bin/magick";

const SIZE = { width: 1280, height: 800 };
const RETINA = 2;

/** @typedef {{ id: string, source: string, url: string, headline: string[], sub: string,
 *   bullets: string[], crop: [number, number, number, number] }} Shot */

const layouts = process.argv.slice(2).filter((arg) => arg === "side" || arg === "top");
const LAYOUTS = layouts.length ? layouts : ["side", "top"];

const styles = () => `
  * { box-sizing: border-box; }
  body {
    margin: 0; width: ${SIZE.width}px; height: ${SIZE.height}px; overflow: hidden;
    font-family: ui-sans-serif, -apple-system, "SF Pro Text", "Helvetica Neue", Arial, sans-serif;
    color: #0f172a;
    background:
      radial-gradient(900px 620px at 8% -12%, rgba(37, 99, 235, .18), transparent 70%),
      radial-gradient(820px 620px at 100% 112%, rgba(147, 51, 234, .2), transparent 70%),
      linear-gradient(135deg, #f6f9ff 0%, #ffffff 52%, #faf6ff 100%);
  }
  .brand { display: flex; align-items: center; gap: 10px; }
  .brand img { width: 30px; height: 30px; }
  .brand span { font-size: 20px; font-weight: 600; letter-spacing: -.01em; }
  h1 { margin: 26px 0 0; font-size: 46px; line-height: 1.06; letter-spacing: -.025em; }
  h1 em {
    font-style: normal;
    background: linear-gradient(92deg, #2563eb, #9333ea);
    -webkit-background-clip: text; background-clip: text; color: transparent;
  }
  p.sub { margin: 20px 0 0; font-size: 17px; line-height: 1.55; color: #475569; }
  ul { margin: 26px 0 0; padding: 0; list-style: none; }
  li { display: flex; align-items: center; gap: 10px; margin-top: 12px; font-size: 15px; color: #334155; }
  li i {
    width: 18px; height: 18px; border-radius: 50%; flex: none;
    background: linear-gradient(135deg, #2563eb, #9333ea);
  }
  .win {
    background: #fff; border: 1px solid #e6eaf2; border-radius: 14px; overflow: hidden;
    box-shadow: 0 34px 64px -24px rgba(15, 23, 42, .42), 0 12px 26px -14px rgba(15, 23, 42, .24);
  }
  .bar {
    display: flex; align-items: center; gap: 10px; height: 32px; padding: 0 14px;
    background: #f2f5fa; border-bottom: 1px solid #e6eaf2;
  }
  .dots { display: flex; gap: 6px; }
  .dots b { width: 9px; height: 9px; border-radius: 50%; background: #cfd8e6; }
  .url {
    flex: 1; height: 18px; display: flex; align-items: center; padding: 0 8px;
    border-radius: 6px; background: #fff; border: 1px solid #e6eaf2;
    font-size: 10px; color: #7c8798; letter-spacing: .01em;
  }
  .shot { position: relative; overflow: hidden; background: #fff; }
  .shot img { position: absolute; max-width: none; }
`;

/**
 * @param {string} html
 * @param {string} out
 * @param {number} [width]
 * @param {number} [height]
 * @returns {Promise<void>}
 */
async function shoot(html, out, width = SIZE.width, height = SIZE.height) {
  const page = path.join(os.tmpdir(), `aeacus-art-${path.basename(out, ".png")}.html`);
  await fs.writeFile(page, html);
  await run(CHROME, [
    "--headless", "--disable-gpu", "--hide-scrollbars", "--no-sandbox",
    `--force-device-scale-factor=${RETINA}`,
    `--window-size=${width},${height}`,
    "--virtual-time-budget=5000",
    `--screenshot=${out}`,
    `file://${page}`,
  ]);
}

/** Where a cropped piece of a source image lands inside a box of its own size. */
/** @param {number} srcWidth @param {number} srcHeight @param {[number, number, number, number]} crop
 *  @param {number} boxWidth @param {number} boxHeight */
function place(srcWidth, srcHeight, [x, y, w, h], boxWidth, boxHeight) {
  const piece = { x: x * srcWidth, y: y * srcHeight, w: w * srcWidth, h: h * srcHeight };
  const scale = Math.max(boxWidth / piece.w, boxHeight / piece.h);
  return {
    width: srcWidth * scale,
    height: srcHeight * scale,
    left: -(piece.x * scale) - (piece.w * scale - boxWidth) / 2,
    top: -(piece.y * scale) - (piece.h * scale - boxHeight) / 2,
  };
}

/** @param {string} file @returns {Promise<{ width: number, height: number }>} */
async function measure(file) {
  const { stdout } = /** @type {{ stdout: string }} */ (
    await run(MAGICK, ["identify", "-format", "%w %h", file]));
  const [width, height] = stdout.trim().split(" ").map(Number);
  return { width, height };
}

/** @param {{ left: number, top: number, width: number, height: number }} spot @param {string} file */
const image = (spot, file) => `<img src="file://${file}" style="width:${spot.width}px;`
  + `height:${spot.height}px;left:${spot.left}px;top:${spot.top}px">`;

/** @param {{ url: string }} shot @returns {string} */
const windowBar = (shot) => `<div class="bar"><div class="dots"><b></b><b></b><b></b></div>`
  + `<div class="url">${shot.url}</div></div>`;

/** @param {Shot} shot @returns {Promise<string>} */
async function sidePage(shot) {
  const file = path.join(SOURCES, shot.source);
  const size = await measure(file);
  const box = { width: 690, height: 590 };
  const shown = place(size.width, size.height, shot.crop, box.width, box.height - 32);
  return `<!doctype html><meta charset="utf-8"><style>${styles()}
    .page { display: grid; grid-template-columns: 440px 690px; gap: 58px;
      height: 100%; padding: 80px 76px 80px 84px; align-items: center; }
    .win { height: ${box.height + 32}px; }
    .shot { height: ${box.height}px; }</style>
    <div class="page">
      <div>
        <div class="brand"><img src="file://${ICON}"><span>Aeacus</span></div>
        <h1>${shot.headline.map((line, at) => at === shot.headline.length - 1 ? `<em>${line}</em>` : line).join("<br>")}</h1>
        <p class="sub">${shot.sub}</p>
        <ul>${shot.bullets.map((text) => `<li><i></i>${text}</li>`).join("")}</ul>
      </div>
      <div class="win">${windowBar(shot)}<div class="shot">${image(shown, file)}</div></div>
    </div>`;
}

/** @param {Shot} shot @returns {Promise<string>} */
async function topPage(shot) {
  const file = path.join(SOURCES, shot.source);
  const size = await measure(file);
  const box = { width: 1156, height: 556 };
  const shown = place(size.width, size.height, shot.crop, box.width, box.height - 32);
  return `<!doctype html><meta charset="utf-8"><style>${styles()}
    .page { height: 100%; padding: 46px 62px 0; display: flex; flex-direction: column; }
    .head { display: flex; align-items: flex-end; justify-content: space-between; gap: 40px; }
    h1 { margin: 18px 0 0; font-size: 42px; }
    p.sub { margin: 12px 0 0; max-width: 52ch; }
    .win { margin-top: 34px; height: ${box.height + 32}px; }
    .shot { height: ${box.height}px; }</style>
    <div class="page">
      <div class="head">
        <div>
          <div class="brand"><img src="file://${ICON}"><span>Aeacus</span></div>
          <h1>${shot.headline.map((line, at) => at === shot.headline.length - 1 ? `<em>${line}</em>` : line).join("<br>")}</h1>
        </div>
        <p class="sub">${shot.sub}</p>
      </div>
      <div class="win">${windowBar(shot)}<div class="shot">${image(shown, file)}</div></div>
    </div>`;
}

/** @param {number} width @param {number} height @param {number} icon @param {number} type
 *  @param {string} wordmark @returns {string} */
const promoPage = (width, height, icon, type, wordmark) => `<!doctype html><meta charset="utf-8">
  <style>
    body { margin: 0; width: ${width}px; height: ${height}px; overflow: hidden;
      display: flex; align-items: center; justify-content: center; gap: ${icon * 0.28}px;
      font-family: ui-sans-serif, -apple-system, "SF Pro Text", "Helvetica Neue", Arial, sans-serif;
      background:
        radial-gradient(${width * 0.8}px ${height * 1.2}px at 6% -20%, rgba(37, 99, 235, .55), transparent 65%),
        radial-gradient(${width * 0.8}px ${height * 1.2}px at 104% 120%, rgba(168, 85, 247, .6), transparent 66%),
        linear-gradient(135deg, #101a33 0%, #131b3a 50%, #1a1033 100%);
      color: #fff; }
    img { width: ${icon}px; height: ${icon}px; filter: drop-shadow(0 12px 24px rgba(0, 0, 0, .35)); }
    span { font-size: ${type}px; font-weight: 600; letter-spacing: -.02em;
      text-shadow: 0 10px 30px rgba(0, 0, 0, .35); }
  </style>
  <img src="file://${ICON}"><span>${wordmark}</span>`;

/** @type {{ shots: Shot[] }} */
const { shots } = JSON.parse(await fs.readFile(path.join(STORE, "art.json"), "utf8"));

// One folder per layout, since both are rendered to be compared before either goes to a store.
const out = {
  screenshots: path.join(ART, "screenshots"),
  mac: path.join(ART, "mac"),
  promo: path.join(ART, "promo"),
};
for (const dir of Object.values(out)) await fs.mkdir(dir, { recursive: true });

for (const layout of LAYOUTS) {
  const here = {
    screenshots: path.join(ART, layout, "screenshots"),
    mac: path.join(ART, layout, "mac"),
  };
  for (const dir of Object.values(here)) await fs.mkdir(dir, { recursive: true });
  for (const shot of shots) {
    const html = layout === "top" ? await topPage(shot) : await sidePage(shot);
    const retina = path.join(os.tmpdir(), `aeacus-art-${shot.id}-${layout}@2x.png`);
    await shoot(html, retina);
    // Chrome writes the shot at twice the size; the stores want one of each, and no alpha channel.
    await run(MAGICK, [retina, "-alpha", "off", path.join(here.mac, `${shot.id}.png`)]);
    await run(MAGICK, [retina, "-alpha", "off", "-resize", "50%",
      path.join(here.screenshots, `${shot.id}.png`)]);
    console.log(`${layout} ${shot.id}`);
  }
  // One sheet per layout, so the whole set can be judged side by side in one image.
  await run(MAGICK, [
    "montage", ...shots.map((shot) => path.join(here.screenshots, `${shot.id}.png`)),
    "-tile", "2x", "-geometry", "620x388+12+12", "-background", "#0b1020",
    path.join(ART, layout, "contact.png"),
  ]);
}

const small = path.join(os.tmpdir(), "aeacus-promo-small@2x.png");
await shoot(promoPage(440, 280, 88, 34, "Aeacus"), small, 440, 280);
await run(MAGICK, [small, "-alpha", "off", "-resize", "50%", path.join(out.promo, "small-440x280.png")]);

const marquee = path.join(os.tmpdir(), "aeacus-promo-marquee@2x.png");
await shoot(promoPage(1400, 560, 132, 62, "Aeacus"), marquee, 1400, 560);
await run(MAGICK, [marquee, "-alpha", "off", "-resize", "50%",
  path.join(out.promo, "marquee-1400x560.png")]);

console.log(`art ${path.relative(HERE, ART)}`);
