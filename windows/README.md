# Jev QQ Windows

基于 [jev-chat/jev-chat-jarvis](https://github.com/jev-chat/jev-chat-jarvis) 的 **QQ Windows 专用**桌面移植。保留 Jev 七题判断与三候选排序，新增 QQ 窗口截图、离线 OCR、历史导入、长期关系/事件/待办档案和辅助回复。原 Android 工程保留在 `app/`，与 Windows 构建独立。

当前源码：**0.1.4，Windows 10/11 x64**。已发布安装包为 0.1.0 Preview。本地支持 [直接读取 QQ NT 记录](NTQQ.md)、[复用 ChatGPT / Codex 登录](LOCAL_CHATGPT.md) 和 [从已导入会话直接分析并生成回复](ANALYSIS.md)。0.1.4 修复引用数量或格式问题阻断整份回复：有效引用继续显示，未知编号排除并提示核对。

## 下载与使用

从 [Windows Releases](https://github.com/RicardoZ-kisara/jev-chat-jarvis-windows/releases) 下载：

- `Jev-QQ-Windows-Setup-0.1.0-x64.exe`：当前用户安装，可选目录。
- `Jev-QQ-Windows-Portable-0.1.0-x64.exe`：免安装启动。

程序和中英文 OCR 模型已经打包，不需要安装 Python、Node.js 或 Android 环境。首版未购买代码签名证书，Windows 可能显示发布者未验证；可以与 Release 附带的 SHA256 文件核对。

已导入记录后，直接在工作台搜索并选择联系人/群聊，点击「分析可能性并生成回复」。无需复制近期消息或先生成完整档案。ChatGPT 模式给出七题判断、解释、原文依据和三条排序回复，标注为 ChatGPT 估计；结果按会话保存，重新打开可恢复。详见 [分析与回复](ANALYSIS.md)。

手动输入或截图流程：

1. 打开「模型与设置」，可选择复用 ChatGPT/Codex 登录。API 模式的判断默认用 OpenRouter `typesafe/jev-1.13`，候选生成默认用 `deepseek/deepseek-chat-v3.1`；两个密钥分别填写。
2. 生成接口支持 OpenAI 兼容的完整 `/chat/completions` 地址，可选 DeepSeek、通义千问、OpenRouter、本机 Ollama。预设仅填充地址和模型名称，账号权限、模型可用性由服务商决定。仅使用生成模型时可关闭 Jev 判断与排序。
3. 将「对话来源」切换为「手动输入 / 截图」，选择一个已打开的 QQ 窗口，框选消息区域并点击「本地识别文字」。也可以直接粘贴文本。
4. **校对文字并标注说话人**，每条一行：`我：内容` 或 `对方：内容`。不根据左右位置猜测身份；删除侧边栏、时间等无关行。
5. 选填关系背景，点击「分析对话」。只发送最后 10 条消息及关系背景。三条候选可复制；Jev 可用时会排序。
6. 如需填入：先截取目标窗口，点击候选旁的「5 秒后填入」，再点击该窗口里的空白聊天输入框。程序核对窗口标题、焦点、控件归属及可写性，只调用 UI Automation `ValuePattern.SetValue`，**不模拟 Enter、不点击发送**。

如果窗口变了、输入框已有草稿、处于密码或支付类控件，或 QQ 没有公开可写的 UI Automation 控件，填入会失败并提示手动复制。QQ 输入框能力随版本变化，不能保证直接填入；复制路径始终可用。

## QQ 长上下文

打开「直接读取 QQ 记录」，选择 Tencent Files 目录及已登录的本人账号，读取并校验数据库副本，然后勾选私聊/群聊加入本机档案。也可在「长期聊天档案」导入可读 JSON/TXT。重复导入会去重，不同账号和会话不混合。详见 [格式、分段机制与数据说明](QQ_HISTORY.md)。

点击「查看分析范围与请求数」后，再决定是否生成档案。程序按时间分段整理关系、事件、待办，每条结论附原文引用，并保留各分段摘要供以后检索。支持暂停和续跑；新导入会使总档案过期，更新时复用未变化的分段，从受影响的分段开始重算。

对话工作台默认选择已导入会话，自动加载最多 40 条近期消息，并结合有效档案、相关历史原文和分段记忆；不必先生成完整档案即可回复。手动模式仍可选择「关联 QQ 历史」，十条限制仅针对手工输入的即时对话。长期档案是压缩后的重点摘要，不保证穷尽所有事件；引用用于回查，模型解读仍需人工核实。

**直接读取需要对应 QQ 账号保持登录。** 按 NTQlean 的只读内存匹配方法取得消息库密钥，解密工作副本并合并有效 WAL；没有实现云端历史拉取、附件内容识别或后台自动监听。

## 数据与边界

- 截图保留在应用内存，OCR 使用随包分发的 Tesseract 中英文模型，不把图片发送给模型服务，也不下载云端 OCR 模型。
- 点「分析」后，对话与关系背景发往你配置的判断/生成服务，可能产生 API 费用。关闭 Jev 后只调用生成接口。若只用本机服务并关闭 Jev，分析请求也可留在本机。
- 手动即时对话、截图与临时关系背景不作为消息导入。主动导入的原文、长期档案和直接会话分析结果保存在 `%APPDATA%/jev-chat-windows/qq-history.sqlite`（本机明文 SQLite）。可单独删除会话副本及分析；不会修改 QQ 原始记录。清空工作台不删除已导入历史及保存的分析，也不清除系统剪贴板。
- API 密钥使用 Electron `safeStorage`（Windows DPAPI）加密后存放在 `%APPDATA%/jev-chat-windows/settings.json`；界面读取设置时不会取回明文密钥。切换到不同源的接口时，不保留旧服务密钥。
- 不 hook、不改包、不写 QQ 原始文件。只处理本人本机选定的消息库副本、窗口和导出文件。生成长期档案时才逐段调用模型；关联历史回复会发送当前档案、相关原文及分段记忆。
- 未实现后台自动监听、跨软件联系人关联或视觉模型接口。当前 OCR 仅支持简体中文和英文；复杂气泡、表情、小字可能识别不准，需要人工校对。
- 模型判断属于建议，不代表已证实的意图；判断、候选、排序失败分别提示，不填充假数据。

## 开发与构建

需要 Windows x64、Node.js 22.12+、npm 和 .NET 8 SDK（构建独立的 QQ 读取辅助程序）。打包的辅助程序自带运行时，使用者无需另装 .NET。首次构建需要网络。

```powershell
cd windows
npm ci
npm run prepare:ocr
npm run build:ntqq
npm start
```

```powershell
npm test
npm run test:desktop
npm run dist
```

`test:desktop` 会打开合成聊天窗口，使用本机 mock HTTP 接口测试，包含真实桌面截图、真实离线 OCR 和 UI Automation 填入尝试；不会调用付费服务，也不会给联系人发消息。结果在 `.qa/`。打包输出在 `dist/`。

GitHub Actions 的 `Windows desktop` 工作流执行单元测试并生成安装包与便携版。CI 不运行需要交互式 Windows 会话的桌面验收。查看 [验收记录](QA.md)，区分实际通过与未验证项目。

## 结构

| 路径 | 职责 |
| --- | --- |
| `src/core.cjs` | 对话校验、接口请求、降级与排序 |
| `src/questions.json` | 从上游 `tools/jev/questions.py` 提取的七题题目集 |
| `src/main.cjs` | Windows 窗口采集、加密配置、本地 OCR、受限 IPC |
| `src/preload.cjs` | 仅暴露指定能力的桥接层 |
| `src/ui/` | 中文桌面界面与截图区域选择 |
| `native/fill.ps1` | 校验聚焦输入框并填入，绝不发送 |
| `native/list-qq.ps1`、`native/capture.ps1` | 按进程筛选 QQ，按窗口句柄截图 |
| `src/history.cjs` | 导入与去重、SQLite、分段档案、检索与来源回查 |
| `test/`、`scripts/desktop-smoke.cjs` | 逻辑测试与桌面验收 |

## 致谢与许可

上游作者 Finderchangchang 与 jev-chat contributors，MIT 许可证及版权声明保留在根目录和本目录 `LICENSE`。Windows 移植由 RicardoZ-kisara 仓库维护，与上游官方版本无隶属关系。Electron、Tesseract.js 及模型文件遵循各自许可证，分发包中保留依赖许可文件。
