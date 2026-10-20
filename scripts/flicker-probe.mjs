#!/usr/bin/env node
/**
 * 空白页「低频闪烁」探针（真机 / adb）
 *
 * 用途：客户反馈「空白首页会低频闪一下」时，在自己机器上尽量复现并给出判据。
 * 一次运行做三件事：
 *   1. 统计空闲期间 App 自己有没有在出帧（dumpsys gfxinfo）——为 0 说明页面根本没重绘，
 *      闪烁只可能来自合成/显示层，而不是 CSS 动画或 Vue 重渲染。
 *   2. 录屏 N 秒，用 ffmpeg 逐帧量「状态栏 / 顶栏 / 中间 / 底部手势条」四块区域的平均亮度，
 *      报告最大跳变与发生时刻（短路闪最容易只在某一小块上出现）。
 *   3. 打印设备信息（机型 / Android 版本 / WebView 版本），方便和客户比对。
 *
 * 用法：
 *   node scripts/flicker-probe.mjs                 # 默认 60 秒
 *   node scripts/flicker-probe.mjs --seconds=180   # 最长 180 秒（screenrecord 上限）
 *   node scripts/flicker-probe.mjs --no-record     # 只统计帧数，不录屏
 *   node scripts/flicker-probe.mjs --adb="D:/Android/android-sdk/platform-tools/adb.exe"
 *
 * 前置：USB 调试已连接；App 先停在空白首页（没有任何消息），深色皮肤各测一次。
 * 依赖：adb；录屏分析需要 ffmpeg（没有则只保存 mp4，人工看）。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ARGS = process.argv.slice(2)
const arg = (name, fallback) => {
  const hit = ARGS.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}
const PKG = arg('pkg', 'com.mofa.chat')
const SECONDS = Math.min(180, Math.max(10, Number(arg('seconds', '60')) || 60))
const NO_RECORD = ARGS.includes('--no-record')
const ADB = arg('adb', process.env.ADB || 'adb')
const FFMPEG = arg('ffmpeg', process.env.FFMPEG || 'ffmpeg')
const OUT_DIR = path.join(os.tmpdir(), 'mofa-flicker')

/** 同步等待（脚本是线性的，没必要引入异步） */
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

/** 画面分区（相对高度）：短路闪往往只出现在状态栏或手势条那一窄条上 */
const REGIONS = [
  { name: '状态栏', y: 0.0, h: 0.07 },
  { name: '顶栏', y: 0.07, h: 0.06 },
  { name: '中间', y: 0.25, h: 0.5 },
  { name: '手势条', y: 0.93, h: 0.07 },
]

const adb = (args, opts = {}) =>
  execFileSync(ADB, args, { encoding: 'utf8', timeout: 30000, ...opts }).trim()

function need(ok, msg) {
  if (!ok) {
    console.error(`\n✗ ${msg}`)
    process.exit(1)
  }
}

// ---------- 环境 ----------
try {
  adb(['version'])
} catch {
  need(false, `找不到 adb（${ADB}）。用 --adb=<路径> 指定，或把 platform-tools 加进 PATH。`)
}

const devices = adb(['devices'])
  .split('\n')
  .slice(1)
  .map((l) => l.trim().split(/\s+/))
  .filter((c) => c[1] === 'device')
need(devices.length > 0, '没有已授权的设备。先在手机上确认「允许 USB 调试」。')

const model = adb(['shell', 'getprop', 'ro.product.model'])
const sdk = adb(['shell', 'getprop', 'ro.build.version.sdk'])
const release = adb(['shell', 'getprop', 'ro.build.version.release'])
let webview = ''
for (const p of ['com.google.android.webview', 'com.android.webview']) {
  try {
    webview = adb(['shell', 'dumpsys', 'package', p]).match(/versionName=(\S+)/)?.[1] ?? ''
    if (webview) break
  } catch {
    /* 该 ROM 没有这个包 */
  }
}
const pid = adb(['shell', 'pidof', PKG]) || ''
need(!!pid, `应用没在运行：先打开 ${PKG} 并停在空白首页，再跑本脚本。`)

console.log(`设备：${model}  Android ${release}（API ${sdk}）  WebView ${webview || '未知'}`)
console.log(`应用：${PKG}（pid ${pid}）`)

// ---------- 静置 + 统计帧数 ----------
console.log(`\n▸ 静置 ${SECONDS}s，期间不要碰手机…`)
try {
  adb(['shell', 'svc', 'power', 'stayon', 'true'])
} catch {
  /* 部分 ROM 不允许，忽略 */
}
adb(['shell', 'dumpsys', 'gfxinfo', PKG, 'reset'])

