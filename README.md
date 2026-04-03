# Pulse Isle

Pulse Isle 是一个 macOS 桌面应用，用来在灵动岛区域展示和管理本地运行的 Claude CLI / Codex CLI 会话。

- 实时显示 CLI session 的状态
- 在需要确认时把提示抬到灵动岛
- 直接在灵动岛完成 `y/n` 类确认，减少来回切终端


## 适用场景

如果你经常同时跑多个 `claude` 或 `codex` 任务，希望：

- 不盯着终端也能知道任务进行到哪一步
- 工具调用需要批准时能更快响应
- 在 Cursor 集成终端和本地终端之间保持统一体验

那这个项目会比较适合你。

## 系统要求

- macOS
- Node.js 18+
- 已安装 [Claude Code / Claude CLI](https://docs.anthropic.com/en/docs/claude-code) 或 [Codex CLI](https://github.com/openai/codex)

带硬件缺口的 MacBook 体验最好；项目主要就是围绕灵动岛交互设计的。

## 安装与启动

### 1. 安装依赖

```bash
npm install
cd dynamic-island
npm install
cd ..
```

### 2. 构建

```bash
npm run build
```

### 3. 启动开发构建

```bash
./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron .
```

如果你只是想安装可分发版本，也可以直接看下面的「打包分发」。

## Hooks 行为

Pulse Isle 启动后会默认尝试安装 hooks。

设置面板里的按钮主要用于：

- 手动修复安装
- 重新启用之前移除的 hooks
- 显式卸载 hooks

安装时会自动完成这些事情：

- 把 `pulse-isle-hook.py` 复制到 `~/.pulse-isle/`
- 将 Claude Code hooks 注入到 `~/.claude/settings.json`
- 将 Codex hooks 注入到 `~/.codex/hooks.json`
- 尝试执行 `codex features enable codex_hooks`

无需修改 PATH，一般也不需要重启终端。

### 验证 hooks 是否生效

先看 App 的设置面板中是否显示：

- `Claude Code hooks active`
- `Codex hooks active`

也可以手动检查：

```bash
cat ~/.claude/settings.json
cat ~/.codex/hooks.json
ls -l ~/.pulse-isle/pulse-isle-hook.py
```

### 卸载 hooks

在设置面板点击 `Remove Hooks` 后，应用会：

- 移除 Claude Code / Codex 配置中的 Pulse Isle hook 条目
- 删除 `~/.pulse-isle/pulse-isle-hook.py`

卸载后，`claude` 和 `codex` 仍可继续正常使用；Pulse Isle 也不会在下次启动时自动重新注入，除非你再次手动安装。

## 使用方式

安装完成后，照常使用 `claude` 和 `codex` 即可，不需要改命令习惯。

```bash
claude "帮我重构 auth.ts 的 token 验证逻辑"
codex "add dark mode support to the dashboard"
```

Pulse Isle 在后台运行时会自动显示这些状态：

| 状态 | 灵动岛显示 |
|------|-----------|
| CLI 启动并在运行 | 胶囊状态，显示活动指示和 session 数量 |
| 有 session 需要确认 | 胶囊状态高亮提醒 |
| 鼠标悬停灵动岛 | 展开 session 卡片列表 |
| 需要 `y/n` 确认 | 卡片中显示 prompt 和操作按钮 |
| 需要文字输入 | 卡片提示回到终端继续输入 |
| 任务完成 | 卡片显示完成状态 |

### 灵动岛交互

- 悬停顶部缺口区域，展开 session 列表
- 左右拖拽或使用滚轮，横向切换多个 session
- 点击确认按钮，直接响应 CLI 的确认请求
- 鼠标移开后，界面自动收起

## 主窗口功能

| 功能 | 说明 |
|------|------|
| Session 列表 | 显示活跃 session 和最近结束的 session |
| `Island On/Off` | 开关灵动岛悬浮窗 |
| `Hook Setup` | 查看 hooks 状态，安装、修复或移除 hooks |

## 工作原理

```text
终端 / Cursor                主 App                    灵动岛
──────────                   ──────                    ──────
claude/codex ──Unix Socket─→ Hook Socket Server
                         └───WebSocket──────────────→ UI
                             ←── 确认响应 ───────────←
                ←──────────── 返回 hook 决策 / 放行结果
```

1. Claude Code / Codex 在 hook 事件触发时执行 `pulse-isle-hook.py`
2. Hook 脚本通过 Unix Socket 把 session、tool、approval 等事件发送给主应用
3. 主应用更新 session 状态，再通过 WebSocket 同步给灵动岛窗口
4. 用户在灵动岛完成确认后，主应用把结果返回给等待中的 hook
5. CLI 根据 hook 的返回结果继续执行、等待输入或结束

默认会优先监听 `9720` 端口；如果端口被占用，会自动尝试下一个可用端口。

## 打包分发

```bash
npm run dist
```

产物会输出到 `release/` 目录。安装后可直接双击 `Pulse Isle.app` 启动。

## 版权声明 / License

本项目采用 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) 协议进行许可。

- 个人 / 教育用途：完全免费
- 严禁商用：未经作者本人书面授权，禁止将本代码或修改后的衍生版本用于任何形式的商业盈利行为，包括但不限于付费课程、软件售卖、企业内包、咨询交付等
- 二次开发：允许基于本项目进行二次开发，但衍生项目在对外分发时必须保持同样的非商业、署名、相同方式共享协议

完整说明请见仓库根目录中的 `LICENSE` 文件。

## 故障排查

**灵动岛不显示**

- 确认主窗口中的 `Island On` 已开启
- 确认应用正在运行
- 如果当前设备没有硬件缺口，显示效果可能不符合预期

**session 没有出现**

- 确认 Pulse Isle 正在运行
- 检查 `~/.claude/settings.json` 或 `~/.codex/hooks.json` 是否已注入 hooks
- 检查 `~/.pulse-isle/pulse-isle-hook.py` 是否存在且可执行

**Hooks 安装失败**

- 确认系统已安装 `python3`
- 查看应用内错误提示
- 如果 Codex hooks 没生效，可手动执行：`codex features enable codex_hooks`

**Cursor 集成终端不生效**

- Cursor 集成终端通常会复用本机 `claude` / `codex` 配置
- 如果是在安装 hooks 之前打开的 Cursor，重启 Cursor 后再试

## 目录结构

```text
pulse-isle/
├── electron/           # 主进程：hook socket、session 管理、岛窗口管理
├── hooks/              # CLI hook 脚本
├── src/                # 主窗口 React UI
├── dynamic-island/     # 灵动岛子项目（独立 Electron 进程）
│   ├── electron/       # 岛进程：窗口管理、WS 客户端
│   └── src/            # 岛 UI：卡片、确认按钮
```
