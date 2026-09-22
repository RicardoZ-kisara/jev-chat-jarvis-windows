# QQ NT 直接读取与长期记忆

0.1.2 增加本人本机 QQ NT 消息库接入，参考 [NTQlean](https://github.com/Kevin-2106/NTQlean) 的只读密钥匹配和副本解密实现。解密过程没有模型请求；聊天不会因读取而上传 GitHub 或 ChatGPT。

## 使用

1. 保持目标 QQ 账号登录，在助手点击「直接读取 QQ 记录」。
2. 选择 `Tencent Files` 根目录，扫描并选择账号。本机已知目录为 `D:\QQ\chat\Tencent Files`。
3. 点击「解密副本并读取会话」。完成后显示私聊/群聊列表、消息数、页面校验及 WAL 合并结果。
4. 勾选会话，点击「加入本机长期档案」。可反复读取和导入；同账号、同会话、同原消息 ID 去重，已变化消息更新。
5. 在「长期聊天档案」选择会话，查看分析范围，生成档案。该步骤才调用已配置的 ChatGPT/Codex，并消耗账号额度。
6. 在工作台选择「关联 QQ 历史」，回复时使用总档案、相关原文和相关分段记忆。

## 本地数据与校验

- 辅助程序仅匹配 `nt_msg.db` 的 salt；不提取登录数据库或账号登录票据。只用进程查询和只读内存访问，不注入、不 hook、不写内存。密钥仅在辅助进程存活期间使用，不回显、不存盘。
- QQ 原文件只读打开。复制消息库及 WAL 后，比较文件元数据与 SHA256；持续变化则重试，仍不稳定就报错。
- 页大小 4096、AES-256-CBC、PBKDF2-SHA512 派生 HMAC key。每个输出页必须通过 HMAC 校验。WAL 校验 salt 和累计 checksum，仅合并已提交事务；重置前的旧尾部及未提交事务不应用。
- 合并后的副本通过 SQLite `quick_check` 才可用于导入。失败不会冒充成功，也不会悄悄忽略 WAL 后只读主库。
- 临时解密副本位于 `%APPDATA%\jev-chat-windows\ntqq-snapshots`，已导入原文、来源映射和分段记忆位于同目录下的 `qq-history.sqlite`。均为本机明文，请勿把用户数据目录提交到 GitHub。重新读取同一账号或正常退出时会清理当前运行的临时副本；异常退出留下的副本仍可能占用磁盘。

## 还原范围

当前识别 `c2c_msg_table` / `group_msg_table`：保存 64 位原消息 ID、会话对象、实际发送者、昵称/群名片、时间和 `40800` Protobuf 消息正文。多段正文保持顺序。群名暂以群号显示；好友名从消息中的发送者昵称回退。

图片、文件、语音、视频、表情、引用等保留类型占位或文件名，不下载资源、不转录语音、不理解图片。未支持或损坏结构有计数与占位，不伪造正文。空正文、无有效时间或会话对象的记录可能跳过，UI 显示导入统计。不能恢复 QQ 本机数据库中本就不存在的云端历史或已清理内容；不是数据取证恢复工具。

长期记忆不是把全库塞进一次请求：按时间分段、保留每段摘要和原文引用；更新时复用未变化的分段，回复时检索相关记忆。少量重点摘要不等于完整事实数据库，引用编号存在也不保证模型解读正确。

## 参考与构建

- [NTQlean 只读扫描源码](https://github.com/Kevin-2106/NTQlean/blob/fabe409d5c9bee57710abe779baabbb4f3b9f61a/src/NTQlean.Core/KeyDumper.cs)，MIT，保留完整许可及声明。
- [QQBackup 消息字段资料](https://github.com/QQBackup/nt_msg_db_util/blob/317024ce2c5e3482fdf9f310a5a7159ab4927e34/db_docs/c2c_msg_table/summary.md)：仅参考字段事实，未合入其 GPL 代码。
- [SQLite WAL 格式](https://www.sqlite.org/fileformat2.html#write_ahead_log)：checksum、提交边界、日志重置。

构建辅助程序：安装 .NET 8 SDK，运行 `npm run build:ntqq`。非默认 SDK 可设置 `JEV_DOTNET` 为完整可执行路径。发布采用自包含 win-x64 程序，使用者无需安装 SDK。`resources/ntqq/Jev.NtqqBridge.exe --self-test` 只使用合成页和日志验证完整性与提交边界。
