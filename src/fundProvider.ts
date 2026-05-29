// src/fundProvider.ts

import * as vscode from "vscode";
import * as path from "path";
import axios from "axios";
import * as cheerio from "cheerio";
import {
  IConfigFundItem,
  CodeItem,
  IFundData,
  FundHoldingsResult,
} from "./common/new";
import { formatDate, getFundMarketType } from "./util";

const userAgents = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2.1 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/605.1.15",
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
];

const referers = [
  "https://quote.eastmoney.com/",
  "https://fund.eastmoney.com/",
  "https://fundf10.eastmoney.com/",
  "https://guba.eastmoney.com/",
  "https://danjuanfunds.com/",
];

function getDynamicHeaders(): Record<string, string> {
  const ua = userAgents[Math.floor(Math.random() * userAgents.length)];
  const ref = referers[Math.floor(Math.random() * referers.length)];
  return {
    "User-Agent": ua,
    Referer: ref,
    "Accept-Language":
      Math.random() > 0.5
        ? "zh-CN,zh;q=0.9,en;q=0.8,en-US;q=0.7"
        : "zh-CN,zh;q=0.9",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
  };
}

// 顶层分类节点
export class CategoryItem extends vscode.TreeItem {
  constructor(
    label: string | vscode.TreeItemLabel,
    collapsibleState: vscode.TreeItemCollapsibleState | undefined
  ) {
    super(label, collapsibleState);
    // this.iconPath = new vscode.ThemeIcon("folder");
    if (label === "基金估值") {
      this.contextValue = "fundCategory";
    } else {
      this.contextValue = "category";
    }
  }
}

