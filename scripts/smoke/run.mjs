#!/usr/bin/env node
/**
 * MoFa 回归冒烟测试（Web 生产包 + 本地 Mock LLM）
 *
 * 用法：
 *   npm run build && npm run test:smoke
 *   npm run test:smoke -- --no-build          # 复用已有 dist
 *   npm run test:smoke -- --only=C03,C07      # 只跑指定用例
 *   npm run test:smoke -- --list              # 列出用例
 *
 * 环境变量：
 *   MOFA_MOCK_PORT      Mock LLM 端口，默认 8787
 *   MOFA_PREVIEW_PORT   预览端口，默认 5200
 *   MOFA_CHROME         Chromium/Chrome 可执行文件路径（默认自动查找）
 *
 * 说明：
 * - 每个用例使用独立浏览器上下文（IndexedDB / localStorage 全隔离），互不影响。
 * - Mock 的 /__stats 用于断言「该联网时搜索、不该联网时不搜索」。
 * - 只覆盖 Web 端可自动化的主流程；原生端（安装包、返回键、更新）见 docs/TESTING.md。
 */
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const MOCK_PORT = Number(process.env.MOFA_MOCK_PORT || 8787)
const PREVIEW_PORT = Number(process.env.MOFA_PREVIEW_PORT || 5200)
const MOCK = `http://localhost:${MOCK_PORT}`
const BASE = `http://localhost:${PREVIEW_PORT}/`
const VITE_BIN = path.join(ROOT, 'node_modules/vite/bin/vite.js')
const ARGS = process.argv.slice(2)
const NO_BUILD = ARGS.includes('--no-build')
const ONLY = (ARGS.find((a) => a.startsWith('--only=')) ?? '').split('=')[1]
const LIST = ARGS.includes('--list')

const SEL = {
  composer: 'textarea[placeholder="发消息…"]',
  send: 'button[aria-label="发送"]',
  stop: 'button[aria-label="停止生成"]',
  drawer: 'button[aria-label="打开会话列表"]',
  newChat: 'button[aria-label="新对话"]',
  settings: 'button[aria-label="设置"]',
  back: 'button[aria-label="返回"]',
  saveFile: 'button[aria-label="存为文件"]',
  export: 'button[aria-label="导出对话"]',
}

// ---------- 进程与端口 ----------

const children = []

async function isUp(url, validate) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1500) })
    if (!res.ok) return false
    if (!validate) return true
    return await validate(await res.text())
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
  throw new Error(`等待 ${label} 启动超时（${timeout}ms）：${url}`)
}

