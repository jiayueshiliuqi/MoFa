/**
 * README 截图/录屏专用 Mock 服务器（OpenAI 兼容协议 + SearXNG 搜索）。
 * 配合 scripts/capture-demo.mjs 使用，提供两个演示场景：
 * - 代码排错：思考过程 + Markdown 代码块（零宽字符问题）
 * - 联网搜索：联网决策器 → /search?format=json → 带 [1][2][3] 引用的金价回答
 *
 * 用法：node scripts/mock-scenario-server.mjs → http://localhost:8788
 */
import http from 'node:http'

const PORT = Number(process.env.PORT || 8788)

const THINK_CODE =
  '用户遇到的是请求头拼接问题。先定位：HTTP 头只允许 Latin-1，API Key 里若有从网页复制来的零宽字符就会抛错。给出清理方案并演示代码块渲染。'

const THINK_GOLD = '黄金价格是实时行情数据，必须联网获取最新报价。整理查询词为「今日金价」，优先取国内金价与上金所行情。'

const CODE_REPLY = [
  '好的！让我帮你分析一下这段代码的问题。\n\n',
  '你当前的实现里，HTTP 请求头的拼接方式有个常见的坑：\n\n',
  '```js\n',
  '// 错误：HTTP 头不允许非 Latin-1 字符\nconst auth = "Bearer " + apiKey\n```\n\n',
  '从网页 / 微信复制 API Key 时经常夹带**零宽字符**（U+200B 等），\n',
  '肉眼看不到，但会让请求直接失败。\n\n',
  '**修复方式**：先对输入做清理：\n\n',
  '```js\nconst clean = apiKey\n  .replace(/[\\u200B-\\u200D]/g, "")\n  .trim()\n```\n\n',
  '清理后重新请求就不会再报「连接失败」了。需要我帮你把这个清理逻辑加到所有服务商的适配层吗？',
].join('')

const GOLD_REPLY = [
  '今天国内金价**小幅上涨**[1]，给你一份速览：\n\n',
  '- **品牌足金饰品**：约 798 元/克（金店挂牌价）[1]\n',
  '- **上海黄金交易所 Au99.99**：约 612 元/克[2]\n',
  '- **国际现货黄金（XAU/USD）**：震荡走高，市场关注美联储降息路径[3]\n\n',
  '短期金价仍受美元指数与实际利率影响；如果是**投资目的**，建议盯上金所的实时盘面，而不是品牌饰品价[2]。\n\n',
  '**参考来源**\n',
  '1. [今日金价实时行情：国内黄金价格多少一克](https://example.com/gold/today)\n',
  '2. [上海黄金交易所 Au99.99 最新价格](https://example.com/gold/sge)\n',
  '3. [国际金价走势与行情分析](https://example.com/gold/analysis)',
].join('')

const GOLD_RESULTS = [
  {
    title: '今日金价实时行情：国内黄金价格多少一克',
    url: 'https://example.com/gold/today',
    content: '国内品牌足金饰品挂牌价约 798 元/克，金条及投资类金价略低。',
  },
  {
    title: '上海黄金交易所 Au99.99 最新价格',
    url: 'https://example.com/gold/sge',
    content: '上海黄金交易所 Au99.99 最新价约 612 元/克，盘中震荡走高。',
  },
  {
    title: '国际金价走势与行情分析',
    url: 'https://example.com/gold/analysis',
    content: '国际现货黄金（XAU/USD）今日上行，市场关注美元指数与美联储政策。',
  },
]

const APIKEY_RESULTS = [
  {
    title: 'API Key 复制后请求失败？零宽字符可能是元凶',
    url: 'https://example.com/posts/zero-width-chars',
    content: '从网页复制 API Key 时可能带上 U+200B 等零宽字符，肉眼不可见，会导致 HTTP 头校验失败。',
  },
  {
    title: 'HTTP 请求头允许的字符集（RFC 7230）',
    url: 'https://example.com/rfc7230-headers',
    content: 'HTTP/1.1 规定请求头字段值仅允许可见 ASCII 与空格，超出即非法。',
  },
  {
    title: '各家大模型 API Key 的正确拼接方式',
    url: 'https://example.com/api-key-header-format',
    content: 'OpenAI 兼容接口用 Authorization: Bearer <key>；Anthropic 用 x-api-key 头。',
  },
]

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key, anthropic-version',
}

