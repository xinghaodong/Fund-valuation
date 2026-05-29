interface TradingTimeInfo {
  day: number;
  hours: number;
  minutes: number;
  now: Date;
  isWorkday: boolean;
}
export function isTradingTime(): TradingTimeInfo {
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const day = now.getDay();
  // 判断是否为工作日（周一到周五）
  const isWorkday = day > 0 && day < 6;
  return {
    day,
    hours,
    minutes,
    now,
    isWorkday,
  };
}

export function getQdiiRegion(fund: any): "US" | "HK" {
  const name = fund.value.fd_name.toLowerCase();
  const benchmark = (fund.value.performance_bench_mark || "").toLowerCase();

  // 1. 优先从基金名称判断（最可靠）
  if (
    name.includes("纳斯达克") ||
    name.includes("标普") ||
    name.includes("美国") ||
    name.includes("美股") ||
    name.includes("s&p") ||
    name.includes("nasdaq") ||
    name.includes("全球")
  ) {
    return "US"; // 美股
  }
  if (
    name.includes("港股") ||
    name.includes("恒生") ||
    name.includes("hs") ||
    name.includes("h股") ||
    name.includes("香港")
  ) {
    return "HK"; // 港股
  }

  // 2. 兜底：从业绩基准判断
  if (
    benchmark.includes("纳斯达克") ||
    benchmark.includes("标普") ||
    benchmark.includes("sp 500") ||
    benchmark.includes("nasdaq") ||
    benchmark.includes("msci usa") ||
    benchmark.includes("美股") ||
    benchmark.includes("全球")
  ) {
    return "US";
  }
  if (
    benchmark.includes("恒生") ||
    benchmark.includes("hs") ||
    benchmark.includes("hang seng")
  ) {
    return "HK";
  }

  // 3. 默认：无法识别，按美股处理（因大多数 QDII 主要投美股）
  return "US";
}

export function getFundMarketType(fund: any): "A" | "QDII_US" | "QDII_HK" {
  const typeDesc = fund.value.type_desc;

  // 1. 先区分是否 QDII
  if (!typeDesc.includes("QDII")) {
    return "A"; // A股基金
  }

  // 2. 是 QDII，再判断地域
  const region = getQdiiRegion(fund);
  if (region === "HK") {
    return "QDII_HK";
  } else {
    return "QDII_US"; // 包括 US 和 GLOBAL（按美股逻辑处理）
  }
}

export function formatDate(date: Date): string {
  return date.toISOString().split("T")[0]; // "2025-11-07"
}

export function isTargetNavAvailable(fund: any): boolean {
  const today = formatDate(new Date()); // 例如 "2025-11-07"
  const typeDesc = fund.data.type_desc;
  const latestNavDate = fund.data.fund_derived.end_date; // 例如 "2025-11-06"

  if (typeDesc.includes("QDII_US")) {
    // QDII 基金：今晚应有 "昨天" 的净值（对应昨天的美股交易）
    const yesterday = formatDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
    return latestNavDate === yesterday;
  } else {
    // A股基金：今晚应有 "今天" 的净值
    return latestNavDate === today;
  }
}
