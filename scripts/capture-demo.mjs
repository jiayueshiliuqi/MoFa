#!/usr/bin/env node
/**
 * 重新生成 README 演示素材（docs/screenshots/）：
 *   demo.gif              演示动图（Playwright 录屏 → ffmpeg 调色板 GIF，约 16fps）
 *   chat.png              流式对话 + 思考过程 + 代码高亮
 *   web-search.png        联网搜索：决策 + 来源引用
 *   settings-provider.png 服务商编辑页
 *   settings.png          设置页
 *
 * 用法：
 *   npm run build                # 先构建生产包（脚本不重复构建）
 *   node scripts/capture-demo.mjs
 *
 * 可选环境变量：
 *   MOFA_CHROME       Chromium/Chrome 路径（默认自动查找）
 *   MOFA_DEMO_PORT    预览端口，默认 5299
 *   DEMO_FPS / DEMO_WIDTH / DEMO_COLORS  GIF 参数
 *
 * 说明：
 * - 场景 Mock：scripts/mock-scenario-server.mjs（OpenAI 兼容 + SearXNG），端口 8788。
 * - 录屏上下文指向 localhost Mock；截图上下文种入真实观感的服务商配置
 *   （https://api.deepseek.com 等，编辑页不发请求，仅用于展示）。
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, statSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const SHOTS = path.join(ROOT, 'docs/screenshots')
const TMP = path.join(os.tmpdir(), 'mofa-demo-capture')
const MOCK_PORT = 8788
const PREVIEW_PORT = Number(process.env.MOFA_DEMO_PORT || 5299)
const MOCK = `http://127.0.0.1:${MOCK_PORT}`
const BASE = `http://localhost:${PREVIEW_PORT}/`
const VITE_BIN = path.join(ROOT, 'node_modules/vite/bin/vite.js')

const GIF_FPS = Number(process.env.DEMO_FPS || 16)
const GIF_WIDTH = Number(process.env.DEMO_WIDTH || 400)
const GIF_COLORS = Number(process.env.DEMO_COLORS || 160)
const VIEW = { width: 400, height: 860 }

const SEL = {
  composer: 'textarea[placeholder="发消息…"]',
  send: 'button[aria-label="发送"]',
  stop: 'button[aria-label="停止生成"]',
  settings: 'button[aria-label="设置"]',
  back: 'button[aria-label="返回"]',
  thinkChip: '.think-chip',
  webChip: '.web-chip',
  modelChip: '.chip-row .model-chip:not(.think-chip):not(.web-chip)',
  modelItem: '.model-item',
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------- 服务进程 ----------

const children = []

function start(name, cmd, args, env = {}) {
  const child = spawn(cmd, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  children.push(child)
  child.stdout.on('data', (d) => process.env.MOFA_DEMO_DEBUG && process.stdout.write(`[${name}] ${d}`))
  child.stderr.on('data', (d) => process.env.MOFA_DEMO_DEBUG && process.stderr.write(`[${name}] ${d}`))
  return child
}

function stopChildren() {
  for (const child of children) {
    if (!child.killed) {
      try {
        child.kill()
      } catch {
        /* ignore */
      }
    }
  }
}

process.on('exit', stopChildren)
process.on('SIGINT', () => {
  stopChildren()
  process.exit(130)
})

async function isUp(url, validate) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1500) })
    if (!res.ok) return false
    return validate ? validate(await res.text()) : true
  } catch {
    return false
  }
}

async function waitFor(url, validate, label, timeout = 30000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    if (await isUp(url, validate)) return
    await sleep(300)
  }
  throw new Error(`等待 ${label} 启动超时：${url}`)
}

// ---------- 浏览器 ----------

function findChrome() {
  if (process.env.MOFA_CHROME) return process.env.MOFA_CHROME
  const home = os.homedir()
  const caches = [
    path.join(home, 'AppData/Local/ms-playwright'),
    path.join(home, '.cache/ms-playwright'),
  ]
  for (const dir of caches) {
    if (!existsSync(dir)) continue
    const versions = readdirSync(dir)
      .filter((d) => d.startsWith('chromium-'))
      .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
    for (const v of versions) {
      for (const rel of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe']) {
        const p = path.join(dir, v, rel)
        if (existsSync(p)) return p
      }
    }
  }
  for (const p of [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ]) {
    if (existsSync(p)) return p
  }
  throw new Error('找不到 Chromium/Chrome，请用 MOFA_CHROME=<路径> 指定')
}

/** 录屏/对话上下文的种子：指向本地场景 Mock（URL 不会出现在画面里） */
const DEMO_PROVIDERS = [
  {
    id: 'p-deepseek',
    name: 'DeepSeek',
    baseURL: MOCK,
    apiKey: 'sk-demo-deepseek',
    models: ['deepseek-flash', 'deepseek-v4-pro'],
    enabled: true,
    apiStyle: 'openai',
    contextWindow: 128000,
    modelContexts: { 'deepseek-flash': 128000, 'deepseek-v4-pro': 128000 },
    capabilityOverrides: { 'deepseek-flash': { reasoning: true } },
  },
  {
    id: 'p-zhipu',
    name: '智谱 GLM',
    baseURL: MOCK,
    apiKey: 'sk-demo-zhipu',
    models: ['glm-5.3'],
    enabled: true,
    apiStyle: 'openai',
    contextWindow: 200000,
    modelContexts: { 'glm-5.3': 200000 },
    capabilityOverrides: { 'glm-5.3': { reasoning: true } },
  },
]