async function readBody(req) {
  let body = ''
  for await (const c of req) body += c
  try {
    return JSON.parse(body || '{}')
  } catch {
    return {}
  }
}

/** 按 40ms/块的固定节奏写 SSE data 行 */
function streamSSE(res, events, chunkDelay = 40) {
  let i = 0
  const timer = setInterval(() => {
    if (i >= events.length) {
      res.write('data: [DONE]\n\n')
      clearInterval(timer)
      res.end()
      return
    }
    res.write(`data: ${JSON.stringify(events[i++])}\n\n`)
  }, chunkDelay)
  return timer
}

process.on('unhandledRejection', (e) => {
  const msg = e instanceof Error ? e.message : String(e)
  if (/aborted|ECONNRESET|socket hang up/i.test(msg)) return
  console.error('[unhandledRejection]', msg)
})

const server = http.createServer(async (req, res) => {
  const url = req.url ?? ''
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS)
    return res.end()
  }

  // ---- 模型列表：按 API Key 区分两家服务商 ----
  if (req.method === 'GET' && url.includes('/models')) {
    const key = req.headers['authorization'] ?? ''
    const data = String(key).includes('zhipu')
      ? [{ id: 'glm-5.3', context_length: 200000 }]
      : [
          { id: 'deepseek-flash', context_length: 128000 },
          { id: 'deepseek-v4-pro', context_length: 128000 },
        ]
    res.writeHead(200, { 'Content-Type': 'application/json', ...CORS })
    return res.end(JSON.stringify({ data }))
  }

  // ---- 模拟 SearXNG 实例（format=json）----
  if (req.method === 'GET' && url.includes('/search?')) {
    const q = new URL(url, 'http://localhost').searchParams.get('q') ?? ''
    const results = /金价|黄金/.test(q) ? GOLD_RESULTS : APIKEY_RESULTS
    res.writeHead(200, { 'Content-Type': 'application/json', ...CORS })
    return res.end(JSON.stringify({ results }))
  }

  // ---- OpenAI 兼容流式对话 ----
  if (req.method === 'POST' && url.includes('/chat/completions')) {
    const payload = await readBody(req)
    const sysMsg = payload.messages?.find((m) => m.role === 'system')?.content ?? ''
    const allText = (payload.messages ?? [])
      .map((m) => (typeof m.content === 'string' ? m.content : ''))
      .join('\n')
    const isGold = /金价|黄金/.test(allText)

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      ...CORS,
    })

    // 联网搜索决策器：返回一行 JSON
    if (String(sysMsg).includes('联网搜索决策器')) {
      const decision = isGold ? { search: true, query: '今日金价' } : { search: false }
      const events = [
        ...(THINK_GOLD.match(/[\s\S]{1,8}/g) ?? []).map((t) => ({
          choices: [{ delta: { reasoning_content: t } }],
        })),
        ...(JSON.stringify(decision).match(/[\s\S]{1,8}/g) ?? []).map((t) => ({
          choices: [{ delta: { content: t } }],
        })),
      ]
      const timer = streamSSE(res, events, 55)
      req.on('close', () => clearInterval(timer))
      return
    }

    const think = isGold ? THINK_GOLD : THINK_CODE
    const reply = isGold ? GOLD_REPLY : CODE_REPLY
    const thinkingOff = payload.enable_thinking === false
    const events = [
      ...(thinkingOff
        ? []
        : (think.match(/[\s\S]{1,6}/g) ?? []).map((t) => ({
            choices: [{ delta: { reasoning_content: t } }],
          }))),
      ...(reply.match(/[\s\S]{1,4}/g) ?? []).map((t) => ({
        choices: [{ delta: { content: t } }],
      })),
    ]
    const timer = streamSSE(res, events, 40)
    req.on('close', () => clearInterval(timer))
    return
  }

  res.writeHead(404, CORS)
  res.end('not found')
})

server.listen(PORT, () => {
  console.log(`scenario mock (openai + searxng) on http://localhost:${PORT}`)
})
