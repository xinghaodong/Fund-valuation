// src/extension.ts

import * as vscode from "vscode";
import { LeekFundDataProvider } from "./fundProvider";

/**
 * 搜索结果项的接口，继承自 QuickPickItem
 */
interface IFundQuickPickItem extends vscode.QuickPickItem {
  fundCode: string;
  fundName: string;
}

/**
 * 存储在 VS Code 配置中的基金对象格式
 */
interface IConfigFundItem {
  code: string;
  name: string;
}
// 定义一个计时器
export let timer: NodeJS.Timeout | null = null;
const provider = new LeekFundDataProvider();
function startAutoRefresh(provider: LeekFundDataProvider) {
  console.log("开始自动刷新");
  // 这里初始化先刷新一次
  provider.refresh();
  timer = setInterval(() => {
    provider.refresh();
  }, 10 * 1000);
}

async function showFundSearchPicker(provider: LeekFundDataProvider) {
  const quickPick = vscode.window.createQuickPick<IFundQuickPickItem>();

  // 设置标题和占位符
  quickPick.title = "🔍搜索并添加基金";
  quickPick.placeholder = "输入基金代码或名称（如：159736 或 纳斯达克）";
  quickPick.matchOnDescription = true;
  quickPick.matchOnDetail = true;

  let searchTimer: NodeJS.Timeout | undefined;
  const DEBOUNCE_DELAY = 200; // 200ms 防抖

  // 监听输入变化
  quickPick.onDidChangeValue(async (value) => {
    // 清除上一个计时器
    if (searchTimer) {
      clearTimeout(searchTimer);
    }

    if (!value.trim()) {
      quickPick.items = [];
      return;
    }

    // 设置新的计时器
    searchTimer = setTimeout(async () => {
      // 显示加载中
      quickPick.busy = true;

      try {
        // 调用搜索接口
        const result = await provider.getFundSearch(value);

        if (typeof result === "string" || !result?.Datas?.length) {
          quickPick.items = [
            {
              label: `$(warning) 未找到相关基金`,
              description: `请尝试其他关键词："${value}"`,
              fundCode: "",
              fundName: "",
            },
          ];
          return;
        }

        // console.log(result, "result");
        // 将搜索结果转换为 QuickPickItem 数组
        const items: IFundQuickPickItem[] = result.Datas.map(
          (fund: { NAME: any; _id: any; Pinyin: any }) => ({
            label: `$(search) ${fund.NAME}`, // 添加图标
            description: `代码: ${fund._id}`,
            fundCode: fund._id,
            fundName: fund.NAME,
          })
        );

        quickPick.items = items;
      } catch (err) {
        console.error("搜索失败:", err);
        quickPick.items = [
          {
            label: `$(error) 网络错误，请重试`,
            description: "搜索请求失败，请检查网络连接",
            fundCode: "",
            fundName: "",
          },
        ];
      } finally {
        // 停止加载
        quickPick.busy = false;
      }
    }, DEBOUNCE_DELAY);
  });

  // 监听用户选择
  quickPick.onDidAccept(async () => {
    const selected = quickPick.selectedItems[0];
    console.log(selected, "selected");

    // 确保选中的是有效的基金项
    if (selected && selected.fundCode) {
      // 关闭 QuickPick
      quickPick.dispose();

      // 获取配置
      const config = vscode.workspace.getConfiguration("leekfund");
      // 注意：现在的 fundList 是 IConfigFundItem 对象的数组
      let fundList: IConfigFundItem[] = config.get("fundList", []);

      const newFundCode = selected.fundCode;
      const newFundName = selected.fundName;

      // 检查是否已存在
      const alreadyExists = fundList.some((item) => item.code === newFundCode);

      if (!alreadyExists) {
        // 添加新基金对象
        fundList.push({ code: newFundCode, name: newFundName });
        await config.update(
          "fundList",
          fundList,
          vscode.ConfigurationTarget.Global
        );

        provider.refresh(); // 刷新视图
        vscode.window.showInformationMessage(
          `已添加: ${newFundName} (${newFundCode})`
        );
      } else {
        vscode.window.showInformationMessage(`${newFundName} 已在关注列表中`);
      }
    }
  });

  // 监听关闭事件，清理资源
  quickPick.onDidHide(() => {
    if (searchTimer) {
      clearTimeout(searchTimer);
    }
    quickPick.dispose();
  });

  // 显示 QuickPick
  quickPick.show();
}

