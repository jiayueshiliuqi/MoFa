# MoFa

移动端 LLM 聊天客户端（对标 Cherry Studio 的手机版），纯客户端模式：用户自己填 API Key，数据全部本地保存。

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
