/**
 * 快讯实时监控 - 原油核心版
 * 模块化重构：分离配置、规则、数据层与存储层
 */

import axios from 'axios';
import { CONFIG } from './config.js';
import { 
  EXCLUDE_PATTERNS, 
  LOW_VALUE_KEYWORDS, 
  A_STOCK_KEYWORDS, 
  EVENT_CLUSTERS, 
  isSectorMove, 
  hasUrgentTime 
} from './rules.js';
import { HOLDINGSTEXT } from './const/index.js';
import { getMarketData } from './data-layer.js';
import { fetchSinaMacro } from './macro-layer.js';
import { loadState, saveState, saveRawData, saveAnalysis } from './storage.js';

// ==================== 主入口 ====================
async function main() {
  console.log(`\n[${formatTime()}] 🚀 金十快讯监控启动 [原油核心+盘面验证模式]`);

  const items = await fetchJin10();
  if (items.length === 0) {
    console.log('❌ 未获取到数据');
    return;
  }

  const newItems = getNewItems(items);
  if (newItems.length === 0) {
    console.log('⏭️ 无新增快讯');
    return;
  }
  console.log(`📥 新增 ${newItems.length} 条`);

  const filtered = preFilter(newItems);
  console.log(`🔍 硬过滤后: ${filtered.length} 条`);

  const clustered = deduplicateByEvent(filtered);
  console.log(`📦 聚合为 ${clustered.length} 个事件簇`);
  clustered.forEach(c => {
    const urgentTag = hasUrgentTime(c.content) ? '⏰' : '';
    console.log(`   ${c._clusterHot === '爆' ? '🔴' : '🔵'} ${urgentTag} ${c._cluster} (${c._clusterSize}条)`);
  });

  let marketData = null;
  let oilPrice = null;
  try {
    marketData = await getMarketData();
    console.log(`📊 数据层状态: A股${marketData.isAOpen ? '开市' : '休市'} | 获取到${marketData.holdings.length} 个ETF行情`);
    oilPrice = marketData.oil;
  } catch (e) {
    console.log('⚠️ data-layer获取失败:', e.message);
  }

  if (oilPrice) {
    console.log(`📊 布伦特原油: $${oilPrice.price} (${oilPrice.change > 0 ? '+' : ''}${oilPrice.change}%)`);
  }
  const holdingsData = marketData?.holdings || [];

  const state = loadState();
  const toAnalyze = [];
  const toUpdate = [];

  for (const cluster of clustered) {
    const existing = state.pushedClusters?.find(p => p.cluster === cluster._cluster);

    if (!existing) {
      toAnalyze.push(cluster);
      console.log(`   🆕 新事件: ${cluster._cluster}`);
    } else if (cluster.hot === '爆' && existing.pushCount === 0) {
      console.log(`   🔥 ${cluster._cluster} 升级为"爆"，补推`);
      toAnalyze.push(cluster);
    } else if (isMajorUpdate(cluster, existing)) {
      console.log(`   ⏰ ${cluster._cluster} 重大更新，重新推送`);
      toAnalyze.push(cluster);
    } else {
      toUpdate.push({ cluster: cluster._cluster, lastId: cluster.id });
    }
  }

  if (toAnalyze.length > 0) {
    console.log(`🧠 送审 LLM: ${toAnalyze.length} 个事件簇`);
    const analysis = await analyzeWithLLM(toAnalyze, oilPrice, holdingsData);
    await pushWechat(analysis, toAnalyze, oilPrice, holdingsData);
    
    updateStateAfterPush(state, toAnalyze);
  } else {
    console.log('📭 无新事件需分析，静默');
  }

  for (const update of toUpdate) {
    const existing = state.pushedClusters?.find(p => p.cluster === update.cluster);
    if (existing) {
      existing.lastUpdateId = update.lastId;
      existing.lastUpdateTime = new Date().toISOString();
    }
  }

  saveState(state);
  saveRawData(items, newItems);
  if (toAnalyze.length > 0) {
    saveAnalysis(toAnalyze);
  }

  console.log(`[${formatTime()}] ✅ 完成\n`);
}

