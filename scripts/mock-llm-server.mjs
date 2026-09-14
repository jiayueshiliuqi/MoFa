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

  for (const m of payload.messages ?? []) {
    if (Array.isArray(m.content)) {
      imgCount += m.content.filter(
        (p) => p.type === 'image_url' || p.type === 'image' || p.inlineData,
      ).length
    }
  }

  if (sys) echo += `【已收到系统提示词：${String(sys).slice(0, 50)}】\n\n`
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

  // ---- 模型列表（三协议共用/各自格式） ----
  if (req.method === 'GET' && url.includes('/v1beta/models')) {
    res.writeHead(200, { 'Content-Type': 'application/json', ...CORS })
    return res.end(
      JSON.stringify({
        models: [{ name: 'models/mock-gemini' }, { name: 'models/mock-gemini-flash' }],
      }),
    )
  }
  if (req.method === 'GET' && url.includes('/models')) {
    res.writeHead(200, { 'Content-Type': 'application/json', ...CORS })
    return res.end(
      JSON.stringify({ data: [{ id: 'mock-chat' }, { id: 'mock-pro' }] }),
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
