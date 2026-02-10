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

## 安装

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
├── manifest.json              # 扩展配置
├── package.json               # 项目配置
├── vite.config.js             # Vite 构建配置
├── src/
│   ├── sidepanel/             # 侧边栏 UI
│   ├── background/            # 后台服务
│   ├── content/               # 内容脚本
│   ├── utils/                 # 工具函数
│   ├── styles/                # 公共样式
│   └── assets/icons/          # 扩展图标
└── dist/                      # 构建输出
```

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

## 许可证

MIT License

## 相关链接

- [GitHub 仓库](https://github.com/HanboyLee/unfollow-xx)
