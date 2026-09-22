# 本机 ChatGPT / Codex 配置

本地 0.1.1 版新增 Codex CLI 接入。复用这台电脑上已登录的 ChatGPT 账号，候选回复和长期档案均使用 `gpt-6-astra`。无需 API Key，也不需要另外启动 HTTP 服务。Jev 判断与排序在此模式下关闭。

## 启动和使用

双击 `D:\chat_tool\启动QQ助手.cmd`，或桌面「QQ助手-ChatGPT」。本次 0.1.2 本地构建在 `windows\dist-ntqq\win-unpacked\Jev QQ Windows.exe`，旧的 0.1.1 构建保留在 `windows\dist\`。

在「模型与设置」选择「复用本机 ChatGPT / Codex 登录」。Codex CLI 路径留空，程序自动检测已安装的 `codex.exe`。模型名称需要属于当前账号可用的模型。

先用「试用示例 → 分析对话」验证三条候选，再导入自己的 QQ JSON / UTF-8 TXT。「长期聊天档案 → 查看分析范围与请求数 → 生成 / 继续长期档案」会分段处理全部导入消息，整理关系、事件和待办。返回对话工作台并选择「关联 QQ 历史」，下一次回复就会带上档案和检索片段。

0.1.2 起可在「直接读取 QQ 记录」选择 `D:\QQ\chat\Tencent Files`，保持本人账号登录后读取消息库副本，不再需要手动导出。解密、WAL 合并和本机导入不调用模型；生成档案时才使用 ChatGPT。流程与限制见 [NTQQ.md](NTQQ.md)。

## 登录、数据和额度

- 本地调用官方 `codex exec`，推理在 OpenAI 云端完成，使用 ChatGPT/Codex 账号额度，需联网。导入本身只在本机处理，点击分析或生成档案后才发送文本。
- 登录由 Codex CLI 管理；本程序不读取、复制或保存账号令牌。CLI 参数不包含聊天正文，正文通过标准输入传入；使用 `--ephemeral` 关闭会话 rollout 文件保存。Codex 本身的运行日志、遥测与云端保留遵循其设置和账号政策，不能据此承诺完全无留存。
- 每次推理使用独立临时工作目录、只读沙箱和禁用的工具功能。忽略个人 `config.toml`，避免把自己的插件和 MCP 接入文本分析过程。不会改动你的 Codex 配置文件。
- 当前个人配置在 `%APPDATA%\jev-chat-windows\settings.json`；导入记录和档案在同目录 `qq-history.sqlite`。应用退出、升级后继续保留。
- 每次请求最长 3 分钟；可取消或暂停。长档案按完成分段保存进度，额度不足或网络失败时可以续跑。新导入后校验分段缓存；内容和前置摘要都未变化的分段可以复用，补录或修改会使受影响部分重算。

## 故障处理

账号过期时，在 Codex 中重新登录，并运行 `codex login status` 确认显示 `Logged in using ChatGPT`。找不到 CLI 时填写 `codex.exe` 完整路径；不要填写 ChatGPT 桌面程序本身。模型不可用时，在设置中选择账号实际支持的模型。

此接入已按本机 `codex-cli 0.155.0-alpha.9.2` 验证；未来 CLI 参数或账号能力变化后可能需要更新适配器。已发布的 GitHub `windows-v0.1.0` 安装包不含此功能；请使用本次本地构建。

官方依据：[非交互调用与复用登录](https://learn.chatgpt.com/docs/non-interactive-mode)、[ChatGPT 登录](https://learn.chatgpt.com/docs/auth)。

## 开发验证

`npm test` 运行不消耗额度的逻辑测试。`node scripts/codex-smoke.cjs` 是显式运行的真实账号测试，只发送仓库内合成示例，会消耗少量账号额度；不会自动包含在普通测试或 CI 中。通过 `JEV_TEST_EXECUTABLE` 可指定打包后的 EXE，结果写入忽略目录 `.qa/`。
