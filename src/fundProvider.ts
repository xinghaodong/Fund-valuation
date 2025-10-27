// src/fundProvider.ts

import * as vscode from "vscode";
import * as path from "path";
import axios from "axios";
import * as cheerio from "cheerio";
interface CodeItem {
  name: string;
  code: string;
}
// 顶层分类节点
export class CategoryItem extends vscode.TreeItem {
  constructor(
    label: string | vscode.TreeItemLabel,
    collapsibleState: vscode.TreeItemCollapsibleState | undefined
  ) {
    super(label, collapsibleState);
    this.iconPath = new vscode.ThemeIcon("folder");
    if (label === "FUND") {
      this.contextValue = "fundCategory";
    } else {
      this.contextValue = "category";
    }
  }
}

// 基金项
export class FundItem extends vscode.TreeItem {
  name: string;
  constructor(changePercent: number, name: any, code: any) {
    super("", vscode.TreeItemCollapsibleState.None);

    const mediaPath = path.join(__dirname, "..", "media");

    let iconPath;
    let labelStr;

    if (changePercent > 0) {
      iconPath = vscode.Uri.file(path.join(mediaPath, "up.svg"));
      labelStr = `  +${changePercent.toFixed(2)}%   ${name}`;
    } else if (changePercent < 0) {
      iconPath = vscode.Uri.file(path.join(mediaPath, "down.svg"));
      labelStr = `  ${changePercent.toFixed(2)}%   ${name}`;
    } else {
      iconPath = new vscode.ThemeIcon("dash");
      labelStr = ` 0.00%   ${name}`;
    }

    this.iconPath = iconPath;
    this.label = labelStr;
    this.name = name;
    this.tooltip = `${code} | ${labelStr}`;
    this.description = "";
    this.contextValue = "fund";
    this.id = code;
  }
}

// 设置项
export class SettingItem extends vscode.TreeItem {
  constructor(label: string | vscode.TreeItemLabel, icon: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(icon);
    this.contextValue = "settingItem";
  }
}

// 主数据提供者
export class LeekFundDataProvider {
  private _onDidChangeTreeData = new vscode.EventEmitter();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private _onDidFinishRefresh = new vscode.EventEmitter<void>();
  readonly onDidFinishRefresh = this._onDidFinishRefresh.event;
  public result: Number = 1; // 刷新结果 1 刷新成功 0 刷新失败

  // 从配置或本地存储读取关注的基金代码
  private getWatchList() {
    const config = vscode.workspace.getConfiguration("leekfund");
    // 获取配置的基金列表
    // console.log("基金列表", config.get("fundList", []));
    return config.get("fundList", []); // 默认几个基金代码
  }

  async getFundSearch(key: string): Promise<any> {
    const res = await axios.get(
      `https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx?m=1&key=${key}`
    );
    if (res.data.Datas && res.data.Datas.length > 0) {
      return res.data;
    }
    return "未找到该基金";
  }

  mergeArrays(arrayA: any[], arrayB: any[], key2: string, key: string) {
    // 构建一个以 symbol 为 key 的 map，便于快速查找
    const symbolMap = new Map();
    arrayA.forEach((item) => {
      symbolMap.set(item[key2], item);
    });

    // 以 arrayB 为主进行合并
    const merged = arrayB.map((bItem) => {
      const matchedA = symbolMap.get(bItem[key]);
      if (matchedA) {
        // 合并：以 A 的字段为主，但保留 B 的字段（比如 rawName 等其实一样，但以防万一）
        return { ...bItem, ...matchedA };
      } else {
        // 没有匹配项，保留 B 的内容，可选：补充缺失字段为 null/undefined
        return { ...bItem };
      }
    });
    // console.log("合并后的数据", merged);
    return merged;
  }

