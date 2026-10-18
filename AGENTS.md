# AGENTS.md

MoFa 是一个本地优先的 AI 聊天客户端：Vue 3 + TypeScript + Vite + Pinia + Dexie，Android 壳用 Capacitor 7。
没有后端，会话存在 IndexedDB，服务商配置存在 localStorage，UI 文案为中文。

## 每次改完代码，按顺序执行

1. `npm run typecheck`
2. `npm run test:smoke`（自动构建 + 15 条回归，约 45 秒；不要用 `--no-build` 掩盖未构建）
3. 打开 `docs/TESTING.md`，按 §1.2「改动 → 必测映射」补手工项；**P0 项不允许跳过**
4. 改了 `android/`、弹层/定位/安全区样式、更新逻辑 → 必须按 `docs/TESTING.md` §5 上模拟器实测
5. 修 bug → 在 `docs/TESTING.md` §7 登记一行，并尽量在 `scripts/smoke/run.mjs` 补自动用例
6. 发版 → 按 `docs/TESTING.md` §6 清单执行

## 不要

- 不要只跑部分用例就宣布完成；未测项要明确写出来。
- 不要用真实 API Key 跑自动化（用 `scripts/mock-llm-server.mjs`）。
- 不要提交 `dist/`、`android/app/src/main/assets/public/` 等构建产物。
- 不要删除 `.workbuddy/`。
- 不要把 `releases/latest.json` 指向未上传的 APK。

## 关键文件

| 路径 | 作用 |
| --- | --- |
| `src/stores/chat.ts` | 会话/流式/搜索/停止/重生成的核心状态机 |
| `src/services/llm/` | OpenAI 兼容 / Anthropic / Gemini 适配器与 SSE |
| `src/services/websearch.ts` | Bing / DuckDuckGo / SearXNG 搜索与降级 |
| `src/lib/context.ts` | 上下文截断与角色规整 |
| `src/components/chat/` | 消息列表、Markdown、输入栏 |
| `android/app/src/main/java/com/mofa/chat/Updater.java` | 应用内下载与安装 |
| `scripts/mock-llm-server.mjs` | 测试用 Mock（三协议 + 搜索 + 更新清单） |
| `docs/TESTING.md` | 完整测试手册（执行协议、手工清单、原生实测） |
