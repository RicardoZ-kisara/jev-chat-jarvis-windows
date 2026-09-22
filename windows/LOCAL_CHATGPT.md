# 本机 ChatGPT / Codex 配置

本地 0.1.4 复用这台电脑上已登录的 ChatGPT 账号，七题判断、候选排序和长期档案均使用 `gpt-6-astra`。无需 API Key，也不需要另外启动 HTTP 服务。判断采用 Jev 七题结构，界面明确标注 ChatGPT 来源，不调用或冒充真实 Jev 模型。

## 启动和使用

双击 `D:\chat_tool\启动QQ助手.cmd`，或桌面「QQ助手-ChatGPT」。本次 0.1.4 本地构建在 `windows\dist-reference\win-unpacked\Jev QQ Windows.exe`，此前构建目录保留。

在「模型与设置」选择「复用本机 ChatGPT / Codex 登录」。Codex CLI 路径留空，程序自动检测已安装的 `codex.exe`。模型名称需要属于当前账号可用的模型。

工作台选择已导入会话，点击「分析可能性并生成回复」，即可得到 ChatGPT 按 Jev 七题结构给出的判断、备选可能性、原文依据和三条排序回复，无需手工复制聊天。不是 Jev 模型自身的输出，百分比不是成功率。结果按会话保存，刷新或重启后可恢复；新增记录会使旧分析失效。完整流程见 [ANALYSIS.md](ANALYSIS.md)。

需要覆盖更多长期事件时，再通过「查看 / 更新长期记忆 → 查看完整档案的范围与请求数 → 生成 / 继续长期档案」分段整理关系、事件和待办。之后再次分析回复就会使用有效档案与检索到的分段记忆。

0.1.2 起可在「直接读取 QQ 记录」选择 `D:\QQ\chat\Tencent Files`，保持本人账号登录后读取消息库副本，不再需要手动导出。解密、WAL 合并和本机导入不调用模型；点击分析回复或生成档案才使用 ChatGPT。流程与限制见 [NTQQ.md](NTQQ.md)。

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