// ==================== 采集 ====================
async function fetchJin10() {
  const params = JSON.stringify({ hot: ["爆", "沸"], channel: [1, 2, 3, 5] });

  try {
    const { data } = await axios.get(
      `https://3318fc142ea545eab931e22a61ec6e5c.z3c.jin10.com/flash?params=${encodeURIComponent(params)}`,
      {
        headers: {
          'accept': 'application/json, text/plain, */*',
          'accept-language': 'zh-CN,zh;q=0.9',
          'handleerror': 'true',
          'origin': 'https://www.jin10.com',
          'referer': 'https://www.jin10.com/',
          'sec-ch-ua': '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"Windows"',
          'sec-fetch-dest': 'empty',
          'sec-fetch-mode': 'cors',
          'sec-fetch-site': 'same-site',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
          'x-app-id': 'bVBF4FyRTn5NJF5n',
          'x-version': '1.0',
          'cookie': CONFIG.FLASH_COOKIE
        },
        timeout: 15000
      }
    );

    if (!Array.isArray(data.data)) {
      console.error('返回格式异常:', typeof data.data);
      return [];
    }

    return data.data.map(item => ({
      id: item.id,
      time: item.time,
      hot: item.hot,
      content: item.data?.content || '',
      source: item.data?.source || '',
      source_link: item.data?.source_link || '',
      important: item.important,
      channel: item.channel || [],
      collectedAt: new Date().toISOString()
    }));

  } catch (error) {
    console.error('❌ 采集失败:', error.response?.status, error.message);
    return [];
  }
}

// ==================== 去重 ====================
function getNewItems(items) {
  const state = loadState();
  const lastId = state.lastId || '';

  const sorted = [...items].sort((a, b) => (a.id > b.id ? -1 : 1));

  let newItems;
  if (!lastId) {
    newItems = sorted.slice(0, 5);
    console.log('🆕 首次运行，取最近5条');
  } else {
    newItems = sorted.filter(i => i.id > lastId);
  }

  if (sorted.length > 0) {
    state.lastId = sorted[0].id;
    saveState(state);
  }

  return newItems.reverse();
}

// ==================== 硬过滤 ====================
function preFilter(items) {
  return items.filter(item => {
    const content = item.content || '';

    if (EXCLUDE_PATTERNS.some(p => p.test(content))) {
      console.log(`   🚫 排除(模式): ${content.slice(0, 40)}...`);
      return false;
    }

    if (LOW_VALUE_KEYWORDS.some(kw => content.includes(kw))) {
      console.log(`   🚫 排除(低价值): ${content.slice(0, 40)}...`);
      return false;
    }

    const isStockReport = /一季度净利润|第一季度净利润|Q1净利润|一季度营收|第一季度营收/.test(content);
    const isSector = isSectorMove(content);
    const hasMacro = A_STOCK_KEYWORDS.some(kw => content.includes(kw));
    
    if (isStockReport && !isSector && !hasMacro) {
      console.log(`   🚫 排除(纯个股财报): ${content.slice(0, 40)}...`);
      return false;
    }

    return true;
  });
}

