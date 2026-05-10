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
  hasUrgentTime,
  evaluateDataQuality
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
  let macro = null;
  if (toAnalyze.length > 0) {
    macro = await fetchSinaMacro();
    console.log(`🧠 送审 LLM: ${toAnalyze.length} 个事件簇`);
    const analysis = await analyzeWithLLM(toAnalyze, macro, holdingsData);
    if (analysis.d_state_compliance) {
      if (analysis.d_state_compliance.gold_short_recommended) {
        console.error('🚫 LLM违规推荐做空黄金，已强制剔除');
        // 从 top_events 中移除任何做空黄金的建议
        analysis.top_events = (analysis.top_events || []).filter(
          e => !(e.target?.includes('黄金ETF') && e.action === '减仓')
        );
      }
      if (analysis.d_state_compliance.oil_bottom_fishing_recommended) {
        console.error('🚫 LLM违规推荐抄底油气，已强制剔除');
        analysis.top_events = (analysis.top_events || []).filter(
          e => !(e.target?.includes('标普油气ETF') && (e.action === '加仓' || e.action === '埋伏'))
        );
      }
    }
    // 推送主模型分析结果
    await pushWechat(analysis, toAnalyze, macro, holdingsData);
    
    // 如果配置了对比模型，则运行第二次分析
    if (CONFIG.LLM.MODEL_COMPARE) {
      console.log(`🔍 运行对比分析 [${CONFIG.LLM.MODEL_COMPARE}]...`);
      const analysisCompare = await analyzeWithLLM(toAnalyze, macro, holdingsData, CONFIG.LLM.MODEL_COMPARE);
      
      // 推送对比简报到主 Webhook
      await pushWechatComparison(analysis, analysisCompare, toAnalyze, macro, holdingsData);
      
      // 推送对比模型的详细结果到对比 Webhook (默认同主 Webhook)
      await pushWechat(analysisCompare, toAnalyze, macro, holdingsData, CONFIG.WECHAT_WEBHOOK_COMPARE);
    }
    
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
  const params = JSON.stringify({ hot: ["爆", "沸", "热"], channel: [1, 5] });

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
        timeout: 30000
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
    _allItems: c.allItems,
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
export async function analyzeWithLLM(clusteredItems, macro, holdingsData, modelOverride = null) {
  const dataQuality = evaluateDataQuality(macro, holdingsData);
  
  const holdingsStatusText = formatHoldingsForLLM(holdingsData);
  const flashText = clusteredItems.map(i => {
    const sizeTag = i._clusterSize > 1 ? ` [本簇共${i._clusterSize}条]` : '';
    const oilTag = ['原油能源', '伊朗局势', '中东战争'].includes(i._cluster) ? ' [原油核心]' : '';
    const urgentTag = hasUrgentTime(i.content) ? ' [时间敏感]' : '';
    
    const contents = i._allItems 
      ? Array.from(new Set(i._allItems.map(item => item.content.trim())))
      : [i.content.trim()];
    
    const aggregatedContent = contents.map((c, idx) => contents.length > 1 ? `${idx + 1}. ${c}` : c).join('\n');
    
    return `[${i._clusterHot}]${sizeTag}${oilTag}${urgentTag} ${i._cluster}\n时间: ${i.time}\n内容:\n${aggregatedContent}`;
  }).join('\n\n---\n\n');

  const clockDesc = dataQuality.market_clock.is_a_stock_trading
    ? 'A股/港股盘中，ETF实时数据可用，可进行盘面交叉验证'
    : (dataQuality.market_clock.is_us_trading
        ? '美股活跃时段，ETF已收盘，仅能进行逻辑自洽检验'
        : '亚盘已收盘，所有ETF无实时数据，盘面验证自动降级为逻辑自洽检验');

  const hstechStatus = (dataQuality.market_clock.is_a_stock_trading || dataQuality.market_clock.is_hstech_extended)
    ? '盘中实时'
    : '已收盘静态数据（仅作宏观参考）';

  const prompt = `【角色定义】
你目前是宏观交易信号过滤引擎。你的首要任务不是"给出答案"，而是"诚实地评估数据能支撑什么结论"。
核心原则：宁可不交易，不可用残缺数据做决策。

## 第一部分：数据预检（必须优先执行）
### 1.1 当前数据快照
- 数据质量评估状态: ${JSON.stringify(dataQuality)}
- 当前市场时段: ${dataQuality.market_clock.beijing_time} 北京时间 | ${clockDesc}
- 恒科指数实时性: ${hstechStatus}
- 布伦特原油: $${macro.brent.price} (昨结算:${macro.brent.prevClose} 涨跌:${macro.brent.change}%)
- 纽约原油: $${macro.crude.price} (昨结算:${macro.crude.prevClose} 涨跌:${macro.crude.change}%)
- 黄金(COMEX): $${macro.gold.price} (昨结算:${macro.gold.prevClose} 涨跌:${macro.gold.change}%)
- 纳指期货(NQ): ${macro.nasdaq.price} (昨结算:${macro.nasdaq.prevClose} 涨跌:${macro.nasdaq.change}%)
- 日经225(NK): ${macro.nke.price} (昨结算:${macro.nke.prevClose} 涨跌:${macro.nke.change}%)
- 恒科指数(HSTECH): ${macro.hstech.price} (昨收:${macro.hstech.prevClose} 涨跌:${macro.hstech.change}%)
- 美元指数(DXY): ${macro.dxy.price} (昨收:${macro.dxy.prevClose} 涨跌:${macro.dxy.change}%)
- 离岸人民币(CNH): ${macro.usdcnh.price} (昨收:${macro.usdcnh.prevClose} 涨跌:${macro.usdcnh.change}%)

### 1.2 盘面实况 (ETF)
${holdingsStatusText}

## 第二部分：核心诊断逻辑
你必须严格遵守以下诊断步骤，并根据数据完整性决定是否激活：

### 2.1 盘面交叉验证
- 若存在盘面数据，验证新闻逻辑与盘面表现是否一致。
- 若无盘面数据，降级为"逻辑自洽性检验"。

### 2.2 原油-黄金相关性诊断（优先级最高）
- 步骤1：计算日内相关性方向（原油跌+黄金涨/平 = D状态）。
- 步骤2：D状态下的美元确认（需美元盘中走势，若无则标注缺失）。
- 步骤3：D状态下的风险资产情绪确认（需纳指/恒科表现）。

### 2.3 D状态专属规则（强制遵守）
- ❌ 严禁基于"协议达成"逻辑推荐做空黄金。
- ❌ 严禁基于"油价暴跌"逻辑推荐抄底油气ETF。
- ✅ 允许推荐：科技ETF（成本下降）、黄金ETF（独立支撑）、军工ETF（对冲风险）。

### 2.4 事件簇分析
- 1个事件：禁止创建多情景，仅单线推演。
- 2-3个事件：最多2个情景，含冲突检测。
- 4个以上：最多3个情景，优先级排序。

## 第三部分：持仓映射规则
- 必须在用户持仓中选：${HOLDINGSTEXT}
- 必须通过传导链检验：事件 → 宏观变量 → 行业/资产 → 对应ETF。

## 输入事件簇
${flashText}

请严格按以下 JSON 格式输出：
{
  "diagnostic_status": {
    "data_quality": "${dataQuality.data_quality}",
    "missing_items": ${JSON.stringify(dataQuality.missing_items)},
    "activated_steps": ${JSON.stringify(dataQuality.activated_steps)},
    "aborted_steps": ${JSON.stringify(dataQuality.aborted_steps)},
    "overall_confidence": "${dataQuality.overall_confidence}"
  },
  "correlation_diagnosis": {
    "oil_direction": "string",
    "gold_direction": "string",
    "correlation_state": "正相关/负相关/D状态/无法判断",
    "dollar_confirmation": "string",
    "risk_asset_confirmation": "string",
    "current_phase": "A/B/C/D/无法判断"
  },
  "market_mood": "string",
  "uncertainty_level": "高/中/低",
  "dominant_narrative": {
    "narrative": "string",
    "fragility": "string",
    "conflicting_signals": ["string"]
  },
  "scenarios": [
    {
      "scenario_name": "string",
      "generation_rule": "单事件推演/多事件推演",
      "probability_qualitative": "string",
      "assumptions": ["string"],
      "oil_path": "string",
      "affected_etfs": ["string"],
      "action_if_confirmed": "string",
      "trigger_to_watch": "string"
    }
  ],
  "top_events": [
    {
      "cluster_name": "string",
      "time_sensitivity_level": "紧急/中等/背景",
      "time_sensitive": "boolean",
      "value_score": "number",
      "oil_impact": "string",
      "transmission_chain": "string",
      "transmission_confidence": "强/中/弱",
      "action": "加仓/减仓/调仓/观望/埋伏/无法判断",
      "target": "string",
      "urgency": "即刻/本周/观察/中长期",
      "why": "string",
      "market_validation": "string",
      "risk": "string"
    }
  ],
  "daily_strategy": {
    "overall_position": "string",
    "max_position_confidence": "高/中/低/不可操作",
    "core_logic": "string",
    "pre_market_checklist": ["string"],
    "key_risks": ["string"],
    "do_not_touch": ["string"]
  },
  "d_state_compliance": {
    "gold_short_recommended": "boolean",
    "oil_bottom_fishing_recommended": "boolean",
    "allowed_recommendations_used": ["string"],
    "compliance_note": "string"
  }
}`;
  const targetModel = modelOverride || CONFIG.LLM.MODEL;
  console.log(`🤖 正在使用模型: ${targetModel}`);
  try {
    const { API_KEY, BASE_URL } = CONFIG.LLM;
    const response = await axios.post(
      `${BASE_URL}/chat/completions`,
      {
        model: targetModel,
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
    console.log(`✅ LLM [${targetModel}] 分析完成`);
    parsed._model = targetModel; // 注入模型名称
    return parsed;
  } catch (error) {
    console.error(`❌ LLM [${targetModel}] 失败:`, error.message?.slice(0, 200));
    return { market_mood: '未知', noise_level: 0, top_events: [], _model: targetModel };
  }
}

// ==================== 盘面格式化 ====================
function formatHoldingsForLLM(holdings) {
  if (!holdings || holdings.length === 0) {
    return '当前为非交易时段，无ETF实时盘面数据。"盘面交叉验证"改为"逻辑自洽性检验"（新闻之间是否矛盾？）。';
  }

  let output = '';
  for (const [cat, names] of Object.entries(HOLDINGSTEXT)) {
    const matched = holdings.filter(h => names.includes(h.name));
    if (matched.length > 0) {
      output += `\n【${cat}】\n`;
      output += matched.sort((a, b) => b.change - a.change).map(h => {
        const arrow = h.change > 0 ? '🔺' : (h.change < 0 ? '🔻' : '➖');
        return `${arrow} ${h.name}: ${h.change > 0 ? '+' : ''}${h.changeStr}%`;
      }).join(' | ');
      output += '\n';
    }
  }
  return output;
}

// ==================== 企微推送 ====================
export async function pushWechat(analysis, rawItems, macro, holdingsData, webhookOverride = null) {
  const targetWebhook = webhookOverride || CONFIG.WECHAT_WEBHOOK;
  if (!targetWebhook) {
    console.log('⚠️ 未配置 WECHAT_WEBHOOK');
    return;
  }

  const modelTag = analysis._model ? ` [${analysis._model.split('/').pop()}]` : '';

  const sendMsg = async (content, label) => {
    if (!content || content.trim() === '') return;
    try {
      const res = await axios.post(targetWebhook, { msgtype: 'markdown', markdown: { content } }, { timeout: 30000 });
      if (res.data.errcode === 0) {
        console.log(`📲 [${label}${modelTag}] 推送成功`);
      } else {
        console.error(`❌ [${label}${modelTag}] 推送失败:`, res.data.errmsg);
      }
    } catch (error) {
      console.error(`❌ [${label}${modelTag}] 网络失败:`, error.message);
    }
  };

  const diag = analysis.diagnostic_status || {};
  const corr = analysis.correlation_diagnosis || {};
  const events = analysis.top_events || [];
  const scenarios = analysis.scenarios || [];
  const narrative = analysis.dominant_narrative || {};
  const strategy = analysis.daily_strategy || {};
  const compliance = analysis.d_state_compliance || {};

  const moodColor = analysis.uncertainty_level === '高' ? 'warning' : (analysis.uncertainty_level === '低' ? 'info' : 'comment');
  const oilEmoji = macro?.change > 0 ? '📈' : (macro?.change < 0 ? '📉' : '➖');

  // --- 阶段 1: 数据预检与宏观诊断 ---
  let p1 = `## ${oilEmoji} 宏观信号过滤引擎${modelTag}
> 数据质量：**${diag.data_quality || '未知'}** (置信度:${diag.overall_confidence || '低'})
> 诊断状态：<font color="${moodColor}">${analysis.market_mood || '未明'}</font> [${analysis.uncertainty_level || '中'}不确定性]
---
### 📊 核心相关性诊断
- **当前阶段：** <font color="warning">状态 ${corr.current_phase || '未知'}</font> (${corr.correlation_state || '无法判断'})
- **盘面确认：** 美元:${corr.dollar_confirmation || '无'} | 风险资产:${corr.risk_asset_confirmation || '无'}
- **主导叙事：** ${narrative.narrative || '未明'}
- **叙事脆弱点：** ${narrative.fragility || '无'}
---
`;
  if (scenarios.length > 0) {
    p1 += `### 🎭 情景推演 (Scenarios)\n`;
    for (const s of scenarios) {
      p1 += `> **${s.scenario_name}** (${s.probability_qualitative})\n> 路径: ${s.oil_path || '无'}\n> 触发: <font color="comment">${s.trigger_to_watch}</font>\n\n`;
    }
  }
  await sendMsg(p1, '摘要与诊断');

  // --- 阶段 2: 重点事件与持仓映射 ---
  if (events.length > 0) {
    let p2 = `### 🔍 重点事件分析\n`;
    for (const event of events.slice(0, 3)) {
      const scoreColor = event.value_score >= 8 ? 'warning' : (event.value_score >= 6 ? 'warning' : 'info');
      const oilTag = event.oil_impact && event.oil_impact !== '无' ? '<font color="warning">[原油]</font>' : '';
      const urgentTag = event.time_sensitive ? '<font color="warning">[紧急]</font>' : '';

      p2 += `#### ${oilTag}${urgentTag} <font color="${scoreColor}">${event.action} ${event.target}</font>
**事件：** ${event.cluster_name} (${event.value_score}分)
**逻辑：** ${event.why}
**链条：** ${event.transmission_chain}
**验证：** ${event.market_validation || '未验证'}
\n`;
    }
    await sendMsg(p2, '事件分析');
  }

  // --- 阶段 3: 每日策略与合规 ---
  let p3 = `### 📅 交易策略 [${strategy.max_position_confidence || '低'}置信度]
> **总仓位：${strategy.overall_position || '观望'}**
> **核心逻辑：** ${strategy.core_logic || '无'}
> **禁入标的：** <font color="comment">${strategy.do_not_touch?.join(' | ') || '无'}</font>
> **开盘清单：** ${strategy.pre_market_checklist?.join(' | ') || '无'}
---
**D状态合规：** ${compliance.compliance_note || '已通过逻辑检查'}
**数据缺失：** <font color="comment">${diag.missing_items?.join(' | ') || '无'}</font>`;
  await sendMsg(p3, '每日策略');
}

// ==================== 企微推送对比版 ====================
export async function pushWechatComparison(analysisA, analysisB, rawItems, macro, holdingsData) {
  if (!CONFIG.WECHAT_WEBHOOK) {
    console.log('⚠️ 未配置 WECHAT_WEBHOOK');
    return;
  }

  const sendMsg = async (content, label) => {
    if (!content || content.trim() === '') return;
    try {
      const res = await axios.post(CONFIG.WECHAT_WEBHOOK, { msgtype: 'markdown', markdown: { content } }, { timeout: 30000 });
      if (res.data.errcode === 0) {
        console.log(`📲 [${label}] 推送成功`);
      } else {
        console.error(`❌ [${label}] 推送失败:`, res.data.errmsg);
      }
    } catch (error) {
      console.error(`❌ [${label}] 网络失败:`, error.message);
    }
  };

  const oilEmoji = macro?.crude?.change > 0 ? '📈' : (macro?.crude?.change < 0 ? '📉' : '➖');
  const modelA = analysisA._model?.split('/').pop() || 'Model A';
  const modelB = analysisB._model?.split('/').pop() || 'Model B';

  let content = `## 🤖 LLM 对比分析报告 ${oilEmoji}
> 时间：${formatTime()} | 布伦特: **$${macro?.crude?.price || '?'}** (${macro?.crude?.change > 0 ? '+' : ''}${macro?.crude?.change || 0}%)
---
| 维度 | **${modelA}** | **${modelB}** |
| :--- | :--- | :--- |
| **质量/状态** | ${analysisA.diagnostic_status?.data_quality} / ${analysisA.correlation_diagnosis?.current_phase} | ${analysisB.diagnostic_status?.data_quality} / ${analysisB.correlation_diagnosis?.current_phase} |
| **情绪** | ${analysisA.market_mood} | ${analysisB.market_mood} |
| **不确定性** | ${analysisA.uncertainty_level} | ${analysisB.uncertainty_level} |
| **主导叙事** | ${analysisA.dominant_narrative?.narrative?.slice(0, 15)}... | ${analysisB.dominant_narrative?.narrative?.slice(0, 15)}... |

### 🎯 核心操作建议
- **${modelA}**: <font color="info">${analysisA.top_events?.[0]?.action || '无'}</font> ${analysisA.top_events?.[0]?.target || ''}
> 理由: ${analysisA.top_events?.[0]?.why?.slice(0, 50) || '无'}
- **${modelB}**: <font color="warning">${analysisB.top_events?.[0]?.action || '无'}</font> ${analysisB.top_events?.[0]?.target || ''}
> 理由: ${analysisB.top_events?.[0]?.why?.slice(0, 50) || '无'}

---
### 📅 策略对比
- **${modelA}**: ${analysisA.daily_strategy?.overall_position} | ${analysisA.daily_strategy?.core_logic?.slice(0, 40)}...
- **${modelB}**: ${analysisB.daily_strategy?.overall_position} | ${analysisB.daily_strategy?.core_logic?.slice(0, 40)}...

---
*注：本报告由双模型自动对比生成，仅供参考。*`;

  await sendMsg(content, '双模型对比');
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
