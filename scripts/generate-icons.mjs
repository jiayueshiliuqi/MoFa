/**
 * 生成 PWA / iOS 主屏幕图标（纯 Node 实现，无需图形库）。
 * 用法：node scripts/generate-icons.mjs
 * 产物：public/icons/*.png（Vite 构建时复制到 dist）
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../public/icons')

// ---- 最小 PNG 编码器 ----
const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const stride = width * 4
  const raw = Buffer.alloc(height * (1 + stride))
  for (let y = 0; y < height; y++) {
    raw[y * (1 + stride)] = 0 // filter: none
    rgba.copy(raw, y * (1 + stride) + 1, y * stride, (y + 1) * stride)
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ---- 绘制 ----
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
const lerp = (a, b, t) => a + (b - a) * t
/** 距离 d 处、半径 r 的圆的抗锯齿覆盖率 */
const disc = (d, r, px) => clamp01((r - d) / px + 0.5)

function drawIcon(size) {
  const px = 1 / size
  const buf = Buffer.alloc(size * size * 4)
  // 品牌色渐变（与 App 内 accent 一致）
  const c1 = [0xe8, 0x5f, 0x5a]
  const c2 = [0xb8, 0x2f, 0x2c]
  const DOT_R = 0.165
  const RING_R = 0.262
  const RING_W = 0.03

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = (x + 0.5) / size
      const cy = (y + 0.5) / size
      const t = clamp01((cx + cy) / 2)

      let r = lerp(c1[0], c2[0], t)
      let g = lerp(c1[1], c2[1], t)
      let b = lerp(c1[2], c2[2], t)

      const d = Math.hypot(cx - 0.5, cy - 0.5)
      // 中心实心圆（白）
      const aDot = disc(d, DOT_R, px)
      // 外圈细环（半透明白）
      const aRing = (1 - disc(d, RING_R - RING_W, px)) * disc(d, RING_R, px) * 0.42
      const a = clamp01(aDot + aRing)

      r = lerp(r, 255, a)
      g = lerp(g, 255, a)
      b = lerp(b, 255, a)

      const i = (y * size + x) * 4
      buf[i] = Math.round(r)
      buf[i + 1] = Math.round(g)
      buf[i + 2] = Math.round(b)
      buf[i + 3] = 255
    }
  }
  return encodePng(size, size, buf)
}

mkdirSync(OUT_DIR, { recursive: true })
const targets = [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
  ['icon-32.png', 32],
]
for (const [name, size] of targets) {
  writeFileSync(resolve(OUT_DIR, name), drawIcon(size))
  console.log(`✓ ${name} (${size}×${size})`)
}
console.log(`图标已生成到 ${OUT_DIR}`)