function start(name, cmd, args, env = {}) {
  const child = spawn(cmd, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  children.push({ name, child })
  let tail = ''
  const onData = (d) => {
    tail = (tail + d.toString()).slice(-2000)
    if (process.env.MOFA_SMOKE_DEBUG) process.stdout.write(`[${name}] ${d}`)
  }
  child.stdout.on('data', onData)
  child.stderr.on('data', onData)
  child.on('exit', (code) => {
    if (code && code !== 0 && process.env.MOFA_SMOKE_DEBUG) {
      console.error(`[${name}] 退出码 ${code}\n${tail}`)
    }
  })
  return child
}

function stopChildren() {
  for (const { child } of children) {
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

// ---------- 浏览器 ----------

function findChrome() {
  if (process.env.MOFA_CHROME) {
    if (!existsSync(process.env.MOFA_CHROME)) {
      throw new Error(`MOFA_CHROME 指向的文件不存在：${process.env.MOFA_CHROME}`)
    }
    return process.env.MOFA_CHROME
  }
  const home = os.homedir()
  const caches = [
    path.join(home, 'AppData/Local/ms-playwright'),
    path.join(home, '.cache/ms-playwright'),
    path.join(home, 'Library/Caches/ms-playwright'),
  ]
  for (const dir of caches) {
    if (!existsSync(dir)) continue
    const versions = readdirSync(dir)
      .filter((d) => d.startsWith('chromium-'))
      .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
    for (const v of versions) {
      const candidates = [
        'chrome-win64/chrome.exe',
        'chrome-win/chrome.exe',
        'chrome-linux/chrome',
        'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
      ]
      for (const rel of candidates) {
        const p = path.join(dir, v, rel)
        if (existsSync(p)) return p
      }
    }
  }
  const system = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ]
  for (const p of system) if (existsSync(p)) return p
  throw new Error(
    '找不到 Chromium/Chrome。请安装 Chrome，或下载 Playwright Chromium，或用 MOFA_CHROME=<路径> 指定。',
  )
}

const PROVIDER = {
  id: 'mock',
  name: 'Mock',
  baseURL: MOCK,
  apiKey: 'sk-smoke',
  models: ['mock-pro'],
  enabled: true,
  apiStyle: 'openai',
  contextWindow: 64000,
}

const SETTINGS = {
  theme: 'light',
  statsEnabled: false,
  searchEngine: 'searxng',
  searchMaxResults: 3,
  searchFullText: false,
  searxngUrl: MOCK,
}

async function newPage({ webSearch = false } = {}) {
  const context = await browser.newContext({
    viewport: { width: 400, height: 860 },
    locale: 'zh-CN',
    acceptDownloads: true,
  })
  await context.addInitScript(
    ({ provider, settings, webSearch }) => {
      localStorage.setItem('mofa.providers', JSON.stringify([provider]))
      localStorage.setItem(
        'mofa.selected',
        JSON.stringify({ providerId: provider.id, model: provider.models[0] }),
      )
      localStorage.setItem('mofa.settings', JSON.stringify(settings))
      localStorage.setItem('mofa.webSearch', webSearch ? '1' : '0')
      localStorage.setItem('mofa.thinkingEffort', 'default')
    },
    { provider: PROVIDER, settings: SETTINGS, webSearch },
  )
  const page = await context.newPage()
  page.setDefaultTimeout(15000)
  const pageErrors = []
  const consoleErrors = []
  page.on('pageerror', (e) => pageErrors.push(e.message))
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    const t = m.text()
    // 静态资源的 404 不影响功能，单独忽略
    if (/Failed to load resource/i.test(t)) return
    consoleErrors.push(t)
  })
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector(SEL.composer)
  await resetStats()
  return { context, page, pageErrors, consoleErrors }
}

async function getStats() {
  return await (await fetch(`${MOCK}/__stats`)).json()
}