/** 设置页截图上下文的种子：真实观感的地址（该上下文不发任何请求） */
const PRETTY_PROVIDERS = DEMO_PROVIDERS.map((p) => ({
  ...p,
  baseURL: p.id === 'p-deepseek' ? 'https://api.deepseek.com' : 'https://open.bigmodel.cn/api/paas/v4',
}))

const SETTINGS = {
  theme: 'dark',
  statsEnabled: false,
  searchEngine: 'searxng',
  searchMaxResults: 3,
  searchFullText: false,
  searxngUrl: MOCK,
}

async function newContext(browser, { record = false, providers = DEMO_PROVIDERS, searxngUrl = MOCK } = {}) {
  const context = await browser.newContext({
    viewport: VIEW,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'zh-CN',
    recordVideo: record
      ? { dir: path.join(TMP, 'video'), size: { width: VIEW.width, height: VIEW.height } }
      : undefined,
  })
  await context.addInitScript(
    ({ providers, settings }) => {
      localStorage.setItem('mofa.providers', JSON.stringify(providers))
      localStorage.setItem(
        'mofa.selected',
        JSON.stringify({ providerId: providers[0].id, model: providers[0].models[0] }),
      )
      localStorage.setItem('mofa.settings', JSON.stringify(settings))
      localStorage.setItem('mofa.webSearch', '0')
      localStorage.setItem('mofa.thinkingEffort', 'default')
    },
    { providers, settings: { ...SETTINGS, searxngUrl } },
  )
  const page = await context.newPage()
  page.setDefaultTimeout(20000)
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector(SEL.composer)
  return { context, page }
}

// ---------- 页面操作 ----------

async function waitIdle(page, timeout = 60000) {
  await page.waitForFunction(
    () =>
      !document.querySelector('button[aria-label="停止生成"]') &&
      !document.querySelector('.stream-caret'),
    null,
    { timeout },
  )
}

/** 流式期间钉底：应用的自动跟随有 nearBottom(<160px) 门槛，联网消息的
 * 占位+决策块一次插入就会超过门槛、跟随被永久判停，画面整段卡在上一条回复。
 * 录制演示时发送前先钉底并保持到流结束，绕开这个问题（不改应用代码）。 */
async function stickToBottom(page) {
  await page.evaluate(() => {
    const el = document.querySelector('.message-list')
    if (!el) return
    window.__mofaStick = setInterval(() => {
      el.scrollTop = el.scrollHeight
    }, 120)
  })
}

async function unstick(page) {
  await page.evaluate(() => clearInterval(window.__mofaStick))
}

async function typeAndSend(page, text) {
  await page.click(SEL.composer)
  // 逐字输入，录屏里呈现真实的打字节奏
  await page.type(SEL.composer, text, { delay: 45 })
  await sleep(300)
  await stickToBottom(page)
  await page.click(SEL.send)
}

/**
 * 对话演示主流程（录屏与截图上下文共用）：
 * 代码排错（思考 + Markdown）→ 切到智谱 glm-5.3 → 开联网问金价（决策 + 来源引用）。
 * opts 控制 GIF 独有的节奏镜头；截图上下文用最短路径。
 */
async function chatFlow(page, { showEffortMenu = false, switchModel = false } = {}) {
  if (showEffortMenu) {
    await sleep(1200) // 首页停留
    await page.click(SEL.thinkChip)
    await sleep(1400) // 思考强度菜单
    await page.click('.think-backdrop')
    await sleep(400)
  }
  await typeAndSend(page, '帮我看看这段代码，为什么复制了 API Key 之后请求一直失败?')
  await page.waitForSelector(SEL.stop, { timeout: 10000 })
  await waitIdle(page)
  await unstick(page)
  await sleep(showEffortMenu ? 1000 : 300)

  if (switchModel) {
    await page.click(SEL.webChip) // 开启联网
    await sleep(600)
    await page.click(SEL.modelChip)
    await page.waitForSelector(SEL.modelItem)
    await sleep(1300) // 模型列表停留
    await page.click(`${SEL.modelItem}:has-text("glm-5.3")`)
    await sleep(800) // 切换后停留
    await sleep(300)
  } else {
    await page.click(SEL.webChip)
    await sleep(300)
  }

  await typeAndSend(page, '今天黄金多少钱一克？')
  await page.waitForSelector(SEL.stop, { timeout: 15000 })
  await waitIdle(page)
  await unstick(page)
  await sleep(showEffortMenu ? 1200 : 300)
}

// ---------- GIF 合成 ----------

