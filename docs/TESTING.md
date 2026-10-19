# MoFa 更新后测试手册

> 适用版本：v0.0.7+ ｜ 最后更新：2026-10-19

这份文档只解决一个问题：**每次改完功能，怎么确认没有把别的地方弄坏。**

它面向两类读者：接手项目的 AI，以及你自己。AI 请先读第 1 节并严格执行；人可以直接跳到第 3、4 节。

---

## 0. 30 秒版

```bash
npm run typecheck     # 类型
npm run test:smoke    # 自动构建 + 16 条核心回归（约 45 秒）
```

两条都过 ≠ 可以发布。还要按「改动 → 必测映射」补手工项；**动了原生代码或样式，必须上模拟器/真机**。

发布前完整走一遍第 4 节 P0 项 + 第 6 节清单。

---

## 1. 执行协议（AI 必须遵守）

### 1.1 五步流程

1. **看影响面**：`git diff --stat` + `git diff`，确认改了哪些层（UI / store / LLM 适配 / 原生 / 样式）。
2. **跑自动检查**：`npm run typecheck` → `npm run test:smoke`（默认会重新 build，别加 `--no-build`）。
3. **补手工项**：按 1.2 的映射表，把对应手工用例走一遍；P0 项不允许跳过。
4. **原生专项**：只要改了 `android/`、Capacitor 配置、弹层/定位/安全区样式，或发布正式包，就必须按第 5 节实测。
5. **写报告**：按第 8 节模板输出；未测项要明确写「未测 + 风险」，不能含糊带过。

### 1.2 改动 → 必测映射

| 改动位置 | 必跑自动用例 | 必补手工项 |
| --- | --- | --- |
| `src/stores/chat.ts` | C02–C07、C10、C15、C16 | B1–B9、D2、D3 |
| `src/services/llm/*`、`src/lib/context.ts` | C02、C03、C05、C08、C09 | C1–C5（三协议各一条） |
| `src/services/llm/sse.ts` | C02、C04 | B6、B10（断网/超时） |
| `src/services/websearch.ts` | C08、C09、C16 | D1–D7 |
| `src/components/chat/MessageList.vue`、`MarkdownView.vue` | C02 | B9（长回答滚动） |
| `src/components/chat/Composer.vue` | C01、C06、C15 | B1、B7、E1–E4 |
| `src/lib/filesave.ts`、`export.ts` | C13、C14 | F1–F4 |
| `src/db/index.ts`、`src/stores/providers.ts` | C10–C12 | A2、A3、C3 |
| 任何弹层 / `position: fixed` / 安全区样式 | — | H4（旧 WebView） |
| `android/**`、`capacitor.config.ts` | — | 第 5 节全部 + I1–I5 |
| 只改文案 / README | — | 抽查对应页面即可 |

### 1.3 通过标准

- `vue-tsc` 0 错误、`vite build` 成功。
- `npm run test:smoke` **16/16**。
- 第 4 节所有 **P0** 项通过；P1 项失败必须有明确记录和取舍，不能沉默。
- 改了原生：安装、启动、返回键、更新下载至少各测一次。
- 没有新增控制台未捕获异常（`pageerror`）。

### 1.4 不允许的做法

- 只跑 C01/C02 就宣布「测试通过」。
- 用真实 API Key 跑自动化（一律用 mock，避免花钱和污染数据）。
- 不 build 就 `--no-build`，测到的是旧包。
- 拿「之前测过了」当理由跳过受影响模块。
- 修完 bug 不补用例、不登记到第 7 节。

### 1.5 最容易漏的 6 类

历史上真实漏测过的，几乎都落在这几类：

1. **只测顺利路径**：没测停止、切换会话、编辑旧消息、删除。
2. **只测 Web**：原生才暴露（CapacitorHttp 返回对象、旧 WebView 不支持 `inset`）。
3. **只测短回复**：长回答才会暴露滚动跟随、渲染卡顿。
4. **只测第一次**：第二次更新、第二个附件、第二次保存才暴露覆盖/残留问题。
5. **只测新数据**：旧版本 localStorage / IndexedDB 缺字段时白屏。
6. **只测一个协议**：OpenAI 通了，Anthropic / Gemini 可能 400。

---

## 2. 测试环境

### 2.1 本机路径（其他机器请替换）

