
import { getMarketData } from './data-layer.js';
import { fetchAllETFCapitalFlows, fetchNorthBoundOverview } from './capital-flow.js';
import { enrichETFData } from './enrich.js';
import { calculateMainForceScore, detectDivergence, detectMarketTheme, formatCapitalFlowForPrompt } from './signal-engine.js';
import { HOLDINGS_MAP } from './const/index.js';

console.log('=' .repeat(60));
console.log('快速功能测试');
console.log('=' .repeat(60));
console.log('');

async function runTest() {
  try {
    console.log('1️⃣ 获取市场数据...');
    const marketData = await getMarketData(true);
    console.log('   ✅ 成功:', marketData.holdings.length, '只ETF');
    if (marketData.holdings.length > 0) {
      const h = marketData.holdings[0];
      console.log('   示例:', h.name, h.price, h.volume);
    }
    console.log('');

    console.log('2️⃣ 数据增强...');
    const enriched = enrichETFData(marketData.holdings);
    console.log('   ✅ 完成');
    if (enriched.length > 0) {
      console.log('   量比:', enriched[0].volumeRatio, '价格位置:', enriched[0].pricePosition);
    }
    console.log('');

    console.log('3️⃣ 获取ETF资金数据...');
    const capitalFlows = await fetchAllETFCapitalFlows(HOLDINGS_MAP);
    const validCount = Object.values(capitalFlows).filter(f => f).length; 
    console.log('   ✅ 完成: ', validCount, '/', Object.keys(HOLDINGS_MAP).length);
    console.log('');

    console.log('4️⃣ 获取北向资金...');
    const northBound = await fetchNorthBoundOverview();
    if (northBound) {
      console.log('   ✅ 完成:', northBound.totalNet, '亿');
    } else {
      console.log('   ⚠️ 未获取到');
    }
    console.log('');

    console.log('5️⃣ 计算评分...');
    const scores = {};
    for (const h of enriched) {
      scores[h.name] = calculateMainForceScore(h.name, h, capitalFlows[h.name]);
    }
    console.log('   ✅ 完成，前3名:');
    Object.entries(scores)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .forEach(([name, score]) => {
        const flow = capitalFlows[name];
        const mf = flow?.mainForceRatio || 0;
        console.log('   - ' + name + ': ' + score + '分 (主力占比: ' + mf + '%)');
      });
    console.log('');

    console.log('6️⃣ 检测市场风格和主线...');
    const theme = detectMarketTheme(enriched, capitalFlows, scores);
    const divergence = detectDivergence(enriched, scores);
    console.log('   ✅ 风格:', divergence.label);
    if (theme) {
      console.log('   ✅ 主线:', theme.theme, '强度', theme.score, '分');
    }
    console.log('');

    console.log('7️⃣ 格式化输出预览...');
    const capitalText = formatCapitalFlowForPrompt(enriched, capitalFlows, scores, theme, divergence, northBound);
    console.log(capitalText);

    console.log('=' .repeat(60));
    console.log('✅ 所有测试通过!');
    console.log('=' .repeat(60));
  } catch (e) {
    console.error('❌ 测试失败:', e);
    console.error(e.stack);
  }
}

runTest();
