import fs from 'fs';
import { CONFIG } from './config.js';
import { HOLDINGS_MAP } from './const/index.js';

function ensureDataDir() {
  if (!fs.existsSync(CONFIG.PATHS.DATA_DIR)) {
    fs.mkdirSync(CONFIG.PATHS.DATA_DIR, { recursive: true });
  }
}

const ETF_CATEGORIES = {
  '宽基': ['沪深300ETF', '中证500ETF', '中证1000ETF', '创业板ETF', '科创板50ETF'],
  '科技': ['芯片ETF', '半导体ETF', '人工智能ETF', '计算机ETF', '通信ETF', '机器人ETF'],
  '新能源': ['新能源车ETF', '电池ETF', '光伏ETF', '电力ETF', '碳中和ETF'],
  '消费': ['消费ETF', '食品饮料ETF', '家电ETF', '旅游ETF'],
  '医药': ['医药ETF', '医疗ETF'],
  '金融': ['银行ETF', '证券ETF', '保险ETF', '房地产ETF'],
  '周期': ['有色ETF', '稀土ETF', '化工ETF', '钢铁ETF', '煤炭ETF', '能源ETF'],
  '商品': ['黄金ETF', '白银ETF', '标普油气ETF'],
  '军工': ['军工ETF', '航空航天ETF'],
  '海外': ['纳斯达克ETF', '标普500ETF', '日经225ETF', '恒生ETF', '恒生科技ETF', '中概互联网ETF']
};

const CORRELATION_GROUPS = [
  ['芯片ETF', '半导体ETF', '人工智能ETF', '计算机ETF'],
  ['新能源车ETF', '电池ETF', '光伏ETF'],
  ['消费ETF', '食品饮料ETF'],
  ['医药ETF', '医疗ETF'],
  ['银行ETF', '证券ETF', '保险ETF'],
  ['黄金ETF', '白银ETF'],
  ['纳斯达克ETF', '中概互联网ETF', '恒生科技ETF']
];

const RISK_CONFIG = {
  maxRiskPerTrade: 0.015,
  maxTotalRisk: 0.06,
  maxPositions: 5,
  maxCorrelatedPositions: 2
};

export function calculatePositionSize(signal, accountSize = 100000) {
  const entryPrice = parseFloat(signal.entryCondition.targetPrice);
  const stopLoss = parseFloat(signal.stopLoss);
  
  if (!entryPrice || !stopLoss) return 0;
  
  const riskPerShare = Math.abs(entryPrice - stopLoss);
  const riskAmount = accountSize * RISK_CONFIG.maxRiskPerTrade;
  
  const shares = Math.floor(riskAmount / riskPerShare);
  const positionValue = shares * entryPrice;
  
  return {
    shares,
    positionValue,
    riskAmount,
    riskPercent: (riskAmount / accountSize * 100).toFixed(2)
  };
}

export function checkCorrelationRisk(newSignal, activeSignals) {
  let correlatedCount = 0;
  
  for (const group of CORRELATION_GROUPS) {
    if (group.includes(newSignal.etfName)) {
      for (const active of activeSignals) {
        if (group.includes(active.etfName)) {
          correlatedCount++;
        }
      }
      break;
    }
  }
  
  return {
    canAdd: correlatedCount < RISK_CONFIG.maxCorrelatedPositions,
    currentCorrelated: correlatedCount,
    maxAllowed: RISK_CONFIG.maxCorrelatedPositions
  };
}

export function checkTotalRisk(activeSignals, newSignal, accountSize = 100000) {
  let totalRisk = 0;
  
  for (const signal of activeSignals) {
    if (signal.status === 'active') {
      const entryPrice = parseFloat(signal.entryPrice);
      const stopLoss = parseFloat(signal.stopLoss);
      if (entryPrice && stopLoss) {
        const risk = Math.abs(entryPrice - stopLoss) / entryPrice * accountSize * 0.015;
        totalRisk += risk;
      }
    }
  }
  
  const newEntry = parseFloat(newSignal.entryCondition.targetPrice);
  const newStop = parseFloat(newSignal.stopLoss);
  if (newEntry && newStop) {
    const newRisk = Math.abs(newEntry - newStop) / newEntry * accountSize * 0.015;
    totalRisk += newRisk;
  }
  
  return {
    canAdd: totalRisk <= accountSize * RISK_CONFIG.maxTotalRisk,
    totalRiskPercent: (totalRisk / accountSize * 100).toFixed(2),
    maxAllowed: (RISK_CONFIG.maxTotalRisk * 100).toFixed(1)
  };
}