| 项目 | 路径 |
| --- | --- |
| JDK | `D:/IDE/Android Studio/jbr` |
| Android SDK | `D:/AndroidStudioSdk/Sdk` |
| adb | `D:/AndroidStudioSdk/Sdk/platform-tools/adb.exe` |
| 模拟器 | `D:/AndroidStudioSdk/Sdk/emulator/emulator.exe` |
| AVD | `New_Device_1_API_30`（WebView 为 Chrome 83，适合测旧内核兼容） |
| Chromium | `C:/Users/Admin/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe` |

### 2.2 一次性准备

```bash
npm install
# 自动化浏览器（playwright-core 已加入 devDependencies）
# 若本机没有 Playwright 的 Chromium，安装 Chrome 或用 MOFA_CHROME 指定：
#   MOFA_CHROME="C:/Program Files/Google/Chrome/Application/chrome.exe"
```

自动化用例不访问外网：LLM、模型列表、SearXNG 搜索、更新清单全部由 `scripts/mock-llm-server.mjs` 模拟。

---

## 3. 自动化冒烟（每次必跑）

### 3.1 命令

```bash
npm run test:smoke                    # 构建 + 启动 mock/预览 + 跑全部
npm run test:smoke -- --only=C04,C07  # 只跑指定用例
npm run test:smoke -- --list          # 列出用例
npm run test:smoke -- --no-build      # 复用 dist（仅在确认 dist 是最新时）
```

脚本会自己启动 Mock（8787）和预览（5200）；已在运行则复用。失败会在项目根目录留 `smoke-fail-<ID>.png`。

环境变量：`MOFA_MOCK_PORT`、`MOFA_PREVIEW_PORT`、`MOFA_CHROME`、`MOFA_SMOKE_DEBUG=1`。

### 3.2 覆盖清单

| ID | 用例 | 主要防的回归 |
| --- | --- | --- |
| C01 | 首页渲染 / 发送按钮禁用态 | 空消息可发、按钮状态错 |
| C02 | 流式回复 / Markdown 与代码块 | 不流式、代码块不渲染、发完不清空 |
| C03 | 多轮上下文 | 历史条数不对、上下文丢失 |
| C04 | 停止生成 | 停不下来、已生成内容丢失 |
| C05 | 重新生成 | 追加新消息而不是原地替换 |
| C06 | 编辑重发 | 后续消息没截断、顺序错乱 |
| C07 | 生成中切换会话 | 串消息、回复未落库、切会话空白 |
| C08 | 联网开启但闲聊 | 每条都搜、来源面板误显示 |
| C09 | 联网且需实时信息 | 不搜索、来源不显示、请求次数异常 |
| C10 | 刷新后持久化 | 消息丢失、无法恢复会话 |
| C11 | 会话重命名 / 删除 | 改名失效、删除后残留 |
| C12 | 设置页进入 / 返回 | 返回要按两次、白屏 |
| C13 | 存为 Markdown | 保存失败（`navigator.share` 回退） |
| C14 | 导出整段对话 | 导出空文件 |
| C15 | 文本附件 + 图片 | 附件发送失败（响应式 Proxy 写入 IndexedDB） |
| C16 | 先闲聊再问「今日金价」 | 判断阶段看起来卡死、判断/搜索/思考顺序错、联网结果写入 IndexedDB 失败 |

### 3.3 输出怎么读

```
✓ C04 停止生成：及时停下且保留已生成内容 (1541ms)
```

出现 `✗` 时：

1. 看失败行下面的断言信息（会给出实际值）。
2. 打开 `smoke-fail-<ID>.png` 看现场。
3. 先判断是**产品回归**还是**用例选择器过期**（UI 改名导致）。后者修用例，前者修代码。
4. 修完先 `--only=<ID>` 单跑，再全量跑。

### 3.4 Mock 的测试钩子

- 发送包含 `[[slow]]` 的消息 → 慢速长回复（80ms/块，60 段），用于停止/切换会话。
- `GET /__stats` → `{chat, decision, search, models}` 请求计数；`POST /__reset` 清零。
- `GET /search?q=...&format=json` → 固定 3 条 SearXNG 结果。
- `GET /share/Mofa/latest.json` → 模拟更新清单。
- 联网决策规则：问题含 `闲聊/你好/翻译/写代码/数学/总结/改写` 时不搜，其余搜。