async function resetStats() {
  await fetch(`${MOCK}/__reset`, { method: 'POST' })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------- 页面操作 ----------

async function waitIdle(page, timeout = 45000) {
  await page.waitForFunction(
    () =>
      !document.querySelector('button[aria-label="停止生成"]') &&
      !document.querySelector('.stream-caret'),
    null,
    { timeout },
  )
}

/** 发送并等待一条完整回复（先确认真的进入流式，避免瞬时空闲误判） */
async function sendAndWait(page, text, timeout = 45000) {
  await page.fill(SEL.composer, text)
  await page.click(SEL.send)
  await page.waitForSelector(SEL.stop, { timeout: 10000 })
  await waitIdle(page, timeout)
}

const lastAssistant = (page) => page.locator('.msg-assistant').last()
const assistantText = async (page) => (await lastAssistant(page).locator('.md').innerText()).trim()

async function openDrawer(page) {
  await page.click(SEL.drawer)
  await page.waitForSelector('.session-list')
}

async function sessionItem(page, title) {
  return page.locator('.session-item', { hasText: title }).first()
}

/** 联网消息的展示顺序：判断 → 来源 → 回复思考 → 正文 */
async function assertSearchOrder(page) {
  const order = await page.evaluate(() => {
    const last = [...document.querySelectorAll('.msg-assistant')].pop()
    if (!last) return { ok: false, reason: '没有助手消息' }
    const d = last.querySelector('.search-decision')
    const s = last.querySelector('.search-info')
    const r = last.querySelector('.reasoning')
    const md = last.querySelector('.md')
    const follows = (a, b) =>
      !!(a && b && a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    return {
      ok: !!d && !!s && !!r && !!md,
      decisionBeforeSearch: follows(d, s),
      searchBeforeReasoning: follows(s, r),
      reasoningBeforeMarkdown: follows(r, md),
    }
  })
  assert.equal(order.ok, true, '缺少联网判断/来源/思考/正文中的某一项')
  assert.equal(order.decisionBeforeSearch, true, '「联网判断」应在搜索来源之前')
  assert.equal(order.searchBeforeReasoning, true, '搜索来源应在回复思考之前')
  assert.equal(order.reasoningBeforeMarkdown, true, '回复思考应在正文之前')
}

// ---------- 用例 ----------

const tests = []
const test = (id, name, fn) => tests.push({ id, name, fn })

test('C01', '首页渲染 / 发送按钮禁用态', async ({ page }) => {
  assert.equal(await page.locator('.empty-title').innerText(), '开始新对话')
  assert.equal(await page.locator(SEL.send).isDisabled(), true, '空输入时应禁用发送')
  await page.fill(SEL.composer, '你好')
  assert.equal(await page.locator(SEL.send).isEnabled(), true, '有输入时应可发送')
  await page.fill(SEL.composer, '')
  assert.equal(await page.locator(SEL.send).isDisabled(), true, '清空后应重新禁用')
})

test('C02', '流式回复 / Markdown 与代码块渲染', async ({ page }) => {
  await sendAndWait(page, '你好，做个自我介绍')
  const text = await assistantText(page)
  assert.ok(text.includes('流式 Markdown'), `回复内容异常：${text.slice(0, 80)}`)
  assert.ok((await lastAssistant(page).locator('pre code').count()) > 0, '代码块未渲染')
  assert.ok((await page.locator('.stream-caret').count()) === 0, '结束后仍有流式光标')
  assert.equal(await page.locator(SEL.composer).inputValue(), '', '发送后输入框未清空')
  assert.equal(await page.locator('.search-decision').count(), 0, '关闭联网时不应出现联网判断')
})

test('C03', '多轮对话携带上下文', async ({ page }) => {
  await sendAndWait(page, '第一轮：你好')
  assert.match(await assistantText(page), /携带历史 1 条/, '第一轮历史数应为 1')
  await sendAndWait(page, '第二轮：继续')
  assert.match(await assistantText(page), /携带历史 3 条/, '第二轮历史数应为 3')
  assert.equal(await page.locator('.msg-user').count(), 2)
  assert.equal(await page.locator('.msg-assistant').count(), 2)
})

test('C04', '停止生成：及时停下且保留已生成内容', async ({ page }) => {
  await page.fill(SEL.composer, '[[slow]] 请写一段很长的说明')
  await page.click(SEL.send)
  await page.waitForSelector(SEL.stop, { timeout: 10000 })
  // 等正文真的开始输出，避免「停止」发生在首包之前
  await page.waitForFunction(
    () => (document.querySelector('.msg-assistant .md')?.textContent ?? '').length > 20,
    null,
    { timeout: 10000 },
  )
  const before = (await assistantText(page)).length
  const t0 = Date.now()
  await page.click(SEL.stop)
  await page.waitForSelector(SEL.stop, { state: 'detached', timeout: 5000 })
  const elapsed = Date.now() - t0
  assert.ok(elapsed < 3000, `停止耗时过长：${elapsed}ms`)
  await sleep(600)
  const after = (await assistantText(page)).length
  assert.ok(after >= before, `已生成内容丢失：${before} → ${after}`)
  assert.ok(after > 20, '停止后没有保留内容')
  assert.equal(await page.locator('.msg-assistant').count(), 1)
})

test('C05', '重新生成：原地替换不追加', async ({ page }) => {
  await sendAndWait(page, '你好，重新生成测试')
  assert.equal(await page.locator('.msg-assistant').count(), 1)
  await lastAssistant(page).locator('button[aria-label="重新生成"]').click()
  await page.waitForSelector(SEL.stop, { timeout: 10000 })
  await waitIdle(page)
  assert.equal(await page.locator('.msg-assistant').count(), 1, '重新生成后不应追加新消息')
  assert.equal(await page.locator('.error-card').count(), 0, '重新生成后出现错误卡片')
})

test('C06', '编辑重发：截断后续消息并重新生成', async ({ page }) => {
  await sendAndWait(page, '第一问')
  await sendAndWait(page, '第二问')
  assert.equal(await page.locator('.msg-user').count(), 2)
  await page.locator('.msg-user').first().locator('button[aria-label="编辑"]').click()
  await page.fill('.edit-box textarea', '改写后的问题')
  await page.click('.edit-save')
  await page.waitForSelector(SEL.stop, { timeout: 10000 })
  await waitIdle(page)
  assert.equal(await page.locator('.msg-user').count(), 1, '编辑旧消息后后续提问应被截断')
  assert.equal(await page.locator('.msg-assistant').count(), 1)
  assert.ok((await page.locator('.msg-user .bubble').first().innerText()).includes('改写后的问题'))
})

test('C07', '生成中切换会话：不串消息、原回复落库', async ({ page }) => {
  await page.fill(SEL.composer, '[[slow]] 会话A的慢速问题')
  await page.click(SEL.send)
  await page.waitForSelector(SEL.stop, { timeout: 10000 })
  await page.waitForFunction(
    () => (document.querySelector('.msg-assistant .md')?.textContent ?? '').length > 20,
    null,
    { timeout: 10000 },
  )
  await openDrawer(page)
  await page.click(SEL.newChat)
  await page.waitForSelector('.empty-title')
  await sendAndWait(page, '会话B的问题')
  assert.ok((await assistantText(page)).includes('流式 Markdown'))

  // 切回 A：应保留 A 的部分回复，且不含 B 的内容
  await openDrawer(page)
  await (await sessionItem(page, '会话A的慢速问题')).click()
  // 会话切换是异步读库的：必须等 A 的消息真正渲染出来再断言，
  // 否则会读到切换前 B 的 DOM（曾经把 C07 误报成「回复未落库」）
  await page.waitForFunction(
    () => (document.querySelector('.msg-user .bubble')?.textContent ?? '').includes('会话A'),
    null,
    { timeout: 10000 },
  )
  await page.waitForFunction(
    () => (document.querySelector('.msg-assistant .md')?.textContent ?? '').includes('第 1 段'),
    null,
    { timeout: 10000 },
  )
  const aText = await page.locator('.msg-assistant .md').last().innerText()
  assert.ok(aText.includes('第 1 段'), `会话A回复未落库：${aText.slice(0, 60)}`)
  assert.ok(!(await page.locator('.msg-user .bubble').last().innerText()).includes('会话B'), '会话A串入了B的提问')

  // 切回 B：内容完整且不串 A
  await openDrawer(page)
  await (await sessionItem(page, '会话B的问题')).click()
  await page.waitForFunction(
    () => (document.querySelector('.msg-user .bubble')?.textContent ?? '').includes('会话B'),
    null,
    { timeout: 10000 },
  )
  assert.equal(await page.locator('.msg-assistant').count(), 1)
  assert.ok(!(await assistantText(page)).includes('第 1 段'), '会话B串入了A的回复')
})

test('C08', '联网开启但闲聊：模型判定不搜索', async ({ page }) => {
  await sendAndWait(page, '你好，随便聊聊，不用查资料')
  assert.equal(await page.locator('.search-info').count(), 0, '闲聊不应出现搜索来源')
  const decision = await page.locator('.search-decision').innerText()
  assert.match(decision, /无需联网/, `应显示「无需联网」：${decision}`)
  const stats = await getStats()
  assert.deepEqual(
    { chat: stats.chat, decision: stats.decision, search: stats.search },
    { chat: 2, decision: 1, search: 0 },
    `请求次数异常：${JSON.stringify(stats)}`,
  )
})

test('C09', '联网开启且需实时信息：自动搜索并展示来源', async ({ page }) => {
  // 不含「金价/天气/查一下」等明显关键词，走模型判断分支
  await sendAndWait(page, '分析一下 API Key 请求失败的可能原因', 60000)
  await page.waitForSelector('.search-info', { timeout: 10000 })
  assert.equal(await page.locator('.search-source').count(), 3, '来源数量应为 3')
  const decision = await page.locator('.search-decision').innerText()
  assert.match(decision, /需要联网/, `联网判断应显示需要联网：${decision}`)
  assert.match(decision, /API Key|零宽字符/, `联网判断应显示查询词：${decision}`)
  await assertSearchOrder(page)
  const head = await page.locator('.search-head-text').innerText()
  assert.match(head, /已搜索「.+」 · 3 条来源/)
  const stats = await getStats()
  assert.deepEqual(
    { chat: stats.chat, decision: stats.decision, search: stats.search },
    { chat: 2, decision: 1, search: 1 },
    `请求次数异常：${JSON.stringify(stats)}`,
  )
})

test('C10', '刷新后会话与消息持久化', async ({ page }) => {
  await sendAndWait(page, '持久化测试消息')
  const before = await assistantText(page)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector(SEL.composer)
  assert.equal(await page.locator('.msg-user').count(), 0, '刷新后不应自动打开会话（当前设计）')
  await openDrawer(page)
  await (await sessionItem(page, '持久化测试消息')).click()
  await page.waitForFunction(
    () => (document.querySelector('.msg-user .bubble')?.textContent ?? '').includes('持久化测试消息'),
    null,
    { timeout: 10000 },
  )
  assert.ok((await assistantText(page)).includes(before.slice(0, 24)), '刷新后回复内容丢失')
})

test('C11', '会话重命名与删除', async ({ page }) => {
  await sendAndWait(page, '准备重命名的会话')
  await openDrawer(page)
  const item = await sessionItem(page, '准备重命名的会话')
  await item.hover()
  await item.locator('[aria-label="重命名会话"]').click()
  await page.fill('.dialog-card input', '改好的标题')
  await page.click('.dialog-ok')
  await page.waitForFunction(
    () => [...document.querySelectorAll('.session-title')].some((e) => e.textContent === '改好的标题'),
    null,
    { timeout: 5000 },
  )

  const renamed = await sessionItem(page, '改好的标题')
  await renamed.hover()
  await renamed.locator('[aria-label="删除会话"]').click()
  await page.click('.dialog-ok')
  await page.waitForFunction(() => document.querySelectorAll('.session-item').length === 0, null, {
    timeout: 5000,
  })
  assert.equal(await page.locator('.session-item').count(), 0)
  assert.ok(await page.locator('.empty-title').isVisible())
})

test('C12', '设置页进入与返回', async ({ page }) => {
  await page.click(SEL.settings)
  await page.waitForSelector('text=关于')
  assert.equal(new URL(page.url()).hash, '#/settings')
  await page.click(SEL.back)
  await page.waitForSelector(SEL.composer)
  assert.equal(new URL(page.url()).hash, '#/')
})

test('C13', '存为 Markdown 文件', async ({ page }) => {
  await sendAndWait(page, '你好，存为文件测试')
  await lastAssistant(page).locator(SEL.saveFile).click()
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.click('text=Markdown（.md）'),
  ])
  assert.match(download.suggestedFilename(), /\.md$/)
  const file = await download.path()
  assert.ok(statSync(file).size > 100, '导出的 Markdown 内容过小')
})

