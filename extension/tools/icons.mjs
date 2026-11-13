// Draws the extension's icons: the same two bars as the website's favicon, blue for a person's
// writing and purple for AI's. Pure Node, so the icons can be rebuilt without any image tooling.
//   node tools/icons.mjs

import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(HERE, "..", "src", "icons");

const HUMAN = [37, 99, 235];
const AI = [147, 51, 234];
const SAMPLES = 4;

const inside = (x, y, x0, y0, x1, y1, radius) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + radius), x1 - radius);
  const cy = Math.min(Math.max(y, y0 + radius), y1 - radius);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius
    || (x >= x0 + radius && x <= x1 - radius)
    || (y >= y0 + radius && y <= y1 - radius);
};

function draw(size) {
  const scale = size * SAMPLES;
  const margin = Math.round(scale * 0.12);
  const gap = Math.round(scale * 0.1);
  const width = Math.max(1, Math.round((scale - margin * 2 - gap) / 2));
  const radius = Math.max(1, Math.round(width * 0.34));
  const bars = [
    { colour: HUMAN, x0: margin, x1: margin + width },
    { colour: AI, x0: margin + width + gap, x1: margin + width + gap + width },
  ];
  const buffer = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const px = x * SAMPLES + sx + 0.5;
          const py = y * SAMPLES + sy + 0.5;
          for (const bar of bars) {
            if (!inside(px, py, bar.x0, margin, bar.x1, scale - margin, radius)) continue;
            r += bar.colour[0];
            g += bar.colour[1];
            b += bar.colour[2];
            a += 255;
          }
        }
      }
      const total = SAMPLES * SAMPLES;
      const offset = (y * size + x) * 4;
      if (a > 0) {
        buffer[offset] = Math.round(r / (a / 255));
        buffer[offset + 1] = Math.round(g / (a / 255));
        buffer[offset + 2] = Math.round(b / (a / 255));
        buffer[offset + 3] = Math.round(a / total);
      }
    }
  }
  return buffer;
}

const CRC = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return (buffer) => {
    let c = -1;
    for (const byte of buffer) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
})();

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(CRC(body));
  return Buffer.concat([length, body, crc]);
}

function png(pixels, size) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

await fs.mkdir(OUT, { recursive: true });
for (const size of [16, 32, 48, 64, 128, 256, 512, 1024]) {
  const file = path.join(OUT, `icon-${size}.png`);
  await fs.writeFile(file, png(draw(size), size));
  console.log(`${file} ${size}×${size}`);
}