function ffmpeg(args) {
  const r = spawnSync('ffmpeg', ['-y', ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
  if (r.status !== 0) {
    throw new Error(`ffmpeg 失败：${r.stderr.toString().slice(-800)}`)
  }
}

function makeGif(webm, outPath) {
  const palette = path.join(TMP, 'palette.png')
  const fps = String(GIF_FPS)
  const chain = `fps=${fps},scale=${GIF_WIDTH}:-1:flags=lanczos`
  // 头部裁掉视口未就位的灰边帧（-ss 必须在 -i 之前：输出侧裁剪会把 palettegen
  // 唯一的输出帧按时间戳丢掉，得到空文件）；尾部保留收尾停留
  const trim = ['-ss', '0.6']
  ffmpeg(['-ss', '0.6', '-i', webm, '-vf', `${chain},palettegen=max_colors=${GIF_COLORS}:stats_mode=diff`, palette])
  ffmpeg([
    '-ss', '0.6',
    '-i', webm,
    '-i', palette,
    '-lavfi', `${chain} [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
    outPath,
  ])
}

// ---------- 主流程 ----------

async function main() {
  if (!existsSync(VITE_BIN)) throw new Error('未安装依赖，请先 npm install')
  if (!existsSync(path.join(ROOT, 'dist/index.html'))) {
    throw new Error('dist/index.html 不存在，请先 npm run build')
  }
  rmSync(TMP, { recursive: true, force: true })
  mkdirSync(path.join(TMP, 'video'), { recursive: true })
  mkdirSync(SHOTS, { recursive: true })

  console.log('▸ 启动场景 Mock 与预览服务…')
  start('mock', process.execPath, [path.join(ROOT, 'scripts/mock-scenario-server.mjs')], {
    PORT: String(MOCK_PORT),
  })
  await waitFor(`${MOCK}/models`, (t) => t.includes('deepseek'), '场景 Mock')
  start('preview', process.execPath, [VITE_BIN, 'preview', '--port', String(PREVIEW_PORT), '--strictPort'])
  await waitFor(BASE, (t) => t.includes('id="app"'), '生产包预览')

  const browser = await chromium.launch({
    executablePath: findChrome(),
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })

  try {
    // ---- 1. 录屏：demo.gif ----
    console.log('▸ 录制演示动图…')
    {
      const { context, page } = await newContext(browser, { record: true })
      await chatFlow(page, { showEffortMenu: true, switchModel: true })
      await context.close() // 关闭后视频才落盘
    }
    const videos = readdirSync(path.join(TMP, 'video')).filter((f) => f.endsWith('.webm'))
    if (!videos.length) throw new Error('录屏文件未生成')
    const webm = path.join(TMP, 'video', videos[0])
    const gifPath = path.join(SHOTS, 'demo.gif')
    console.log('▸ 合成 GIF（fps、调色板两遍）…')
    makeGif(webm, gifPath)
    console.log(`  demo.gif ${(statSync(gifPath).size / 1024 / 1024).toFixed(2)} MB`)

    // ---- 2. 对话截图：chat.png / web-search.png ----
    console.log('▸ 截取对话画面…')
    {
      const { context, page } = await newContext(browser)
      await chatFlow(page)

      // chat.png：展开第一条回复的思考过程，滚到顶部
      await page.locator('.msg-assistant .reasoning-head').first().click()
      await page.locator('.msg-user').first().scrollIntoViewIfNeeded()
      await sleep(500)
      await page.screenshot({ path: path.join(SHOTS, 'chat.png') })

      // web-search.png：展开搜索来源，滚到底部
      await page.locator('.search-head').last().click()
      await sleep(400)
      await page.locator('.msg-assistant').last().scrollIntoViewIfNeeded()
      await page.mouse.wheel(0, 800)
      await sleep(500)
      await page.screenshot({ path: path.join(SHOTS, 'web-search.png') })
      await context.close()
    }

    // ---- 3. 设置类截图：settings-provider.png / settings.png ----
    console.log('▸ 截取设置画面…')
    {
      const { context, page } = await newContext(browser, {
        providers: PRETTY_PROVIDERS,
        searxngUrl: 'https://searx.example.com',
      })
      await page.click(SEL.settings)
      await page.waitForSelector('.provider-item')
      await sleep(600)
      await page.screenshot({ path: path.join(SHOTS, 'settings.png') })

      await page.locator('.provider-item', { hasText: 'DeepSeek' }).click()
      await page.waitForSelector('text=从 API 拉取模型列表')
      await sleep(600)
      await page.screenshot({ path: path.join(SHOTS, 'settings-provider.png'), fullPage: true })
      await context.close()
    }
  } finally {
    await browser.close().catch(() => undefined)
    stopChildren()
  }

  console.log(`\n完成：${SHOTS}`)
  for (const f of ['demo.gif', 'chat.png', 'web-search.png', 'settings-provider.png', 'settings.png']) {
    const p = path.join(SHOTS, f)
    if (existsSync(p)) console.log(`  ${f}  ${(statSync(p).size / 1024).toFixed(0)} KB`)
  }
}

main().catch((e) => {
  console.error(`\n素材生成失败：${e.message}`)
  process.exitCode = 1
})
