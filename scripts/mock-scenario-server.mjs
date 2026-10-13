/**
 * 截图/录屏专用 Mock 服务器：模拟真实的代码问题对话场景。
 * 用法：node scripts/mock-scenario-server.mjs  → http://localhost:8788
 */
import http from 'node:http'

const THINK = '用户遇到的是请求头拼接问题。先定位：HTTP 头只允许 Latin-1，API Key 里若有从网页复制来的零宽字符就会抛错。给出清理方案并演示代码块渲染。'

const REPLY = [
  '好的！让我帮你分析一下这段代码的问题。\n\n',
  '你当前的实现里，HTTP 请求头的拼接方式有个常见的坑：\n\n',
  '```js\n',
  '// 错误：HTTP 头不允许非 Latin-1 字符\nconst auth = "Bearer " + apiKey\n```\n\n',
  '从微信 / 网页复制 API Key 时经常夹带**零宽字符**（U+200B 等），\n',
  '肉眼看不到，但会导致请求直接失败。\n\n',
  '**修复方式**：先对输入做清理：\n\n',
  '```js\nconst clean = apiKey\n  .replace(/[\\u200B-\\u200D]/g, "")\n  .trim()\n```\n\n',
  '这样就不会出现「连接失败」了。需要我帮你接入到所有服务商的适配层吗？',
].join('')

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
}

http.createServer(async (req, res) => {
  const url = req.url ?? ''
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end() }

  if (req.method === 'GET' && url.includes('/models')) {
    // 按 API Key 区分模型列表，模拟两家服务商
    const key = req.headers['authorization'] ?? ''
    const data = key.includes('demo-glm')
      ? [{ id: 'glm-4.6', context_length: 200000 }]
      : [{ id: 'deepseek-flash', context_length: 128000 }]
    res.writeHead(200, { 'Content-Type': 'application/json', ...CORS })
    return res.end(JSON.stringify({ data }))
  }

  if (req.method === 'POST' && url.includes('/chat/completions')) {
    let body = ''
    for await (const c of req) body += c
    let historyCount = 1
    try {
      historyCount = (JSON.parse(body).messages ?? []).filter((m) => m.role !== 'system').length
    } catch { /* ignore */ }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      ...CORS,
    })
    const prefix = `【携带历史 ${historyCount} 条】\n\n`
    const full = prefix + REPLY
    // 先流式输出思考，再输出正文
    const events = [
      ...(THINK.match(/[\s\S]{1,6}/g) ?? []).map((t) => ({
        choices: [{ delta: { reasoning_content: t } }],
      })),
      ...(full.match(/[\s\S]{1,4}/g) ?? []).map((t) => ({
        choices: [{ delta: { content: t } }],
      })),
    ]
    let i = 0
    const t = setInterval(() => {
      if (i >= events.length) {
        res.write('data: [DONE]\n\n')
        clearInterval(t)
        res.end()
        return
      }
      res.write(`data: ${JSON.stringify(events[i++])}\n\n`)
    }, 45)
    req.on('close', () => clearInterval(t))
    return
  }

  res.writeHead(404, CORS)
  res.end('not found')
}).listen(8788, () => console.log('scenario mock on http://localhost:8788'))
