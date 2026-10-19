/**
 * 一键发版脚本：
 *   node scripts/release.mjs <版本号> [更新说明]
 *   例：node scripts/release.mjs 0.0.2 "新增思考强度选择；修复若干问题"
 *
 * 做的事：
 *   1. 更新 android/app/build.gradle 的 versionName/versionCode 与 src/config.ts 的兜底版本
 *   2. npm run build → npx cap sync android → gradle assembleRelease（正式签名）
 *   3. 产物复制为 releases/mofa-<版本>.apk，并生成 releases/latest.json
 *
 * 之后把 releases/ 下这两个文件上传到服务器（见 README「自动更新」）。
 */
import { execSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const version = process.argv[2]
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('用法: node scripts/release.mjs <x.y.z> [更新说明]')
  process.exit(1)
}
const changelog = process.argv[3] || ''

const [major, minor, patch] = version.split('.').map(Number)
// 每段留 3 位：0.0.100 与 0.1.0 不会撞号（原 10000/100 规则在这两种版本上会冲突）
if (minor > 999 || patch > 999) {
  console.error('版本号的 minor / patch 段不能超过 999')
  process.exit(1)
}
const versionCode = major * 1_000_000 + minor * 1_000 + patch

function run(cmd, opts = {}) {
  console.log(`> ${cmd}`)
  execSync(cmd, { stdio: 'inherit', cwd: ROOT, shell: true, ...opts })
}

// 1. 改版本号
const gradlePath = resolve(ROOT, 'android/app/build.gradle')
let gradle = readFileSync(gradlePath, 'utf8')
gradle = gradle.replace(/versionCode \d+/, `versionCode ${versionCode}`)
gradle = gradle.replace(/versionName "[^"]*"/, `versionName "${version}"`)
writeFileSync(gradlePath, gradle)

const configPath = resolve(ROOT, 'src/config.ts')
let config = readFileSync(configPath, 'utf8')
config = config.replace(/APP_VERSION_FALLBACK = '[^']*'/, `APP_VERSION_FALLBACK = '${version}'`)
writeFileSync(configPath, config)

// package.json 版本号同步（保持三处一致，便于排查）
const pkgPath = resolve(ROOT, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
pkg.version = version
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')

console.log(`版本号已更新: ${version} (versionCode ${versionCode})`)

// 2. 构建
run('npm run build')
run('npx cap sync android')
run(
  'gradlew.bat assembleRelease',
  { cwd: resolve(ROOT, 'android'), env: { ...process.env, JAVA_HOME: 'D:\\IDE\\Android Studio\\jbr', ANDROID_HOME: 'D:\\AndroidStudioSdk\\Sdk' } },
)

// 3. 产出：先用 lineage 重签（v1/v2=旧 debug key，v3/v3.1=正式 key），再复制到 releases/
const releasesDir = resolve(ROOT, 'releases')
mkdirSync(releasesDir, { recursive: true })
const apkName = `mofa-${version}.apk`
const builtApk = resolve(ROOT, 'android/app/build/outputs/apk/release/app-release.apk')
if (!existsSync(builtApk)) {
  console.error('\n❌ 没有找到已签名的 release APK。请确认 android/keystore.properties 与 mofa-release.jks 存在。')
  process.exit(1)
}

/** 在 ANDROID SDK build-tools 里找 apksigner */
function findApksigner() {
  const sdk = process.env.ANDROID_HOME || 'D:/AndroidStudioSdk/Sdk'
  const btDir = join(sdk, 'build-tools')
  if (!existsSync(btDir)) return null
  for (const v of readdirSync(btDir).filter((d) => /^\d/.test(d)).sort().reverse()) {
    for (const name of ['apksigner.bat', 'apksigner']) {
      const exe = join(btDir, v, name)
      if (existsSync(exe)) return exe
    }
  }
  return null
}

/** 生成 0.0.7 旧包签名的 debug keystore（Android ≤12 的覆盖更新仍需要它） */
function findDebugKeystore() {
  const candidates = [
    process.env.ANDROID_SDK_HOME && join(process.env.ANDROID_SDK_HOME, '.android', 'debug.keystore'),
    process.env.USERPROFILE && join(process.env.USERPROFILE, '.android', 'debug.keystore'),
    process.env.HOME && join(process.env.HOME, '.android', 'debug.keystore'),
  ].filter(Boolean)
  return candidates.find((p) => existsSync(p)) || null
}

const apksignerExe = findApksigner()
const debugKs = findDebugKeystore()
const lineagePath = resolve(ROOT, 'android/lineage.bin')
const releaseKs = resolve(ROOT, 'android/mofa-release.jks')
const propsPath = resolve(ROOT, 'android/keystore.properties')
const canRotate = apksignerExe && debugKs && existsSync(lineagePath) && existsSync(releaseKs) && existsSync(propsPath)

if (canRotate) {
  const props = Object.fromEntries(
    readFileSync(propsPath, 'utf8')
      .split(/\r?\n/)
      .filter((l) => l.includes('='))
      .map((l) => {
        const i = l.indexOf('=')
        return [l.slice(0, i), l.slice(i + 1)]
      }),
  )
  const rotated = builtApk.replace(/\.apk$/, '.rotated.apk')
  console.log('> apksigner（lineage 重签：v1/v2=旧 key，v3/v3.1=正式 key）')
  execSync(
    `"${apksignerExe}" sign` +
      ` --ks "${debugKs}" --ks-key-alias androiddebugkey --ks-pass pass:android --key-pass pass:android` +
      ` --next-signer` +
      ` --ks "${releaseKs}" --ks-key-alias ${props.keyAlias} --ks-pass pass:${props.storePassword} --key-pass pass:${props.keyPassword}` +
      ` --lineage "${lineagePath}"` +
      ` --v4-signing-enabled false` +
      ` --in "${builtApk}" --out "${rotated}"`,
    { stdio: 'inherit' },
  )
  copyFileSync(rotated, resolve(releasesDir, apkName))
} else {
  copyFileSync(builtApk, resolve(releasesDir, apkName))
  console.warn(
    '⚠️ 未找到 apksigner / debug keystore / lineage.bin，' +
      '本次使用普通 release 签名：Android ≤12 的旧版用户将无法覆盖更新，只能卸载重装。',
  )
}

const updateBase = /UPDATE_BASE = '([^']+)'/.exec(readFileSync(configPath, 'utf8'))[1]
const latest = {
  version,
  url: `${updateBase}/${apkName}`,
  changelog,
}
writeFileSync(resolve(releasesDir, 'latest.json'), JSON.stringify(latest, null, 2) + '\n')

console.log('\n✅ 发版产物已生成，上传这两个文件到服务器即可：')
console.log(`   releases/${apkName}`)
console.log('   releases/latest.json')
console.log(`   （服务器目录对应 ${updateBase}）`)
