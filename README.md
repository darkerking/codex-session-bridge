# Codex Session Bridge

本地优先的 VS Code 扩展，用来发现、搜索、预览并恢复本机 Codex 历史会话，重点解决“切换账号后，历史会话还在本地，但官方历史列表接不上”的问题。

当前版本：`v1.0.0`
发布日期：`2026-04-20`

## 适用场景

- 切换 Codex 账号后，旧会话在官方历史中不可见
- 需要从本机 `.codex` 中找回历史会话内容
- 希望把旧会话上下文恢复给当前 Codex 对话继续聊
- 希望在修改本地 Codex 元数据前有备份、日志和回滚保护

## 当前能力

- 扫描本机 `.codex` 下的历史会话和归档会话
- 在 VS Code 左侧提供独立的 Session Bridge 面板
- 支持搜索、筛选、预览会话
- 支持将选中会话恢复到当前 Codex 工作流
- 支持实验性的可见性同步、备份、加锁、日志、回滚
- 支持通过 SQLite、索引、会话正文补全标题，改善跨账号旧会话识别

## 工作原理

当前 `v1.0.0` 的核心思路是“恢复上下文”，不是“恢复原生线程身份”。

恢复流程如下：

1. 从本机 `%USERPROFILE%\\.codex` 中扫描历史会话
2. 为选中的会话生成恢复包
3. 将恢复包挂到当前 Codex 对话中
4. 让 Codex 基于恢复包继续承接旧上下文

也就是说，这个项目当前做的是：

- 把旧会话恢复给新线程继续使用
- 而不是直接接管原来的官方 thread id

## 数据来源

默认读取以下本地数据：

- `%USERPROFILE%\\.codex\\sessions`
- `%USERPROFILE%\\.codex\\archived_sessions`
- `%USERPROFILE%\\.codex\\session_index.jsonl`
- `%USERPROFILE%\\.codex\\state_5.sqlite`

## 安装与运行

### 本地开发调试

```powershell
npm install
npm run check
npm run build
npm run smoke
```

然后在 VS Code 中按 `F5` 启动 `Extension Development Host`。

### 使用前说明

在 `F5` 打开的新 VS Code 窗口中，最好先打开目标项目目录，再使用 Codex 面板继续对话。

原因是当前 Codex 面板通常需要一个已打开的项目目录，才能正常发送消息。

## 使用方式

1. 打开左侧 `Session Bridge` 面板
2. 执行 `Refresh Sessions`
3. 使用搜索和筛选定位目标会话
4. 点击 `Preview Session` 查看会话摘要
5. 点击 `Restore to Codex` 将恢复包挂入当前 Codex 对话
6. 如需实验性同步，可使用 `Sync to Official History (Experimental)`
7. 如需排查写操作，可使用 `View Mutation History` 和回滚命令

## 命令列表

- `Refresh Sessions`
- `Search Sessions`
- `Clear Session Search`
- `Configure Session Filters`
- `Clear Session Filters`
- `Preview Session`
- `Restore to Codex`
- `Sync to Official History (Experimental)`
- `Rollback Last Mutation`
- `Rollback Selected Mutation`
- `View Mutation History`

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

## 安全与边界

- 所有实验性写操作都要求先备份
- 写操作带全局锁，防止并发修改本地 Codex 数据
- 写操作会记录 mutation 日志，并支持回滚
- 当前版本是 Windows 优先、本地优先实现
- 当前版本的主路径是“恢复上下文”，不是“恢复原生线程”

## 已知限制

- 恢复后的连续性来自恢复包，不是来自原生会话身份
- 某些场景下，仍需要当前窗口先打开项目目录，Codex 才能正常发送消息
- 实验性同步链路不保证适配未来所有 Codex 内部存储格式变化

## 隐私说明

- 本扩展默认只读取本机 Codex 本地数据
- 不会自动上传你的 `.codex` 原始数据
- 恢复包、备份、日志会写入 VS Code 扩展自己的全局存储目录
- 在执行实验性写操作前，请自行确认本地数据备份策略

## 路线说明

`v1.0.0` 已证明“搜索会话 + 恢复上下文继续聊”这条路线可行。

后续版本会优先改进：

- 恢复时自动处理项目目录 `cwd`
- 让恢复流程更接近无感续聊
- 继续提升标题识别和恢复包质量

## 许可证

暂未添加。开源发布前请补充 `LICENSE` 文件。