export function activate(context: vscode.ExtensionContext) {
  console.log('扩展 "functest" 已激活!');

  // 注册 TreeView
  const treeView = vscode.window.createTreeView("leekFundView", {
    treeDataProvider: provider,
  });

  // 注册刷新基金命令
  let refreshCmd = vscode.commands.registerCommand(
    "leekfund.refresh",
    async () => {
      vscode.window.setStatusBarMessage(
        "$(sync~spin) 正在刷新基金数据...",
        2000
      );

      // 注册一次性监听器
      const disposable = provider.onDidFinishRefresh(() => {
        if (provider.result) {
          vscode.window.showInformationMessage("刷新成功！");
        }
        disposable.dispose(); // 避免重复监听
      });

      provider.refresh(); // 触发刷新
    }
  );

  // 注册新增基金命令  调用 showFundSearchPicker
  let addFundCmd = vscode.commands.registerCommand("leekfund.addFund", () => {
    showFundSearchPicker(provider);
  });

  // 注册删除基金命令
  let removeFundCmd = vscode.commands.registerCommand(
    "leekfund.removeFundItem",
    async (item: any) => {
      if (!item || !item.id) {
        vscode.window.showWarningMessage("未找到该基金信息");
        return;
      }
      const confirm = await vscode.window.showWarningMessage(
        `确定要删除 ${item.label?.toString().trim()} 吗？`,
        "确定",
        "取消"
      );
      if (confirm === "确定") {
        const config = vscode.workspace.getConfiguration("leekfund");
        const fundList = config.get<IConfigFundItem[]>("fundList", []);
        // 过滤掉要删除的基金
        const updatedList = fundList.filter((f) => f.code !== item.id);

        await config.update(
          "fundList",
          updatedList,
          vscode.ConfigurationTarget.Global
        );

        provider.refresh();
        vscode.window.showInformationMessage("基金已删除");
      }
    }
  );

  // 注册置顶基金命令
  let topFundCmd = vscode.commands.registerCommand(
    "leekfund.topFundItem",
    async (item: any) => {
      if (!item || !item.id) {
        vscode.window.showWarningMessage("未找到该基金信息");
        return;
      }
      const config = vscode.workspace.getConfiguration("leekfund");
      const fundList = config.get<IConfigFundItem[]>("fundList", []);
      if (item.id === fundList[0].code) {
        vscode.window.showWarningMessage("该基金已置顶");
        return;
      }
      fundList.unshift(
        fundList.splice(
          fundList.findIndex((f) => f.code === item.id),
          1
        )[0]
      );
      await config.update(
        "fundList",
        fundList,
        vscode.ConfigurationTarget.Global
      );
      vscode.window.showInformationMessage("基金置顶成功");
      provider.refresh();
    }
  );

  context.subscriptions.push(
    refreshCmd,
    addFundCmd,
    topFundCmd,
    removeFundCmd,
    treeView
  );

  treeView.onDidChangeVisibility((e) => {
    if (e.visible) {
      // 重新启动刷新
      console.log("视图可见，重新启动刷新");
      if (!timer) {
        startAutoRefresh(provider);
      }
    } else {
      // 视图隐藏则暂停刷新
      console.log("视图影藏，暂停刷新");
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    }
  });
}

export function deactivate() {
  console.log('扩展 "functest" 已被销毁!');
  // 这里清空之前的setInterval
  if (timer) {
    clearInterval(timer);
  }
}
