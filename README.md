# MoFa

移动端 LLM 聊天客户端，纯客户端模式：用户自己填 API Key，数据全部本地保存。

## 技术栈

- **框架**：Vue 3 + TypeScript + Vite
- **套壳**：Capacitor 7（Android / iOS）
- **状态**：Pinia
- **存储**：Dexie（IndexedDB，会话与消息）+ localStorage（配置）
- **渲染**：markdown-it + highlight.js（流式 Markdown + 代码高亮）
- **请求**：原生 fetch + ReadableStream（SSE 流式）

## 开发

```bash
npm install
npm run dev
```

手机与电脑同一 WiFi 时，直接访问终端里打印的局域网地址（如 `http://192.168.x.x:5173`）即可真机预览。

### 其他命令

```bash
npm run build      # 生产构建（输出 dist/）
npm run preview    # 本地预览构建产物
npm run typecheck  # vue-tsc 类型检查
```

## 统计使用情况（无需第三方服务、无需后端）

数据全部留在自己的服务器上，靠 nginx 访问日志统计。App 启动时会发一个匿名 ping，只带**随机安装 ID、版本号、平台**三项，不含聊天内容和 API Key；设置页有开关可关闭。

### 方式一：零配置（立刻可用）

什么都不用配。上报请求会落到 `/share/MoFa/stats/hit`，返回 404 —— **但请求照样被记进 nginx 的 access.log**，脚本对状态码不做限制，直接解析即可。

### 方式二：推荐（日志独立、便于筛选）

在 nginx 里加一条精确匹配（不落文件、不进常规日志），统计日志单独存一份：

```nginx
location = /share/MoFa/stats/hit {
    access_log /var/log/nginx/mofa-stats.log;
    add_header Access-Control-Allow-Origin *;
    return 204;
}
```

`nginx -s reload` 后生效。

> 记得让 logrotate 覆盖 `mofa-stats.log`（默认规则 `/var/log/nginx/*.log` 会自动包含它）。

### 查看报告

服务器上**不需要安装 Node.js**（`apt` 里的 nodejs 版本太老，跑不了 Node 版脚本），直接用 shell 版：

```bash
bash scripts/stats-report.sh /var/log/nginx/access.log
bash scripts/stats-report.sh /var/log/nginx/mofa-stats.log     # 独立统计日志
zcat /var/log/nginx/access.log*.gz | bash scripts/stats-report.sh -   # 压缩日志
```

功能相同的 Node 版为 `scripts/stats-report.mjs`（需 Node ≥ 18，适合本地分析）。

### 报告内容

```
【APK 下载】
  总下载次数：4        独立 IP 数：3
  按文件：mofa-0.0.2.apk 3 次 / mofa-0.0.1.apk 1 次
  今日下载：2 次

【使用人数（启动上报）】
  累计安装数（唯一 ID）：3
  今日活跃：2 人        近 7 日活跃：3 人        总启动次数：4 次
  平台分布：android-app 3 / ios-web 1
  版本分布：0.0.2 3 / 0.0.1 1
```