// ==================== 事件聚合 ====================
function deduplicateByEvent(items) {
  const clusters = [];
  const usedIds = new Set();

  for (const item of items) {
    if (usedIds.has(item.id)) continue;

    const content = item.content || '';
    let matched = false;

    for (const clusterDef of EVENT_CLUSTERS) {
      const isMatch = clusterDef.keywords.some(kw => {
        if (kw.includes('.*')) {
          return new RegExp(kw).test(content);
        }
        return content.includes(kw);
      });

      if (isMatch) {
        const existing = clusters.find(c => c.clusterName === clusterDef.name);

        if (!existing) {
          clusters.push({
            clusterName: clusterDef.name,
            representative: item,
            allItems: [item],
            hotMax: item.hot === '爆' ? 2 : 1,
            earliestTime: item.time,
          });
        } else {
          existing.allItems.push(item);
          if (item.hot === '爆') existing.hotMax = 2;
          if ((item.source_link || '').length > (existing.representative.source_link || '').length) {
            existing.representative = item;
          }
        }

        usedIds.add(item.id);
        matched = true;
        break;
      }
    }

    if (!matched) {
      clusters.push({
        clusterName: '其他',
        representative: item,
        allItems: [item],
        hotMax: item.hot === '爆' ? 2 : 1,
        earliestTime: item.time,
      });
      usedIds.add(item.id);
    }
  }

  return clusters.map(c => ({
    ...c.representative,
    _cluster: c.clusterName,
    _clusterSize: c.allItems.length,
    _clusterHot: c.hotMax === 2 ? '爆' : '沸',
    _clusterTime: c.earliestTime,
  }));
}

// ==================== 重大更新判断 ====================
function isMajorUpdate(cluster, existing) {
  const content = cluster.content || '';
  
  if (hasUrgentTime(content)) return true;
  
  const rules = [
    { key: 'hasMilitary', kw: '军事行动' },
    { key: 'hasStrike', kw: '打击方案' },
    { key: 'hasAction', kw: '行动开始' },
    { key: 'hasDeployment', kw: ['15000名', '导弹驱逐舰', '航母', '军机'] },
    { key: 'wasRejected', kw: '不可接受' },
    { key: 'wasBroken', kw: '违反停火' }
  ];

  for (const rule of rules) {
    const kws = Array.isArray(rule.kw) ? rule.kw : [rule.kw];
    if (kws.some(kw => content.includes(kw)) && !existing[rule.key]) return true;
  }

  if (content.includes('重启空袭') || content.includes('恢复打击')) return true;
  
  return false;
}

