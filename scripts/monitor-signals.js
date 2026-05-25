#!/usr/bin/env node
import { getMarketData } from './data-layer.js';
import { 
  updateSignals, 
  getActiveSignals, 
  getHistory,
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

async function pushAlert(message) {
  const webhook = CONFIG.WECHAT_WEBHOOK_REVIEW || CONFIG.WECHAT_WEBHOOK;
  if (!webhook) {
    console.log('⚠️ 未配置 Webhook，跳过推送');
    return;
  }

  const MAX_CONTENT_BYTES = 4000;
  const makeHeader = (t) => `## ${t}\n> 生成时间：${formatTime()}\n---\n`;
  const fullMarkdown = makeHeader('🎯 交易信号提醒') + message;

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
      report += `- 原因：${s.exits[s.exits.length - 1]?.reason || ''}\n`;
      report += '\n';
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

async function checkOnce() {
  console.log(`\n[${formatTime()}] 🔍 检查信号...`);
  
  try {
    const marketData = await getMarketData(true);
    if (!marketData.holdings || marketData.holdings.length === 0) {
      console.log('⚠️ 无ETF行情数据');
      return;
    }

    const result = updateSignals(marketData);
    const { tracking, alerts } = result;

    const hasEntries = alerts.entries.length > 0;
    const hasExits = alerts.exits.length > 0;
    const hasUpdates = alerts.updates.length > 0;

    if (hasEntries || hasExits) {
      console.log(`   🎯 发现 ${alerts.entries.length} 个买入, ${alerts.exits.length} 个卖出信号！`);
      
      const alertReport = generateAlertReport(alerts);
      console.log('\n' + '='.repeat(60));
      console.log(alertReport);
      console.log('='.repeat(60));
      
      await pushAlert(alertReport);
    } else if (hasUpdates) {
      console.log(`   ⚡ ${alerts.updates.length} 个接近提醒`);
      for (const alert of alerts.updates) {
        console.log(`      ${alert.message}`);
      }
    } else {
      const activeSignals = getActiveSignals();
      console.log(`   ✅ 无信号变化 (当前 ${activeSignals.length} 个活跃信号)`);
    }
  } catch (error) {
    console.error('❌ 检查失败:', error.message);
  }
}

async function main() {
  console.log('🎯 交易信号实时监控');
  console.log('=' .repeat(60));
  
  const args = process.argv.slice(2);
  const isOnce = args.includes('--once') || args.includes('-1');
  
  if (isOnce) {
    await checkOnce();
    process.exit(0);
  }
  
  console.log('按 Ctrl+C 停止监控\n');
  
  await checkOnce();
  
  const interval = 60000;
  setInterval(checkOnce, interval);
}

main().catch(err => {
  console.error('监控脚本异常:', err);
  process.exit(1);
});
