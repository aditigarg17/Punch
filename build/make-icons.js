// Generates the app icon (PNG + ICO) and the tray icons with no image libraries.
// Run: node build/make-icons.js
const zlib = require('zlib'), fs = require('fs'), path = require('path');

function crc32(buf) {
  let c, crc = ~0;
  for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return ~crc >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const segDist = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
};
// colour at a point of the unit square, or null when transparent
function shade(x, y, live) {
  const m = 0.04, r = 0.22, hx = 0.5 - m, qx = Math.abs(x - 0.5) - (hx - r), qy = Math.abs(y - 0.5) - (hx - r);
  const sdf = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
  if (sdf > 0) return null;
  let c = [36 - 10 * y, 87 - 24 * y, 230 - 50 * y];                       // blue gradient
  const d = Math.hypot(x - 0.5, y - 0.5);
  if (d > 0.27 && d < 0.34) c = [255, 255, 255];                           // dial ring
  if (segDist(x, y, 0.5, 0.5, 0.5, 0.28) < 0.032) c = [255, 255, 255];     // minute hand
  if (segDist(x, y, 0.5, 0.5, 0.63, 0.57) < 0.032) c = [255, 255, 255];    // hour hand
  if (d < 0.055) c = [242, 168, 29];                                        // amber hub
  if (live) {
    const dd = Math.hypot(x - 0.77, y - 0.77);
    if (dd < 0.2) c = [255, 255, 255];
    if (dd < 0.155) c = [63, 207, 142];                                     // green "running" dot
  }
  return c;
}
function render(size, live) {
  const S = 4, out = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const c = shade((px + (sx + 0.5) / S) / size, (py + (sy + 0.5) / S) / size, live);
      if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
    }
    const i = (py * size + px) * 4;
    if (a) { out[i] = r / a; out[i + 1] = g / a; out[i + 2] = b / a; out[i + 3] = Math.round(255 * a / (S * S)); }
  }
  return png(size, out);
}

const dir = __dirname;
fs.writeFileSync(path.join(dir, 'icon.png'), render(512, false));
fs.writeFileSync(path.join(dir, 'tray.png'), render(32, false));
fs.writeFileSync(path.join(dir, 'tray-on.png'), render(32, true));
// ICO with embedded PNGs (supported since Windows Vista)
const sizes = [16, 24, 32, 48, 64, 128, 256], imgs = sizes.map(s => render(s, false));
const head = Buffer.alloc(6); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
let off = 6 + 16 * sizes.length;
const dirs = sizes.map((s, i) => { const e = Buffer.alloc(16); e[0] = s === 256 ? 0 : s; e[1] = s === 256 ? 0 : s; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(imgs[i].length, 8); e.writeUInt32LE(off, 12); off += imgs[i].length; return e; });
fs.writeFileSync(path.join(dir, 'icon.ico'), Buffer.concat([head, ...dirs, ...imgs]));
console.log('icons written to', dir);
