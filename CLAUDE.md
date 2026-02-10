# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

X Unfollower 是一个 Chrome 扩展（Manifest V3），帮助用户管理 X (Twitter) 关注列表。它支持扫描关注者、按互关/非互关和蓝 V 认证筛选、以及带每日限额的批量取关功能。

## 开发命令

```bash
# 开发模式，支持热更新（HMR 端口 5173）
npm run dev

# 构建生产版本到 dist/
npm run build

# 发布新版本（更新 package.json、manifest.json、创建 git tag）
npm run release          # 交互式选择版本类型
npm run release:patch    # Bug 修复 (1.0.0 -> 1.0.1)
npm run release:minor    # 新功能 (1.0.0 -> 1.1.0)
npm run release:major    # 破坏性变更 (1.0.0 -> 2.0.0)
```

在 Chrome 中加载扩展：
1. 运行 `npm run dev` 或 `npm run build`
2. 打开 `chrome://extensions/`
3. 启用"开发者模式"
4. 点击"加载已解压的扩展程序"，选择 `dist` 目录

## 架构设计

这是一个**三层通信的 Chrome 扩展**：

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          CHROME 扩展架构                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────────┐         ┌──────────────────┐        ┌─────────────┐  │
│  │   Side Panel     │◄───────►│   Service Worker │◄──────►│    X.com    │  │
│  │   (UI 层)        │         │   (协调器)        │        │   Content   │  │
│  │                  │         │                  │        │   Script    │  │
│  │  - 用户列表      │         │  - 每日限额      │        │             │  │
│  │  - 筛选器        │         │  - 历史记录      │        │  - 扫描     │  │
│  │  - 取关按钮      │         │  - 存储          │        │  - DOM/API  │  │
│  └──────────────────┘         └──────────────────┘        └─────────────┘  │
│          ▲                                                          ▲       │
│          │                                                          │       │
│     chrome.runtime.onMessage                                 chrome.tabs   │
│     .sendMessage (广播)                                       .sendMessage  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 组件通信

1. **Side Panel → Service Worker**：请求取关、查询每日配额
2. **Service Worker → Content Script**：向 X.com 页面发送扫描/取关命令
3. **Content Script → Service Worker**：广播扫描进度/完成状态
4. **Service Worker → Side Panel**：转发来自 content script 的消息

Service Worker 充当**消息代理**，因为 side panel 和 content script 无法直接通信。

### 核心文件与职责

| 文件 | 职责 |
|------|------|
| `src/background/service-worker.js` | 消息协调、每日限额控制、历史记录 |
| `src/content/content.js` | X.com 页面交互：fetch 拦截、DOM 解析、通过 API/DOM 取关 |
| `src/sidepanel/main.js` | UI 逻辑：筛选、搜索、白名单、取关确认 |
| `src/utils/storage.js` | Chrome storage 封装，含每日配额辅助函数 |
| `src/utils/rate-limiter.js` | 随机延迟防自动化（支持暂停/恢复） |
| `src/sidepanel/helpers.js` | UI 工具：toast 提示、格式化、SVG 图标 |

### 数据流：扫描操作

1. 用户在侧边栏点击"扫描"
2. Side panel 经由 service worker 向 content script 发送 `START_SCAN`
3. Content script 如需要则导航到 `/username/following`
4. Content script 拦截 `window.fetch` 捕获 GraphQL 响应
5. Content script 滚动页面触发懒加载
6. Content script 定期发送 `SCAN_PROGRESS` 消息
7. Content script 发送 `SCAN_COMPLETE` 携带用户数组
8. Side panel 接收广播，缓存数据（30 分钟有效期），渲染列表

### 数据流：取关操作

1. 用户点击"取关" → 确认弹窗
2. Side panel 向 service worker 发送 `UNFOLLOW_ONE`，携带 `{user, tabId}`
3. Service worker 检查每日限额（50 次/天）
4. Service worker 转发到 content script，携带 `{userId, screenName}`
5. Content script 优先尝试 API 取关 (`/i/api/1.1/friendships/destroy.json`)
6. API 失败则回退到 DOM 点击方式
7. Service worker 增加计数器，记录历史，返回新计数
8. Side panel 更新 UI（配额条、按钮状态）

### 重要模式

**消息传递返回值** - 异步处理必须使用 `return true` 并调用 `sendResponse()`：
```javascript
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleAsync().then(sendResponse);
  return true; // 保持通道开启
});
```

**Storage 结构** - 使用 `chrome.storage.local` 存储以下数据：
- `cachedUsers` - 最近扫描结果（30 分钟缓存）
- `whitelist` - 受保护用户 ID 数组
- `unfollowedIds` - 已取关用户 ID（持久化）
- `dailyUnfollow` - `{date: "YYYY-MM-DD", count: N}`
- `unfollowHistory` - `{timestamp, userId, screenName, name, avatar}` 数组

**X.com fetch 拦截** - Content script 覆盖 `window.fetch` 从 GraphQL 响应提取用户数据。API 响应结构：
```
data.user.result.timeline.timeline.instructions[].entries[].content.itemContent.user_results.result
```

**蓝 V 检测** - 从 API 响应 (`is_blue_verified`) 或 DOM (SVG with `data-testid="icon-verified"`) 提取。

## 构建系统

使用 **Vite + @crxjs/vite-plugin**。该插件：
- 监听 `manifest.json` 变化
- 处理 side panel 和 content script 的 HMR
- 复制静态资源（图标）到 dist
- 构建时生成正确的扩展 manifest

`package.json` 和 `manifest.json` 的版本号必须保持同步 —— 发布脚本会自动处理。

## GitHub Actions 发布

推送 `v*.*.*` 格式的 tag 会触发自动发布：
1. 使用 `npm run build` 构建扩展
2. 打包 `dist/` 目录为 zip
3. 创建 GitHub Release 并附加 zip 文件
4. 生成安装说明

## 测试注意事项

- Side Panel API 需要 Chrome 114+
- Content script 注入需要用户在 x.com 或 twitter.com 页面
- 每日取关限额 50 次硬编码（可在 `src/utils/storage.js` 中调整）
