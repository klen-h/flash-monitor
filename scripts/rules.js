export const EXCLUDE_PATTERNS = [
  /^【金十数据整理[：:]/,
  /^【今日重点关注的财经数据/,
  /^【财料】/,
  /^【金十整理[：:]/,
  /涨\d+%.*股价再创历史新高/,
  /估值或升至逾\d+亿美元/,
  /Good afternoon/i,
  /"好好先生"/i,
  /特朗普.*"太迟先生"/i,
  /特朗普.*其他地方没人要他/i,
];

export const LOW_VALUE_KEYWORDS = [
  '俏皮话', '最后一次新闻发布会', '不会成为"影子主席"',
  '部署时间创纪录', '厕所也反复出现问题',
];

export const URGENT_TIME_KEYWORDS = [
  '几小时内', '即将', '马上', '立刻', '立即',
  '倒计时', '最后期限', '最后通牒',
  '周一早上', '周二', '明天', '今晚',
  '行动开始', '行动将在', '启动.*行动',
  '几小时', '数小时内', '接下来',
];

export const A_STOCK_KEYWORDS = [
  '原油', '油价', '石油', 'WTI', '布伦特', 'Brent', 'EIA',
  '欧佩克', 'OPEC', '页岩油', '战略储备', '储油', '管道',
  '霍尔木兹', '海峡', '油轮', '油运', '航运',
  '沙特', '阿联酋', '科威特', '伊拉克', '委内瑞拉',
  '三桶油', '中石油', '中石化', '中海油',
  '化工', '塑料', 'PTA', '沥青', '化肥',
  '通胀', 'CPI', 'PPI', '美联储', '加息', '降息', '鲍威尔',
  '央行', '降准', 'MLF', 'LPR',
  'A股', '上证', '深证', '创业板', '沪指', '沪深300',
  '汇金', '社保基金', '国家队',
  '伊朗', '核计划', '封锁', '美伊', '中东', '战争',
  '中美', '关税', '贸易', '制裁',
  '证券', '券商', '银行', '保险', '半导体', '芯片',
  '房地产', '限购', '公积金',
];

export const EVENT_CLUSTERS = [
  { 
    name: '原油能源', 
    keywords: [
      '原油', '油价', '石油', 'WTI', '布伦特', 'Brent', 
      'EIA', '欧佩克', 'OPEC', '页岩油', '战略储备',
      '霍尔木兹', '海峡', '油轮', '储油', '管道', '出口',
      '沙特', '阿联酋', '科威特', '伊拉克', '委内瑞拉',
      '三桶油', '中石油', '中石化', '中海油',
      '化工', '塑料', 'PTA', '沥青', '化肥', '油运'
    ] 
  },
  { 
    name: '伊朗局势', 
    keywords: ['伊朗', '核计划', '封锁', '特朗普.*伊朗', '美伊', '伊美', '哈梅内伊'] 
  },
  { 
    name: '中东战争', 
    keywords: ['战争授权', '战争权力法', '60天', '国会授权', '军事行动', '以军', '真主党', '哈马斯'] 
  },
  { 
    name: '美联储利率', 
    keywords: ['美联储', 'FOMC', '利率决议', '维持利率', '降息', '加息', '鲍威尔', '沃什'] 
  },
  { 
    name: '美联储人事', 
    keywords: ['沃什', '美联储主席提名', '参议院', '米兰', '哈玛克', '卡什卡利'] 
  },
  { 
    name: '黄金贵金属', 
    keywords: ['黄金', '增持黄金', '世界黄金协会', '白银', '央行购金'] 
  },
  { 
    name: '国内政策', 
    keywords: ['证监会', '央行', '降准', '降息', 'LPR', 'MLF', '限购', '公积金', '房地产'] 
  },
  { 
    name: '中美贸易', 
    keywords: ['中美', '关税', '贸易', '半导体', '华虹', '脱钩'] 
  },
  { 
    name: '俄乌局势', 
    keywords: ['普京', '俄乌', '乌克兰', '停火', '胜利日'] 
  },
  { 
    name: '港股/中概股', 
    keywords: ['港股', '恒生', '科网股', '小米', '阿里巴巴', '百度', '中芯国际'] 
  },
];

export function isSectorMove(content) {
  const sectorPatterns = [
    /集体走高|集体上扬|集体大涨|集体飙升/,
    /涨幅扩大至\d+%/,
    /涨超.*涨超/,  // 至少2个涨超
    /科网股|芯片股|半导体股|地产股|汽车股/,
    /港股.*涨|恒生.*涨/,
  ];
  return sectorPatterns.some(p => p.test(content));
}

export function hasUrgentTime(content) {
  return URGENT_TIME_KEYWORDS.some(kw => {
    if (kw.includes('.*')) return new RegExp(kw).test(content);
    return content.includes(kw);
  });
}