### 3.5 新增用例

在 `scripts/smoke/run.mjs` 里用 `test('C17', '名称', async ({ page }) => { ... })` 追加。约定：

- 每个用例独立上下文，不依赖前一个用例。
- 只断言用户可见结果，不依赖内部 store 实现。
- 选择器优先 `aria-label`，其次稳定 class（`.msg-user`、`.session-item`）。
- 网络请求次数用 `/__stats` 断言，别用 sleep 猜。
- 新用例必须能在无外网、无真实 Key 的环境跑通。

---

## 4. 手工回归清单

标记说明：**P0** 发布阻断；**P1** 重要功能；**P2** 体验/兼容。

### 4.1 启动与数据

| ID | 级别 | 操作 | 预期 |
| --- | --- | --- | --- |
| A1 | P0 | 冷启动应用 | 无白屏；空状态显示「开始新对话」 |
| A2 | P0 | 发一条消息 → 杀掉进程重开 → 打开抽屉 → 点会话 | 消息、模型标签、回复完整恢复 |
| A3 | P1 | 用旧版数据（缺 `contextPolicy`/`model` 字段）启动 | 不崩溃，按默认值工作 |
| A4 | P2 | 同时开两个标签页，各发一条 | 不互相覆盖；刷新后两条都在 |

### 4.2 对话核心（P0）

| ID | 操作 | 预期 |
| --- | --- | --- |
| B1 | 输入文字 → 发送 | 逐字流式；结束后停止按钮消失；输入框清空 |
| B2 | 输入框留空 / 只输空格 | 发送按钮禁用 |
| B3 | 桌面按 Enter；Shift+Enter | Enter 发送；Shift+Enter 换行（移动端 Enter 换行） |
| B4 | 连续两轮提问 | 第二轮模型标签显示「携带 3 条上下文」左右 |
| B5 | 生成中点停止 | 3 秒内停下；已生成内容保留；可立即继续发 |
| B6 | 点重新生成 | 原回复被替换，消息条数不变，不追加到末尾 |
| B7 | 编辑较早的提问 → 保存并重发 | 该消息之后的问答被截断，重新生成 |
| B8 | 删除单条消息 | 只删除该条（当前设计不联动），刷新后不复活 |
| B9 | 生成 2 万字以上长回复 | 视图持续跟随到底；手动上翻不被抢回；滚回底部恢复跟随 |
| B10 | 断网 / 错 Key / 空响应 | 有明确错误提示；可重试；不落库空回复 |
| B11 | 生成中切到另一会话再切回 | 不串消息；原会话未完成回复已保存 |

### 4.3 服务商与模型（P0）

| ID | 操作 | 预期 |
| --- | --- | --- |
| C1 | 分别添加 OpenAI 兼容 / Anthropic / Gemini 服务商 | 都能拉模型、发消息、流式正常 |
| C2 | baseURL 填完整端点（`.../v1/chat/completions`） | 自动剥后缀，不重复拼 `/v1` |
| C3 | 修改/删除服务商后返回 | 一次返回即回设置页；列表即时更新 |
| C4 | Key 前后带空格或零宽字符 | 自动清理，不报 header 非法 |
| C5 | 切换思考强度 off/low/high | 仅对支持 reasoning 的模型显示；请求参数正确 |
| C6 | 未配置服务商时发送 | 提示去设置；输入内容保留在输入框 |
| C7 | 模型窗口很小（如 8k）时发长文 | 自动截断旧消息，请求不超限 |

### 4.4 联网搜索（P1）

| ID | 操作 | 预期 |
| --- | --- | --- |
| D1 | 关闭联网发消息 | 无「判断/搜索」状态条，无来源面板 |
| D2 | 开启联网问「你好，随便聊聊」 | 发送后立即出现「思考中…」（默认折叠）；判定完成后收起为「思考完成」，展开才显示「无需联网」；无来源 |
| D3 | 先问「你好」，再问「今日金价多少？」 | 发送后立即出现「思考中…」，完成后收起为「思考完成」；再显示「联网搜索」；顺序为 思考 → 搜索 → 回复思考 → 正文；展开可见判断结果与查询词 |
| D4 | 搜索源不可用（断网/错 SearXNG 地址） | 搜索卡片显示失败原因并降级为模型自身回答，不中断对话 |
| D5 | 搜索/判断阶段点停止 | 立即停止，不产生半条空回复 |
| D6 | 关闭再开启联网，刷新页面 | 开关状态保持 |
| D7 | 判断模型较慢（3~5 秒） | 「思考中…」和呼吸点持续可见；不会出现整屏无变化的假死 |

