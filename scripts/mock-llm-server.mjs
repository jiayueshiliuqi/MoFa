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

const server = http.createServer(async (req, res) => {
  const url = req.url ?? ''

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS)
    return res.end()
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
    res.writeHead(200, { 'Content-Type': 'application/json', ...CORS })
    return res.end(
      JSON.stringify({
        results: [
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
        ],
      }),
    )
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
    // 查询词生成的辅助调用：返回一个短查询词（验证联网搜索的词生成环节）
    const sysMsg = payload.messages?.find((m) => m.role === 'system')?.content ?? ''
    if (String(sysMsg).includes('搜索查询生成器')) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        ...CORS,
      })
      const query = 'API Key 复制 请求失败 零宽字符'
      const events = (query.match(/[\s\S]{1,6}/g) ?? []).map((t) => ({
        choices: [{ delta: { content: t } }],
      }))
      const timer = streamSSE(res, events)
      req.on('close', () => clearInterval(timer))
      return
    }
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
        : (THINK.match(/[\s\S]{1,7}/g) ?? []).map((t) => ({
            choices: [{ delta: { reasoning_content: t } }],
          }))),
      ...(reply.match(/[\s\S]{1,5}/g) ?? []).map((t) => ({
        choices: [{ delta: { content: t } }],
      })),
    ]
    const timer = streamSSE(res, events)
    req.on('close', () => clearInterval(timer))
    return
  }

  res.writeHead(404, CORS)
  res.end('not found')
})

server.listen(8787, () => {
  console.log('mock llm server (openai + anthropic + gemini) on http://localhost:8787')
})
