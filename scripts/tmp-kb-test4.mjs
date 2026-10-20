import { spawn } from 'node:child_process'
import path from 'node:path'
import { chromium } from 'playwright-core'
const mock = spawn(process.execPath, [path.resolve('scripts/mock-llm-server.mjs')], { stdio: 'ignore', windowsHide: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
for (let i = 0; i < 40; i++) { try { if ((await fetch('http://localhost:8787/__stats')).ok) break } catch {} await sleep(200) }
const PROVIDER = { id: 'mock', name: 'Mock', baseURL: 'http://localhost:8787', apiKey: 'sk-x', models: ['mock-pro'], enabled: true, apiStyle: 'openai', contextWindow: 64000 }
const browser = await chromium.launch({ executablePath: 'C:/Users/Admin/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe', headless: true })
const ctx = await browser.newContext({ viewport: { width: 400, height: 780 }, locale: 'zh-CN' })
await ctx.addInitScript(({ provider }) => {
  localStorage.setItem('mofa.providers', JSON.stringify([provider]))
  localStorage.setItem('mofa.selected', JSON.stringify({ providerId: provider.id, model: 'mock-pro' }))
  localStorage.setItem('mofa.settings', JSON.stringify({ theme: 'dark', statsEnabled: false, searchEngine: 'auto', searchMaxResults: 5, searchFullText: false, searxngUrl: '' }))
}, { provider: PROVIDER })
const page = await ctx.newPage()
page.on('console', (m) => { const t = m.text(); if (t.startsWith('[')) console.log('LOG', t) })
await page.goto('http://localhost:5200/', { waitUntil: 'domcontentloaded' })
await page.waitForSelector('textarea[placeholder="发消息…"]')
const waitIdle = () => page.waitForFunction(() => !document.querySelector('button[aria-label="停止生成"]') && !document.querySelector('.stream-caret'), null, { timeout: 45000 })
for (const q of ['第一轮', '第二轮', '第三轮']) {
  await page.fill('textarea[placeholder="发消息…"]', q + ' 请写一段较长的说明')
  await page.click('button[aria-label="发送"]')
  await waitIdle()
  await page.waitForTimeout(600)
}
const snap = (tag) => page.evaluate((tag) => {
  const el = document.querySelector('.message-list')
  const last = document.querySelector('.msg-assistant:last-of-type .md').getBoundingClientRect()
  const c = document.querySelector('.composer').getBoundingClientRect()
  return { tag, gap: Math.round(el.scrollHeight - el.scrollTop - el.clientHeight), msgs: document.querySelectorAll('.msg').length, lastBottom: Math.round(last.bottom), composerTop: Math.round(c.top) }
}, tag)
await page.evaluate(() => { const el = document.querySelector('.message-list'); el.scrollTop = el.scrollHeight })
const out = [await snap('before')]
await page.setViewportSize({ width: 400, height: 380 })
for (const [ms, tag] of [[200, 't200'], [500, 't500'], [1000, 't1000']]) { await page.waitForTimeout(ms); out.push(await snap(tag)) }
// 场景二：用户往上翻历史后再弹键盘，不能被强行拉回底部
await page.setViewportSize({ width: 400, height: 780 })
await page.waitForTimeout(300)
await page.evaluate(() => { const el = document.querySelector('.message-list'); el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight - 600) })
await page.waitForTimeout(300)
const upBefore = await page.evaluate(() => Math.round(document.querySelector('.message-list').scrollTop))
await page.setViewportSize({ width: 400, height: 380 })
await page.waitForTimeout(500)
const upAfter = await page.evaluate(() => Math.round(document.querySelector('.message-list').scrollTop))
console.log(JSON.stringify({ out, scrollUpCase: { upBefore, upAfter } }, null, 2))
await ctx.close(); await browser.close(); mock.kill()