### 4.5 附件（P1）

| ID | 操作 | 预期 |
| --- | --- | --- |
| E1 | 选 1 张图 → 发送 | 压缩后进入请求；回复能描述图片；气泡显示缩略图 |
| E2 | 选 4 张图；再选第 5 张 | 提示最多 4 张 |
| E3 | 上传 PDF / docx / txt / md | 正确提取正文；发送成功 |
| E4 | 上传 `.doc` / 二进制 / 超 8MB 文件 | 明确提示不支持或超限，不崩溃 |
| E5 | 附件消息刷新后重开 | 文件名和提取文本仍在（图片以 data URL 存） |
| E6 | 附件发送中点停止 | 不产生 `DataCloneError`；草稿可恢复 |

### 4.6 文件与导出（P1）

| ID | 操作 | 预期 |
| --- | --- | --- |
| F1 | 回复「存为文件」→ md / txt / docx | 下载/分享成功；docx 能用 Word 打开 |
| F2 | 代码块右上角「保存」 | 保存为对应扩展名（如 `.ts`） |
| F3 | 顶栏「导出对话」 | 导出整段 Markdown，含角色与时间 |
| F4 | 网页端浏览器不支持 `navigator.share` | 自动回退下载，不提示「保存失败」 |
| F5 | 原生端保存 | 拉起系统分享面板；取消不报错 |

### 4.7 会话与设置（P1）

| ID | 操作 | 预期 |
| --- | --- | --- |
| G1 | 新建对话 → 发消息 | 标题取首条消息前 24 字 |
| G2 | 重命名 / 删除会话 | 立即生效；删除当前会话后回到空状态 |
| G3 | 给会话设置系统提示词并换模型 | 只影响该会话；切换会话后恢复 |
| G4 | 主题 浅色/深色/跟随系统 | 全部页面（含弹层）颜色正确、文字可读 |
| G5 | 关闭「使用统计」 | 不再发统计请求；重启后仍关闭 |
| G6 | 设置页「关于」 | 版本号与 APK `versionName` 一致 |

### 4.8 兼容与边界（P2）

| ID | 操作 | 预期 |
| --- | --- | --- |
| H1 | 320px 窄屏 | 不横向滚动；按钮不重叠 |
| H2 | 横屏 / 平板 | 输入框、抽屉、弹层布局正常 |
| H3 | 深色模式 + 长代码块 | 代码高亮对比度足够 |
| H4 | 旧 WebView（API 30 模拟器，Chrome 83） | 弹层居中、遮罩铺满；无 `inset` 定位错乱 |
| H5 | 系统字体放大 | 文本不截断、不溢出按钮 |
| H6 | 100 条以上会话 | 打开、滚动不卡死 |

---

## 5. 原生 Android 实测

### 5.1 启动模拟器并安装

```bash
ADB="D:/AndroidStudioSdk/Sdk/platform-tools/adb.exe"
EMU="D:/AndroidStudioSdk/Sdk/emulator/emulator.exe"

"$EMU" -avd New_Device_1_API_30 -no-window -no-audio -no-boot-anim -no-snapshot -gpu swiftshader_indirect
# 等 sys.boot_completed=1

"$ADB" install -r releases/mofa-0.0.6.apk
"$ADB" shell am start -n com.mofa.chat/.MainActivity
"$ADB" exec-out screencap -p > native.png
```

### 5.2 必测项

| ID | 操作 | 预期 |
| --- | --- | --- |
| N1 | 启动、切后台再回来 | 不白屏；状态保持 |
| N2 | 设置页按返回；聊天页按返回 | 设置→聊天；聊天→退出应用（不误杀） |
| N3 | 点 Markdown 外链 | 拉起系统浏览器，不在 WebView 内导航 |
| N4 | 保存文件 | 系统分享面板；可存到文件管理器 |
| N5 | 开启联网并提问实时问题 | 搜索面板正常（验证 CapacitorHttp 返回对象） |
| N6 | 打开重命名/删除对话框 | 弹层居中、遮罩全屏（旧 WebView 兼容） |
| N7 | 深色模式 + 系统栏 | 状态栏/导航栏图标可见 |
| N8 | 软键盘弹出 | 输入框不被遮挡 |