// ==================== LLM 分析 ====================
async function analyzeWithLLM(clusteredItems, oilPrice, holdingsData) {
  const holdingsStatusText = formatHoldingsForLLM(holdingsData);
  const flashText = clusteredItems.map(i => {
    const sizeTag = i._clusterSize > 1 ? ` [本簇共${i._clusterSize}条]` : '';
    const oilTag = ['原油能源', '伊朗局势', '中东战争'].includes(i._cluster) ? ' [原油核心]' : '';
    const urgentTag = hasUrgentTime(i.content) ? ' [时间敏感]' : '';
    return `[${i._clusterHot}]${sizeTag}${oilTag}${urgentTag} ${i._cluster}\n时间: ${i.time}\n来源: ${i.source || '金十'}\n${i.content.slice(0, 350)}...`;
  }).join('\n\n---\n\n');

  const macro = await fetchSinaMacro(); // 获取宏观锚定物
  const prompt = `你是一位宏观交易信号过滤专家。当前市场以原油价格为绝对核心锚定，所有分析必须围绕原油传导链展开，并结合实盘表现进行交叉验证。

【当前全球宏观锚定物实况】
- 布伦特原油: $${oilPrice?.price || '未知'} (${oilPrice?.change > 0 ? '+' : ''}${oilPrice?.change || 0}%)
- 原油(WTI): $${macro.crude.price} (高:${macro.crude.high} 低:${macro.crude.low})
- 黄金(COMEX): $${macro.gold.price} (高:${macro.gold.high} 低:${macro.gold.low})
- 美元指数(DXY): ${macro.dxy.price} (${macro.dxy.change > 0 ? '+' : ''}${macro.dxy.change}%)
- 离岸人民币(CNH): ${macro.usdcnh.price} (${macro.usdcnh.change > 0 ? '+' : ''}${macro.usdcnh.change}%)

【用户持仓】
${HOLDINGSTEXT}

 【⚠️ 当前ETF实盘状态（按涨跌幅排序）】
 ${holdingsStatusText}

 【核心判断标准】
 1. 盘面交叉验证（最重要）：新闻逻辑与盘面表现是否一致？
 2. 原油传导链：关注原油价格变动对产业链的影响。
 3. 时间敏感度：优先处理即将发生或正在发生的重大事件。
 4. 精准标的匹配：必须在用户持仓中的ETF中选。

【输入事件簇】
${flashText}

 【输出格式】（严格JSON）
 {
   "market_mood": "string",
   "noise_level": "integer",
   "oil_outlook": "string",
   "top_events": [
     {
       "cluster_name": "string",
       "value_score": "integer",
       "oil_impact": "string",
       "transmission_chain": "string",
       "action": "加仓/减仓/调仓/观望/埋伏",
       "target": "必须是用户持仓中的ETF之一的全称",
       "urgency": "string",
       "time_sensitive": "boolean",
       "holding_match": "string",
       "why": "核心价值逻辑",
       "market_validation": "盘面验证情况",
       "contrarian": "逆向/埋伏机会",
       "risk": "误读风险"
     }
   ],
   "daily_strategy": {
     "overall_position": "string",
     "core_logic": "核心逻辑",
     "oil_trade": "原油操作建议",
     "key_risks": ["string"],
     "watchlist": ["string"]
   }
 }`;
console.log(prompt);
  try {
    const { API_KEY, BASE_URL, MODEL } = CONFIG.LLM;
    const response = await axios.post(
      `${BASE_URL}/chat/completions`,
      {
        model: MODEL,
        messages: [
          { role: "system", content: "你是冷酷的原油宏观交易员。当前一切以油价为核心。对无价值信息要毫不留情。必须输出合法JSON。" },
          { role: "user", content: prompt }
        ],
        temperature: 0.1,
        max_tokens: 4096,
        response_format: { type: "json_object" }
      },
      {
        headers: { 'Authorization': `Bearer ${API_KEY}` },
        timeout: 120000
      }
    );

    const parsed = JSON.parse(response.data.choices[0].message.content);
    console.log('✅ LLM 分析完成');
    return parsed;
  } catch (error) {
    console.error('❌ LLM 失败:', error.message?.slice(0, 200));
    return { market_mood: '未知', noise_level: 0, top_events: [] };
  }
}

// ==================== 盘面格式化 ====================
function formatHoldingsForLLM(holdings) {
  if (!holdings || holdings.length === 0) {
    return '当前为非交易时段，无ETF实时盘面数据。请纯粹基于事件逻辑进行分析。';
  }
  return [...holdings].sort((a, b) => b.change - a.change).map(h => {
    const arrow = h.change > 0 ? '🔺' : (h.change < 0 ? '🔻' : '➖');
    return `${arrow} ${h.name}: 现价${h.price} (${h.change > 0 ? '+' : ''}${h.changeStr}%)`;
  }).join('\n');
}

