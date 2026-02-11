# X Unfollower

> 一款 Chrome 扩展，帮助用户智能管理 X (Twitter) 关注列表，批量取消关注不互关或非蓝 V 的账号。

## 功能特性

- **侧边栏体验** - 使用 Chrome Side Panel API，不遮挡页面，可持续操作
- **智能筛选** - 按不互关、非蓝 V、互关等条件筛选关注列表
- **蓝 V 检测** - 快速识别 X Premium 认证用户
- **白名单保护** - 防止误取消重要关注
- **操作历史** - 记录所有取消关注操作
- **速率控制** - 每日上限 50 次，防止账号被限制
- **纯本地存储** - 所有数据存储在本地，保护用户隐私
- **实时进度** - 扫描过程显示实时进度，支持随时停止
- **CSP 绕过** - 使用 MAIN World 脚本拦截 GraphQL API 响应

## 下载

### 从 GitHub Releases 下载（推荐）

访问 [Releases 页面](https://github.com/HanboyLee/unfollow-xx/releases) 下载最新版本。

### 开发模式安装

1. 克隆仓库：
```bash
git clone https://github.com/HanboyLee/unfollow-xx.git
cd unfollow-xx
```

2. 安装依赖：
```bash
npm install
```

3. 构建项目：
```bash
npm run build
```

4. 在 Chrome 浏览器中加载扩展：
   - 打开 `chrome://extensions/`
   - 启用"开发者模式"
   - 点击"加载已解压的扩展程序"
   - 选择项目的 `dist` 目录

## 使用方法

1. 访问 [x.com](https://x.com) 并登录
2. 点击扩展图标打开侧边栏
3. 点击"扫描关注列表"获取数据
4. 使用筛选功能找到要取关的用户
5. 单独点击"取关"按钮取消关注

## 技术栈

- Manifest V3 - Chrome 扩展标准
- Vite + CRXJS - 构建工具与热更新
- Chrome Side Panel API - 侧边栏展示
- Chrome Storage API - 本地数据持久化
- Content Scripts - 页面注入与 DOM 操作

## 项目结构

```
x-unfollower/
├── manifest.json              # 扩展配置文件
├── package.json               # 项目配置与依赖
├── vite.config.js             # Vite 构建配置（含 CRXJS 插件）
├── scripts/
│   └── release.js             # 自动发布脚本（版本同步）
├── .github/workflows/
│   └── release.yml            # GitHub Actions 自动发布流程
├── src/
│   ├── sidepanel/             # 侧边栏 UI
│   │   ├── main.js            # UI 逻辑：筛选、搜索、白名单
│   │   └── helpers.js         # UI 工具：toast、格式化、SVG 图标
│   ├── background/
│   │   └── service-worker.js  # 消息协调、每日限额控制、历史记录
│   ├── content/               # 内容脚本
│   │   ├── content.js         # X.com 页面交互：DOM 解析、取关
│   │   └── fetch-interceptor.js  # MAIN World 脚本：拦截 fetch/XHR
│   ├── utils/                 # 工具函数
│   │   ├── storage.js         # Chrome storage 封装（含配额辅助）
│   │   └── rate-limiter.js    # 随机延迟防自动化
│   ├── styles/                # 公共样式
│   └── assets/icons/          # 扩展图标
└── dist/                      # 构建输出目录
```

## 架构设计

### 三层通信架构

本扩展采用 **Service Worker 作为消息代理** 的三层通信架构：

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
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**为什么需要 Service Worker 作为代理？**
- Side Panel 和 Content Script 无法直接通信
- 需要集中管理状态（每日配额、历史记录）
- 消息广播和路由需要中心协调点

### 核心文件职责

| 文件 | 职责 |
|------|------|
| `service-worker.js` | 消息协调、每日限额控制、历史记录管理 |
| `fetch-interceptor.js` | MAIN World 脚本，拦截 GraphQL API 响应 |
| `content.js` | DOM 解析、滚动扫描、API/DOM 取关 |
| `main.js` | UI 渲染、筛选、搜索、白名单管理 |
| `storage.js` | Chrome storage 封装，含每日配额辅助函数 |
| `rate-limiter.js` | 随机延迟工具（支持暂停/恢复） |
| `helpers.js` | UI 工具：toast 提示、格式化、SVG 图标 |

### 消息传递模式

| 方向 | 消息类型 | 说明 |
|------|----------|------|
| **Side Panel → Service Worker** | `UNFOLLOW_ONE` | 请求取关指定用户 |
| | `GET_DAILY_COUNT` | 查询今日配额 |
| | `START_SCAN_TAB` | 发起扫描（自动导航） |
| | `STOP_SCAN_TAB` | 停止扫描 |
| **Service Worker → Content Script** | `PING` | 检查 content script 是否加载 |
| | `START_SCAN` | 开始扫描关注列表 |
| | `STOP_SCAN` | 停止扫描 |
| | `UNFOLLOW_USER` | 执行取关操作 |
| | `NAVIGATE_TO_FOLLOWING` | 点击 Following 标签页（SPA 导航） |
| **Content Script → Service Worker** | `SCAN_PROGRESS` | 广播扫描进度 |
| | `SCAN_COMPLETE` | 广播扫描完成（用户数组） |
| | `SCAN_ERROR` | 广播扫描错误 |

## 操作流程

### 扫描操作流程

```
┌─────────────┐    START_SCAN_TAB    ┌───────────────┐    NAVIGATE    ┌─────────────┐
│ Side Panel  │ ──────────────────► │Service Worker │ ──────────────► │  X.com      │
└─────────────┘                     └───────────────┘                 └─────────────┘
       ▲                                   │                                  │
       │                                   │ inject scripts                   │
       │                                   ▼                                  ▼
       │                          ┌───────────────┐    START_SCAN     ┌─────────────┐
       │                          │Content Script │ ◄─────────────── │Service Worker│
       │                          └───────────────┘                   └─────────────┘
       │                                   │                                  │
       │                                   │ click Following tab              │
       │                                   ▼                                  │
       │                          ┌───────────────┐                         │
       │                          │ MAIN World    │                         │
       │                          │ Interceptor   │                         │
       │                          └───────────────┘                         │
       │                                   │                                  │
       │                      capture GraphQL responses                      │
       │                                   │                                  │
       │                      scroll & trigger lazy load                    │
       │                                   │                                  │
       │  SCAN_PROGRESS/COMPLETE  ◄────────┴──────────────────────────────────┘
       └──────────────────────────────────────────────────────────────────────┘
```

**详细步骤：**
1. 用户点击侧边栏的"扫描"按钮
2. Service Worker 导航到用户个人主页
3. 注入 content script 和 fetch interceptor
4. 点击"Following"标签页（SPA 导航）
5. MAIN World 脚本拦截 GraphQL API 响应
6. 滚动页面触发懒加载
7. 定期广播 `SCAN_PROGRESS` 更新进度
8. 发送 `SCAN_COMPLETE` 携带完整用户列表

### 取关操作流程

```
┌─────────────┐   UNFOLLOW_ONE    ┌───────────────┐   UNFOLLOW_USER   ┌─────────────┐
│ Side Panel  │ ────────────────► │Service Worker │ ─────────────────► │Content Script│
└─────────────┘                   └───────────────┘                    └─────────────┘
                                       │                                     │
                                  check quota                           try API first
                                       │                                     │
                              ┌─────────┴─────────┐                         │
                              │ daily limit: 50   │                         │
                              └─────────┬─────────┘                         │
                                        │                                     ▼
                              increment counter                    ┌──────────────────┐
                              record history                      │ POST /i/api/...  │
                                       │                            └──────────────────┘
                                       │                                     │
                              return new count                              fail?
                                       │                                     │
                                       ▼                                     ▼
┌─────────────┐   update UI     ┌───────────────┐                 ┌──────────────────┐
│ Side Panel  │ ◄────────────── │Service Worker │                 │   DOM click      │
└─────────────┘                   └───────────────┘                 └──────────────────┘
                                                                                │
                                                                           still fail?
                                                                                │
                                                                                ▼
                                                                      ┌──────────────────┐
                                                                      │ navigate to user │
                                                                      │    profile       │
                                                                      └──────────────────┘
```

**详细步骤：**
1. 用户点击"取关" → 确认弹窗
2. Service Worker 检查每日限额（50 次/天）
3. 优先尝试 API 取关 (`/i/api/1.1/friendships/destroy.json`)
4. API 失败则回退到 DOM 点击方式
5. 最后手段：导航到用户个人主页
6. Service Worker 增加计数器，记录历史
7. 返回新计数，侧边栏更新 UI

## 数据结构

### Storage (chrome.storage.local)

| 键名 | 类型 | 说明 |
|------|------|------|
| `cachedUsers` | Array | 扫描结果用户数组（30 分钟缓存） |
| `cachedAt` | Number | 缓存时间戳 |
| `whitelist` | Array | 受保护用户 ID 数组 |
| `unfollowedIds` | Array | 已取关用户 ID 数组（持久化） |
| `dailyUnfollow` | Object | `{date: "YYYY-MM-DD", count: N}` |
| `unfollowHistory` | Array | 历史记录条目（最多 500 条） |

### 用户对象结构

```javascript
{
  id: string,              // 数字 ID 或 screenName 备用
  name: string,            // 显示名称
  screenName: string,      // 用户名 (@xxx)
  avatar: string,          // 头像 URL
  followersCount: number | null,
  followingCount: number | null,
  statusesCount: number | null,
  isFollowingYou: boolean, // 是否互关
  isBlueVerified: boolean, // 是否蓝 V
  status: 'mutual' | 'not-following-back',
  description: string,     // 简介
  incomplete: boolean      // true = DOM 回退数据（缺少粉丝数）
}
```

### 技术细节

- **Manifest 版本**: V3
- **最低 Chrome 版本**: 114+ (Side Panel API)
- **每日取关上限**: 50 次（硬编码）
- **滚动间隔**: 1500ms
- **最大滚动重试**: 5 次后结束扫描
- **缓存有效期**: 30 分钟
- **开发服务器端口**: 5173 (HMR)

## 权限说明

| 权限 | 用途 |
|------|------|
| `activeTab` | 获取当前 X 标签页信息 |
| `storage` | 存储白名单、操作历史、用户设置 |
| `sidePanel` | 在侧边栏展示扩展 UI |
| `host_permissions` | 在 X 页面注入 Content Script |

## 注意事项

> [!WARNING]
> 本工具仅供个人使用，频繁的取消关注操作可能导致 X 账号被暂时限制功能。

> [!NOTE]
> Side Panel API 需要 Chrome 114+ 版本支持。

## 开发

```bash
# 开发模式（支持热更新）
npm run dev

# 构建生产版本
npm run build
```

### 发布新版本

```bash
# 补丁版本 (1.0.0 -> 1.0.1)
npm run release:patch

# 次要版本 (1.0.0 -> 1.1.0)
npm run release:minor

# 主要版本 (1.0.0 -> 2.0.0)
npm run release:major

# 交互式选择
npm run release
```

详细说明请参考 [发布指南](./RELEASE.md)。

## 许可证

MIT License

## 相关链接

- [GitHub 仓库](https://github.com/HanboyLee/unfollow-xx)