### 5.3 WebView 调试

```bash
PID=$("$ADB" shell pidof com.mofa.chat | tr -d '\r')
"$ADB" forward tcp:9333 localabstract:webview_devtools_remote_$PID
curl -s http://localhost:9333/json | head
```

拿到 `webSocketDebuggerUrl` 后可用 CDP 执行 JS、读取 DOM 或截图（测试脚本里已有类似用法）。

### 5.4 应用内更新（改了 `Updater.java` / 更新 UI 必测）

1. 准备一个旧版本 APK 安装到模拟器（如 `releases/mofa-0.0.5.apk`）。
2. 让更新清单指向测试包。两种方式：
   - 临时把 `src/config.ts` 的 `UPDATE_BASE` 改成 `http://localhost:8787/share/MoFa`，重新 build 安装（**不要提交这个改动**）；
   - 或直接改服务器上的 `latest.json` 指向测试 APK。
3. 如果走本地 HTTP：`adb reverse tcp:8787 tcp:8787`。
4. 首次安装需允许未知来源：
   `adb shell appops set com.mofa.chat REQUEST_INSTALL_PACKAGES allow`
5. 点「立即更新」，检查：
   - 进度从 0→100%，可取消；
   - 下载完成自动调起系统安装器；
   - 安装后版本号更新，**原会话数据仍在**；
   - **连续更新两次**都成功（历史 bug：固定文件名导致第二次 `ERROR_FILE_ALREADY_EXISTS`）；
   - 缓存目录只保留最新 APK。

> 普通应用无法静默安装，最后一步必须由系统安装器确认，这是 Android 限制，不是 bug。

---

## 6. 发版检查清单

```bash
# 1) 升版本 + 构建 + 产物（会改 gradle / config.ts / package.json）
node scripts/release.mjs 0.0.7 "本次更新说明"
```

本机注意：`release.mjs` 内部会跑 `npx cap sync android`，可能被 safe-delete 防护拦截。失败时改用：

```bash
npm run build
npx cap copy android          # 偶尔被拦一次，重跑即可
cd android
JAVA_HOME="D:/IDE/Android Studio/jbr" ANDROID_HOME="D:/AndroidStudioSdk/Sdk" ./gradlew.bat assembleDebug
cd ..
cp android/app/build/outputs/apk/debug/app-debug.apk releases/mofa-0.0.7.apk
```

发布前逐项确认：

- [ ] `package.json` / `src/config.ts` / `android/app/build.gradle` 版本一致
- [ ] `package-lock.json` 版本同步（`npm install --package-lock-only`）
- [ ] `npm run typecheck` 通过
- [ ] `npm run test:smoke` 16/16
- [ ] 第 4 节 P0 手工项通过
- [ ] 原生第 5 节必测项通过（至少 N1/N2/N3/N6）
- [ ] APK 版本正确：
      `aapt dump badging releases/mofa-0.0.7.apk | grep ^package`
- [ ] APK 里是最新前端（抽查一个本次新增的字符串）：
      `unzip -p releases/mofa-0.0.7.apk assets/public/assets/ChatView-*.js | grep "新增文案"`
- [ ] `releases/latest.json` 的 `version` / `url` / `changelog` 正确
- [ ] 覆盖安装旧版后数据仍在
- [ ] 上传 `mofa-0.0.7.apk` 与 `latest.json` 到 `https://yunsmart.cn/share/MoFa/`
- [ ] 用旧版 App 点「检查更新」实际走一遍
- [ ] 提交代码（不提交 `dist/`、`android/app/src/main/assets/public/` 等构建产物）

---

## 7. 历史回归陷阱（不许再犯）

每修一个 bug，在这里补一行；能自动化的一并加用例。

