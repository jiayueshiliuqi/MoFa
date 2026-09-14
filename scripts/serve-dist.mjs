/**
 * 本地模拟「生产部署」：把 dist/ 挂在子路径下（与服务器一致），
 * 用来验证相对路径、PWA 清单、图标、流式对话在子目录部署时都正常。
 *
 * 用法：node scripts/serve-dist.mjs   → 打开 http://localhost:8899/share/MoFa/app/
 */
import http from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, resolve } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = resolve(ROOT, 'dist')
const PREFIX = '/share/MoFa/app'
const PORT = 8899

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
}

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent((req.url ?? '/').split('?')[0])

  if (urlPath === PREFIX || urlPath === `${PREFIX}/`) urlPath = '/index.html'
  else if (urlPath.startsWith(`${PREFIX}/`)) urlPath = urlPath.slice(PREFIX.length)

  const filePath = resolve(DIST, `.${urlPath}`)
  if (!filePath.startsWith(DIST) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    return res.end('not found')
  }

  res.writeHead(200, {
    'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream',
    'Cache-Control': 'no-store',
  })
  createReadStream(filePath).pipe(res)
})

server.listen(PORT, () => {
  console.log(`dist 预览（模拟子目录部署）: http://localhost:${PORT}${PREFIX}/`)
})
