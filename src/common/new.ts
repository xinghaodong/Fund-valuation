/**
 * 存储在 VS Code 配置中的基金对象格式
 */
export interface IConfigFundItem {
  code: string;
  name: string;
  amount?: string; // 持仓金额
  profit?: string; // 当日预估收益点 比如0.31就是正收益0.31% 如果是 -0.31那就是负收益-0.31%
  proportion?: number; // 持仓比例
  dailyEarnings?: string; //当日预估收益
  isUpdate?: string; //是否已更新
  fundDerived?: string; // 已更新的实际 收益点
  actualIncome?: string; //已更新的实际收益 元
}

/**
 * 存储在 Vs Code 配置中的收益相关的配置对象格式
 */
export interface IFundData {
  totalProfit?: string;
}

export interface CodeItem {
  name: string;
  code: string;
}

export interface FundHoldingsResult {
  fundList: IConfigFundItem[];
  fundDatas: IFundData;
}
