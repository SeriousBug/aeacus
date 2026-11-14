// Draws the store artwork: the screenshots from `store/sources` framed in a window, with the words
// outside the frame and never over it.
//   node tools/store-art.mjs
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
 *   note?: string, crop: [number, number, number, number] }} Shot */

const styles = () => `  * { box-sizing: border-box; }
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
  p.note { margin: 14px 0 0; font-size: 14px; line-height: 1.5; color: #8592a6; }
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

// Where a source image lands inside the window. The crop's width is scaled to the frame the layout
// gives it, and the page is anchored at the frame's top left, so a crop only ever takes from the
// right and the bottom: the page's own top and left edge stay where the page put them.
/**
 * @param {number} srcWidth
 * @param {number} srcHeight
 * @param {[number, number, number, number]} crop
 * @param {number} frame
 */
function place(srcWidth, srcHeight, [x, y, w, h], frame) {
  const scale = frame / (w * srcWidth);
  return {
    width: srcWidth * scale,
    height: srcHeight * scale,
    frame,
    frameHeight: h * srcHeight * scale,
    left: -x * srcWidth * scale,
    top: -y * srcHeight * scale,
  };
}

/** @param {string} file @returns {Promise<{ width: number, height: number }>} */
async function measure(file) {
  const { stdout } = /** @type {{ stdout: string }} */ (
    await run(MAGICK, ["identify", "-format", "%w %h", file]));
  const [width, height] = stdout.trim().split(" ").map(Number);
  return { width, height };
}

/** @param {{ left: number, top: number, width: number, height: number }} spot
 *  @param {string} file */
const image = (spot, file) => `<img src="file://${file}" style="width:${spot.width}px;`
  + `height:${spot.height}px;left:${spot.left}px;top:${spot.top}px">`;

/** @param {{ url: string }} shot @returns {string} */
const windowBar = (shot) => `<div class="bar"><div class="dots"><b></b><b></b><b></b></div>`
  + `<div class="url">${shot.url}</div></div>`;

// The words all sit outside the frame: the last line of the headline carries the gradient, and the
// note is for the sentence a shot wants on a line of its own.
/** @param {Shot} shot @returns {string} */
const headline = (shot) => `<h1>${shot.headline
  .map((line, at) => at === shot.headline.length - 1 ? `<em>${line}</em>` : line)
  .join("<br>")}</h1>`;

/** @param {Shot} shot @returns {string} */
const say = (shot) => `<p class="sub">${shot.sub}</p>`
  + (shot.note ? `<p class="note">${shot.note}</p>` : "");

/** @param {Shot} shot @returns {Promise<string>} */
async function pageOf(shot) {
  const file = path.join(SOURCES, shot.source);
  const size = await measure(file);
  const shown = place(size.width, size.height, shot.crop, 744);
  return `<!doctype html><meta charset="utf-8"><style>${styles()}
    .page { display: flex; gap: 32px; height: 100%; padding: 46px 34px 46px 54px;
      align-items: center; }
    .copy { width: 404px; flex: none; }
    h1 { font-size: 38px; }
    p.sub { font-size: 16px; }
    .win { width: ${Math.round(shown.frame)}px;
      height: ${Math.round(shown.frameHeight) + 32}px; flex: none; }
    .shot { height: ${Math.round(shown.frameHeight)}px; }</style>
    <div class="page">
      <div class="copy">
        <div class="brand"><img src="file://${ICON}"><span>Aeacus</span></div>
        ${headline(shot)}
        ${say(shot)}
      </div>
      <div class="win">${windowBar(shot)}<div class="shot">${image(shown, file)}</div></div>
    </div>`;
}

/** @param {{ width: number, height: number, icon: number, type: number, tagline: string,
 *    taglineSize: number }} promo @returns {string} */
const promoPage = ({ width, height, icon, type, tagline, taglineSize }) => `<!doctype html><meta charset="utf-8">
  <style>
    body { margin: 0; width: ${width}px; height: ${height}px; overflow: hidden;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: ${Math.round(icon * 0.3)}px;
      font-family: ui-sans-serif, -apple-system, "SF Pro Text", "Helvetica Neue", Arial, sans-serif;
      background:
        radial-gradient(${width * 0.8}px ${height * 1.2}px at 6% -20%, rgba(37, 99, 235, .55), transparent 65%),
        radial-gradient(${width * 0.8}px ${height * 1.2}px at 104% 120%, rgba(168, 85, 247, .6), transparent 66%),
        linear-gradient(135deg, #101a33 0%, #131b3a 50%, #1a1033 100%);
      color: #fff; }
    .mark { display: flex; align-items: center; gap: ${Math.round(icon * 0.28)}px; }
    img { width: ${icon}px; height: ${icon}px; filter: drop-shadow(0 12px 24px rgba(0, 0, 0, .35)); }
    .mark span { font-size: ${type}px; font-weight: 600; letter-spacing: -.02em;
      text-shadow: 0 10px 30px rgba(0, 0, 0, .35); }
    p { margin: 0; max-width: ${Math.round(width * 0.72)}px; text-align: center;
      font-size: ${taglineSize}px; line-height: 1.35; color: rgba(255, 255, 255, .82); }
  </style>
  <div class="mark"><img src="file://${ICON}"><span>Aeacus</span></div>
  <p>${tagline}</p>`;

/** @type {{ shots: Shot[], promo: { tagline: string } }} */
const { shots, promo } = JSON.parse(await fs.readFile(path.join(STORE, "art.json"), "utf8"));

const out = {
  screenshots: path.join(ART, "screenshots"),
  mac: path.join(ART, "mac"),
  promo: path.join(ART, "promo"),
};
for (const dir of Object.values(out)) await fs.mkdir(dir, { recursive: true });

for (const shot of shots) {
  const retina = path.join(os.tmpdir(), `aeacus-art-${shot.id}@2x.png`);
  await shoot(await pageOf(shot), retina);
  // Chrome writes the shot at twice the size; the stores want one of each, and no alpha channel.
  await run(MAGICK, [retina, "-alpha", "off", path.join(out.mac, `${shot.id}.png`)]);
  await run(MAGICK, [retina, "-alpha", "off", "-resize", "50%",
    path.join(out.screenshots, `${shot.id}.png`)]);
  console.log(`art ${shot.id}`);
}

// One sheet, so the whole set can be judged side by side in one image.
await run(MAGICK, [
  "montage", ...shots.map((shot) => path.join(out.screenshots, `${shot.id}.png`)),
  "-tile", "2x", "-geometry", "620x388+12+12", "-background", "#0b1020",
  path.join(ART, "contact.png"),
]);

const small = path.join(os.tmpdir(), "aeacus-promo-small@2x.png");
await shoot(promoPage({ width: 440, height: 280, icon: 76, type: 32, tagline: promo.tagline,
  taglineSize: 15 }), small, 440, 280);
await run(MAGICK, [small, "-alpha", "off", "-resize", "50%", path.join(out.promo, "small-440x280.png")]);

const marquee = path.join(os.tmpdir(), "aeacus-promo-marquee@2x.png");
await shoot(promoPage({ width: 1400, height: 560, icon: 116, type: 58, tagline: promo.tagline,
  taglineSize: 30 }), marquee, 1400, 560);
await run(MAGICK, [marquee, "-alpha", "off", "-resize", "50%",
  path.join(out.promo, "marquee-1400x560.png")]);

console.log(`art ${path.relative(HERE, ART)}`);
