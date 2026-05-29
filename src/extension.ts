// src/extension.ts

import * as vscode from "vscode";
import { LeekFundDataProvider } from "./fundProvider";
// 这里引入公用的接口类型文件
import { IConfigFundItem } from "./common/new";
import fs from "fs";
import path from "path";
import { isTradingTime } from "./util";

/**
 * 搜索结果项的接口，继承自 QuickPickItem
 */
interface IFundQuickPickItem extends vscode.QuickPickItem {
  fundCode: string;
  fundName: string;
}

let holdingsPanel: vscode.WebviewPanel | undefined;
let holdingsPanelAmount: vscode.WebviewPanel | undefined;

const provider = new LeekFundDataProvider();

function scheduleNextTradingTime18(provider: LeekFundDataProvider) {
  const now = new Date();
  let nextRun = new Date();
  nextRun.setHours(18, 0, 0, 0);
  while (nextRun <= now || nextRun.getDay() === 0 || nextRun.getDay() === 6) {
    nextRun.setDate(nextRun.getDate() + 1);
  }
  const delay = nextRun.getTime() - now.getTime();
  console.log("设置净值更新定时器!", delay);
  setTimeout(() => {
    console.log("执行净值更新");
    provider.startAutoNetValueRefresh();
  }, delay);
}
function scheduleNextTradingTime(provider: LeekFundDataProvider) {
  const now = new Date();
  let nextRun = new Date();
  nextRun.setHours(9, 15, 0, 0);
  while (nextRun <= now || nextRun.getDay() === 0 || nextRun.getDay() === 6) {
    nextRun.setDate(nextRun.getDate() + 1);
  }
  const delay = nextRun.getTime() - now.getTime();
  console.log("不符合交易时间条件,刷新定时器!", delay);
  setTimeout(() => {
    console.log("不符合交易时间条件,刷新定时器", delay);
    provider.startAutoRefresh();
  }, delay);
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
        if (typeof result === "string" || !result?.length) {
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
        const items: IFundQuickPickItem[] = result.map(
          (fund: {
            NAME: any;
            _id: any;
            CATEGORY: any;
            CATEGORYDESC: string;
          }) => ({
            label: `$(search) ${fund.NAME}`, // 添加图标
            description: `代码: ${fund._id} 分类: ${fund.CATEGORYDESC}`,
            fundCode: fund._id,
            fundName: fund.NAME,
            type: fund.CATEGORY,
            typeName: fund.CATEGORYDESC,
          }),
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
        // 添加新基金对象 给 fundList再增加几个字段 持仓金额、当日收益、当前比例默认是空
        fundList.push({
          code: newFundCode,
          name: newFundName,
          amount: "0", // 持仓金额默认为空
          profit: "0", // 当日收益默认为0
          proportion: 0, // 持仓比例默认为0
          dailyEarnings: "0", // 当日收益默认为0
        });
        await config.update(
          "fundList",
          fundList,
          vscode.ConfigurationTarget.Global,
        );

        provider.refresh(); // 刷新视图
        vscode.window.showInformationMessage(
          `已添加: ${newFundName} (${newFundCode})`,
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
    dragAndDropController:
      new (class implements vscode.TreeDragAndDropController<any> {
        dropMimeTypes = ["application/vnd.code.tree.leekFundView"];
        dragMimeTypes = ["application/vnd.code.tree.leekFundView"];

        async handleDrag(
          source: any[],
          dataTransfer: vscode.DataTransfer,
          token: vscode.CancellationToken,
        ) {
          dataTransfer.set(
            "application/vnd.code.tree.leekFundView",
            new vscode.DataTransferItem(source.map((s) => s.id)),
          );
        }

        async handleDrop(target: any, dataTransfer: vscode.DataTransfer) {
          const dragData = dataTransfer.get(
            "application/vnd.code.tree.leekFundView",
          );
          if (!dragData) {
            return;
          }
          const draggedId: string = dragData.value[0];
          const targetId = target?.id;
          if (!targetId) {
            return;
          }
          const config = vscode.workspace.getConfiguration("leekfund");
          let fundList = config.get<{ code: string; name: string }[]>(
            "fundList",
            [],
          );
          const draggedIndex = fundList.findIndex((f) => f.code === draggedId);
          const targetIndex = fundList.findIndex((f) => f.code === targetId);
          if (draggedIndex < 0 || targetIndex < 0) {
            return;
          }

          // 从原位置删除并插入新位置
          const [moved] = fundList.splice(draggedIndex, 1);
          fundList.splice(targetIndex, 0, moved);

          await config.update(
            "fundList",
            fundList,
            vscode.ConfigurationTarget.Global,
          );
          vscode.window.showInformationMessage("基金顺序已更新");
          provider.refresh();
        }
      })(),
  });

  // 注册刷新基金命令
  let refreshCmd = vscode.commands.registerCommand(
    "leekfund.refresh",
    async () => {
      vscode.window.setStatusBarMessage(
        "$(sync~spin) 正在刷新基金数据...",
        2000,
      );

      // 注册一次性监听器
      const disposable = provider.onDidFinishRefresh(() => {
        if (provider.result) {
          vscode.window.showInformationMessage("刷新成功！");
        }
        disposable.dispose(); // 避免重复监听
      });

      provider.refresh(); // 触发刷新
    },
  );

  // 注册新增基金命令  调用 showFundSearchPicker
  let addFundCmd = vscode.commands.registerCommand("leekfund.addFund", () => {
    showFundSearchPicker(provider);
  });

  // 注册删除基金命令
  let removeFundCmd = vscode.commands.registerCommand(
    "leekfund.removeFundItem",
    async (item: any) => {
      console.log(item);
      if (!item || !item.id) {
        vscode.window.showWarningMessage("未找到该基金信息");
        return;
      }
      const confirm = await vscode.window.showWarningMessage(
        `确定要删除 ${item.label?.toString().trim()} 吗？`,
        "确定",
        "取消",
      );
      if (confirm === "确定") {
        const config = vscode.workspace.getConfiguration("leekfund");
        const fundList = config.get<IConfigFundItem[]>("fundList", []);
        // 过滤掉要删除的基金
        const updatedList = fundList.filter((f) => f.code !== item.id);

        await config.update(
          "fundList",
          updatedList,
          vscode.ConfigurationTarget.Global,
        );

        provider.refresh();
        vscode.window.showInformationMessage("基金已删除");
      }
    },
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
          1,
        )[0],
      );
      await config.update(
        "fundList",
        fundList,
        vscode.ConfigurationTarget.Global,
      );
      vscode.window.showInformationMessage("基金置顶成功");
      provider.refresh();
    },
  );

  // 注册点击基金命令
  let showHoldingsCmd = vscode.commands.registerCommand(
    "leekfund.showHoldings",
    async (fundCode: string, fundName: string) => {
      // 复用或创建 Webview 面板
      if (!holdingsPanel) {
        holdingsPanel = vscode.window.createWebviewPanel(
          "leekFundHoldings",
          "基金持仓",
          vscode.ViewColumn.Beside,
          {
            enableScripts: true,
            retainContextWhenHidden: true,
          },
        );

        // === 关键：只注册一次消息监听器 ===
        const messageDisposable = holdingsPanel.webview.onDidReceiveMessage(
          async (message) => {
            console.log(message, "message");
            if (message.command === "refresh" && message.fundCode) {
              const { fundCode, fundName } = message;
              holdingsPanel!.webview.html = getLoadingHTML();

              try {
                const holdings = await provider.findOne(fundCode);
                holdingsPanel!.webview.html = getHoldingsHTML(
                  fundName,
                  fundCode,
                  holdings,
                );
              } catch (err) {
                holdingsPanel!.webview.html = getErrorHTML("刷新失败，请重试");
              }
            }
          },
        );

        // 面板关闭时清理监听器
        holdingsPanel.onDidDispose(() => {
          messageDisposable.dispose();
          holdingsPanel = undefined;
        });
      }

      // 切换标题和内容
      holdingsPanel.title = `${fundName} (${fundCode}) 持仓`;
      holdingsPanel.reveal(vscode.ViewColumn.Beside);

      // 显示加载中
      holdingsPanel.webview.html = getLoadingHTML();

      // 加载最新数据
      try {
        const holdings = await provider.findOne(fundCode);
        holdingsPanel.webview.html = getHoldingsHTML(
          fundName,
          fundCode,
          holdings,
        );
      } catch (err) {
        holdingsPanel.webview.html = getErrorHTML("加载失败，请检查网络");
      }
    },
  );

  // 注册持仓金额命令
  let positionHoldingCmd = vscode.commands.registerCommand(
    "leekfund.positionHolding",
    async () => {
      console.log("positionHoldingCmd 被触发");
      if (!holdingsPanelAmount) {
        holdingsPanelAmount = vscode.window.createWebviewPanel(
          "positionHolding",
          "持仓金额",
          vscode.ViewColumn.Beside,
          {
            enableScripts: true,
            retainContextWhenHidden: true,
          },
        );
        setTimeout(() => {
          holdingsPanelAmount!.webview.html = getPositionHoldingHTML();
        }, 10);
        // === 只注册一次消息监听器 ===
        const messageDisposable =
          holdingsPanelAmount.webview.onDidReceiveMessage(async (message) => {
            console.log("收到", message);
            if (message.command === "positionHolding") {
              try {
                const holdingData = await provider.getAllPositionHoldings();
                const { fundList, fundDatas } = holdingData;
                console.log("刷新111", fundList, fundDatas);
                // 发送数据回 Webview
                holdingsPanelAmount!.webview.postMessage({
                  command: "holdingData",
                  data: fundList,
                  fundDatas,
                });
                console.log("holdingData 已发送");
              } catch (err) {
                console.error("刷新持仓失败:", err);
                holdingsPanelAmount!.webview.postMessage({
                  command: "error",
                  message: "刷新失败，请重试",
                });
              }
            } else if (message.command === "saveData") {
              const holdingData = await provider.setAllPositionHoldings(
                message.holdings,
              );
              console.log("保存成功", holdingData);
              // 提示保存成功
              vscode.window.showInformationMessage("保存成功");
              provider.refresh();
            }
          });
        // 面板关闭时清理
        holdingsPanelAmount.onDidDispose(() => {
          messageDisposable.dispose();
          holdingsPanelAmount = undefined;
        });
      }
      console.log("positionHoldingCmd 被触发11");
      holdingsPanelAmount.reveal(vscode.ViewColumn.Beside);
      // 复用面板
      holdingsPanelAmount.title = "基金持仓金额明细";
    },
  );

  context.subscriptions.push(
    refreshCmd,
    showHoldingsCmd,
    addFundCmd,
    topFundCmd,
    removeFundCmd,
    positionHoldingCmd,
  );

  treeView.onDidChangeVisibility((e) => {
    if (e.visible) {
      const { isWorkday, hours, minutes } = isTradingTime();
      const isAfterTradingStart = hours > 9 || (hours === 9 && minutes >= 15);

      if (isWorkday && isAfterTradingStart) {
        console.log("符合交易时间条件，启动刷新");
        provider.startAutoRefresh();
      } else {
        console.log("不符合交易时间条件，设置定时器");
        provider.refresh();
        scheduleNextTradingTime(provider);
      }

      const isEveningToMorning =
        hours >= 14 || hours < 9 || (hours === 9 && minutes < 15);
      if (isEveningToMorning) {
        provider.startAutoNetValueRefresh();
      } else {
        console.log("还没到下午18点");
        scheduleNextTradingTime18(provider);
      }
    } else {
      console.log("视图隐藏，暂停刷新");
      provider.stopAutoRefresh();
    }
  });
}