// ==================== 企微推送 ====================
async function pushWechat(analysis, rawItems, oilPrice, holdingsData) {
  if (!CONFIG.WECHAT_WEBHOOK) {
    console.log('⚠️ 未配置 WECHAT_WEBHOOK');
    return;
  }

  const events = analysis.top_events || [];
  if (events.length === 0) {
    console.log('📭 无高价值信号，不推送');
    return;
  }

  const oilEmoji = oilPrice?.change > 0 ? '📈' : (oilPrice?.change < 0 ? '📉' : '➖');
  const sortedHoldings = [...holdingsData].sort((a,b) => a.change - b.change);
  const topGainer = sortedHoldings[sortedHoldings.length - 1];
  const topLoser = sortedHoldings[0];

  let markdown = `## ${oilEmoji} 金十快讯 [原油核心+盘面验证] <font color="warning">${analysis.market_mood}</font> 
  > 时间：${formatTime()} | 布伦特: **$${oilPrice?.price || '?'}** (${oilPrice?.change > 0 ? '+' : ''}${oilPrice?.change || 0}%)
  > 仓位建议：**${analysis.daily_strategy?.overall_position || '观望'}**
  > 原油展望：${analysis.oil_outlook || '无'}
  > 盘面特征：${topGainer ? `领涨<font color="info">${topGainer.name}(+${topGainer.changeStr}%)</font> | 领跌<font color="red">${topLoser.name}(${topLoser.changeStr}%)</font>` : '休市中'}
  --- 
  `;

  for (const event of events.slice(0, 3)) {
    const raw = rawItems.find(i => i._cluster === event.cluster_name);
    const scoreColor = event.value_score >= 8 ? 'red' : (event.value_score >= 6 ? 'warning' : 'info');
    const oilTag = event.oil_impact && event.oil_impact !== '无' ? '<font color="red">[原油]</font>' : '';
    const urgentTag = event.time_sensitive ? '<font color="red">[紧急]</font>' : '';

    markdown += `### ${oilTag}${urgentTag} <font color="${scoreColor}">【${event.urgency}】${event.action} ${event.target} (${event.value_score}分)</font>
**事件：** ${event.cluster_name}
**持仓匹配：** ${event.holding_match || '无'}
**逻辑：** ${event.why}
**盘面验证：** ${event.market_validation || '无'}

**原油影响：** ${event.oil_impact || '无'}
**传导链：** ${event.transmission_chain || '无'}
**逆向机会：** ${event.contrarian || '无'}
**误读风险：** ${event.risk || '无'}

${raw ? `> 原文：${raw.content.slice(0, 120)}...` : ''}
---
`;
  }

  if (analysis.daily_strategy?.oil_trade) {
    markdown += `\n### 🛢️ 原油操作\n${analysis.daily_strategy.oil_trade}\n`;
  }

  if (analysis.daily_strategy?.key_risks?.length > 0) {
    markdown += `\n### ⚠️ 警惕\n${analysis.daily_strategy.key_risks.map(r => `- ${r}`).join('\n')}\n`;
  }

  if (analysis.daily_strategy?.watchlist?.length > 0) {
    markdown += `\n### 👀 观察\n${analysis.daily_strategy.watchlist.join('、')}\n`;
  }

  try {
    await axios.post(CONFIG.WECHAT_WEBHOOK, { msgtype: 'markdown', markdown: { content: markdown } }, { timeout: 15000 });
    console.log('📲 企微推送成功');
  } catch (error) {
    console.error('❌ 企微推送失败:', error.message);
  }
}

// ==================== 状态更新逻辑 ====================
function updateStateAfterPush(state, toAnalyze) {
  for (const cluster of toAnalyze) {
    const existingIdx = state.pushedClusters?.findIndex(p => p.cluster === cluster._cluster);
    if (existingIdx >= 0) {
      const existing = state.pushedClusters[existingIdx];
      existing.pushCount++;
      existing.lastUpdateId = cluster.id;
      existing.lastUpdateTime = new Date().toISOString();
      if (hasUrgentTime(cluster.content)) existing.hadUrgent = true;
      if (cluster.content.includes('军事行动')) existing.hasMilitary = true;
    } else {
      state.pushedClusters = state.pushedClusters || [];
      state.pushedClusters.push({
        cluster: cluster._cluster,
        firstId: cluster.id,
        firstTime: new Date().toISOString(),
        lastUpdateId: cluster.id,
        lastUpdateTime: new Date().toISOString(),
        pushCount: 1,
        hotMax: cluster.hot === '爆' ? '爆' : '沸',
        hadUrgent: hasUrgentTime(cluster.content),
        hasMilitary: cluster.content.includes('军事行动'),
      });
    }
  }
}

// ==================== 工具 ====================
function formatTime() {
  return new Date().toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  });
}

// ==================== 运行 ====================
main().catch(err => {
  console.error('脚本异常:', err);
  process.exit(1);
});
