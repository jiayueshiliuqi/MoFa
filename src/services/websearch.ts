/**
 * 免费联网搜索：客户端直接请求搜索引擎结果页并解析，不依赖任何付费 API。
 *
 * 跨域问题走 CapacitorHttp（原生 HTTP，绕过 WebView CORS；Web 端自动退化为 fetch，
 * 届时仅支持 CORS 开放的源）。引擎链：Bing（国内外可达）→ DuckDuckGo → SearXNG
 * （用户自建/公共实例）。任一引擎改版或反爬导致失败时自动降级到下一个。
 */
import { Capacitor, CapacitorHttp } from '@capacitor/core'
import type { SearchInfo } from '@/db'

export type { SearchInfo }
export type SearchEnginePref = 'auto' | 'bing' | 'duckduckgo' | 'searxng'

export interface SearchResult {
  title: string
  url: string
  snippet: string
}

export interface WebSearchOutcome {
  query: string
  engine: string
  results: SearchResult[]
  /** 各结果的正文摘录（抓取成功时与 results 等长，失败位为空串） */
  texts: string[]
}

const UA =
  'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'

const ENGINE_TIMEOUT_MS = 9000
const PAGE_TIMEOUT_MS = 10000
const PAGE_CHARS = 3500
const FULLTEXT_PAGES = 3