| # | 现象 | 根因 | 复测方式 |
| --- | --- | --- | --- |
| 1 | 点任何会话都打不开 | `openSession` 在赋值前用 `activeId` 判断 | C07、B11 |
| 2 | 点停止后还在输出 | SSE 中断未统一抛 `AbortError`；建会话间隙未处理停止 | C04、D5 |
| 3 | 生成中切会话串消息 / 丢回复 | 未等待在途请求落库 | C07 |
| 4 | 重新生成后回复跑到最后 | 允许对非最后一条重生成 | C05 |
| 5 | 带附件发送必失败 | 响应式 Proxy 直接写 IndexedDB 触发 `DataCloneError` | C15、E6 |
| 6 | 空流也存一条空回复 / 假死 | 未校验空响应、无空闲超时 | B10 |
| 7 | Claude/Gemini 历史 400 | 截断后以 assistant 开头或角色不交替 | C7、B7 |
| 8 | OpenAI 推理模型 400 | 辅助调用强行带 `enable_thinking=false` | C1（官方模型） |
| 9 | 长回答中途不跟随 | 用「距离突然变大」判断上翻，被内容增长误触发 | B9 |
| 10 | 旧 WebView 弹层跑到屏幕外 | `inset: 0` 不支持，压缩后又会合回 `inset` | H4、N6 |
| 11 | 原生 SearXNG 必失败 | CapacitorHttp 把 JSON 解析成对象，`String()` 成 `[object Object]` | N5 |
| 12 | 网页端保存文件报失败 | 未回退 `navigator.share` 缺失 | C13、F4 |
| 13 | 保存服务商后要按两次返回 | 保存用 `replace` 制造了重复历史 | C12、C3 |
| 14 | 第二次应用内更新失败 | DownloadManager 不覆盖同名文件 | 5.4 连续更新两次 |
| 15 | 搜索词里混入思考内容 | 未按 chunk kind 过滤 reasoning | D3、B10 |
| 16 | 切换会话后旧消息闪一下 | 异步读库期间仍渲染上一会话 | 可接受（<100ms）；若变长需优化 |
| 17 | 开启联网后判断/搜索阶段整屏不动，像卡死 | 助手占位消息在搜索结束后才创建，判断和搜索期间没有任何可见进度 | C16、D2、D3 |
| 18 | 联网回复末尾出现「生成中断：DataCloneError」 | `searchDecision`/`searchInfo` 是 Vue 响应式 Proxy，直接写 IndexedDB 无法结构化克隆 | C16（含刷新后校验） |

---

## 8. 测试报告模板

```markdown
## 测试报告 vX.Y.Z

**改动范围**：一句话 + 关键文件
**自动检查**：typecheck ✅ / build ✅ / smoke 16/16 ✅
**手工 P0**：A1 A2 B1–B11 C1–C7（未过项：无）
**手工 P1**：D1–D6 E1–E6 F1–F5 G1–G6（未过项：…）
**原生**：模拟器 API 30 / 真机型号；N1–N8 结果；更新流程结果
**新增用例**：C16 …（如有）
**未覆盖 / 风险**：明确写出没测什么、可能影响谁
**结论**：可发布 / 不可发布（原因）
```

---

## 9. 失败排查

| 现象 | 处理 |
| --- | --- |
| `等待 Mock LLM 启动超时` | 8787 被占用或 mock 启动报错；`netstat -ano \| grep 8787` 后结束旧进程 |
| `找不到 Chromium/Chrome` | 设 `MOFA_CHROME`，或安装 Chrome / Playwright Chromium |
| `dist/index.html 不存在` | 去掉 `--no-build`，或先 `npm run build` |
| 用例突然大面积失败 | 先看是不是 UI 改名导致选择器过期；对比 `git diff` 的模板改动 |
| 只有 C07 偶发失败 | 会话切换是异步读库，断言前必须等目标会话的用户消息出现 |
| 预览页是旧界面 | 复用了旧 preview 进程；结束它，或不要用 `--no-build` |
| 原生搜索无结果 | 检查 `adb reverse`、SearXNG 地址、CapacitorHttp JSON 处理 |
| 模拟器更新下载失败 | 模拟器无外网；用 `adb reverse` + 本地 HTTP，或真机测 |
| 构建被 safe-delete 拦截 | 见第 6 节手动构建流程；重跑 `cap copy` 一次 |

---

## 10. 维护这份文档

- 新增功能：在第 4 节加用例，在第 1.2 节加映射。
- 修复 bug：第 7 节加一行，优先补自动用例。
- 删除功能：同步删掉用例，避免文档失真。
- 每次发版后花 2 分钟回看：这次漏测了什么？补进「最容易漏的 6 类」或清单。
