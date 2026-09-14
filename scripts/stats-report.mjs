/**
 * 使用统计报告：解析 nginx 访问日志，统计「APK 下载量」与「使用人数」。
 *
 * 用法（在服务器或本地都能跑）：
 *   node scripts/stats-report.mjs /var/log/nginx/access.log
 *   node scripts/stats-report.mjs /var/log/nginx/mofa-stats.log /var/log/nginx/access.log
 *   zcat /var/log/nginx/access.log*.gz | node scripts/stats-report.mjs -   # 读标准输入
 *
 * 需要 nginx 有这两条日志（见 README「统计使用情况」）：
 *   1. APK 下载 —— 常规 access.log 即可
 *   2. 启动上报 —— /share/MoFa/stats/ 单独记一份日志（便于筛选）
 */
import { createReadStream, existsSync } from 'node:fs'
import { createInterface } from 'node:readline'

const MONTHS = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
}

// nginx 默认 combined 格式
const LINE_RE = /^(\S+) \S+ \S+ \[([^\]]+)\] "(\S+) ([^"]*?) [^"]*" (\d{3}) /

function parseTime(s) {
  // 14/Sep/2026:10:00:00 +0800
  const m = /^(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})/.exec(s)
  if (!m) return null
  return new Date(Number(m[3]), MONTHS[m[2]] ?? 0, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6]))
}

const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

async function* lines(sources) {
  for (const src of sources) {
    if (src === '-') {
      const rl = createInterface({ input: process.stdin })
      for await (const l of rl) yield l
      continue
    }
    if (!existsSync(src)) {
      console.error(`⚠️  文件不存在，跳过: ${src}`)
      continue
    }
    const rl = createInterface({ input: createReadStream(src), crlfDelay: Infinity })
    for await (const l of rl) yield l
  }
}

const sources = process.argv.slice(2)
if (!sources.length) {
  console.error('用法: node scripts/stats-report.mjs <日志文件...>   （用 - 读标准输入）')
  process.exit(1)
}

// ---- 聚合 ----
const downloads = [] // { ip, file, time }
const hits = [] // { id, version, platform, time }

for await (const line of lines(sources)) {
  const m = LINE_RE.exec(line)
  if (!m) continue
  const [, ip, timeStr, method, url, status] = m
  const time = parseTime(timeStr)
  if (!time) continue

  // 启动上报：无论返回什么状态码都计入（未配置专用 location 时是 404，请求一样有效）
  if (url.includes('/stats/hit')) {
    const q = new URLSearchParams(url.split('?')[1] ?? '')
    if (q.get('e') !== 'open') continue
    hits.push({
      id: q.get('id') ?? 'unknown',
      version: q.get('v') ?? '?',
      platform: q.get('p') ?? '?',
      time,
    })
    continue
  }

  // APK 下载：只认可成功响应（200/206），排除被打断的请求
  if (status !== '200' && status !== '206') continue
  if (/\.apk(\?|$)/i.test(url)) {
    const file = decodeURIComponent(url.split('?')[0].split('/').pop() ?? '')
    downloads.push({ ip, file, time })
  }
}

// ---- 报告 ----
const today = dayKey(new Date())
const daysAgo = (n) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return dayKey(d)
}

const pad = (s, n) => String(s).padEnd(n)
const uniq = (arr) => new Set(arr)

console.log('\n════════ MoFa 统计报告 ════════\n')

console.log('【APK 下载】')
if (!downloads.length) {
  console.log('  未发现下载记录')
} else {
  console.log(`  总下载次数：${downloads.length}`)
  console.log(`  独立 IP 数：${uniq(downloads.map((d) => d.ip)).size}`)
  const byFile = {}
  for (const d of downloads) byFile[d.file] = (byFile[d.file] ?? 0) + 1
  console.log('  按文件：')
  for (const [f, c] of Object.entries(byFile).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${pad(f, 28)} ${c} 次`)
  }
  console.log(`  今日下载：${downloads.filter((d) => dayKey(d.time) === today).length} 次`)
}

console.log('\n【使用人数（启动上报）】')
if (!hits.length) {
  console.log('  未发现上报记录（检查 nginx 是否已配置 /stats/ 并记录日志）')
} else {
  const installs = uniq(hits.map((h) => h.id))
  console.log(`  累计安装数（唯一 ID）：${installs.size}`)
  console.log(`  今日活跃：${uniq(hits.filter((h) => dayKey(h.time) === today).map((h) => h.id)).size} 人`)
  const week = uniq(
    hits.filter((h) => h.time >= new Date(Date.now() - 7 * 864e5)).map((h) => h.id),
  )
  console.log(`  近 7 日活跃：${week.size} 人`)
  console.log(`  总启动次数：${hits.length} 次`)

  const group = (key) => {
    const m = {}
    for (const h of hits) m[h[key]] = (m[h[key]] ?? 0) + 1
    return Object.entries(m).sort((a, b) => b[1] - a[1])
  }
  console.log('  平台分布：')
  for (const [p, c] of group('platform')) console.log(`    ${pad(p, 16)} ${c} 次启动`)
  console.log('  版本分布：')
  for (const [v, c] of group('version')) console.log(`    ${pad(v, 16)} ${c} 次启动`)
}

console.log('\n提示：想按日期看趋势，把日志按天切分后分别运行本脚本即可；')
console.log('      想要图形化面板可以在服务器安装 goaccess 直接分析同一份日志。\n')
