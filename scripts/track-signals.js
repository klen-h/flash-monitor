#!/usr/bin/env node
import { getMarketData } from './data-layer.js';
import { 
  updateSignals, 
  getActiveSignals, 
  getHistory, 
  getPerformance,
  generateProTraderReport
} from './tracker.js';
import { calculateAdvancedMetrics } from './pro-trader.js';
import axios from 'axios';
import { CONFIG } from './config.js';

function formatTime() {
  return new Date().toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  });
}

const MAX_CONTENT_BYTES = 4000;

async function pushAlert(message, titleOverride = null) {
  const webhook = CONFIG.WECHAT_WEBHOOK_REVIEW || CONFIG.WECHAT_WEBHOOK;
  if (!webhook) {
    console.log('⚠️ 未配置 Webhook，跳过推送');
    return;
  }

  const makeHeader = (t) => `## ${t}\n> 生成时间：${formatTime()}\n---\n`;
  const fullMarkdown = makeHeader(titleOverride || '🎯 交易信号提醒') + message;

  try {
    const res = await axios.post(webhook, {
      msgtype: 'markdown',
      markdown: { content: fullMarkdown }
    }, { timeout: 30000 });
    if (res.data.errcode === 0) {
      console.log('📲 提醒推送成功');
    } else {
      console.error('❌ 提醒推送失败:', res.data.errmsg);
    }
  } catch (error) {
    console.error('❌ 网络失败:', error.message);
  }
}

function generateAlertReport(alerts) {
  let report = '';
  
  if (alerts.entries.length > 0) {
    report += '### 🚀 买入信号\n';
    for (const alert of alerts.entries) {
      const s = alert.signal;
      report += `**${s.etfName}** (${s.direction === 'long' ? '做多' : '做空'})\n`;
      report += `- 入场价：${alert.currentPrice}\n`;
      report += `- 止损：${s.stopLoss}\n`;
      report += `- 止盈：${s.takeProfit}\n`;
      if (s.positionSize && s.positionSize.positionValue > 0) {
        report += `- 建议仓位：¥${s.positionSize.positionValue.toLocaleString()}\n`;
      }
      report += '\n';
    }
  }
  
  if (alerts.exits.length > 0) {
    report += '### 💰 卖出信号\n';
    for (const alert of alerts.exits) {
      const s = alert.signal;
      const profitStr = alert.profit ? `${alert.profit > 0 ? '+' : ''}${alert.profit.toFixed(2)}%` : '';
      report += `**${s.etfName}** (${s.direction === 'long' ? '做多' : '做空'})\n`;
      report += `- 出场价：${alert.currentPrice}\n`;
      report += `- 盈亏：${profitStr}\n`;
      report += `- 原因：${s.exits[s.exits.length - 1]?.reason || ''}\n\n`;
    }
  }
  
  if (alerts.updates.length > 0) {
    report += '### ⚡ 接近提醒\n';
    for (const alert of alerts.updates) {
      report += `- **${alert.signal.etfName}**：当前 ${alert.currentPrice}，距离目标 ${alert.targetPrice} 还有 ${alert.distance.toFixed(2)}%\n`;
    }
    report += '\n';
  }
  
  return report;
}

