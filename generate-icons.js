/**
 * Run with: node generate-icons.js
 * Generates simple PNG icons for the extension.
 * Requires: npm install canvas  (or uses built-in if available)
 * 
 * If canvas is unavailable, this script falls back to creating minimal
 * 1x1 PNG placeholders that Chrome will accept.
 */

const fs = require('fs');
const path = require('path');

const sizes = [16, 32, 48, 128];
const outDir = path.join(__dirname, 'icons');

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

// Minimal valid 1×1 transparent PNG (68 bytes), scaled conceptually.
// We'll use a proper approach: generate an SVG then convert, OR
// create a proper PNG with pure Node.js using raw PNG bytes.

function createPNG(size) {
  // We create a simple PNG with a solid purple/indigo gradient icon.
  // Using raw PNG structure (zlib deflate of raw pixel data).
  const { createCanvas } = (() => {
    try { return require('canvas'); } catch { return null; }
  })() || {};

  if (createCanvas) {
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext('2d');

    // Background gradient
    const grad = ctx.createLinearGradient(0, 0, size, size);
    grad.addColorStop(0, '#6c63ff');
    grad.addColorStop(1, '#a78bfa');
    ctx.fillStyle = grad;

    // Rounded rect background
    const r = size * 0.22;
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(size - r, 0);
    ctx.quadraticCurveTo(size, 0, size, r);
    ctx.lineTo(size, size - r);
    ctx.quadraticCurveTo(size, size, size - r, size);
    ctx.lineTo(r, size);
    ctx.quadraticCurveTo(0, size, 0, size - r);
    ctx.lineTo(0, r);
    ctx.quadraticCurveTo(0, 0, r, 0);
    ctx.closePath();
    ctx.fill();

    // Target emoji-style icon
    const cx = size / 2;
    const cy = size / 2;
    const outer = size * 0.38;
    const mid   = size * 0.24;
    const inner = size * 0.12;

    // Outer ring
    ctx.strokeStyle = 'white';
    ctx.lineWidth = size * 0.06;
    ctx.beginPath();
    ctx.arc(cx, cy, outer, 0, Math.PI * 2);
    ctx.stroke();

    // Middle ring
    ctx.lineWidth = size * 0.05;
    ctx.beginPath();
    ctx.arc(cx, cy, mid, 0, Math.PI * 2);
    ctx.stroke();

    // Inner dot
    ctx.fillStyle = 'white';
    ctx.beginPath();
    ctx.arc(cx, cy, inner, 0, Math.PI * 2);
    ctx.fill();

    return canvas.toBuffer('image/png');
  }

  // Fallback: return a minimal valid PNG (purple 1px, Chrome scales it)
  return minimalPNG();
}

function minimalPNG() {
  // A valid 16x16 single-color PNG for fallback
  const pngHeader = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  
  function crc32(buf) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) {
      crc = crc ^ buf[i];
      for (let j = 0; j < 8; j++) {
        crc = (crc & 1) ? (0xEDB88320 ^ (crc >>> 1)) : (crc >>> 1);
      }
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function chunk(type, data) {
    const typeBytes = Buffer.from(type, 'ascii');
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const crcData = Buffer.concat([typeBytes, data]);
    const crcVal = Buffer.alloc(4);
    crcVal.writeUInt32BE(crc32(crcData), 0);
    return Buffer.concat([len, typeBytes, data, crcVal]);
  }

  const zlib = require('zlib');
  const size = 16;

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.writeUInt8(8, 8);  // bit depth
  ihdr.writeUInt8(2, 9);  // color type RGB
  ihdr.writeUInt8(0, 10); // compression
  ihdr.writeUInt8(0, 11); // filter
  ihdr.writeUInt8(0, 12); // interlace

  // Raw pixel data: purple color
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(size * 3 + 1);
    row[0] = 0; // filter type: None
    for (let x = 0; x < size; x++) {
      row[1 + x * 3 + 0] = 108; // R (purple)
      row[1 + x * 3 + 1] = 99;  // G
      row[1 + x * 3 + 2] = 255; // B
    }
    rows.push(row);
  }
  const rawPixels = Buffer.concat(rows);
  const compressed = zlib.deflateSync(rawPixels, { level: 9 });

  const png = Buffer.concat([
    pngHeader,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);

  return png;
}

// Generate icons
sizes.forEach(size => {
  try {
    const png = createPNG(size);
    const filePath = path.join(outDir, `icon${size}.png`);
    fs.writeFileSync(filePath, png);
    console.log(`✓ Generated icon${size}.png`);
  } catch (err) {
    console.error(`✗ Failed to generate icon${size}.png:`, err.message);
  }
});

console.log('\nIcons generated. You can replace them with your own PNG files.');
