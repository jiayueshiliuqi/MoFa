/**
 * 本地 Mock LLM 服务器，模拟三种协议（开发期端到端验证）：
 * - OpenAI 兼容：POST /v1/chat/completions（SSE，reasoning_content + content）
 * - Anthropic： POST /v1/messages（SSE，thinking_delta + text_delta）
 * - Gemini：    POST /v1beta/models/<model>:streamGenerateContent?alt=sse
 * 以及各协议的模型列表接口。所有回复回显系统提示词/图片数/思考参数，便于断言。
 *
 * 用法：node scripts/mock-llm-server.mjs
 */
import http from 'node:http'

const REPLY = [
  '好的，这是一段**流式 Markdown** 演示：\n\n',
  '1. 列表项一\n2. 列表项二\n\n',
  '> 轻量、好迭代，个人开发者友好。\n\n',
  '```ts\nconst app = createApp("MoFa")\nconsole.log(app)\n```\n\n',
  '支持**加粗**、*斜体*、`行内代码`、表格和公式可以后续再加。',
].join('')

const THINK = '用户在验证思考链路：先理解请求意图，再决定回答结构。这只是模拟的思考内容。'

/** [[slow]] 触发的慢速长回复：用于测试「停止生成」「生成中切换会话」 */
const SLOW_REPLY = Array.from(
  { length: 60 },
  (_, i) => `第 ${i + 1} 段：这是一段用于测试流式中断、长文本滚动与会话切换的占位内容。`,
).join('\n\n')

/** 测试统计：/__stats 读取，/__reset 清零（仅 mock 服务使用） */
const stats = { chat: 0, decision: 0, search: 0, models: 0, lastSearchQuery: '' }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key, anthropic-version, anthropic-dangerous-direct-browser-access',
}

async function readBody(req) {
  let body = ''
  for await (const chunk of req) body += chunk
  try {
    return JSON.parse(body || '{}')
  } catch {
    return {}
  }
}

/** 从三种协议的请求体中提取回显信息 */
function extractEcho(payload) {
  let echo = ''
  let sys = ''
  let imgCount = 0

  if (payload.system) {
    // Anthropic：system 是顶层字段
    sys = typeof payload.system === 'string' ? payload.system : JSON.stringify(payload.system)
  } else if (payload.systemInstruction) {
    // Gemini
    sys = payload.systemInstruction?.parts?.[0]?.text ?? ''
  } else {
    sys = payload.messages?.find((m) => m.role === 'system')?.content ?? ''
  }

  const msgs = payload.messages ?? payload.contents ?? []
  for (const m of msgs) {
    const parts = Array.isArray(m.content) ? m.content : Array.isArray(m.parts) ? m.parts : null
    if (parts) {
      imgCount += parts.filter(
        (p) => p.type === 'image_url' || p.type === 'image' || p.inlineData,
      ).length
    }
  }
  const historyCount = msgs.filter((m) => m.role !== 'system' && !m.systemInstruction).length

  if (sys) echo += `【已收到系统提示词：${String(sys).slice(0, 50)}】\n\n`
  if (historyCount) echo += `【携带历史 ${historyCount} 条】\n\n`
  if (imgCount) echo += `【已收到 ${imgCount} 张图片】\n\n`
  if (payload.enable_thinking === false) echo += '【思考已关闭：请求带 enable_thinking=false】\n\n'
  if (typeof payload.reasoning_effort === 'string') {
    echo += `【思考强度：reasoning_effort=${payload.reasoning_effort}】\n\n`
  }
  if (payload.thinking?.budget_tokens) {
    echo += `【Claude 思考预算：budget_tokens=${payload.thinking.budget_tokens}】\n\n`
  }
  const budget = payload.generationConfig?.thinkingConfig?.thinkingBudget
  if (budget !== undefined) {
    echo += `【Gemini 思考预算：thinkingBudget=${budget}】\n\n`
  }
  return { echo, imgCount, thinkingOff: payload.enable_thinking === false || budget === 0 }
}

/** 以固定间隔写 SSE data 行，返回结束 Promise */
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

// 开发服务器：客户端中断请求（刷新/停止生成）会让 readBody 抛 ECONNRESET/AbortError，
// 未处理的 promise rejection 在 Node 22 会直接杀掉进程。这里兜住，只记一行日志。
process.on('unhandledRejection', (e) => {
  const msg = e instanceof Error ? e.message : String(e)
  if (/aborted|ECONNRESET|socket hang up/i.test(msg)) return
  console.error('[unhandledRejection]', msg)
})

