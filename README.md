# MoFa

移动端 LLM 聊天客户端，纯客户端模式：用户自己填 API Key，数据全部保存在本地。

对标 [Cherry Studio](https://github.com/CherryHQ/cherry-studio) 的手机版，为个人开发者打造：轻量、易迭代。

## 功能

- 多服务商：OpenAI 兼容 / Claude / Gemini 三种协议，内置常用服务商模板
- 流式对话：Markdown 渲染、代码高亮、思考过程展示、思考强度选择
- 图片输入：自动压缩，支持视觉模型
- 按会话记忆模型：不同聊天用不同模型
- 会话管理：本地持久化、重命名、导出 Markdown
- 应用内自动更新（Android）

## 技术栈

Vue 3 · TypeScript · Vite · Pinia · Dexie · Capacitor 7

## 开发

```bash
npm install
npm run dev        # 开发，手机同 WiFi 可访问局域网地址
npm run build      # 构建（dist/）
npm run typecheck  # 类型检查
```

本地模拟 LLM 服务（三协议、可验证全部功能）：

```bash
npm run mock       # http://localhost:8787
```

## 打 Android 包

依赖 Android Studio（SDK 路径按需修改，见 `scripts/release.mjs`）：

```bash
npm run release 0.0.3 "更新说明"   # 自动改版本号、构建、打 APK
```

产物在 `releases/`：`mofa-<版本>.apk` 和 `latest.json`，上传到服务器即可被应用内更新使用。

更新服务地址在 `src/config.ts` 的 `UPDATE_BASE`。

## 网页版（iOS / PWA）

```bash
npm run build
# 把 dist/ 上传到服务器任意目录，如 /share/MoFa/app/
```

iOS 用 Safari 打开后「分享 → 添加到主屏幕」即可全屏使用。

## 项目结构

```
src/
├── components/       # UI 组件（chat/ 对话相关，ui/ 基础组件）
├── composables/      # useToast / useDialog / useUpdate / useBackHandler
├── db/               # Dexie：会话与消息
├── lib/              # markdown 渲染、图片压缩、模型能力识别等
├── router/
├── services/
│   ├── llm/          # 协议适配层：openai-compatible / anthropic / gemini
│   ├── update.ts     # 应用内更新
│   └── stats.ts      # 匿名使用统计（可在设置中关闭）
├── stores/           # Pinia：settings / providers / chat
├── styles/
└── views/            # ChatView / SettingsView / ProviderEditView
```

## License

MIT
