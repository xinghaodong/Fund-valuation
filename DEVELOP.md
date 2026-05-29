# 基金估值插件 - 开发与发布指南

## 环境要求

- Node.js ≥ 18
- VS Code（用于调试）
- vsce（用于发布）：`npm install -g @vscode/vsce`

---

## 开发调试

### 1. 编译并启动调试

```bash
npm run compile     # 编译一次
```

或者监视模式（修改代码自动重新编译）：

```bash
npm run watch
```

### 2. 运行插件

在 VS Code 中按 **F5**，或者：

1. 打开调试面板（`Ctrl+Shift+D`）
2. 选择 **"Run Extension"**
3. 按 **F5**

这会打开一个新的 VS Code 窗口，加载你的插件。

### 3. 调试日志

插件的 `console.log` 输出在 **调试控制台**（Debug Console）中查看。

---

## 打包发布

### 方式一：生成 .vsix 文件（本地安装）

```bash
npm run package
```

打包后的文件：`fund-valuation-x.x.x.vsix`

安装方式：

- 双击 .vsix 文件直接安装
- 或 `code --install-extension fund-valuation-x.x.x.vsix`

### 方式二：发布到 VS Code 插件市场

> 需要 [Visual Studio Marketplace](https://marketplace.visualstudio.com/) 账号和 Personal Access Token。

```bash
# 登录
vsce login <publisher-name>

# 发布
vsce publish
```

---

## 项目结构

```
src/
├── extension.ts          # 插件入口、命令注册、UI
├── fundProvider.ts       # 数据获取、TreeView Provider
├── common/new.ts         # 类型定义
├── util.ts               # 工具函数
└── pages/
    └── holding.html      # 持仓金额管理页面
```

## 相关命令

| 命令              | 说明                     |
| ----------------- | ------------------------ |
| `npm run compile` | 编译 TypeScript          |
| `npm run watch`   | 监视模式（自动重新编译） |
| `npm run package` | 打包为 .vsix             |
| `npm run lint`    | ESLint 检查              |
| `npm test`        | 运行测试                 |

---

## 发布前检查清单

1. 更新 `package.json` 中的 `version`
2. 更新 `CHANGELOG.md`
3. 确保 README.md 文档最新
4. 运行 `npm run lint` 无报错
5. 运行 `npm run package` 确认打包成功
6. 本地安装 .vsix 测试功能正常
7. 然后执行 `vsce publish`