// ==================== 市场时钟感知层 ====================
function getMarketClock() {
  const now = new Date();
  const beijingHour = (now.getUTCHours() + 8) % 24;
  const beijingMinute = now.getUTCMinutes();
  const beijingTime = beijingHour * 60 + beijingMinute;

  // A股/港股连续竞价：9:30-11:30, 13:00-15:00
  const aStockMorning = beijingTime >= 570 && beijingTime < 690;
  const aStockAfternoon = beijingTime >= 780 && beijingTime < 900;
  const isAStockTrading = aStockMorning || aStockAfternoon;

  // 恒生科技指数收盘时间晚于ETF，ETF收盘后指数仍在发布（15:00-16:30）
  const isHSTechExtended = beijingTime >= 900 && beijingTime < 990; // 15:00-16:30

  // 日经225指数交易时段（北京时间）：上午8:00-10:30，下午11:30-14:00（近似，取整）
  const nkMorning = beijingTime >= 480 && beijingTime < 630;   // 8:00-10:30
  const nkAfternoon = beijingTime >= 690 && beijingTime < 840; // 11:30-14:00
  const isNikkeiTrading = nkMorning || nkAfternoon;

  // 美股常规交易：北京时间 21:30-04:00 (夏令时)
  const isUSTrading = beijingTime >= 1290 || beijingTime < 240;

  return {
    beijingTime: `${String(Math.floor(beijingTime / 60)).padStart(2, '0')}:${String(beijingTime % 60).padStart(2, '0')}`,
    isAStockTrading,
    isHSTechExtended,
    isNikkeiTrading,
    isUSTrading,
    isAsiaEquityClosed: !isAStockTrading && !isHSTechExtended && !isNikkeiTrading, // 亚盘主要股票市场全部关闭
  };
}

// ==================== 数据质量评估（修正版） ====================
export function evaluateDataQuality(macro, holdingsData) {
  const clock = getMarketClock();
  const missingItems = [];
  
  // ---- 1. 原油涨跌方向（24h，无需时钟判断）----
  if (!macro.crude || macro.crude.price === 0 || macro.crude.price === '未知') {
    missingItems.push('纽约原油涨跌方向');
  }
  
  // ---- 2. 黄金涨跌方向（24h，无需时钟判断）----
  if (!macro.gold || macro.gold.price === 0 || macro.gold.prevClose === 0) {
    missingItems.push('黄金涨跌方向');
  }
  
  // ---- 3. 美元指数（24h，无需时钟判断）----
  if (!macro.dxy || macro.dxy.price === 0) {
    missingItems.push('美元指数走势');
  }
  
  // ---- 4. 纳指期货（几乎24h，保持原检查）----
  if (!macro.nasdaq || macro.nasdaq.price === 0) {
    missingItems.push('纳指期货盘中表现');
  }
  
  // ---- 5. 恒生科技指数：仅在亚盘时段才要求实时数据 ----
  if (clock.isAStockTrading || clock.isHSTechExtended) {
    // 亚盘仍在交易时段，应当有实时数据
    if (!macro.hstech || macro.hstech.price === 0) {
      missingItems.push('恒生科技盘中表现');
    }
  }
  // 亚盘收盘后，不将缺失视为异常，恒生科技数据为静态收盘数据，不影响诊断准确性
  
  //  ---- 6. 日经225期货：24h品种，去掉时钟限制 ----
  if (!macro.nke || macro.nke.price === 0) {
    missingItems.push('日经225期货盘中表现');
  }
  
  // ---- 7. ETF盘面数据：只有A股/港股交易时段才期望有ETF实时数据 ----
  if (clock.isAStockTrading) {
    // 盘中：需要有ETF数据
    if (!holdingsData || holdingsData.length === 0) {
      missingItems.push('对应ETF的盘面数据');
    }
  }
  // 非交易时段：ETF无数据是正常的，不视为缺失，后续盘面验证自动降级为逻辑自洽检验

  // ---- 8. 综合质量判断（保持原有逻辑）----
  let data_quality = '充足';
  let activated_steps = ['1.1 必要数据清单', '1.2 数据质量判定', '2.4 事件簇分析'];
  let aborted_steps = [];

  if (missingItems.includes('纽约原油涨跌方向')) {
    data_quality = '严重不足';
    aborted_steps.push('整个诊断模块 (原因: 缺失纽约原油涨跌方向)');
  } else if (missingItems.length >= 3) {
    data_quality = '严重不足';
    aborted_steps.push('多情景生成 (原因: 数据严重不足，仅执行单线推演)');
  } else if (missingItems.length > 0) {
    data_quality = '部分缺失';
    if (missingItems.includes('黄金涨跌方向')) aborted_steps.push('相关性诊断步骤1 (原因: 黄金方向不明)');
    if (missingItems.includes('美元指数走势')) aborted_steps.push('D状态步骤2 (原因: 美元细节缺失)');
    if (missingItems.includes('纳指期货盘中表现') || missingItems.includes('日经225期货盘中表现') || missingItems.includes('恒生科技盘中表现')) {
      aborted_steps.push('D状态步骤3 (原因: 风险资产数据缺失)');
    }
  }

  // 激活步骤：只要不是严重不足，就可激活相关性诊断
  if (data_quality !== '严重不足') {
    activated_steps.push('2.2 原油-黄金相关性诊断');
    // 盘面验证：只有当ETF数据可用时才能激活（非交易时段即使未标注缺失，也无法执行盘面验证）
    if (!missingItems.includes('对应ETF的盘面数据') && clock.isAStockTrading) {
      activated_steps.push('2.1 盘面交叉验证');
    }
  }

  // 追加时钟信息到返回对象，便于 prompt 和日志使用
  return {
    data_quality,
    missing_items: missingItems,
    activated_steps,
    aborted_steps,
    overall_confidence: data_quality === '充足' ? '高' : (data_quality === '部分缺失' ? '中' : '低'),
    market_clock: {
      beijing_time: clock.beijingTime,
      is_a_stock_trading: clock.isAStockTrading,
      is_hstech_extended: clock.isHSTechExtended,
      is_nikkei_trading: clock.isNikkeiTrading,
      is_us_trading: clock.isUSTrading,
      is_asia_equity_closed: clock.isAsiaEquityClosed,
    }
  };
}