// 基金项  负责处理UI TreeItem
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
    this.tooltip = `${code}  ${labelStr}`;
    this.description = "";
    this.contextValue = "fund";
    this.id = code;
    // 创建点击事件
    this.command = {
      command: "leekfund.showHoldings",
      title: "查看持仓",
      arguments: [code, name],
    };
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

  // 自适应刷新状态
  private _refreshTimer: NodeJS.Timeout | null = null;
  private _netValueTimer: NodeJS.Timeout | null = null;
  private _refreshInterval: number = 15000;
  private _netValueInterval: number = 15000;
  private _consecutiveErrors: number = 0;
  private _netValueErrors: number = 0;
  private readonly MIN_INTERVAL = 10000;
  private readonly MAX_INTERVAL = 120000;

  private _getNextInterval(baseErrors: number): number {
    // 成功时：随机 10~20s
    // 失败时：在随机基础上指数退避
    const successBase = 10000 + Math.random() * 10000; // 10000~20000
    if (baseErrors === 0) {
      return successBase;
    }
    const backoff = Math.min(Math.pow(2, baseErrors), 8); // 最多退避 8 倍
    return Math.min(successBase * backoff, this.MAX_INTERVAL);
  }

  public startAutoRefresh(): void {
    this._scheduleNextRefresh();
  }

  public startAutoNetValueRefresh(): void {
    this._scheduleNextNetValueRefresh();
  }

  public stopAutoRefresh(): void {
    if (this._refreshTimer) {
      clearTimeout(this._refreshTimer);
      this._refreshTimer = null;
    }
    if (this._netValueTimer) {
      clearTimeout(this._netValueTimer);
      this._netValueTimer = null;
    }
  }

  private _scheduleNextRefresh(): void {
    this._refreshTimer = setTimeout(async () => {
      try {
        await this.refresh();
      } catch (err) {
        console.error("刷新失败:", err);
      }
      this._scheduleNextRefresh();
    }, this._refreshInterval);
  }

  private _scheduleNextNetValueRefresh(): void {
    this._netValueTimer = setTimeout(async () => {
      try {
        await this.fetchNetValueChanges();
      } catch (err) {
        console.error("净值更新失败:", err);
      }
      this._scheduleNextNetValueRefresh();
    }, this._netValueInterval);
  }

  public onRefreshSuccess(): void {
    this._consecutiveErrors = 0;
    this._refreshInterval = this._getNextInterval(0);
  }

  public onNetValueSuccess(): void {
    this._netValueErrors = 0;
    this._netValueInterval = this._getNextInterval(0);
  }

  public onRefreshError(): void {
    this._consecutiveErrors++;
    this._refreshInterval = this._getNextInterval(this._consecutiveErrors);
  }

  public onNetValueError(): void {
    this._netValueErrors++;
    this._netValueInterval = this._getNextInterval(this._netValueErrors);
  }



  // 从配置或本地存储读取关注的基金代码
  private async getWatchList() {
    const config = vscode.workspace.getConfiguration("leekfund");
    // 获取配置的基金列表
    // console.log("基金列表", config.get("fundList", []));
    return config.get("fundList", []); // 默认几个基金代码
  }

  // 搜索基金
  async getFundSearch(key: string): Promise<any> {
    const url =
      "https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx";
    const params = {
      m: "1",
      key: key,
    };
    console.log("搜索基金", url + params.key);
    try {
      const res = await axios.get(url, { params, headers: getDynamicHeaders() });
      if (res.data.Datas && res.data.Datas.length > 0) {
        // 过滤数据 CATEGORY === 700的才能返回
        let data = res.data.Datas.filter((item: { CATEGORY: number }) => {
          return item.CATEGORY === 700;
        });
        console.log("过滤后的基金列表", data);
        return data;
      }
      // return "未找到该基金";
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error("Axios 错误:", error.message);
        console.error("状态码:", error.response?.status);
        console.error("响应数据:", error.response?.data);
      } else {
        console.error("未知错误:", error);
      }
    }
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

  public async findOne(id: any) {
    // console.log(id, "id");
    // console.log(id, 'id');
    // id 基金编号，topline 显示基金持有多少股票，
    const url = `https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code=${id}&topline=100&year=&month=`;
    try {
      const res = await axios.get(url, { headers: getDynamicHeaders() });

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
      const headersTitle: string[] = [];
      const datas: any[] = [];
      // 读取表头以确定列索引
      table.find("thead tr th").each((i, th) => {
        headersTitle.push($(th).text().trim());
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
        const headerText = headersTitle.join("|").toLowerCase();
        // console.log(headerText, 'headerText', headers);
        const rawCode = cols[0] || "";
        const rawName = cols[1] || "";
        const rawNames = cols[2] || "";
        // console.log(rawNames, "rawNames");
        let weightIdx =
          headerText.indexOf("占净值") >= 0
            ? headersTitle.findIndex((h) => h.includes("占净值"))
            : headersTitle.findIndex((h) => h.includes("占净值比例"));

        if (weightIdx < 0) {
          weightIdx = cols.length - 1;
        }
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
      if (stockInfo?.diff) {
        parsed = this.mergeArrays(stockInfo.diff, parsed, "f12", "rawName");
      }
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
    // const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?fields=f2,f3,f12,f14,f9&secids=${codes}`;
    const url = "https://push2.eastmoney.com/api/qt/ulist.np/get";
    const params = {
      fields: "f2,f3,f12,f14,f9",
      secids: codes,
    };
    try {
      const response = await axios.get(url, { params, headers: getDynamicHeaders() });
      return response.data.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error("Axios 错误:", error.message);
        console.error("状态码:", error.response?.status);
        console.error("响应数据:", error.response?.data);
      } else {
        console.error("未知错误:", error);
      }
    }
  }

  // 从天天基金等接口获取估值
  async fetchFundData() {
    const codes: CodeItem[] = await this.getWatchList();
    if (codes.length === 0) {
      return [];
    }

    try {
      // Step 1: 获取每只基金的估算涨幅
      const results = await Promise.allSettled(
        codes.map((item) => this.findOne(item.code))
      );
      // Step 2: 构建 code -> changePercent 映射
      const changeMap = new Map<string, number>();
      results.forEach((result, index) => {
        const code = codes[index].code;
        if (result.status === "fulfilled" && result.value?.length > 0) {
          const pct = parseFloat(result.value[0].fundChangePct) || 0;
          changeMap.set(code, pct);
        } else {
          changeMap.set(code, 0);
        }
      });

      // Step 3: 读取当前 fundList（含 amount）
      const fundList: IConfigFundItem[] = vscode.workspace
        .getConfiguration("leekfund")
        .get("fundList", []);

      // Step 4 & 5: 计算 profit、dailyEarnings 和 totalProfit
      let totalProfit = 0;
      const updatedFundList = fundList.map((item) => {
        const changePercent = changeMap.get(item.code) || 0;
        const newItem = { ...item };

        // 更新 profit（字符串，保留两位小数）
        newItem.profit = changePercent.toFixed(2);

        // 计算 dailyEarnings
        if (newItem.amount && !isNaN(Number(newItem.amount))) {
          const dailyEarnings = (Number(newItem.amount) * changePercent) / 100;
          newItem.dailyEarnings = dailyEarnings.toFixed(2);
          totalProfit += dailyEarnings;
        } else {
          newItem.dailyEarnings = "0.00";
        }

        return newItem;
      });

      // Step 6: 更新配置
      const fundDatas: IFundData = vscode.workspace
        .getConfiguration("leekfund")
        .get("fundDatas", {});

      const updatedFundDatas = {
        ...fundDatas,
        totalProfit: totalProfit.toFixed(2), //  这就是你的总收益！
      };

      // 一次性写入配置（避免多次触发 onDidChangeConfiguration）
      await vscode.workspace
        .getConfiguration("leekfund")
        .update("fundList", updatedFundList, vscode.ConfigurationTarget.Global);
      await vscode.workspace
        .getConfiguration("leekfund")
        .update(
          "fundDatas",
          updatedFundDatas,
          vscode.ConfigurationTarget.Global
        );
      console.log("总收益", updatedFundDatas);
      // console.log("基金数据", updatedFundList);

      // Step 7: 构造 FundItem
      return updatedFundList.map((item) => {
        const changePercent = changeMap.get(item.code) || 0;
        return new FundItem(changePercent, item.name, item.code);
      });
    } catch (err) {
      console.error("fetchFundData error:", err);
      vscode.window.showErrorMessage("基金数据加载失败，请检查网络！");
      this._onDidFinishRefresh.fire();
      this.result = 0;
      this.onRefreshError();
      return [];
    } finally {
      this.onRefreshSuccess();
    }
  }

  getTreeItem(element: any) {
    return element;
  }

  async getChildren(element: { label: string }) {
    if (!element) {
      return [
        new CategoryItem("基金估值", vscode.TreeItemCollapsibleState.Expanded),
        // new SettingItem("基金中心", "home"),
      ];
    }
    if (element.label === "基金估值") {
      // 异步加载真实基金数据
      return await this.fetchFundData();
    }

    return [];
  }

  // 获取基金持仓数据
  async getAllPositionHoldings(): Promise<FundHoldingsResult> {
    await this.fetchFundData();
    const fundList = await this.getWatchList();
    const fundDatas: IFundData = vscode.workspace
      .getConfiguration("leekfund")
      .get("fundDatas", {});
    return {
      fundList,
      fundDatas,
    };
  }

  async findOne18(code: string): Promise<any> {
    let url = "https://danjuanfunds.com/djapi/fund/";
    console.log(code);
    try {
      const res = await axios.get(url + code, { headers: getDynamicHeaders() });
      return res.data.data;
    } catch (error) {
      throw error;
    }
  }

  async setAllPositionHoldings(holdings: any): Promise<IConfigFundItem[]> {
    const fundList: IConfigFundItem[] = await this.getWatchList();
    // 更新 amount
    const updated = fundList.map((item) => {
      const h = holdings.find((h: any) => h.code === item.code);
      return h ? { ...item, amount: h.amount } : item;
    });
    await vscode.workspace
      .getConfiguration("leekfund")
      .update("fundList", updated, vscode.ConfigurationTarget.Global);
    //触发刷新，从而重新计算收益
    this.refresh();
    return updated;
  }
  // 更新净值
  async fetchNetValueChanges(): Promise<IConfigFundItem[]> {
    let fundList: IConfigFundItem[] = await this.getWatchList();
    let arr = fundList.map((item) => this.findOne18(item.code)); // 返回Promise
    const results = await Promise.allSettled(arr);
    console.log("results", results);

    // 先计算所有更新，不立即写入
    const updates: Partial<IConfigFundItem>[] = results.map((item, index) => {
      const today = new Date();
      const todayStr = formatDate(today);
      const yesterdayStr = formatDate(new Date(today.getTime() - 86400000));

      const navDate = (item as any).value?.fund_derived?.end_date;
      const marketType = getFundMarketType(item);
      const update: Partial<IConfigFundItem> = {};

      if (marketType === "A" || marketType === "QDII_HK") {
        if (navDate === todayStr) {
          update.isUpdate = "1";
        }
      } else {
        // QDII_US
        if (navDate === yesterdayStr) {
          if (fundList[index].isUpdate !== "1") {
            const nav_grtd = (item as any).value?.fund_derived?.nav_grtd;
            const amount = Number(fundList[index].amount);
            const navGrtdNum = parseFloat(nav_grtd);
            const actualIncome = amount * navGrtdNum * 0.01;
            update.actualIncome = actualIncome.toFixed(2);
            update.amount = (amount + actualIncome).toFixed(2);
            update.isUpdate = "1";
            update.fundDerived = nav_grtd;
          }
        }
      }
      return update;
    });

    // 应用所有更新到 fundList
    for (let i = 0; i < updates.length; i++) {
      fundList[i] = { ...fundList[i], ...updates[i] };
    }

    // 一次性写入配置
    await vscode.workspace
      .getConfiguration("leekfund")
      .update("fundList", fundList, vscode.ConfigurationTarget.Global);

    console.log("results", results);
    return fundList;
  }

  // fundProvider.ts
  refresh(): Promise<void> {
    return new Promise((resolve) => {
      // 当 TreeView 重新请求数据后再 resolve
      console.log("refresh刷新数据");
      this._onDidChangeTreeData.fire(undefined);
      setTimeout(() => {
        resolve();
      }, 200);
    });
  }
}
