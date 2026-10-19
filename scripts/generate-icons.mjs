/**
 * 从设计稿导出 PWA / iOS 图标（纯 Node，无第三方依赖）。
 *
 * 母版放在 scripts/assets/：
 *   icon-1024.png           圆角透明的应用图标
 *   icon-maskable-1024.png  满版（无透明边）的版本，供 maskable / iOS 使用
 *
 * 用法：node scripts/generate-icons.mjs
 * 产物：public/icons/*.png（Vite 构建时复制到 dist）
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { inflateSync, deflateSync } from 'node:zlib'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ASSETS = resolve(HERE, 'assets')
const OUT_DIR = resolve(HERE, '../public/icons')

// ---- 最小 PNG 解码（8bit RGB/RGBA，非隔行） ----
function decodePng(file) {
  const buf = readFileSync(file)
  let off = 8
  let w = 0
  let h = 0
  let depth = 0
  let color = 0
  let interlace = 0
  const idat = []
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      w = data.readUInt32BE(0)
      h = data.readUInt32BE(4)
      depth = data[8]
      color = data[9]
      interlace = data[12]
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    off += 12 + len
  }
  if (depth !== 8 || (color !== 6 && color !== 2) || interlace !== 0) {
    throw new Error(`${file}: 只支持 8bit RGB/RGBA 非隔行 PNG`)
  }
  const raw = inflateSync(Buffer.concat(idat))
  const bpp = color === 6 ? 4 : 3
  const stride = w * bpp
  const out = Buffer.alloc(w * h * 4)
  let prev = Buffer.alloc(stride)
  for (let y = 0; y < h; y++) {
    const base = y * (stride + 1)
    const filter = raw[base]
    const line = Buffer.from(raw.subarray(base + 1, base + 1 + stride))
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0
      const b = prev[i]
      const c = i >= bpp ? prev[i - bpp] : 0
      let v = line[i]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      line[i] = v & 0xff
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4
      const i = x * bpp
      out[o] = line[i]
      out[o + 1] = line[i + 1]
      out[o + 2] = line[i + 2]
      out[o + 3] = bpp === 4 ? line[i + 3] : 255
    }
    prev = line
  }
  return { w, h, data: out }
}

// ---- 面积平均缩放（缩小时不会像最近邻那样丢像素） ----
function resize(src, dw, dh) {
  const { w, h, data } = src
  const tmp = new Float32Array(dw * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < dw; x++) {
      const x0 = (x * w) / dw
      const x1 = ((x + 1) * w) / dw
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let ws = 0
      for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
        const cover = Math.min(x1, sx + 1) - Math.max(x0, sx)
        if (cover <= 0) continue
        const i = (y * w + sx) * 4
        r += data[i] * cover
        g += data[i + 1] * cover
        b += data[i + 2] * cover
        a += data[i + 3] * cover
        ws += cover
      }
      const o = (y * dw + x) * 4
      tmp[o] = r / ws
      tmp[o + 1] = g / ws
      tmp[o + 2] = b / ws
      tmp[o + 3] = a / ws
    }
  }
  const out = Buffer.alloc(dw * dh * 4)
  for (let y = 0; y < dh; y++) {
    const y0 = (y * h) / dh
    const y1 = ((y + 1) * h) / dh
    for (let x = 0; x < dw; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let ws = 0
      for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++) {
        const cover = Math.min(y1, sy + 1) - Math.max(y0, sy)
        if (cover <= 0) continue
        const i = (sy * dw + x) * 4
        r += tmp[i] * cover
        g += tmp[i + 1] * cover
        b += tmp[i + 2] * cover
        a += tmp[i + 3] * cover
        ws += cover
      }
      const o = (y * dw + x) * 4
      out[o] = Math.round(r / ws)
      out[o + 1] = Math.round(g / ws)
      out[o + 2] = Math.round(b / ws)
      out[o + 3] = Math.round(a / ws)
    }
  }
  return { w: dw, h: dh, data: out }
}

// ---- 最小 PNG 编码 ----
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

// ---- 导出 ----
mkdirSync(OUT_DIR, { recursive: true })
const icon = decodePng(resolve(ASSETS, 'icon-1024.png'))
const maskable = decodePng(resolve(ASSETS, 'icon-maskable-1024.png'))

const targets = [
  [icon, 'icon-512.png', 512],
  [icon, 'icon-192.png', 192],
  [icon, 'icon-32.png', 32],
  [maskable, 'apple-touch-icon.png', 180],
  [maskable, 'icon-maskable-512.png', 512],
]
for (const [src, name, size] of targets) {
  const out = resize(src, size, size)
  writeFileSync(resolve(OUT_DIR, name), encodePng(size, size, out.data))
  console.log(`✓ ${name} (${size}×${size})`)
}
console.log(`图标已生成到 ${OUT_DIR}`)