const server = http.createServer(async (req, res) => {
  try {
    await handle(req, res)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/aborted|ECONNRESET|socket hang up/i.test(msg)) return // 客户端主动断开，正常
    console.error('[request error]', msg)
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain', ...CORS })
      res.end('mock server error')
    } else {
      res.end()
    }
  }
})

async function handle(req, res) {
  const url = req.url ?? ''

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS)
    return res.end()
  }

  // ---- 测试统计（冒烟测试用来断言「该搜/不该搜」） ----
  if (req.method === 'GET' && url.startsWith('/__stats')) {
    res.writeHead(200, { 'Content-Type': 'application/json', ...CORS })
    return res.end(JSON.stringify(stats))
  }
  if (req.method === 'POST' && url.startsWith('/__reset')) {
    stats.chat = stats.decision = stats.search = stats.models = 0
    stats.lastSearchQuery = ''
    res.writeHead(200, { 'Content-Type': 'application/json', ...CORS })
    return res.end('{"ok":true}')
  }

  // 模拟更新服务器（测试自动更新用）
  if (req.method === 'GET' && url.includes('/share/Mofa/latest.json')) {
    res.writeHead(200, { 'Content-Type': 'application/json', ...CORS })
    return res.end(
      JSON.stringify({
        version: '0.0.3',
        url: 'http://localhost:8787/share/Mofa/mofa-0.0.3.apk',
        changelog: '测试更新：修复了一些问题，优化了体验。',
      }),
    )
  }

  // ---- 模拟 SearXNG 实例（验证联网搜索流程；format=json 优先） ----
  if (req.method === 'GET' && url.includes('/search?')) {
    stats.search++
    const q = new URL(url, 'http://localhost').searchParams.get('q') ?? ''
    stats.lastSearchQuery = q
    const gold = /金价|黄金/.test(q)
    const results = gold
      ? [
          {
            title: '今日金价（2026年10月19日）黄金价格实时行情',
            url: 'https://example.com/gold/today',
            content: '国内足金饰品价格约 798 元/克，上海黄金交易所 Au99.99 最新价约 612 元/克。',
          },
          {
            title: '上海黄金交易所 Au99.99 最新价格',
            url: 'https://example.com/gold/sge',
            content: '上海黄金交易所实时行情：Au99.99 开盘价、最高价、最低价与成交量。',
          },
          {
            title: '国际金价走势与今日行情分析',
            url: 'https://example.com/gold/analysis',
            content: '国际现货黄金（XAU/USD）今日震荡，市场关注美元指数与美联储政策。',
          },
        ]
      : [
          {
            title: 'API Key 复制后请求失败？零宽字符可能是元凶',
            url: 'https://example.com/posts/zero-width-chars',
            content:
              '从微信或网页复制 API Key 时可能带上 U+200B 等零宽字符，肉眼不可见，会导致 HTTP 头校验失败（non ISO-8859-1）。用 trim() 无法去除，需要正则清理。',
          },
          {
            title: 'HTTP 请求头允许的字符集（RFC 7230）',
            url: 'https://example.com/rfc7230-headers',
            content: 'HTTP/1.1 规定请求头字段值仅允许可见 ASCII 与空格（field-vchar 等非 CTL 字符），超出即非法。',
          },
          {
            title: '各家大模型 API Key 的正确拼接方式',
            url: 'https://example.com/api-key-header-format',
            content: 'OpenAI 兼容接口用 Authorization: Bearer <key>；Anthropic 用 x-api-key 头并附带 anthropic-version。',
          },
        ]
    res.writeHead(200, { 'Content-Type': 'application/json', ...CORS })
    return res.end(JSON.stringify({ results }))
  }

  // ---- 模型列表（三协议共用/各自格式） ----
  if (req.method === 'GET' && url.includes('/v1beta/models')) {
    res.writeHead(200, { 'Content-Type': 'application/json', ...CORS })
    return res.end(
      JSON.stringify({
        models: [
          { name: 'models/mock-gemini', inputTokenLimit: 1048576 },
          { name: 'models/mock-gemini-flash', inputTokenLimit: 1048576 },
        ],
      }),
    )
  }
  if (req.method === 'GET' && url.includes('/models')) {
    res.writeHead(200, { 'Content-Type': 'application/json', ...CORS })
    // context_length 模拟 OpenRouter 风格（能被自动读取）
    return res.end(
      JSON.stringify({
        data: [
          { id: 'mock-chat', context_length: 32000 },
          { id: 'mock-pro', context_length: 64000 },
        ],
      }),
    )
  }

  // ---- Gemini 流式 ----
  if (req.method === 'POST' && url.includes(':streamGenerateContent')) {
    const payload = await readBody(req)
    const { echo, thinkingOff } = extractEcho(payload)
    const reply = echo + REPLY
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      ...CORS,
    })
    const events = [
      ...(thinkingOff
        ? []
        : (THINK.match(/[\s\S]{1,8}/g) ?? []).map((t) => ({
            candidates: [{ content: { parts: [{ text: t, thought: true }] } }],
          }))),
      ...(reply.match(/[\s\S]{1,5}/g) ?? []).map((t) => ({
        candidates: [{ content: { parts: [{ text: t }] } }],
      })),
    ]
    const timer = streamSSE(res, events)
    req.on('close', () => clearInterval(timer))
    return
  }

  // ---- Anthropic 流式 ----
  if (req.method === 'POST' && url.includes('/v1/messages')) {
    const payload = await readBody(req)
    const { echo, thinkingOff } = extractEcho(payload)
    const reply = echo + REPLY
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      ...CORS,
    })
    const events = [
      ...(thinkingOff
        ? []
        : (THINK.match(/[\s\S]{1,8}/g) ?? []).map((t) => ({
            type: 'content_block_delta',
            delta: { type: 'thinking_delta', thinking: t },
          }))),
      ...(reply.match(/[\s\S]{1,5}/g) ?? []).map((t) => ({
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: t },
      })),
    ]
    const timer = streamSSE(res, events)
    req.on('close', () => clearInterval(timer))
    return
  }

  // ---- OpenAI 兼容流式 ----
  if (req.method === 'POST' && url.includes('/chat/completions')) {
    const payload = await readBody(req)
    stats.chat++
    // 联网决策的辅助调用：返回是否搜索 + 查询词（验证「模型自主决定联网」环节）
    const sysMsg = payload.messages?.find((m) => m.role === 'system')?.content ?? ''
    if (String(sysMsg).includes('联网搜索决策器')) {
      stats.decision++
      const lastUser = [...(payload.messages ?? [])].reverse().find((m) => m.role === 'user')
      const text = typeof lastUser?.content === 'string' ? lastUser.content : ''
      // 只看「用户最新问题」这一段，别被上下文里的闲聊词干扰
      const question = text.includes('用户最新问题：') ? text.split('用户最新问题：').pop() : text
      // mock 的简单规则：闲聊/翻译/代码/数学/总结类不搜，其余都搜
      const needSearch = !/闲聊|你好|翻译|写代码|数学|总结|改写/.test(question)
      const query = /金价|黄金/.test(question)
        ? '今日金价'
        : /天气/.test(question)
          ? '北京 天气'
          : 'API Key 复制 请求失败 零宽字符'
      const decision = needSearch ? { search: true, query } : { search: false }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        ...CORS,
      })
      // 决策调用若没关思考，先流一段 reasoning，验证「联网判断」区块能展示判断依据
      const think = '先判断问题是否需要最新的互联网信息，再决定查询词。'
      const thinkEvents =
        payload.enable_thinking === false
          ? []
          : (think.match(/[\s\S]{1,8}/g) ?? []).map((t) => ({
              choices: [{ delta: { reasoning_content: t } }],
            }))
      const content = JSON.stringify(decision)
      const events = [
        ...thinkEvents,
        ...(content.match(/[\s\S]{1,8}/g) ?? []).map((t) => ({
          choices: [{ delta: { content: t } }],
        })),
      ]
      const timer = streamSSE(res, events)
      req.on('close', () => clearInterval(timer))
      return
    }
    const { echo, thinkingOff } = extractEcho(payload)
    const lastUser = [...(payload.messages ?? [])].reverse().find((m) => m.role === 'user')
    const lastText = typeof lastUser?.content === 'string' ? lastUser.content : ''
    const slow = lastText.includes('[[slow]]') // 慢速长回复：留给测试点击「停止」/切换会话
    const reply = echo + (slow ? SLOW_REPLY : REPLY)
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      ...CORS,
    })
    const events = [
      ...(slow || thinkingOff
        ? []
        : (THINK.match(/[\s\S]{1,7}/g) ?? []).map((t) => ({
            choices: [{ delta: { reasoning_content: t } }],
          }))),
      ...(reply.match(/[\s\S]{1,5}/g) ?? []).map((t) => ({
        choices: [{ delta: { content: t } }],
      })),
    ]
    const timer = streamSSE(res, events, slow ? 80 : 40)
    req.on('close', () => clearInterval(timer))
    return
  }

  res.writeHead(404, CORS)
  res.end('not found')
}

const PORT = Number(process.env.PORT || 8787)
server.listen(PORT, () => {
  console.log(`mock llm server (openai + anthropic + gemini) on http://localhost:${PORT}`)
})
