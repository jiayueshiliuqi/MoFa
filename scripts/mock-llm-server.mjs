/**
 * 本地 Mock LLM 服务器（OpenAI 兼容协议），用于开发期端到端验证：
 * - GET  /v1/models            返回模型列表
 * - POST /v1/chat/completions  以 SSE 流式返回一段 Markdown 回复
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

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

const server = http.createServer(async (req, res) => {
  const url = req.url ?? ''

  // 模拟更新服务器（测试自动更新用）
  if (req.method === 'GET' && url.includes('/share/Mofa/latest.json')) {
    res.writeHead(200, { 'Content-Type': 'application/json', ...CORS })
    return res.end(
      JSON.stringify({
        version: '0.0.2',
        url: 'http://localhost:8787/share/Mofa/mofa-0.0.2.apk',
        changelog: '测试更新：修复了一些问题，优化了体验。',
      }),
    )
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS)
    return res.end()
  }

  if (req.method === 'GET' && url.includes('/models')) {
    res.writeHead(200, { 'Content-Type': 'application/json', ...CORS })
    return res.end(JSON.stringify({ data: [{ id: 'mock-chat' }, { id: 'mock-pro' }] }))
  }

  if (req.method === 'POST' && url.includes('/chat/completions')) {
    // 读取请求体，回显系统提示词与图片数量，便于端到端验证多模态请求真的发出
    let body = ''
    for await (const chunk of req) body += chunk
    let echo = ''
    let payload = {}
    try {
      payload = JSON.parse(body || '{}')
      const sys = payload.messages?.find((m) => m.role === 'system')?.content
      if (sys) echo += `【已收到系统提示词：${String(sys).slice(0, 50)}】\n\n`
      if (payload.enable_thinking === false) echo += '【思考已关闭：请求带 enable_thinking=false】\n\n'
      if (typeof payload.reasoning_effort === 'string') {
        echo += `【思考强度：reasoning_effort=${payload.reasoning_effort}】\n\n`
      }
      let imgCount = 0
      for (const m of payload.messages ?? []) {
        if (Array.isArray(m.content)) {
          imgCount += m.content.filter((p) => p.type === 'image_url').length
        }
      }
      if (imgCount) echo += `【已收到 ${imgCount} 张图片】\n\n`
    } catch {
      /* ignore */
    }
    const reply = echo + REPLY

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      ...CORS,
    })
    // 先流式输出思考（reasoning_content），再输出正文，模拟推理模型的行为
    // 思考被关闭时不输出思考流
    const THINK = '用户在验证思考链路：先理解请求意图，再决定回答结构。这只是模拟的思考内容。'
    const thinkingOff = payload.enable_thinking === false
    const events = [
      ...(thinkingOff ? [] : (THINK.match(/[\s\S]{1,7}/g) ?? []).map((t) => ({ r: t }))),
      ...(reply.match(/[\s\S]{1,5}/g) ?? []).map((t) => ({ c: t })),
    ]
    let i = 0
    const timer = setInterval(() => {
      if (i >= events.length) {
        res.write('data: [DONE]\n\n')
        clearInterval(timer)
        res.end()
        return
      }
      const ev = events[i++]
      const payload = ev.r
        ? { choices: [{ delta: { reasoning_content: ev.r } }] }
        : { choices: [{ delta: { content: ev.c } }] }
      res.write(`data: ${JSON.stringify(payload)}\n\n`)
    }, 40)
    req.on('close', () => clearInterval(timer))
    return
  }

  res.writeHead(404, CORS)
  res.end('not found')
})

server.listen(8787, () => {
  console.log('mock llm server on http://localhost:8787')
})