test('C14', '导出整段对话', async ({ page }) => {
  await sendAndWait(page, '你好，导出对话测试')
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.click(SEL.export),
  ])
  assert.match(download.suggestedFilename(), /\.md$/)
  const file = await download.path()
  assert.ok(statSync(file).size > 100, '导出的对话内容过小')
})

test('C15', '附件消息：文本附件 + 图片可正常发送', async ({ page }) => {
  // 文本附件（走 IndexedDB 持久化，历史上曾因响应式 Proxy 触发 DataCloneError）
  await page.click('button[aria-label="添加附件"]')
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('.attach-menu button:has-text("文件")'),
  ])
  await fileChooser.setFiles({
    name: '说明.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('附件内容：这是一段用于冒烟测试的文本。'),
  })
  await page.waitForSelector('.file-chip-name')

  // 图片附件（压缩后走多模态）
  await page.click('button[aria-label="添加附件"]')
  const [imageChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('.attach-menu button:has-text("图片")'),
  ])
  await imageChooser.setFiles({
    name: 'icon-32.png',
    mimeType: 'image/png',
    buffer: readFileSync(path.join(ROOT, 'public/icons/icon-32.png')),
  })
  await page.waitForSelector('.image-preview img')

  await sendAndWait(page, '看看这两个附件')
  const reply = await assistantText(page)
  assert.ok(reply.includes('【已收到 1 张图片】'), `图片未进入请求：${reply.slice(0, 80)}`)
  const bubble = await page.locator('.msg-user .bubble').last().innerText()
  assert.ok(bubble.includes('说明.txt'), '用户消息未显示附件名')
  assert.equal(await page.locator('.error-card').count(), 0, '附件消息发送失败')
})


