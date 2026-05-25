import fs from 'fs';
import { CONFIG } from './config.js';
import {
  calculatePositionSize,
  checkCorrelationRisk,
  checkTotalRisk,
  checkPositionCount,
  filterSignalByTechnical,
  calculateAdvancedMetrics,
  generateProTraderReport
} from './pro-trader.js';

function ensureDataDir() {
  if (!fs.existsSync(CONFIG.PATHS.DATA_DIR)) {
    fs.mkdirSync(CONFIG.PATHS.DATA_DIR, { recursive: true });
  }
}

export function loadTracking() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG.PATHS.TRACKING, 'utf8'));
  } catch {
    return {
      activeSignals: [],
      history: [],
      priceHistory: {},
      performance: {
        total: 0,
        wins: 0,
        losses: 0,
        winRate: 0
      }
    };
  }
}

export function saveTracking(tracking) {
  ensureDataDir();
  fs.writeFileSync(CONFIG.PATHS.TRACKING, JSON.stringify(tracking, null, 2));
}

export function recordPriceHistory(marketData) {
  const tracking = loadTracking();
  const today = new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' });
  
  if (!tracking.priceHistory) {
    tracking.priceHistory = {};
  }
  
  for (const holding of marketData.holdings) {
    if (!tracking.priceHistory[holding.name]) {
      tracking.priceHistory[holding.name] = [];
    }
    
    const history = tracking.priceHistory[holding.name];
    const lastRecord = history[history.length - 1];
    
    if (!lastRecord || lastRecord.date !== today) {
      history.push({
        date: today,
        price: parseFloat(holding.price),
        timestamp: new Date().toISOString()
      });
      
      if (history.length > 60) {
        tracking.priceHistory[holding.name] = history.slice(-60);
      }
    }
  }
  
  saveTracking(tracking);
}

export function addSignalWithValidation(signal, marketData = null, accountSize = 100000) {
  const tracking = loadTracking();
  const validation = {
    passed: true,
    warnings: [],
    reasons: []
  };
  
  const posCheck = checkPositionCount(tracking.activeSignals);
  if (!posCheck.canAdd) {
    validation.passed = false;
    validation.reasons.push(`持仓数超限 (${posCheck.currentCount}/${posCheck.maxAllowed})`);
  }
  
  const corrCheck = checkCorrelationRisk(signal, tracking.activeSignals);
  if (!corrCheck.canAdd) {
    validation.passed = false;
    validation.reasons.push(`相关性超限 (${corrCheck.currentCorrelated}/${corrCheck.maxAllowed})`);
  }
  
  const riskCheck = checkTotalRisk(tracking.activeSignals, signal, accountSize);
  if (!riskCheck.canAdd) {
    validation.passed = false;
    validation.reasons.push(`总风险超限 (${riskCheck.totalRiskPercent}%/${riskCheck.maxAllowed}%)`);
  }
  
  let techCheck = { passed: true, score: 100, warnings: [], grade: 'A' };
  if (tracking.priceHistory && tracking.priceHistory[signal.etfName]) {
    const prices = tracking.priceHistory[signal.etfName].map(p => p.price);
    techCheck = filterSignalByTechnical(signal, prices);
    validation.warnings = techCheck.warnings;
  }
  
  const positionSize = calculatePositionSize(signal, accountSize);
  
  signal.id = Date.now().toString();
  signal.createdAt = new Date().toISOString();
  signal.status = validation.passed ? 'waiting' : 'rejected';
  signal.entries = [];
  signal.exits = [];
  signal.validation = validation;
  signal.techScore = techCheck.score;
  signal.techGrade = techCheck.grade;
  signal.positionSize = positionSize;
  
  if (validation.passed) {
    tracking.activeSignals.push(signal);
  } else {
    if (!tracking.rejectedSignals) tracking.rejectedSignals = [];
    tracking.rejectedSignals.unshift(signal);
    if (tracking.rejectedSignals.length > 50) {
      tracking.rejectedSignals = tracking.rejectedSignals.slice(0, 50);
    }
  }
  
  saveTracking(tracking);
  return { signal, validation, techCheck, positionSize };
}

export function addSignal(signal) {
  return addSignalWithValidation(signal);
}