export function deactivate() {
  console.log('扩展 "functest" 已被销毁!');
  provider.stopAutoRefresh();
}

// 获取加载中HTML 输出持仓页面
function getPositionHoldingHTML() {
  // 获取 holding.html 文件的绝对路径
  const htmlPath = path.join(__dirname, "pages", "holding.html");

  try {
    // 读取 HTML 文件内容
    const htmlContent = fs.readFileSync(htmlPath, "utf-8");
    return htmlContent;
  } catch (error) {
    // 如果文件读取失败，返回默认内容
    console.error("读取 holding.html 文件失败:", error);
    return getErrorHTML("加载失败！");
  }
}

function getLoadingHTML() {
  return `
    <!DOCTYPE html>
    <html><body style="font-family: var(--vscode-editor-font-family); padding: 20px; color: var(--vscode-foreground);">
      <h3>正在加载持仓数据...</h3>
      <p><span class="codicon codicon-loading codicon-modifier-spin"></span> 请稍候</p>
    </body></html>
  `;
}

function getErrorHTML(message: string) {
  return `
    <!DOCTYPE html>
    <html><body style="font-family: var(--vscode-editor-font-family); padding: 20px; color: var(--vscode-errorForeground);">
      <h3>加载失败</h3>
      <p>${message}</p>
    </body></html>
  `;
}

