#!/usr/bin/env node
import { getMarketData } from './data-layer.js';
import { 
  addSignalWithValidation, 
  updateSignals, 
  getActiveSignals, 
  getHistory,
  loadTracking,
  saveTracking
} from './tracker.js';
import { 
  calculatePositionSize,
  checkCorrelationRisk,
  checkPositionCount,
  filterSignalByTechnical,
  calculateAdvancedMetrics,
  generateProTraderReport
} from './pro-trader.js';

console.log('🧪 开始测试专业交易系统...\n');

async function test() {
  try {
    console.log('1️⃣ 获取市场数据...');
    const marketData = await getMarketData(true);
    console.log(`   ✅ 获取到 ${marketData.holdings.length} 个ETF\n`);

    console.log('2️⃣ 创建测试信号...');
    
    const testSignal1 = {
      etfName: '纳斯达克ETF',
      direction: 'long',
      support: '2.800',
      resistance: '3.000',
      entryCondition: { type: 'price', targetPrice: '2.820' },
      stopLoss: '2.750',
      takeProfit: '2.980',
      reasoning: '测试信号1 - 纳斯达克ETF做多'
    };

    const testSignal2 = {
      etfName: '黄金ETF',
      direction: 'long',
      support: '4.500',
      resistance: '4.700',
      entryCondition: { type: 'price', targetPrice: '4.520' },
      stopLoss: '4.400',
      takeProfit: '4.680',
      reasoning: '测试信号2 - 黄金ETF做多'
    };

    const testSignal3 = {
      etfName: '芯片ETF',
      direction: 'short',
      support: '1.200',
      resistance: '1.400',
      entryCondition: { type: 'price', targetPrice: '1.380' },
      stopLoss: '1.450',
      takeProfit: '1.220',
      reasoning: '测试信号3 - 芯片ETF做空'
    };

    console.log('3️⃣ 验证并添加信号...\n');
    const signals = [testSignal1, testSignal2, testSignal3];
    
    for (const signal of signals) {
      const result = addSignalWithValidation(signal, marketData);
      
      console.log(`   📊 ${signal.etfName}`);
      console.log(`      方向: ${signal.direction === 'long' ? '做多' : '做空'}`);
      console.log(`      入场: ${signal.entryCondition.targetPrice} | 止损: ${signal.stopLoss} | 止盈: ${signal.takeProfit}`);
      console.log(`      验证: ${result.validation.passed ? '✅ 通过' : '❌ 拒绝'}`);
      
      if (!result.validation.passed && result.validation.reasons.length > 0) {
        console.log(`      原因: ${result.validation.reasons.join(', ')}`);
      }
      
      if (result.techCheck) {
        console.log(`      技术评分: ${result.techCheck.score} (${result.techCheck.grade})`);
        if (result.techCheck.warnings.length > 0) {
          console.log(`      技术警告: ${result.techCheck.warnings.join(', ')}`);
        }
      }
      
      if (result.positionSize && result.positionSize.positionValue > 0) {
        console.log(`      建议仓位: ¥${result.positionSize.positionValue.toLocaleString()} (${result.positionSize.shares}份)`);
        console.log(`      风险金额: ¥${result.positionSize.riskAmount.toLocaleString()} (${result.positionSize.riskPercent}%)`);
      }
      
      console.log('');
    }

    console.log('4️⃣ 更新信号状态...');
    updateSignals(marketData);
    console.log('   ✅ 信号状态已更新\n');

    console.log('5️⃣ 检查当前活跃信号...');
    const activeSignals = getActiveSignals();
    console.log(`   当前活跃信号: ${activeSignals.length} 个\n`);

    console.log('6️⃣ 计算高级绩效指标...');
    const history = getHistory(100);
    const metrics = calculateAdvancedMetrics(history);
    if (metrics) {
      console.log('   📊 绩效指标:');
      console.log(`      总交易: ${metrics.totalTrades}`);
      console.log(`      胜率: ${metrics.winRate}%`);
      console.log(`      盈亏比: ${metrics.profitFactor}`);
      console.log(`      夏普比率: ${metrics.sharpeRatio}`);
      console.log(`      最大回撤: ${metrics.maxDrawdown}%`);
      console.log(`      单笔期望: ${metrics.expectancy}%`);
    } else {
      console.log('   ⚠️ 暂无历史交易数据');
    }
    console.log('');

    console.log('7️⃣ 生成专业交易报告...');
    const report = generateProTraderReport(activeSignals, history);
    console.log('   ✅ 报告生成成功\n');
    console.log('='.repeat(60));
    console.log(report);
    console.log('='.repeat(60));
    console.log('');

    console.log('8️⃣ 清理测试数据...');
    const tracking = loadTracking();
    tracking.activeSignals = tracking.activeSignals.filter(s => !s.reasoning?.includes('测试信号'));
    if (tracking.rejectedSignals) {
      tracking.rejectedSignals = tracking.rejectedSignals.filter(s => !s.reasoning?.includes('测试信号'));
    }
    saveTracking(tracking);
    console.log('   ✅ 测试数据已清理\n');

    console.log('🎉 测试完成！系统运行正常！\n');
    console.log('💡 使用提示:');
    console.log('   - 运行 node scripts/review.js premarket 进行盘前分析');
    console.log('   - 运行 node scripts/track-signals.js 盘中更新信号');
    console.log('   - 查看 public/data/tracking.json 查看完整数据\n');

  } catch (error) {
    console.error('❌ 测试失败:', error.message);
    console.error(error.stack);
  }
}

test();
