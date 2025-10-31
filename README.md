# Fund-valuation README

这是一个 VS Code 插件，用于实时查看和管理基金估值数据。

## 功能特性

- 📈 实时基金数据展示
- 🔍 基金搜索与添加
- 📋 基金列表管理（添加、删除、置顶）
- ⏱️ 自动刷新基金数据（每 10 秒）
- 📊 基金涨跌可视化显示
- 🌐 支持多种市场基金（A 股、港股、美股等）

## 使用方法

1. vscode 插件搜索“基金估值”安装插件后，在侧边栏会出现一个图标
2. 点击"基金"分类展开基金列表
3. 使用以下命令操作基金：
   - `添加基金`：搜索并添加新的基金到关注列表
   - `刷新`：手动刷新基金数据
   - `删除`：从关注列表中移除基金
   - `置顶`：将基金移动到列表顶部

## 插件命令

| 命令                      | 描述           |
| ------------------------- | -------------- |
| `leekfund.addFund`        | 搜索并添加基金 |
| `leekfund.refresh`        | 刷新基金数据   |
| `leekfund.removeFundItem` | 删除基金项     |
| `leekfund.topFundItem`    | 置顶基金项     |

## 配置选项

本插件会将关注的基金保存在 VS Code 配置中：

- `leekfund.fundList`: 基金列表数组，包含基金代码和名称

## 数据来源

基金数据来源于天天基金网等公开金融数据接口，提供准确的实时估值信息。

## 注意事项

- 插件需要网络连接以获取基金数据
- 基金数据更新可能存在延迟
- 自动刷新仅在插件视图可见时运行以节省资源

## 开发说明

此插件基于以下技术实现：

- TypeScript
- VS Code Extension API
- Axios（HTTP 请求）
- Cheerio（HTML 解析）
- 天天基金 API

主要组件：

- [extension.ts](file://d:\xuexi\vcode\functest\src\extension.ts): 插件入口文件，处理命令注册和生命周期管理
- [fundProvider.ts](file://d:\xuexi\vcode\functest\src\fundProvider.ts): 基金数据提供者，负责数据获取和树形视图渲染