function getHoldingsHTML(fundName: string, fundCode: string, holdings: any[]) {
  if (!holdings || holdings.length === 0) {
    return getErrorHTML("暂无持仓数据");
  }

  const rows = holdings
    .map((item: any) => {
      const change = item.f3 ? (item.f3 / 100).toFixed(2) : "0.00";
      const changeNum = parseFloat(change);
      const changeColor =
        changeNum > 0 ? "#d73a49" : changeNum < 0 ? "#28a745" : "#6c757d";
      return `
        <tr style="border-bottom: 1px solid var(--vscode-editorWidget-border);">
          <td style="padding: 8px 12px;">${item.f14 || item.rawName || "-"}</td>
          <td style="padding: 8px 12px; color: #888; font-size: 0.9em;">${
            item.f12 || item.symbol
          }</td>
          <td style="padding: 8px 12px; text-align: right;">${item.weightPct?.toFixed(
            2,
          )}%</td>
          <td style="padding: 8px 12px; text-align: right; color: ${changeColor}; font-weight: 500;">
            ${change.startsWith("-") ? "" : "+"}${change}%
          </td>
        </tr>
      `;
    })
    .join("");

  const totalWeight = holdings
    .reduce((sum: number, h: any) => sum + (h.weightPct || 0), 0)
    .toFixed(2);
  const fundChangePct = holdings[0]?.fundChangePct || "0.00";

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body { 
          font-family: var(--vscode-editor-font-family, Segoe UI); 
          padding: 16px; 
          color: var(--vscode-foreground); 
          margin: 0;
        }
        h2 { margin: 0 0 12px 0; }
        .header { 
          display: flex; 
          justify-content: space-between; 
          align-items: center; 
          margin-bottom: 16px; 
          padding-bottom: 8px; 
          border-bottom: 1px solid var(--vscode-editorWidget-border); 
        }
        .summary { font-size: 0.9em; color: #888; }
        .change { font-weight: bold; }
        table { width: 100%; border-collapse: collapse; margin-top: 8px; }
        th { text-align: left; padding: 8px 12px; color: #888; font-weight: normal; font-size: 0.9em; }
        .refresh { 
          cursor: pointer; 
          color: var(--vscode-textLink-foreground); 
          font-size: 0.9em; 
          padding: 4px 8px;
          border: 1px solid transparent;
          border-radius: 4px;
          background: var(--vscode-button-background);
        }
        .refresh:hover { 
          background: var(--vscode-button-hoverBackground);
        }
      </style>
    </head>
    <body>
      <div class="header">
        <div>
          <h2>${fundName}</h2>
          <div class="summary">
            代码: ${fundCode} | 合计占比: ${totalWeight}% | 
            基金估算涨跌: <span class="change" style="color: ${
              parseFloat(fundChangePct) > 0 ? "#d73a49" : "#28a745"
            };">${fundChangePct}%</span>
          </div>
        </div>
        <div class="refresh" onclick="refresh()">刷新</div>
      </div>

      <table>
        <thead>
          <tr>
            <th>股票名称</th>
            <th>代码</th>
            <th style="text-align: right;">占净值</th>
            <th style="text-align: right;">涨跌幅</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>

      <script>
        const vscode = acquireVsCodeApi();
        function refresh() {
          vscode.postMessage({ 
            command: 'refresh', 
            fundCode: '${fundCode}', 
            fundName: '${fundName}' 
          });
        }
      </script>
    </body>
    </html>
  `;
}