想要图形化面板：在服务器装 [goaccess](https://goaccess.io/) 分析同一份日志。

## 分享给 iPhone 朋友（PWA，无需 Mac / 无需开发者账号）

iOS 原生包必须在 macOS + Xcode 编译，且要 $99/年账号才能给他人安装。**给朋友用走 PWA 更划算**：一套代码部署成网页，Safari 打开后「添加到主屏幕」，图标、全屏、体验与 App 基本一致。

### 部署（把 dist 传到服务器）

```bash
npm run build
# 把 dist/ 里的全部内容上传到服务器的一个目录，例如
#   /var/www/yangming/share/MoFa/app/
# 访问地址即 https://yunsmart.cn/share/MoFa/app/
```

因为用的是 hash 路由，**不需要任何 SPA 重写规则**；构建产物全部是相对路径，可放在任意子目录。
建议 nginx 补一条 MIME（可选，多数浏览器会容错）：

```nginx
location /share/MoFa/app/ {
    types { application/manifest+json webmanifest; }
}
```

本地可先预览子目录部署效果：

```bash
npm run serve:dist   # → http://localhost:8899/share/MoFa/app/
```

### 朋友怎么用

1. **Safari** 打开 `https://yunsmart.cn/share/MoFa/app/`（必须 Safari，iOS 上 Chrome 不能添加到主屏幕）
2. 点底部**分享按钮** → **添加到主屏幕**
3. 桌面出现 MoFa 图标，点开即全屏使用
4. 进设置添加自己的服务商与 API Key

> 应用内已内置引导横幅（仅 iOS 未添加主屏幕时显示，可关闭）。
> 建议一定要「添加到主屏幕」——留在 Safari 标签页里的话，iOS 可能在一段时间不用后清理网页数据，导致会话丢失。

### 已知限制

- 网页版依赖服务商允许跨域（CORS）。已实测允许：DeepSeek、硅基流动、Moonshot、智谱 GLM、OpenRouter、Anthropic（已带浏览器直连头）。OpenAI/Gemini 建议用真实 Key 验证一次。
- **本地 Ollama 在网页版不可用**（默认只允许 localhost 来源请求），请用安卓 App 或设置 `OLLAMA_ORIGINS`。
- 网页版无应用内更新入口（刷新即最新）。

## 打安卓包（真机阶段）

已配置好国内镜像（Gradle 走腾讯镜像、依赖走阿里云 maven，见 `android/gradle/wrapper/gradle-wrapper.properties` 和 `android/build.gradle`）。命令行打包：

```bash
npm run build
npx cap sync                  # web 产物同步进原生工程
cd android
JAVA_HOME="D:\IDE\Android Studio\jbr" ANDROID_HOME="D:\AndroidStudioSdk\Sdk" ./gradlew.bat assembleDebug
```

产物：`android/app/build/outputs/apk/debug/app-debug.apk`（约 4MB，debug 签名，自用/发朋友直接装）。
以后要正式发布再配 release 签名（`assembleRelease` + keystore）。

真机安装：

```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

> 注意：保持 Capacitor 的 `CapacitorHttp` 补丁**关闭**（默认关闭），否则 fetch 流式会被整包缓冲。若个别机型 WebView 不支持流式，接入 [capacitor-stream-http](https://github.com/chatboxai/capacitor-stream-http) 原生插件兜底。

iOS 自用：云端/本地构建后用 Sideloadly + 免费 Apple ID 签名安装（7 天重签）。

## 项目结构

```
src/
├── components/
│   ├── chat/         # MessageList / MessageItem / Composer / MarkdownView
│   ├── ui/           # Icon / Toast
│   ├── ModelSheet.vue    # 模型选择底部弹层
│   └── SessionsDrawer.vue # 会话侧边抽屉
├── composables/      # useToast
├── db/               # Dexie：conversations / messages
├── lib/              # markdown 渲染管线、工具函数
├── router/
├── services/llm/     # Provider 抽象：openai-compatible（SSE 解析）
├── stores/           # Pinia：settings / providers / chat
├── styles/           # 设计令牌（Cherry Studio V2 风格）/ 基础 / markdown 样式
└── views/            # ChatView / SettingsView / ProviderEditView
```

## Roadmap

- [x] 多服务商（OpenAI 兼容）+ 模型管理
- [x] 流式对话 + Markdown / 代码高亮 / 代码复制
- [x] 多会话本地持久化
- [x] 消息编辑（重发）、标题重命名
- [x] 系统提示词 / 助手预设（对话级设定，内置常用预设）
- [x] 导出对话（Markdown，支持系统分享）
- [x] 应用内对话框（替代原生 prompt/confirm，全端一致）
- [x] 图片输入（多模态，自动压缩，全屏预览）
- [x] 模型能力标签（视觉/思考，按名称自动识别 + 手动修正）
- [ ] Anthropic / Gemini 原生协议适配
- [ ] Mermaid 图表渲染 / Artifacts 预览
- [ ] 图片生成（绘画）
- [ ] 知识库（RAG）
- [ ] 消息搜索、会话置顶
- [ ] 数据备份（WebDAV / 文件导入导出）

## 设计参考

- [Cherry Studio V2 官方设计稿](https://github.com/CherryHQ/cherry-studio-ui-design)
- [Cherry Studio](https://cherry-ai.com) / [ChatBox](https://github.com/chatboxai/chatbox)