test('C16', '明显地实时问题：跳过判断调用，先显示判断再搜索', async ({ page }) => {
  // 先制造一轮闲聊上下文（复现「先问你好，再问金价」的场景）
  await sendAndWait(page, '你好')
  await resetStats()

  const t0 = Date.now()
  await page.fill(SEL.composer, '今日金价多少？')
  await page.click(SEL.send)
  // 判断区块必须立刻出现（不应再等一次 4~5 秒的模型判断）
  await page.waitForFunction(
    () => {
      const all = document.querySelectorAll('.msg-assistant')
      return all.length >= 2 && !!all[all.length - 1].querySelector('.search-decision')
    },
    null,
    { timeout: 5000 },
  )
  const decisionMs = Date.now() - t0
  assert.ok(decisionMs < 3000, `联网判断区块出现太慢：${decisionMs}ms`)

  await page.waitForSelector(SEL.stop, { timeout: 10000 })
  await waitIdle(page, 60000)

  const stats = await getStats()
  assert.equal(stats.decision, 0, '明显实时问题不应再调用判断模型')
  assert.equal(stats.search, 1, '应发起一次搜索')
  assert.equal(stats.chat, 1, '只需要一次回答请求')
  assert.match(stats.lastSearchQuery, /金价/, `搜索词应包含金价：${stats.lastSearchQuery}`)

  const last = page.locator('.msg-assistant').last()
  const decision = await last.locator('.search-decision').innerText()
  assert.match(decision, /需要联网/, `应显示需要联网：${decision}`)
  assert.match(decision, /今日金价/, `应显示查询词：${decision}`)
  assert.match(decision, /自动识别/, '应标注为本地识别')
  assert.equal(await last.locator('.search-source').count(), 3)
  assert.match(await last.locator('.search-source-title').first().innerText(), /金价/)

  await assertSearchOrder(page)
})