  async findOne(id: any) {
    // console.log(id, "id");
    // console.log(id, 'id');
    // id 基金编号，topline 显示基金持有多少股票，
    const url = `https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code=${id}&topline=100&year=&month=`;
    try {
      const res = await axios.get(url);

      const $ = cheerio.load(res.data);
      // console.log($('#gpdmList').text().split(','), 'cheerio');
      let codeList = $("#gpdmList").text().split(",");
      // 删除掉 codeList 的最后一项
      // console.log(codeList, "codeList");
      codeList.pop();

      // 构建 rawCode -> fullCode 映射
      const codeMap = new Map<string, string>();
      codeList.forEach((fullCode) => {
        const [prefix, symbol] = fullCode.split(".");
        if (symbol) {
          codeMap.set(symbol, fullCode);
        }
      });

      // 尝试定位包含“证券代码 / 占净值比例”的表格
      let table = $("table")
        .filter((i, el) => {
          const txt = $(el).text();
          return (
            txt.includes("股票代码") ||
            txt.includes("占基金净值比例") ||
            txt.includes("占净值比例")
          );
        })
        .first();
      const headers: string[] = [];
      const datas: any[] = [];
      // 读取表头以确定列索引
      table.find("thead tr th").each((i, th) => {
        headers.push($(th).text().trim());
        return; // 显式返回 void，防止类型推断为 number
      });

      const rows = table.find("tbody tr");
      rows.each((i, tr) => {
        const cols = $(tr)
          .find("td")
          .map((i, td) => $(td).text().trim())
          .get();
        if (!cols || !cols.length) return;
        // 尝试找到证券代码/简称/占比的列
        const headerText = headers.join("|").toLowerCase();
        // console.log(headerText, 'headerText', headers);
        const rawCode = cols[0] || "";
        const rawName = cols[1] || "";
        const rawNames = cols[2] || "";
        // console.log(rawNames, "rawNames");
        let weightIdx =
          headerText.indexOf("占净值") >= 0
            ? headers.findIndex((h) => h.includes("占净值"))
            : headers.findIndex((h) => h.includes("占净值比例"));

        if (weightIdx < 0) weightIdx = cols.length - 1;
        const rawWeight = cols[weightIdx] || "";
        // 解析 weight（可能带 %）
        const weightPct =
          parseFloat((rawWeight || "").replace("%", "").replace(/,/g, "")) || 0;
        // console.log(weightPct, 'weightPct', rawName);
        datas.push({
          codeName: rawCode,
          rawName: rawName,
          rawNames: rawNames,
          rawWeight: rawWeight,
          weightPct: weightPct,
        });
      });
      // console.log(datas, "datas");
      let parsed = codeList.map((item, index) => {
        // console.log(item, 'item');
        // codeList.push(item);
        const [marketPrefix, symbol] = item.split(".");
        let market: string;
        if (!marketPrefix || !symbol) {
          market = "INVALID"; // 格式错误，如无 '.' 分隔
        } else if (marketPrefix === "105" || marketPrefix === "106") {
          market = "US"; // 美股（含中概股）
        } else if (marketPrefix === "116") {
          market = "HK"; // 港股
        } else if (/^[013]/.test(marketPrefix)) {
          // A股常见前缀：0（深市主板/创业板）、6（沪市）— 但天天基金A股通常无前缀或用0/1/3
          // 注意：天天基金中A股代码可能直接是 '000001'，无前缀，此时 marketPrefix = '000001'
          // 所以这里更安全的做法是判断 symbol 长度和数字特征
          market = "CN";
        } else {
          market = "OTHER"; // 未知市场（如债券、基金、新加坡、日韩欧洲股等）
        }
        return {
          symbol,
          market,
          code: item,
          fundChangePct: "",
        };
      });
      //symbol
      // 合并两个数组

      parsed = this.mergeArrays(parsed, datas, "symbol", "rawName");

      // console.log(rows, datas, "datas", codeList, parsed);

      // console.log(parsed.length, 'parsed', rows.length);
      // console.log(parsed.length, 'parsed');
      // console.log(rows.length);
      // console.log(parsed, 'parsed');
      // if (parsed.length != rows.length) {
      //     throw new BadRequestException('比对失败');
      // }
      // console.log(parsed, 'parsed');
      // 便利 parsed 提取出拼接所有的code 字段为字符串
      const codes = parsed.map((item) => item.code).join(",");
      const stockInfo = await this.getStockInfo(codes);
      // console.log(stockInfo, "stockInfo");
      parsed = this.mergeArrays(stockInfo.diff, parsed, "f12", "rawName");
      // console.log(parsed, "parsed");
      // -----------------------------
      //  计算基金整体涨跌幅（加权平均）
      // -----------------------------
      // weightPct 是占净值比例9.82 f3是涨跌幅 220 需要 *0.01
      const totalWeight = parsed.reduce(
        (sum, item) => sum + ((item as any).weightPct || 0),
        0
      );
      const weightedSum = parsed.reduce((sum, item) => {
        const weight = (item as any).weightPct || 0; // 9.82
        const changePct = ((item as any).f3 || 0) / 100; // 220 -> 2.20
        return sum + weight * changePct; // 9.82 * 2.2 = 21.604
      }, 0);

      // 加权平均 0.07是汇率先写死
      const fundChangePct = (weightedSum / totalWeight).toFixed(2);
      // console.log(fundChangePct, "fundChangePct", weightedSum, totalWeight);
      // console.log(parsed, 'parsed', codes);
      // console.log(stockInfo, 'stockInfo');
      // return stockInfo;
      parsed = parsed.map((item) => {
        return {
          ...item,
          fundChangePct,
        };
      });
      return parsed;
    } catch (error) {
      console.log(error);
      throw error;
    }
  }
  // 根据 查询出来的基金codes 集合获取股票信息
  async getStockInfo(codes: string) {
    const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?fields=f2,f3,f12,f14,f9&secids=${codes}`;

    try {
      const res = await axios.get(url);

      // console.log(res.data, 'res.data');
      // console.log(res.data.data, 'res.data.data');
      return res.data.data;
    } catch (error) {
      console.log(error);
    }
  }

  // 从天天基金等接口获取估值
  async fetchFundData() {
    let codes: CodeItem[] = this.getWatchList();
    if (codes.length === 0) {
      return [];
    }
    // console.log("codes:", codes);
    try {
      // Leek Fund 插件公开接口（你也可以换成自己的后端）

      const results = await Promise.allSettled(
        codes.map((item) => this.findOne(item.code))
      );

      if (results.some((result) => result.status === "rejected")) {
        vscode.window.showErrorMessage("基金数据加载失败，请检查网络");
        this.result = 0;
        this._onDidFinishRefresh.fire();
      } else {
        this.result = 1;
        this._onDidFinishRefresh.fire();
      }
      // console.log(results, "results");

      return results.map((result, index) => {
        const item = codes[index];
        let changePercent = 0;
        let name = item.name;
        let code = item.code;

        if (
          result.status === "fulfilled" &&
          result.value &&
          result.value.length > 0
        ) {
          changePercent = parseFloat(result.value[0].fundChangePct) || 0;
        } else {
          changePercent = 0;
        }
        return new FundItem(changePercent, name, code);
      });
    } catch (err) {
      console.error(err);
      vscode.window.showErrorMessage("基金数据加载失败，请检查网络");
      this._onDidFinishRefresh.fire();
      this.result = 0;
      return [];
    }
  }

  getTreeItem(element: any) {
    return element;
  }

  async getChildren(element: { label: string }) {
    if (!element) {
      return [
        new CategoryItem("FUND", vscode.TreeItemCollapsibleState.Expanded),
        new SettingItem("基金中心", "home"),
      ];
    }

    if (element.label === "FUND") {
      // 异步加载真实基金数据
      return await this.fetchFundData();
    }

    return [];
  }

  // fundProvider.ts
  refresh(): Promise<void> {
    return new Promise((resolve) => {
      // 当 TreeView 重新请求数据后再 resolve
      console.log("refresh刷新数据");
      this._onDidChangeTreeData.fire(undefined);
      setTimeout(() => {
        resolve();
      }, 1500);
    });
  }
}