export function checkPositionCount(activeSignals) {
  const activeCount = activeSignals.filter(s => s.status === 'active' || s.status === 'waiting').length;
  return {
    canAdd: activeCount < RISK_CONFIG.maxPositions,
    currentCount: activeCount,
    maxAllowed: RISK_CONFIG.maxPositions
  };
}

export function calculateRSI(prices, period = 14) {
  if (prices.length < period + 1) return null;
  
  let gains = 0;
  let losses = 0;
  
  for (let i = 1; i <= period; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  
  const avgGain = gains / period;
  const avgLoss = losses / period;
  
  if (avgLoss === 0) return 100;
  
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

export function checkTrend(prices, shortPeriod = 5, longPeriod = 20) {
  if (prices.length < longPeriod) return 'unknown';
  
  const shortMA = prices.slice(-shortPeriod).reduce((a, b) => a + b, 0) / shortPeriod;
  const longMA = prices.slice(-longPeriod).reduce((a, b) => a + b, 0) / longPeriod;
  const currentPrice = prices[prices.length - 1];
  
  if (currentPrice > shortMA && shortMA > longMA) return 'strong_up';
  if (currentPrice < shortMA && shortMA < longMA) return 'strong_down';
  if (currentPrice > longMA) return 'up';
  if (currentPrice < longMA) return 'down';
  return 'sideways';
}

export function filterSignalByTechnical(signal, priceHistory = []) {
  const warnings = [];
  let score = 100;
  
  if (priceHistory.length >= 20) {
    const rsi = calculateRSI(priceHistory);
    const trend = checkTrend(priceHistory);
    
    if (rsi !== null) {
      if (signal.direction === 'long') {
        if (rsi > 70) {
          warnings.push('RSI超买 (>70)，追高需谨慎');
          score -= 25;
        } else if (rsi < 30) {
          score += 15;
        }
      } else {
        if (rsi < 30) {
          warnings.push('RSI超卖 (<30)，追空需谨慎');
          score -= 25;
        } else if (rsi > 70) {
          score += 15;
        }
      }
    }
    
    if (signal.direction === 'long') {
      if (trend === 'strong_down') {
        warnings.push('趋势向下，逆势做多');
        score -= 30;
      } else if (trend === 'strong_up') {
        score += 20;
      }
    } else {
      if (trend === 'strong_up') {
        warnings.push('趋势向上，逆势做空');
        score -= 30;
      } else if (trend === 'strong_down') {
        score += 20;
      }
    }
  } else {
    warnings.push('价格历史数据不足，无法进行技术分析');
    score -= 10;
  }
  
  return {
    passed: score >= 50,
    score,
    warnings,
    grade: score >= 80 ? 'A' : score >= 60 ? 'B' : score >= 40 ? 'C' : 'D'
  };
}

export function calculateAdvancedMetrics(history) {
  if (history.length === 0) return null;
  
  const profits = history.map(h => h.profit || 0);
  const winningTrades = history.filter(h => h.isWin);
  const losingTrades = history.filter(h => !h.isWin);
  
  const avgWin = winningTrades.length > 0 
    ? winningTrades.reduce((sum, h) => sum + (h.profit || 0), 0) / winningTrades.length 
    : 0;
  const avgLoss = losingTrades.length > 0 
    ? Math.abs(losingTrades.reduce((sum, h) => sum + (h.profit || 0), 0) / losingTrades.length)
    : 0;
  
  const profitFactor = avgLoss > 0 ? (avgWin * winningTrades.length) / (avgLoss * losingTrades.length) : 999;
  
  let maxDrawdown = 0;
  let peak = 0;
  let cumulative = 0;
  for (const p of profits) {
    cumulative += p;
    if (cumulative > peak) peak = cumulative;
    const drawdown = peak - cumulative;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }
  
  let maxConsecutiveWins = 0;
  let maxConsecutiveLosses = 0;
  let currentWins = 0;
  let currentLosses = 0;
  for (const h of history) {
    if (h.isWin) {
      currentWins++;
      currentLosses = 0;
      if (currentWins > maxConsecutiveWins) maxConsecutiveWins = currentWins;
    } else {
      currentLosses++;
      currentWins = 0;
      if (currentLosses > maxConsecutiveLosses) maxConsecutiveLosses = currentLosses;
    }
  }
  
  const returns = profits;
  const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const stdDev = Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / returns.length);
  const sharpeRatio = stdDev > 0 ? (meanReturn / stdDev * Math.sqrt(252)) : 0;
  
  return {
    totalTrades: history.length,
    winRate: (winningTrades.length / history.length * 100).toFixed(1),
    avgWin: avgWin.toFixed(2),
    avgLoss: avgLoss.toFixed(2),
    profitFactor: profitFactor.toFixed(2),
    maxDrawdown: maxDrawdown.toFixed(2),
    maxConsecutiveWins,
    maxConsecutiveLosses,
    sharpeRatio: sharpeRatio.toFixed(2),
    expectancy: ((avgWin * winningTrades.length / history.length) - (avgLoss * losingTrades.length / history.length)).toFixed(2)
  };
}

export function generateProTraderReport(signals, history, accountSize = 100000) {
  const metrics = calculateAdvancedMetrics(history);
  const activeSignals = signals.filter(s => s.status === 'active' || s.status === 'waiting');
  
  let report = '# 🎯 专业交易员报告\n';
  report += `> 生成时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}\n\n`;
  
  if (metrics) {
    report += '## 📊 绩效仪表盘\n';
    report += `| 指标 | 数值 | 评级 |\n`;
    report += `|:---|---:|:---:|\n`;
    report += `| 总交易次数 | ${metrics.totalTrades} | - |\n`;
    report += `| 胜率 | ${metrics.winRate}% | ${parseFloat(metrics.winRate) >= 55 ? '✅' : '⚠️'} |\n`;
    report += `| 平均盈利 | +${metrics.avgWin}% | - |\n`;
    report += `| 平均亏损 | -${metrics.avgLoss}% | - |\n`;
    report += `| 盈亏比 | ${metrics.profitFactor} | ${parseFloat(metrics.profitFactor) >= 1.5 ? '✅' : '⚠️'} |\n`;
    report += `| 夏普比率 | ${metrics.sharpeRatio} | ${parseFloat(metrics.sharpeRatio) >= 1 ? '✅' : '⚠️'} |\n`;
    report += `| 最大回撤 | -${metrics.maxDrawdown}% | ${parseFloat(metrics.maxDrawdown) <= 10 ? '✅' : '⚠️'} |\n`;
    report += `| 单笔期望收益 | ${metrics.expectancy}% | ${parseFloat(metrics.expectancy) >= 0.2 ? '✅' : '⚠️'} |\n`;
    report += `| 最长连胜 | ${metrics.maxConsecutiveWins}次 | - |\n`;
    report += `| 最长连败 | ${metrics.maxConsecutiveLosses}次 | - |\n\n`;
  }
  
  report += '## ⚙️ 风控状态\n';
  report += `- 单笔最大风险：${(RISK_CONFIG.maxRiskPerTrade * 100).toFixed(1)}%\n`;
  report += `- 总风险上限：${(RISK_CONFIG.maxTotalRisk * 100).toFixed(1)}%\n`;
  report += `- 最大持仓数：${RISK_CONFIG.maxPositions}个\n`;
  report += `- 同组最大持仓：${RISK_CONFIG.maxCorrelatedPositions}个\n\n`;
  
  if (activeSignals.length > 0) {
    report += '## 🎯 当前持仓/待入场\n';
    for (const signal of activeSignals) {
      const statusIcon = signal.status === 'active' ? '🟢' : '⏳';
      const posSize = calculatePositionSize(signal, accountSize);
      
      report += `### ${statusIcon} ${signal.etfName} (${signal.direction === 'long' ? '做多' : '做空'})\n`;
      report += `- 状态：${signal.status === 'active' ? '已持有' : '等待入场'}\n`;
      report += `- 入场价：${signal.entryCondition.targetPrice}\n`;
      report += `- 支撑/止损：${signal.support} / ${signal.stopLoss}\n`;
      report += `- 阻力/止盈：${signal.resistance} / ${signal.takeProfit}\n`;
      if (posSize.positionValue > 0) {
        report += `- 建议仓位：¥${posSize.positionValue.toLocaleString()} (${posSize.shares}份)\n`;
        report += `- 风险金额：¥${posSize.riskAmount.toLocaleString()} (${posSize.riskPercent}%)\n`;
      }
      report += '\n';
    }
  }
  
  return report;
}