export function updateSignals(marketData) {
  recordPriceHistory(marketData);
  
  const tracking = loadTracking();
  const holdingsMap = new Map(marketData.holdings.map(h => [h.name, h]));
  const now = new Date().toISOString();
  
  const alerts = {
    entries: [],
    exits: [],
    updates: []
  };

  for (const signal of tracking.activeSignals) {
    if (signal.status !== 'waiting' && signal.status !== 'active') continue;

    const holding = holdingsMap.get(signal.etfName);
    if (!holding) continue;

    const currentPrice = parseFloat(holding.price);
    const prevPrice = signal.lastCheckedPrice || currentPrice;
    signal.lastCheckedPrice = currentPrice;

    if (signal.status === 'waiting') {
      if (signal.entryCondition.type === 'price') {
        const targetPrice = parseFloat(signal.entryCondition.targetPrice);
        const direction = signal.direction;

        const triggered = (direction === 'long' && currentPrice <= targetPrice) ||
                         (direction === 'short' && currentPrice >= targetPrice);
        const prevTriggered = (direction === 'long' && prevPrice <= targetPrice) ||
                            (direction === 'short' && prevPrice >= targetPrice);

        if (triggered && !prevTriggered) {
          signal.status = 'active';
          signal.entries.push({
            price: currentPrice,
            time: now,
            reason: '触发入场价格'
          });
          signal.entryPrice = currentPrice;
          signal.entryTime = now;
          
          alerts.entries.push({
            signal,
            currentPrice,
            message: `🚀 【买入信号】${signal.etfName} 在 ${currentPrice} 触发入场`
          });
        }
      }
    }

    if (signal.status === 'active') {
      let hitStopLoss = false;
      let hitTakeProfit = false;
      let hitResistance = false;
      let exitReason = '';

      if (signal.stopLoss) {
        const slPrice = parseFloat(signal.stopLoss);
        if ((signal.direction === 'long' && currentPrice <= slPrice) ||
            (signal.direction === 'short' && currentPrice >= slPrice)) {
          hitStopLoss = true;
          exitReason = '触发止损';
        }
      }

      if (signal.takeProfit) {
        const tpPrice = parseFloat(signal.takeProfit);
        if ((signal.direction === 'long' && currentPrice >= tpPrice) ||
            (signal.direction === 'short' && currentPrice <= tpPrice)) {
          hitTakeProfit = true;
          exitReason = '触发止盈';
        }
      }

      if (signal.resistance && !hitTakeProfit && !hitStopLoss) {
        const resPrice = parseFloat(signal.resistance);
        if ((signal.direction === 'long' && currentPrice >= resPrice) ||
            (signal.direction === 'short' && currentPrice <= resPrice)) {
          hitResistance = true;
          exitReason = '触及阻力位';
        }
      }

      if (hitStopLoss || hitTakeProfit || hitResistance) {
        const prevHit = signal.lastStatus === 'closed';
        if (!prevHit) {
          signal.status = 'closed';
          signal.lastStatus = 'closed';
          signal.exits.push({
            price: currentPrice,
            time: now,
            reason: exitReason
          });
          signal.exitPrice = currentPrice;
          signal.exitTime = now;

          const profit = signal.direction === 'long' 
            ? ((currentPrice - signal.entryPrice) / signal.entryPrice * 100)
            : ((signal.entryPrice - currentPrice) / signal.entryPrice * 100);
          signal.profit = profit;
          signal.isWin = profit > 0;

          tracking.performance.total++;
          if (signal.isWin) tracking.performance.wins++;
          else tracking.performance.losses++;
          tracking.performance.winRate = tracking.performance.total > 0 
            ? (tracking.performance.wins / tracking.performance.total * 100).toFixed(1)
            : 0;

          tracking.history.unshift(signal);
          tracking.activeSignals = tracking.activeSignals.filter(s => s.id !== signal.id);
          
          const profitEmoji = signal.isWin ? '💰' : '💸';
          const profitStr = signal.profit ? `${signal.profit > 0 ? '+' : ''}${signal.profit.toFixed(2)}%` : '';
          alerts.exits.push({
            signal,
            currentPrice,
            profit: signal.profit,
            isWin: signal.isWin,
            message: `${profitEmoji} 【卖出信号】${signal.etfName} 在 ${currentPrice} ${exitReason} (${profitStr})`
          });
        }
      }
    }
    
    if (signal.status === 'waiting' || signal.status === 'active') {
      const targetPrice = signal.status === 'waiting' 
        ? parseFloat(signal.entryCondition.targetPrice)
        : (signal.direction === 'long' 
            ? parseFloat(signal.takeProfit || signal.resistance)
            : parseFloat(signal.stopLoss || signal.support));
      
      if (targetPrice) {
        const distance = Math.abs((currentPrice - targetPrice) / targetPrice * 100);
        if (distance <= 1.0 && distance > 0.1) {
          alerts.updates.push({
            signal,
            currentPrice,
            targetPrice,
            distance,
            message: `⚡ 【接近提醒】${signal.etfName} 当前 ${currentPrice}，距离目标 ${targetPrice} 还有 ${distance.toFixed(2)}%`
          });
        }
      }
    }
  }

  saveTracking(tracking);
  return { tracking, alerts };
}

