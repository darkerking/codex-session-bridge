# Codex Session Bridge

一个本地优先的 VS Code 扩展，帮助你在切换 Codex 账号后，重新找到并直接打开这台机器上的旧会话，实现尽可能接近原生的“继续聊”体验。

## 这个插件解决什么问题

很多时候，Codex 的历史会话其实还在本机 `.codex` 目录里，但一旦切换账号：

- 官方历史列表里看不到之前的会话
- 原来的项目背景信息、讨论上下文、任务进展断掉了
- 只能靠手工复制摘要，续聊效果很差

`Codex Session Bridge` 的目标，就是把“本地还存在的旧会话”重新接回当前 VS Code 里的 Codex 面板，让续聊体验尽量接近官方原生会话。

## 核心价值

- 跨账号找回这台机器上的本地 Codex 会话
- 直接打开旧线程，而不是只生成一个摘要文件喂给新会话
- 尽可能保留原来的上下文衔接感，减少“重新解释一遍项目背景”
- 支持搜索、筛选、预览，方便在大量历史会话里快速定位

## 为什么说是“无缝衔接”

这个项目当前的主路径，不是把历史对话压缩成 Markdown 再注入新会话。

它优先做的是：

1. 扫描本机 `%USERPROFILE%\\.codex` 下的历史会话
2. 定位你想继续的本地线程 ID
3. 直接调用官方 OpenAI ChatGPT / Codex 扩展自己的本地线程打开链路
4. 让 VS Code 跳转到对应的旧线程继续使用

这意味着它的体验更接近：

- “把原来的会话重新打开”

而不是：

- “新建一个会话，再把旧内容当附件发进去”

也正因为如此，在已经验证通过的环境里，续聊效果会明显好于传统的恢复包方案。

## 当前功能

- 扫描本机 `.codex` 下的会话与归档会话
- 在 VS Code 左侧提供独立的 `Session Bridge` 面板
- 支持按标题、会话 ID、工作目录、模型提供方进行搜索
- 支持按工作目录、归档状态、时间范围进行筛选
- 支持 `Preview Session` 查看会话摘要
- 支持 `Open in Codex` 直接打开本地旧线程
- 支持标题补全，尽量改善跨账号场景下的会话识别
- 支持实验性的可见性同步、备份、日志、回滚
- 支持运行时自检，检查官方 `openai.chatgpt` 扩展是否具备所需能力

## 工作原理

### 主链路

当前版本的主链路是“原生本地线程重开”：

- 读取本地会话元数据和索引
- 识别会话标题、更新时间、工作目录、模型信息
- 调用官方扩展的本地线程路由，打开 `/local/<threadId>` 对应线程

### 为什么效果更好

因为这条链路复用了官方扩展自己的本地线程打开机制，所以在可用环境下，它比“恢复包注入新对话”更容易保住上下文连续性。

### 自检机制

插件会在两个时机做健康检查：

- 激活时进行轻量检查
- 执行 `Open in Codex` 前进行强校验

当前会检查：

- 官方 `openai.chatgpt` 扩展是否已安装并启用
- 是否具备 `onUri` 能力
- 当前环境是否具备用于打开侧栏或面板的相关命令

如果环境不满足要求，插件会给出明确提示，而不是静默失败。

## 数据来源

默认读取以下本地数据：

- `%USERPROFILE%\\.codex\\sessions`
- `%USERPROFILE%\\.codex\\archived_sessions`
- `%USERPROFILE%\\.codex\\session_index.jsonl`
- `%USERPROFILE%\\.codex\\state_5.sqlite`

## 安装

### 方式一：从 VS Code 扩展市场安装

在 VS Code 扩展市场中搜索：

- `Codex Session Bridge`

### 方式二：本地打包安装

```powershell
npm install
npm run build
vsce package
```

然后在 VS Code 中选择 `Extensions: Install from VSIX...` 安装生成的 `.vsix` 文件。

## 本地开发

```powershell
npm install
npm run check
npm run build
npm run smoke
```

按 `F5` 启动 `Extension Development Host` 进行调试。

建议在新的调试窗口中先打开一个项目目录，再测试 `Open in Codex`。某些情况下，官方 Codex 面板需要绑定到一个已打开的工作区后，才能稳定发送后续消息。

## 使用方式

1. 打开左侧 `Session Bridge` 面板
2. 执行 `Refresh Sessions`
3. 通过搜索和筛选定位目标会话
4. 可先用 `Preview Session` 查看摘要
5. 点击 `Open in Codex`，直接尝试打开本地旧线程

如果你只是想把旧会话重新接回当前账号，以上流程就是最核心、最推荐的用法。

## 命令列表

- `Refresh Sessions`
- `Search Sessions`
- `Clear Session Search`
- `Configure Session Filters`
- `Clear Session Filters`
- `Preview Session`
- `Open in Codex`
- `Sync to Official History (Experimental)`
- `Rollback Last Mutation`
- `Rollback Selected Mutation`
- `View Mutation History`

## 适用范围

当前版本优先面向：

- Windows
- 当前机器上的本地 `.codex` 数据
- 已安装官方 `openai.chatgpt` 扩展的 VS Code 环境

## 已知限制

- 是否能够继续发送消息，仍然取决于官方扩展当前账号状态和会话状态
- 某些情况下需要先打开一个项目目录，Codex 面板才能正常继续对话
- 当前主链路依赖官方扩展的本地线程路由能力；如果官方后续调整内部实现，可能需要跟进适配
- 实验性同步链路不保证适配未来所有本地存储格式变化

## 安全与隐私

- 默认只读取本机 Codex 本地数据
- 不会自动上传你的 `.codex` 原始会话文件
- 实验性写操作会先备份，再执行修改
- 所有写操作都有日志记录，并支持回滚
- 预览、备份、日志会写入 VS Code 扩展自己的全局存储目录

## 项目结构

```text
src/
  application/
  commands/
  discovery/
  indexing/
  integration/
  mutation/
  persistence/
  recovery/
  shared/
  ui/
media/
scripts/
```

## 版本说明

`v1.0.x` 的产品重点已经收敛为：

- 搜索本地历史会话
- 在切换账号后重新找到旧上下文
- 以接近原生的方式重新打开本地线程续聊

## License

本项目采用 [MIT License](./LICENSE)。
