<div align="center">

# MoFa

**专为手机打造的 LLM 聊天客户端。**

[English](./README.md) | 简体中文

Android APK & PWA · 自带 API Key · 数据全部本地保存

</div>

MoFa 是一个开源的安卓 AI 聊天应用：填入自己的 API Key（OpenAI 兼容、Claude、Gemini、DeepSeek、硅基流动、OpenRouter、Ollama…），即可流式对话，支持 Markdown 渲染、代码高亮、图片输入和推理模型。所有会话与密钥仅保存在本机。

## 功能

- **多服务商** —— OpenAI 兼容协议 + Claude / Gemini 原生协议，每个服务商独立配置 API 地址与 Key
- **流式对话** —— 逐字输出，Markdown 渲染 + 代码高亮
- **思考模式** —— 展示模型思考过程（DeepSeek-R1、QwQ…），思考强度可选（低/中/高）
- **图片输入** —— 给视觉模型发图片，自动压缩
- **按会话分模型** —— 每个会话记住自己用的服务商和模型
- **助手预设** —— 会话级系统提示词，内置常用预设
- **会话管理** —— 本地历史、重命名、导出 Markdown
- **应用内更新** —— Android 端自动检查并安装新版本

## 下载

- **Android**：从 [Releases](../../releases) 下载最新 APK
- **iOS / 浏览器**：PWA —— 将 `dist/` 部署到任意静态服务器，Safari 中「添加到主屏幕」

## 开发

```bash
npm install
npm run dev        # 开发服务器，手机同 WiFi 可访问
npm run mock       # 本地 Mock LLM 服务（OpenAI / Anthropic / Gemini 三协议）
npm run build      # 构建到 dist/
npm run typecheck
```

打 Android 包（需要 Android Studio）：

```bash
npm run release 0.0.3 "更新说明"
# → 产物 releases/mofa-0.0.3.apk + releases/latest.json（应用内更新用）
```

## 技术栈

Vue 3 · TypeScript · Vite · Pinia · Dexie (IndexedDB) · Capacitor 7 · markdown-it + highlight.js

## License

[MIT](./LICENSE)
