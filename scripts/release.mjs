/**
 * 一键发版脚本：
 *   node scripts/release.mjs <版本号> [更新说明]
 *   例：node scripts/release.mjs 0.0.2 "新增思考强度选择；修复若干问题"
 *
 * 做的事：
 *   1. 更新 android/app/build.gradle 的 versionName/versionCode 与 src/config.ts 的兜底版本
 *   2. npm run build → npx cap sync android → gradle assembleDebug
 *   3. 产物复制为 releases/mofa-<版本>.apk，并生成 releases/latest.json
 *
 * 之后把 releases/ 下这两个文件上传到服务器（见 README「自动更新」）。
 */
import { execSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const version = process.argv[2]
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('用法: node scripts/release.mjs <x.y.z> [更新说明]')
  process.exit(1)
}
const changelog = process.argv[3] || ''

const [major, minor, patch] = version.split('.').map(Number)
const versionCode = major * 10000 + minor * 100 + patch

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
console.log(`版本号已更新: ${version} (versionCode ${versionCode})`)

// 2. 构建
run('npm run build')
run('npx cap sync android')
run(
  'gradlew.bat assembleDebug',
  { cwd: resolve(ROOT, 'android'), env: { ...process.env, JAVA_HOME: 'D:\\IDE\\Android Studio\\jbr', ANDROID_HOME: 'D:\\AndroidStudioSdk\\Sdk' } },
)

// 3. 产出
const releasesDir = resolve(ROOT, 'releases')
mkdirSync(releasesDir, { recursive: true })
const apkName = `mofa-${version}.apk`
copyFileSync(resolve(ROOT, 'android/app/build/outputs/apk/debug/app-debug.apk'), resolve(releasesDir, apkName))

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