async function main() {
  console.log('📈 开始更新交易信号...');
  
  try {
    const marketData = await getMarketData(true);
    if (!marketData.holdings || marketData.holdings.length === 0) {
      console.log('⚠️ 无ETF行情数据，跳过更新');
      return;
    }

    console.log(`   获取到 ${marketData.holdings.length} 个ETF行情`);
    
    const result = updateSignals(marketData);
    const { tracking, alerts } = result;
    
    const activeSignals = getActiveSignals();
    const history = getHistory(10);
    const performance = getPerformance();
    const metrics = calculateAdvancedMetrics(getHistory(100));
    
    const hasEntries = alerts.entries.length > 0;
    const hasExits = alerts.exits.length > 0;
    const hasUpdates = alerts.updates.length > 0;
    
    console.log(`\n` + '='.repeat(70));
    console.log(`🎯 交易信号监控 [${formatTime()}]`);
    console.log('='.repeat(70));
    
    if (hasEntries) {
      console.log(`\n🚀 【买入信号】(${alerts.entries.length}个):`);
      for (const alert of alerts.entries) {
        const s = alert.signal;
        console.log(`   ✅ ${s.etfName} @ ${alert.currentPrice} (${s.direction === 'long' ? '做多' : '做空'})`);
        console.log(`      止损: ${s.stopLoss} | 止盈: ${s.takeProfit}`);
        if (s.positionSize && s.positionSize.positionValue > 0) {
          console.log(`      建议仓位: ¥${s.positionSize.positionValue.toLocaleString()}`);
        }
      }
    }
    
    if (hasExits) {
      console.log(`\n💰 【卖出信号】(${alerts.exits.length}个):`);
      for (const alert of alerts.exits) {
        const s = alert.signal;
        const profitEmoji = alert.isWin ? '✅' : '❌';
        const profitStr = alert.profit ? `${alert.profit > 0 ? '+' : ''}${alert.profit.toFixed(2)}%` : '';
        console.log(`   ${profitEmoji} ${s.etfName} @ ${alert.currentPrice} (${profitStr})`);
        console.log(`      原因: ${s.exits[s.exits.length - 1]?.reason || ''}`);
      }
    }
    
    if (hasUpdates) {
      console.log(`\n⚡ 【接近提醒】(${alerts.updates.length}个):`);
      for (const alert of alerts.updates) {
        console.log(`   ${alert.message}`);
      }
    }
    
    if (metrics) {
      console.log(`\n📊 绩效仪表盘:`);
      console.log(`   总交易: ${metrics.totalTrades} | 胜率: ${metrics.winRate}% | 盈亏比: ${metrics.profitFactor}`);
      console.log(`   平均盈利: +${metrics.avgWin}% | 平均亏损: -${metrics.avgLoss}%`);
      console.log(`   夏普比率: ${metrics.sharpeRatio} | 最大回撤: -${metrics.maxDrawdown}%`);
    }
    
    if (activeSignals.length > 0) {
      console.log(`\n🎯 当前持仓/待入场 (${activeSignals.length}个):`);
      for (const s of activeSignals) {
        const statusIcon = s.status === 'active' ? '🟢' : '⏳';
        const gradeIcon = s.techGrade === 'A' ? '🌟' : s.techGrade === 'B' ? '✨' : s.techGrade === 'C' ? '⚠️' : '❌';
        console.log(`\n   ${statusIcon} ${gradeIcon} ${s.etfName} (${s.direction === 'long' ? '做多' : '做空'})`);
        console.log(`      状态: ${s.status === 'active' ? '已持有' : '等待入场'} | 评分: ${s.techScore || '-'} (${s.techGrade || '-'})`);
        console.log(`      入场: ${s.entryCondition.targetPrice} | 止损: ${s.stopLoss} | 止盈: ${s.takeProfit}`);
        if (s.positionSize && s.positionSize.positionValue > 0) {
          console.log(`      仓位: ¥${s.positionSize.positionValue.toLocaleString()} | 风险: ${s.positionSize.riskPercent}%`);
        }
      }
    }
    
    if (history.length > 0) {
      console.log(`\n📜 最近历史 (${history.length}个):`);
      for (const h of history) {
        const resultIcon = h.isWin ? '✅' : '❌';
        const profitStr = h.profit ? `${h.profit > 0 ? '+' : ''}${h.profit.toFixed(2)}%` : '';
        console.log(`   ${resultIcon} ${h.etfName} (${h.direction === 'long' ? '做多' : '做空'}) ${profitStr}`);
      }
    }
    
    console.log('\n' + '='.repeat(70));
    
    if (hasEntries || hasExits) {
      console.log('🎯 有交易信号！正在推送...');
      const alertReport = generateAlertReport(alerts);
      await pushAlert(alertReport);
    } else if (hasUpdates) {
      console.log('⚡ 有接近提醒，正在推送...');
      const alertReport = generateAlertReport(alerts);
      await pushAlert(alertReport, '⚡ 接近提醒');
    } else {
      console.log('✅ 信号更新完成\n');
    }
  } catch (error) {
    console.error('❌ 更新信号失败:', error.message);
  }
}

main().catch(err => {
  console.error('跟踪脚本异常:', err);
  process.exit(1);
});