// ---------- 主流程 ----------

let browser

async function main() {
  if (LIST) {
    for (const t of tests) console.log(`${t.id}  ${t.name}`)
    return
  }

  if (!existsSync(VITE_BIN)) throw new Error('未安装依赖：node_modules/vite 不存在，请先 npm install')
  if (!NO_BUILD) {
    console.log('▸ 构建生产包…')
    const r = spawnSync(process.execPath, [VITE_BIN, 'build'], { cwd: ROOT, stdio: 'inherit' })
    if (r.status !== 0) throw new Error('构建失败，已中止冒烟测试')
  }
  if (!existsSync(path.join(ROOT, 'dist/index.html'))) {
    throw new Error('dist/index.html 不存在，请先 npm run build')
  }

  console.log('▸ 准备测试服务…')
  if (await isUp(`${MOCK}/__stats`, (t) => t.includes('"chat"'))) {
    console.log(`  · 复用已运行的 Mock（${MOCK}）`)
  } else {
    if (await isUp(MOCK)) {
      throw new Error(
        `${MOCK} 已被其他进程占用（不是本项目的 Mock）。请先结束它，或设置 MOFA_MOCK_PORT 换端口。`,
      )
    }
    start('mock', process.execPath, [path.join(ROOT, 'scripts/mock-llm-server.mjs')], {
      PORT: String(MOCK_PORT),
    })
    await waitFor(`${MOCK}/__stats`, (t) => t.includes('"chat"'), 'Mock LLM')
  }
  if (await isUp(BASE, (t) => t.includes('id="app"'))) {
    console.log(`  · 复用已运行的预览服务（${BASE}）`)
  } else {
    if (await isUp(BASE)) {
      throw new Error(
        `${BASE} 返回的不是 MoFa 页面。请先结束占用进程，或设置 MOFA_PREVIEW_PORT 换端口。`,
      )
    }
    start('preview', process.execPath, [
      VITE_BIN,
      'preview',
      '--port',
      String(PREVIEW_PORT),
      '--strictPort',
    ])
    await waitFor(BASE, (t) => t.includes('id="app"'), '生产包预览')
  }

  console.log(`▸ 启动浏览器：${findChrome()}`)
  browser = await chromium.launch({
    executablePath: findChrome(),
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })

  const selected = ONLY ? tests.filter((t) => ONLY.split(',').includes(t.id)) : tests
  if (!selected.length) throw new Error(`--only=${ONLY} 没有匹配的用例`)

  const results = []
  for (const t of selected) {
    const t0 = Date.now()
    const ctx = await newPage({ webSearch: ['C08', 'C09', 'C16'].includes(t.id) })
    try {
      await t.fn({ page: ctx.page, context: ctx.context })
      if (ctx.pageErrors.length) throw new Error(`未捕获异常：${ctx.pageErrors.join(' | ')}`)
      if (ctx.consoleErrors.length) {
        console.log(`  ⚠ 控制台错误：${ctx.consoleErrors.slice(0, 3).join(' | ')}`)
      }
      results.push({ ...t, ok: true, ms: Date.now() - t0 })
      console.log(`✓ ${t.id} ${t.name} (${Date.now() - t0}ms)`)
    } catch (e) {
      results.push({ ...t, ok: false, ms: Date.now() - t0, error: e.message })
      console.error(`✗ ${t.id} ${t.name} (${Date.now() - t0}ms)\n  ${e.message.split('\n')[0]}`)
      // 失败时留存现场，便于排查
      try {
        await ctx.page.screenshot({ path: path.join(ROOT, `smoke-fail-${t.id}.png`), fullPage: true })
        console.error(`  截图：smoke-fail-${t.id}.png`)
      } catch {
        /* ignore */
      }
    } finally {
      await ctx.context.close()
    }
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\n${'='.repeat(56)}`)
  console.log(`通过 ${results.length - failed.length}/${results.length}，耗时 ${Math.round(results.reduce((s, r) => s + r.ms, 0) / 1000)}s`)
  if (failed.length) {
    console.log('失败用例：')
    for (const f of failed) console.log(`  - ${f.id} ${f.name}\n    ${f.error.split('\n')[0]}`)
    console.log('排查建议：docs/TESTING.md「失败排查」一节')
  }
  console.log('='.repeat(56))
  process.exitCode = failed.length ? 1 : 0
}

main()
  .catch((e) => {
    console.error(`\n冒烟测试无法运行：${e.message}`)
    process.exitCode = 1
  })
  .finally(async () => {
    if (browser) await browser.close().catch(() => undefined)
    stopChildren()
  })