export function getActiveSignals() {
  const tracking = loadTracking();
  return tracking.activeSignals;
}

export function getHistory(limit = 20) {
  const tracking = loadTracking();
  return tracking.history.slice(0, limit);
}

export function getPerformance() {
  const tracking = loadTracking();
  return tracking.performance;
}

function formatTime() {
  return new Date().toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  });
}

export function generateTrackingReport() {
  const activeSignals = getActiveSignals();
  const history = getHistory(10);
  const performance = getPerformance();
  const tracking = loadTracking();
  
  let report = '## 📊 交易跟踪报告\n';
  report += `> 生成时间：${formatTime()}\n\n`;
  
  report += `### 📈 历史表现\n`;
  report += `- 总交易次数：${performance.total}\n`;
  report += `- 盈利：${performance.wins}次\n`;
  report += `- 亏损：${performance.losses}次\n`;
  report += `- 胜率：${performance.winRate}%\n\n`;
  
  if (activeSignals.length > 0) {
    report += `### 🎯 当前跟踪信号 (${activeSignals.length}个)\n`;
    for (const s of activeSignals) {
      const statusEmoji = s.status === 'active' ? '🟢' : '⏳';
      const gradeEmoji = s.techGrade === 'A' ? '🌟' : s.techGrade === 'B' ? '✨' : s.techGrade === 'C' ? '⚠️' : '❌';
      report += `${statusEmoji} ${gradeEmoji} **${s.etfName}** (${s.direction === 'long' ? '做多' : '做空'})\n`;
      report += `   状态：${s.status === 'active' ? '已入场' : '等待入场'}\n`;
      if (s.techScore) report += `   技术评分：${s.techScore} (${s.techGrade})\n`;
      if (s.support) report += `   支撑位：${s.support}\n`;
      if (s.resistance) report += `   阻力位：${s.resistance}\n`;
      if (s.entryPrice) report += `   入场价：${s.entryPrice}\n`;
      if (s.stopLoss) report += `   止损：${s.stopLoss}\n`;
      if (s.takeProfit) report += `   止盈：${s.takeProfit}\n`;
      if (s.positionSize && s.positionSize.positionValue > 0) {
        report += `   建议仓位：¥${s.positionSize.positionValue.toLocaleString()}\n`;
      }
      report += '\n';
    }
  }
  
  if (history.length > 0) {
    report += `### 📜 最近历史 (${history.length}个)\n`;
    for (const h of history) {
      const resultEmoji = h.isWin ? '✅' : '❌';
      const profitStr = h.profit ? `${h.profit > 0 ? '+' : ''}${h.profit.toFixed(2)}%` : '';
      report += `${resultEmoji} **${h.etfName}** (${h.direction === 'long' ? '做多' : '做空'}) ${profitStr}\n`;
    }
  }
  
  if (tracking.rejectedSignals && tracking.rejectedSignals.length > 0) {
    report += `\n### 🚫 被拒绝信号 (最近3个)\n`;
    for (const s of tracking.rejectedSignals.slice(0, 3)) {
      report += `- **${s.etfName}**: ${s.validation?.reasons?.join(', ') || '未知原因'}\n`;
    }
  }
  
  return report;
}

export { generateProTraderReport };
