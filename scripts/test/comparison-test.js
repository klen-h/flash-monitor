import { analyzeWithLLM, pushWechatComparison } from '../fetch-flash.js';
import { CONFIG } from '../config.js';

async function testComparison() {
  console.log('🧪 开始本地对比测试...');

  // 1. 检查配置
  if (!CONFIG.LLM.MODEL_COMPARE) {
    console.error('❌ 错误: 请在 .env 中设置 LLM_MODEL_COMPARE 环境变量再进行测试。');
    return;
  }
  if (!CONFIG.WECHAT_WEBHOOK) {
    console.error('❌ 错误: 请在 .env 中设置 WECHAT_WEBHOOK 环境变量以查看推送效果。');
    return;
  }

  // 2. 模拟数据
  const mockOilPrice = { price: 78.5, change: -1.2 };
  const mockHoldings = [
    { name: '标普油气ETF', change: -2.5, changeStr: '-2.50' },
    { name: '黄金ETF', change: 0.8, changeStr: '0.80' },
    { name: '纳斯达克ETF', change: 1.2, changeStr: '1.20' }
  ];
  
  const mockClusteredItems = [
    {
      _cluster: '原油能源',
      _clusterHot: '爆',
      _clusterSize: 2,
      time: '10:00',
      source: '金十',
      content: '【以色列计划对伊朗石油设施进行报复性打击】据消息人士透露，以色列内阁已批准打击方案。',
      _allItems: [
        { content: '【以色列计划对伊朗石油设施进行报复性打击】据消息人士透露，以色列内阁已批准打击方案。' },
        { content: '伊朗表示若石油设施遭袭将进行对等报复。' }
      ]
    }
  ];

  try {
    console.log(`🤖 模型 A: ${CONFIG.LLM.MODEL}`);
    console.log(`🤖 模型 B: ${CONFIG.LLM.MODEL_COMPARE}`);
    
    // 3. 运行分析
    console.log('🧠 正在请求分析 (Model A)...');
    const analysisA = await analyzeWithLLM(mockClusteredItems, mockOilPrice, mockHoldings);
    
    console.log('🧠 正在请求分析 (Model B)...');
    const analysisB = await analyzeWithLLM(mockClusteredItems, mockOilPrice, mockHoldings, CONFIG.LLM.MODEL_COMPARE);
    
    // 4. 推送对比
    console.log('📲 正在发送主模型推送...');
    await pushWechat(analysisA, mockClusteredItems, mockOilPrice, mockHoldings);

    console.log('📲 正在发送对比简报...');
    await pushWechatComparison(analysisA, analysisB, mockClusteredItems, mockOilPrice, mockHoldings);

    console.log('📲 正在发送对比模型详细推送...');
    await pushWechat(analysisB, mockClusteredItems, mockOilPrice, mockHoldings, CONFIG.WECHAT_WEBHOOK_COMPARE);
    
    console.log('✅ 测试完成！请检查企业微信。');
  } catch (error) {
    console.error('❌ 测试失败:', error);
  }
}

testComparison();