mkdirSync(OUT_DIR, { recursive: true })
const remote = `/sdcard/mofa-flicker-${Date.now()}.mp4`
const local = path.join(OUT_DIR, 'flicker.mp4')
let recorded = false

if (NO_RECORD) {
  sleep(SECONDS * 1000)
} else {
  console.log('▸ 同时录屏（静态画面下 screenrecord 只出很少几帧，属正常）')
  try {
    execFileSync(ADB, ['shell', 'screenrecord', '--time-limit', String(SECONDS), remote], {
      timeout: (SECONDS + 30) * 1000,
      stdio: 'ignore',
    })
    adb(['pull', remote, local], { timeout: 60000 })
    adb(['shell', 'rm', '-f', remote])
    recorded = existsSync(local)
  } catch {
    console.log('  · 录屏失败（部分 ROM 限制 screenrecord），只做帧数统计')
  }
}

const gfx = adb(['shell', 'dumpsys', 'gfxinfo', PKG])
const frames = Number(gfx.match(/Total frames rendered:\s*(\d+)/)?.[1] ?? -1)

// ---------- 帧亮度分析 ----------
function analyze(video) {
  try {
    execFileSync(FFMPEG, ['-version'], { stdio: 'ignore', timeout: 5000 })
  } catch {
    return null
  }
  const ffmpeg = FFMPEG

  const rows = []
  const videoName = path.basename(video)
  for (const [i, r] of REGIONS.entries()) {
    // ffmpeg 的 filtergraph 用 ':' 分隔参数，绝对路径里的盘符会被当成参数名。
    // 因此统一 cwd 到输出目录、只传相对文件名。
    const txtName = `yavg-${i}.txt`
    const txt = path.join(OUT_DIR, txtName)
    rmSync(txt, { force: true })
    execFileSync(
      ffmpeg,
      [
        '-v', 'error',
        '-i', videoName,
        '-vf', `crop=iw:ih*${r.h}:0:ih*${r.y},signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=${txtName}`,
        '-f', 'null',
        '-',
      ],
      { stdio: 'ignore', timeout: 120000, cwd: OUT_DIR },
    )
    if (!existsSync(txt)) continue
    const lines = readFileSync(txt, 'utf8').split('\n')
    const samples = []
    let time = 0
    for (const line of lines) {
      const t = line.match(/pts_time:([\d.]+)/)
      if (t) time = Number(t[1])
      const v = line.match(/YAVG=([\d.]+)/)
      if (v) samples.push({ t: time, y: Number(v[1]) })
    }
    if (samples.length < 2) continue
    const values = samples.map((s) => s.y)
    const min = Math.min(...values)
    const max = Math.max(...values)
    const at = samples.find((s) => s.y === max)?.t ?? 0
    rows.push({ region: r.name, frames: samples.length, jump: +(max - min).toFixed(3), max, at })
  }
  return rows
}

// ---------- 结论 ----------
console.log('\n================ 结果 ================')
console.log(`空闲 ${SECONDS}s 内 App 绘制帧数：${frames < 0 ? '读取失败' : frames}`)
if (frames === 0) {
  console.log('  → 页面完全没有重绘：闪烁不来自 CSS 动画 / Vue 重渲染，')
  console.log('    只可能是合成层或屏幕本身（如 PWM 调光、刷新率切换）。')
} else if (frames > 0) {
  console.log(`  → 空闲时仍在出帧（约 ${(frames / SECONDS).toFixed(2)} fps），`)
  console.log('    说明页面里有东西在动，重点查这段期间的 CSS 动画。')
}

if (recorded) {
  console.log(`\n录屏：${local}`)
  const table = analyze(local)
  if (!table) {
    console.log('  · 没找到 ffmpeg，跳过逐帧分析（直接看上面这个 mp4 也行）')
  } else {
    console.log('  区域     帧数   最大亮度跳变   峰值时刻')
    for (const r of table) {
      const flag = r.jump >= 1.5 ? '  ← 有跳变' : ''
      console.log(
        `  ${r.region.padEnd(6)}  ${String(r.frames).padStart(4)}   ${String(r.jump).padStart(10)}   ${r.at.toFixed(1)}s${flag}`,
      )
    }
    const worst = table.reduce((a, b) => (b.jump > a.jump ? b : a), table[0])
    console.log(
      worst.jump >= 1.5
        ? `\n  ✗ 「${worst.region}」出现跳变，可对照 ${worst.at.toFixed(1)}s 的位置逐帧看图确认是否就是客户说的闪`
        : '\n  ✓ 各区域亮度平稳，这一次没有闪（说明是偶发，需要更长时间或客户机型才能撞上）',
    )
    console.log('  提示：让客户自己录屏，如果录屏里也能看到闪 → 合成层；看不到 → 屏幕/背光本身。')
  }
}
console.log('======================================\n')
