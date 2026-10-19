<div align="center">

<img src="public/icons/icon-512.png" width="112" height="112" alt="MoFa 应用图标" />

# MoFa

**专为手机打造的 LLM 聊天客户端。**

[English](./README.md) | 简体中文

Android APK & PWA · 自带 API Key · 数据全部本地保存

<p>
  <img src="https://img.shields.io/badge/version-0.0.7-red" alt="版本 0.0.7" />
  <img src="https://img.shields.io/badge/platform-Android%20%7C%20PWA-blue" alt="Android 与 PWA" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License" />
</p>

</div>

MoFa 是一个开源的安卓 AI 聊天应用：填入自己的 API Key（OpenAI 兼容、Claude、Gemini、DeepSeek、硅基流动、OpenRouter、Ollama…），即可流式对话，支持 Markdown 渲染、代码高亮、图片输入和推理模型。所有会话与密钥仅保存在本机。

<div align="center">
  <img src="docs/screenshots/demo.gif" width="280" alt="MoFa 演示 —— 填入 API Key、对话、切换模型">
</div>

<div align="center">
  <img src="docs/screenshots/chat.png" width="250" alt="流式对话与思考过程">
  <img src="docs/screenshots/settings-provider.png" width="250" alt="服务商设置 —— 模型、能力、上下文长度">
  <img src="docs/screenshots/settings.png" width="250" alt="设置 —— 数据全部本地保存">
</div>

## 功能

- **多服务商** —— OpenAI 兼容协议 + Claude / Gemini 原生协议，每个服务商独立配置 API 地址与 Key
- **流式对话** —— 逐字输出，Markdown 渲染 + 代码高亮
- **思考模式** —— 展示模型思考过程（DeepSeek-R1、QwQ…），思考强度可选（低/中/高）
- **图片输入** —— 给视觉模型发图片，自动压缩
- **按会话分模型** —— 每个会话记住自己用的服务商和模型
- **联网搜索** —— 可选的免费联网（Bing / DuckDuckGo / SearXNG，无需 API Key，客户端直接解析结果）；模型先判断是否需要联网，需要时自动生成搜索词，回答带编号来源
- **文件输入输出** —— 可附加文件（PDF / Word / 文本 / 代码，本地提取文字）；回复可一键存为真实文件（.md / .txt / .json / .docx）
- **上下文管理** —— 按轮数 / token 预算自动截断历史，模型窗口兜底防超限
- **助手预设** —— 会话级系统提示词，内置常用预设
- **会话管理** —— 本地历史、重命名、导出 Markdown
- **应用内更新** —— 应用内下载并显示进度；首次授权后自动继续下载，安装完成自动清理安装包

## 下载

- **Android 6.0+**：[下载 MoFa v0.0.7 APK](https://yunsmart.cn/share/MoFa/mofa-0.0.7.apk)
- **iOS / 浏览器**：PWA —— 将 `dist/` 部署到任意静态服务器，Safari 中「添加到主屏幕」

## 开发

```bash
npm install
npm run dev        # 开发服务器，手机同 WiFi 可访问
npm run mock       # 本地 Mock LLM 服务（OpenAI / Anthropic / Gemini 三协议）
npm run build      # 构建到 dist/
npm run typecheck
```

## 测试

```bash
npm run test:smoke   # 自动构建 + 16 条核心回归（本地 Mock LLM，约 60 秒）
```

完整清单（含手工与原生 Android）见 [docs/TESTING.md](docs/TESTING.md)。改完代码请按其中的「改动 → 必测映射」执行。

打 Android 包（需要 Android Studio）：

```bash
npm run release 0.0.7 "更新说明"
# → 产物 releases/mofa-0.0.7.apk + releases/latest.json（应用内更新用）
```

## 技术栈

Vue 3 · TypeScript · Vite · Pinia · Dexie (IndexedDB) · Capacitor 7 · markdown-it + highlight.js

## License

[MIT](./LICENSE)
