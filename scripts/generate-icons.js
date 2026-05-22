// 앱 아이콘/스플래시 PNG 생성기 (의존성 0: Node 내장 zlib)
// 실행: node scripts/generate-icons.js  → assets/icon.png(1024), assets/splash.png(2732)
// 이후 모바일에서: npx @capacitor/assets generate  (전 해상도 자동 생성)
"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const OUT = path.join(__dirname, "..", "assets");
fs.mkdirSync(OUT, { recursive: true });

// --- CRC32 (PNG 청크용) ---
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crcBuf]);
}
function encodePNG(size, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8bit, RGBA
  // 스캔라인마다 필터바이트(0) 추가
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

// --- 드로잉 ---
function scene(size, monScale) {
  const buf = Buffer.alloc(size * size * 4);
  const set = (x, y, r, g, b, a = 255) => {
    x |= 0; y |= 0; if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4; buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a;
  };
  const mix = (a, b, t) => Math.round(a + (b - a) * t);
  const cx = size / 2, cy = size / 2;
  const maxd = Math.hypot(cx, cy);

  // 배경: 중앙 밝은 보라 → 가장자리 어두운 남색 (radial)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const t = Math.min(1, Math.hypot(x - cx, y - cy) / maxd);
    set(x, y, mix(42, 15, t), mix(44, 16, t), mix(82, 32, t));
  }

  const fillCircle = (ox, oy, rad, r, g, b) => {
    for (let y = oy - rad; y <= oy + rad; y++) for (let x = ox - rad; x <= ox + rad; x++) {
      const d = Math.hypot(x - ox, y - oy);
      if (d <= rad) { const e = Math.min(1, rad - d); set(x, y, r, g, b, Math.round(255 * (e < 1 ? e : 1))); }
    }
  };

  const R = size * monScale;
  const my = cy - R * 0.05;
  // 그림자
  fillCircle(cx, my + R * 0.12, R * 1.02, 10, 10, 22);
  // 몸통 (accent 핑크/레드)
  fillCircle(cx, my, R, 255, 93, 115);
  // 뿔 2개 (어두운 accent) — 머리 위 삼각형
  const horn = (hx, dir) => {
    const hw = R * 0.28, hh = R * 0.42, by = my - R * 0.78;
    for (let y = 0; y < hh; y++) {
      const w = hw * (1 - y / hh);
      for (let x = -w; x < w; x++) set(hx + x + dir * R * 0.02, by - y + hh, 192, 57, 91);
    }
  };
  horn(cx - R * 0.45, -1); horn(cx + R * 0.45, 1);
  // 큰 외눈 (흰자)
  fillCircle(cx, my - R * 0.08, R * 0.46, 245, 247, 255);
  // 동공 (남색)
  fillCircle(cx, my - R * 0.02, R * 0.22, 15, 16, 40);
  // 하이라이트
  fillCircle(cx - R * 0.08, my - R * 0.12, R * 0.07, 255, 255, 255);
  // 입 (작은 어두운 호 — 사다리꼴로 근사)
  for (let y = 0; y < R * 0.14; y++) {
    const w = R * 0.26 * (1 - y / (R * 0.14)) + R * 0.05;
    for (let x = -w; x < w; x++) set(cx + x, my + R * 0.42 + y, 120, 30, 48);
  }
  return buf;
}

function write(name, size, monScale) {
  const png = encodePNG(size, scene(size, monScale));
  const p = path.join(OUT, name);
  fs.writeFileSync(p, png);
  console.log(`${name}  ${size}x${size}  ${(png.length / 1024).toFixed(0)}KB`);
}

write("icon.png", 1024, 0.34);    // 앱 아이콘
write("splash.png", 2732, 0.12);  // 스플래시(중앙 로고 작게)
console.log("완료 → assets/  (모바일: npx @capacitor/assets generate)");