/** 原生 HTTP GET/POST 文本（绕过 CORS；失败抛错由调用方降级） */
async function httpText(
  url: string,
  opts: { method?: 'GET' | 'POST'; data?: string; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<string> {
  const headers = {
    Accept: 'text/html,application/json,*/*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    ...(opts.data ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
  }
  // 原生端：CapacitorHttp 走系统网络栈，无 CORS 限制（可自定义 UA）。
  // 原生请求无法被 AbortSignal 中断，靠事前/事后检查 aborted 尽早退出。
  if (Capacitor.isNativePlatform()) {
    if (opts.signal?.aborted) throw abortError()
    const res = await CapacitorHttp.request({
      url,
      method: opts.method ?? 'GET',
      headers: { 'User-Agent': UA, ...headers },
      data: opts.data,
      connectTimeout: 8000,
      readTimeout: opts.timeoutMs ?? ENGINE_TIMEOUT_MS,
      responseType: 'text',
    })
    if (opts.signal?.aborted) throw abortError()
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`)
    const text = typeof res.data === 'string' ? res.data : String(res.data ?? '')
    if (!text) throw new Error('空响应')
    return text
  }
  // Web / PWA：退化为普通 fetch（受 CORS 约束，仅 CORS 开放的源可用，如 SearXNG/Wikipedia）
  const res = await fetch(url, { method: opts.method ?? 'GET', headers, body: opts.data, signal: opts.signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const text = await res.text()
  if (!text) throw new Error('空响应')
  return text
}

function abortError(): Error {
  return new DOMException('aborted', 'AbortError')
}

/** UTF-16 安全截断：避免切断代理对（emoji 等） */
function safeSlice(s: string, n: number): string {
  if (s.length <= n) return s
  const cut = s.slice(0, n)
  const code = cut.charCodeAt(cut.length - 1)
  return code >= 0xd800 && code <= 0xdbff ? cut.slice(0, -1) : cut
}

function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html')
}

function clean(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim()
}

// ---- Bing（含国内可直达的 cn 节点）----

async function searchBing(query: string, count: number, signal?: AbortSignal): Promise<SearchResult[]> {
  const html = await httpText(
    `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${Math.max(count, 10)}&mkt=zh-CN`,
    { signal },
  )
  const doc = parseHtml(html)
  const out: SearchResult[] = []
  for (const li of doc.querySelectorAll('li.b_algo')) {
    // Bing 现行结构是 <a href><h2>标题</h2></a>（a 包裹 h2），旧版是 h2 内嵌 a，两种都兼容
    const h2 = li.querySelector('h2')
    const a = (h2?.closest('a') ?? li.querySelector('h2 a')) as HTMLAnchorElement | null
    const url = a?.getAttribute('href') ?? ''
    const title = clean(a?.textContent)
    if (!a || !title || !url.startsWith('http')) continue
    const snippet = clean(li.querySelector('.b_caption p, .b_caption, p')?.textContent)
    out.push({ title, url, snippet })
    if (out.length >= count) break
  }
  if (!out.length) throw new Error('无结果（可能被要求人机验证）')
  return out
}

// ---- DuckDuckGo（html 端点；国内网络不可达，作为海外链路备选）----

function unwrapDdgLink(href: string): string {
  try {
    if (href.startsWith('//')) href = 'https:' + href
    const uddg = new URL(href).searchParams.get('uddg')
    return uddg ? decodeURIComponent(uddg) : href
  } catch {
    return href
  }
}

async function searchDuckDuckGo(query: string, count: number, signal?: AbortSignal): Promise<SearchResult[]> {
  const html = await httpText(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, { signal })
  const doc = parseHtml(html)
  const out: SearchResult[] = []
  for (const div of doc.querySelectorAll('div.result, div.web-result')) {
    const a = div.querySelector('a.result__a')
    const url = unwrapDdgLink(a?.getAttribute('href') ?? '')
    const title = clean(a?.textContent)
    if (!a || !title || !url.startsWith('http')) continue
    const snippet = clean(div.querySelector('.result__snippet')?.textContent)
    out.push({ title, url, snippet })
    if (out.length >= count) break
  }
  if (!out.length) throw new Error('无结果')
  return out
}

// ---- SearXNG（用户自填实例地址；JSON API 优先，失败退回解析结果页 HTML）----

async function searchSearxng(base: string, query: string, count: number, signal?: AbortSignal): Promise<SearchResult[]> {
  const b = base.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//.test(b)) throw new Error('SearXNG 地址无效')
  const q = encodeURIComponent(query)
  // JSON API
  try {
    const json = JSON.parse(await httpText(`${b}/search?q=${q}&format=json`, { signal }))
    const list = ((json?.results ?? []) as Array<Record<string, unknown>>)
      .map((r) => ({
        title: clean(String(r.title ?? '')),
        url: String(r.url ?? ''),
        snippet: clean(String(r.content ?? '')),
      }))
      .filter((r) => r.title && r.url.startsWith('http'))
      .slice(0, count)
    if (list.length) return list
  } catch {
    /* 实例多半禁用了 JSON，退回解析 HTML */
  }
  const doc = parseHtml(await httpText(`${b}/search?q=${q}`, { signal }))
  const out: SearchResult[] = []
  for (const art of doc.querySelectorAll('article.result, .result')) {
    const a = art.querySelector('h3 a, a.url_wrapper, a[href^="http"]')
    const url = a?.getAttribute('href') ?? ''
    const title = clean(a?.textContent)
    if (!a || !title || !url.startsWith('http')) continue
    const snippet = clean(art.querySelector('p.content')?.textContent)
    out.push({ title, url, snippet })
    if (out.length >= count) break
  }
  if (!out.length) throw new Error('无结果（实例可能禁用了该格式）')
  return out
}

// ---- 抓取网页正文 ----

/** 抓取单页并提取正文文本；内容过短（JS 渲染页等）返回空串，由调用方退回摘要 */
export async function fetchPageText(url: string, signal?: AbortSignal): Promise<string> {
  const html = await httpText(url, { timeoutMs: PAGE_TIMEOUT_MS, signal })
  const doc = parseHtml(html)
  doc
    .querySelectorAll('script, style, noscript, iframe, svg, form, button, header, footer, nav, aside')
    .forEach((el) => el.remove())
  const main = doc.querySelector('article') ?? doc.querySelector('main') ?? doc.body
  const text = clean(main?.textContent)
  return text.length >= 200 ? text.slice(0, PAGE_CHARS) : ''
}

// ---- 搜索入口（带引擎降级）----

export async function webSearch(
  query: string,
  opts: {
    engine: SearchEnginePref
    maxResults: number
    fetchFullText: boolean
    searxngUrl?: string
    signal?: AbortSignal
  },
): Promise<WebSearchOutcome> {
  const q = safeSlice(query.trim(), 80)
  if (!q) throw new Error('搜索词为空')
  const signal = opts.signal

  const chain: Array<{ name: string; run: () => Promise<SearchResult[]> }> = []
  if (opts.engine === 'auto' || opts.engine === 'bing') chain.push({ name: 'bing', run: () => searchBing(q, opts.maxResults, signal) })
  if (opts.engine === 'auto' || opts.engine === 'duckduckgo') chain.push({ name: 'duckduckgo', run: () => searchDuckDuckGo(q, opts.maxResults, signal) })
  if ((opts.engine === 'auto' && opts.searxngUrl?.trim()) || opts.engine === 'searxng')
    chain.push({ name: 'searxng', run: () => searchSearxng(opts.searxngUrl ?? '', q, opts.maxResults, signal) })
  if (opts.engine !== 'auto' && opts.engine === 'searxng' && !opts.searxngUrl?.trim())
    throw new Error('请先在设置中填写 SearXNG 实例地址')

  let results: SearchResult[] | null = null
  let engine = ''
  const errors: string[] = []
  for (const step of chain) {
    if (signal?.aborted) throw abortError()
    try {
      results = await step.run()
      engine = step.name
      break
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e
      errors.push(`${step.name}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  if (!results) throw new Error(errors.join('；') || '无可用搜索引擎')

  // 正文抓取：并行取前几条，失败的位留空（退回用摘要）
  const texts: string[] = results.map(() => '')
  if (opts.fetchFullText) {
    if (signal?.aborted) throw abortError()
    const top = results.slice(0, FULLTEXT_PAGES)
    const settled = await Promise.allSettled(top.map((r) => fetchPageText(r.url, signal)))
    settled.forEach((s, i) => {
      if (s.status === 'fulfilled' && s.value) texts[i] = s.value
    })
  }
  return { query: q, engine, results, texts }
}

// ---- 组装注入上下文的来源块 ----

export function buildSearchBlock(outcome: WebSearchOutcome): string {
  const date = new Date().toLocaleDateString('zh-CN')
  const instruction =
    '回答要求：优先依据以上搜索结果回答；引用某条结果的信息时在句末标注对应编号（如 [1]）；' +
    '给出答案时列出参考链接；若搜索结果与问题无关或不足，按你自己的知识回答并注明未经联网核实。'
  // 逐条按剩余预算裁剪（UTF-16 安全），保证总长受控且末尾的指令行永远完整
  let budget = 12000 - instruction.length - 200
  const parts: string[] = [`[联网搜索结果] 搜索词：${outcome.query}（${date}）`]
  outcome.results.forEach((r, i) => {
    const text = outcome.texts[i] || r.snippet || '（无摘要）'
    const clipped = safeSlice(text, Math.max(200, Math.min(3500, budget)))
    budget -= clipped.length
    parts.push(`[${i + 1}] ${r.title}`)
    parts.push(`链接：${r.url}`)
    parts.push(`内容：${clipped}`)
  })
  parts.push(instruction)
  return parts.join('\n')
}
