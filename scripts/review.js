/**
 * A股盘前/午盘/盘后复盘脚本 (review.js)
 * 
 * 功能：
 * - 盘前：基于已推送事件簇 + 隔夜收盘数据，更新情景推演，给出开盘锚点
 * - 午盘：基于上午事件 + 盘面表现，更新策略，给出下午交易建议
 * - 盘后：基于今日推送事件簇 + ETF实际涨跌，验证逻辑，修正框架
 * - 支持双模型对比分析（主模型 + CONFIG.LLM.MODEL_COMPARE）
 * - 新增：宏观历史趋势分析、ETF昨日收盘数据复用
 * 
 * 用法：
 *   node scripts/review.js premarket   # 强制盘前
 *   node scripts/review.js lunchbreak  # 强制午盘
 *   node scripts/review.js postmarket  # 强制盘后
 *   node scripts/review.js             # 自动判断
 * 
 * 依赖：
 *   - fetchSinaMacro()   获取全球宏观数据
 *   - getMarketData()    获取ETF实时/收盘行情
 *   - loadState()        读取pushedClusters
 *   - macro-history.js   宏观历史存储与读取
 */
import { readFileSync, existsSync } from 'fs';
import axios from 'axios';
import { CONFIG } from './config.js';
import { fetchSinaMacro } from './macro-layer.js';
import { getMarketData } from './data-layer.js';
import { loadState, saveETFClose } from './storage.js';
import { 
  addSignalWithValidation, 
  updateSignals, 
  generateTrackingReport,
  generateProTraderReport,
  getHistory,
  getActiveSignals
} from './tracker.js';
import { loadMacroHistory, appendMacroHistory } from './macro-history.js';
import { getCoreSkill, getPremarketSkill, getMidmarketSkill, getPostmarketSkill, getTrendContext } from './const/prompt.js';

// ==================== 时间工具 ====================
function formatTime() {
  return new Date().toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  });
}

function getBeijingTime() {
  const now = new Date();
  const hour = (now.getUTCHours() + 8) % 24;
  const minute = now.getUTCMinutes();
  return { hour, minute, totalMinutes: hour * 60 + minute };
}

// ==================== 模式判断 ====================
function getReviewType() {
  const mode = process.argv[2] || 'auto';
  if (['premarket', 'lunchbreak', 'postmarket'].includes(mode)) return mode;
  
  const { totalMinutes } = getBeijingTime();
  if (totalMinutes >= 480 && totalMinutes < 570) return 'premarket';
  if (totalMinutes >= 690 && totalMinutes < 780) return 'lunchbreak';
  if (totalMinutes >= 900 && totalMinutes < 960) return 'postmarket';
  return 'premarket';
}

// ==================== 获取已推送事件簇 ====================
function getRecentPushedClusters(hours = 24) {
  const state = loadState();
  const clusters = state.pushedClusters || [];
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
  
  return clusters
    .filter(c => new Date(c.lastUpdateTime) > cutoff)
    .sort((a, b) => new Date(a.lastUpdateTime) - new Date(b.lastUpdateTime));
}

function getClusterContents(clusters) {
  const rawPath = CONFIG.PATHS.RAW;
  if (!existsSync(rawPath)) return {};
  const raw = JSON.parse(readFileSync(rawPath, 'utf-8'));
  const allItems = raw.items || [];
  const contentMap = {};
  for (const cluster of clusters) {
    const latestItem = allItems.find(item => item.id === cluster.lastUpdateId);
    if (latestItem) {
      contentMap[cluster.cluster] = latestItem.content || '';
    }
  }
  return contentMap;
}

// ==================== 格式化宏观快照（集成趋势） ====================
function formatMacroSnapshot(macro, history = []) {
  const lines = [];

  // 辅助格式化函数，自动添加趋势上下文
  const add = (label, symbol, data) => {
    // 如果数据无效则跳过
    if (!data || typeof data.price !== 'number' || isNaN(data.price)) return;
    const change = typeof data.change === 'number' ? data.change : parseFloat(data.change);
    const changeStr = !isNaN(change) ? (change > 0 ? `+${change.toFixed(2)}` : change.toFixed(2)) : '0.00';
    const context = getTrendContext(
      symbol,
      data.price,
      data.prevClose,
      data.high,
      data.low,
      data.open || data.prevClose,
      history
    );
    lines.push(`- ${label}: $${data.price} (${changeStr}%)  [${context}]`);
  };

  // 非美元计价的特殊处理
  const addNonDollar = (label, data, unit = '', isPercent = false) => {
    if (!data || typeof data.price !== 'number' || isNaN(data.price)) return;
    const price = data.price;
    const change = typeof data.change === 'number' ? data.change : parseFloat(data.change);
    const changeStr = !isNaN(change) ? (change > 0 ? `+${change.toFixed(2)}` : change.toFixed(2)) : '0.00';
    // 如果已经是百分比数值（如美债收益率），则直接显示，不另加百分号
    const prefix = isPercent ? '' : '$';
    lines.push(`- ${label}: ${prefix}${price}${unit} (${changeStr}%)`);
  };

  // 商品/指数（美元计价）
  add('布伦特原油', 'brent', macro.brent);
  add('纽约原油', 'wti', macro.crude);
  add('COMEX黄金', 'gold', macro.gold);
  add('COMEX白银', 'silver', macro.silver);
  add('COMEX铜', 'copper', macro.copper);

  // 比值
  const ratios = [];
  if (macro.copperOilRatio) ratios.push(`铜油比: ${macro.copperOilRatio}`);
  if (macro.goldSilverRatio) ratios.push(`金银比: ${macro.goldSilverRatio}`);
  if (macro.gldRatio) ratios.push(`金油比: ${macro.gldRatio}`);
  if (macro.copperGoldRatio) ratios.push(`铜金比: ${macro.copperGoldRatio}`);
  if (ratios.length) lines.push(`- ${ratios.join('  ')}`);

  // 股指期货
  add('纳指指数期货', 'nasdaq', macro.nasdaq);
  add('日经225指数期货', 'nke', macro.nke);

  // 恒生科技指数（可能无趋势上下文）
  if (macro.hstech?.price) {
    const hs = macro.hstech;
    const change = typeof hs.change === 'number' ? hs.change : parseFloat(hs.change);
    const changeStr = !isNaN(change) ? (change > 0 ? `+${change.toFixed(2)}` : change.toFixed(2)) : '0.00';
    lines.push(`- 恒生科技指数: ${hs.price} (${changeStr}%)`);
  }

  add('美元指数', 'dxy', macro.dxy);

  // 离岸人民币（非美元）
  if (macro.usdcnh?.price) {
    const cnh = macro.usdcnh;
    const change = typeof cnh.change === 'number' ? cnh.change : parseFloat(cnh.change);
    const changeStr = !isNaN(change) ? (change > 0 ? `+${change.toFixed(2)}` : change.toFixed(2)) : '0.00';
    lines.push(`- 离岸人民币: ${cnh.price} (${changeStr}%)`);
  }

  // 美10年期国债收益率（百分比，不显示$）
  addNonDollar('美10年期债收益率', macro.us10yt, '%', true);

  // VIX期货
  if (macro.vix?.price) {
    addNonDollar('VIX期货', macro.vix);
  }

  // GLD价格
  if (macro.gld?.price) {
    addNonDollar('GLD价格', macro.gld);
  }

  return lines.join('\n');
}

// ==================== 格式化事件簇列表 ====================
function formatClusterList(clusters, contentMap = {}) {
  if (!clusters.length) return '暂无事件簇。';
  
  const lines = [];
  clusters.forEach((c, idx) => {
    const urgentTag = c.hadUrgent ? '[⏰时间敏感]' : '';
    const hotTag = c.hotMax === '爆' ? '🔴' : '🟠';
    lines.push(`${idx + 1}. ${hotTag} ${urgentTag} **${c.cluster}** (更新${c.pushCount}次，最近: ${new Date(new Date(c.lastUpdateTime).getTime() + 8*3600*1000).toISOString().replace('Z','')})`);
    // 添加原文内容
    const content = contentMap[c.cluster];
    if (content) {
      lines.push(`   > ${content}`);
    }
  });
  return lines.join('\n');
}

// ==================== 格式化ETF行情 ====================
function formatETFPerformance(holdings) {
  if (!holdings || !holdings.length) return '无ETF数据（非交易时段）。';
  
  const sorted = [...holdings].sort((a, b) => b.change - a.change);
  const top5 = sorted.slice(0, 5).map(h => `🔺 ${h.name} +${h.changeStr}%`);
  const bottom5 = sorted.slice(-5).map(h => `🔻 ${h.name} ${h.changeStr}%`);
  return `**领涨**：${top5.join(' | ')}\n**领跌**：${bottom5.join(' | ')}`;
}

// ==================== LLM 调用封装 ====================
async function callLLM(prompt, modelOverride = null) {
  const targetModel = modelOverride || CONFIG.LLM.MODEL;
  try {
    const { API_KEY, BASE_URL } = CONFIG.LLM;
    const response = await axios.post(
      `${BASE_URL}/chat/completions`,
      {
        model: targetModel,
        messages: [
          { role: "system", content: "你是A股宏观策略复盘专家，输出简洁、专业的Markdown格式。必须基于给定数据推理，不编造信息。" },
          { role: "user", content: prompt }
        ],
        temperature: 0.3,
        max_tokens: 4096,
        response_format: { type: "text" }
      },
      {
        headers: { 'Authorization': `Bearer ${API_KEY}` },
        timeout: 1000000
      }
    );
    return response.data.choices[0].message.content;
  } catch (error) {
    console.error(`❌ LLM [${targetModel}] 调用失败:`, error.message);
    return `LLM分析暂时不可用，请稍后重试。`;
  }
}

// ==================== 企业微信推送（支持自动分批） ====================
function truncateToByteLength(str, maxByteLen) {
  let buf = Buffer.from(str, 'utf8');
  if (buf.length <= maxByteLen) return str;
  let truncated = buf.slice(0, maxByteLen).toString('utf8');
  while (Buffer.byteLength(truncated, 'utf8') > maxByteLen) {
    truncated = truncated.slice(0, -1);
  }
  return truncated;
}

const MAX_CONTENT_BYTES = 4000;

async function pushWechatReview(title, content, webhookOverride = null) {
  const webhook = webhookOverride || CONFIG.WECHAT_WEBHOOK_REVIEW;
  if (!webhook) {
    console.log('⚠️ 未配置推送 Webhook，跳过推送');
    return;
  }

  const makeHeader = (t) => `## ${t}\n> 生成时间：${formatTime()} | 模式：${process.argv[2] || '自动'}\n---\n`;
  const fullMarkdown = makeHeader(title) + content;

  if (Buffer.byteLength(fullMarkdown, 'utf8') <= MAX_CONTENT_BYTES) {
    try {
      const res = await axios.post(webhook, {
        msgtype: 'markdown',
        markdown: { content: fullMarkdown }
      }, { timeout: 30000 });
      if (res.data.errcode === 0) {
      console.log(`📲 [${title}] 推送成功`);
      } else {
        console.error(`❌ [${title}] 推送失败:`, res.data.errmsg);
      }
    } catch (error) {
      console.error(`❌ [${title}] 网络失败:`, error.message);
    }
    return;
  }

  // 分批逻辑
  let remaining = content;
  let batchIndex = 0;
  while (remaining.length > 0) {
    batchIndex++;
    const batchTitle = `${title} (${batchIndex}/?)`;
    const header = makeHeader(batchTitle);
    const headerBytes = Buffer.byteLength(header, 'utf8');
    const maxContentBytes = MAX_CONTENT_BYTES - headerBytes - 20;
    let batchContent = truncateToByteLength(remaining, maxContentBytes);
    
    const lastParaEnd = batchContent.lastIndexOf('\n\n');
    if (lastParaEnd > 0 && lastParaEnd > batchContent.length * 0.5) {
      batchContent = batchContent.slice(0, lastParaEnd);
    }

    const batchMarkdown = header + batchContent + (batchIndex > 1 ? '\n\n...(续)' : '');
    try {
      const res = await axios.post(webhook, {
        msgtype: 'markdown',
        markdown: { content: batchMarkdown }
      }, { timeout: 30000 });
      if (res.data.errcode === 0) {
        console.log(`📲 [${title} (${batchIndex})] 推送成功`);
      } else {
        console.error(`❌ [${title} (${batchIndex})] 推送失败:`, res.data.errmsg);
      }
    } catch (error) {
      console.error(`❌ [${title} (${batchIndex})] 网络失败:`, error.message);
    }

    remaining = remaining.slice(batchContent.length).trim();
  }
}

// ==================== 盘前/午盘/盘后 Prompt 构建（集成趋势数据） ====================
function buildPremarketPrompt(clusters, macro, contentMap, history) {
  const clusterText = formatClusterList(clusters, contentMap);
  const macroText = formatMacroSnapshot(macro, history);
  const skillCore = getCoreSkill();      // 注意：getCoreSkill 需要从 prompt.js 导入，如果没有请定义
  const skillPremarket = getPremarketSkill();

  // 尝试加载昨日ETF收盘数据
  let yesterdayCloseText = '';
  const yesterdayClose = loadETFClose();
  if (yesterdayClose) {
    const topHoldings = yesterdayClose.holdings.slice(0, 5).map(h => `${h.name} ${h.changeStr}%`).join('，');
    yesterdayCloseText = `\n昨日收盘ETF参考：${topHoldings}`;
  }

  return `【角色定义】
你是宏观交易策略复盘与决策引擎。当前时间为北京时间${formatTime()}，A股即将开盘。

## 隔夜事件链（最近24小时已推送的事件簇）
${clusterText}

## 当前全球宏观锚定物
${macroText}
${yesterdayCloseText}

${skillCore}
${skillPremarket}

请用简练的Markdown输出，包含 emoji 增强可读性。`;
}

function buildLunchbreakPrompt(clusters, macro, etfPerformance, contentMap, history) {
  const clusterText = formatClusterList(clusters, contentMap);
  const macroText = formatMacroSnapshot(macro, history);
  const etfText = formatETFPerformance(etfPerformance);
  const skillCore = getCoreSkill();
  const skillMidmarket = getMidmarketSkill();

  return `【角色定义】
你是宏观交易策略午盘复盘与决策引擎。当前时间为北京时间${formatTime()}，A股上午收盘，下午即将开盘。

## 上午事件链（最近6小时已推送的事件簇）
${clusterText}

## 当前全球宏观锚定物
${macroText}

## 上午ETF实际表现
${etfText}

${skillCore}
${skillMidmarket}

请用简练的Markdown输出，包含 emoji 增强可读性。`;
}

function buildPostmarketPrompt(clusters, macro, etfPerformance, contentMap, history) {
  const clusterText = formatClusterList(clusters, contentMap);
  const macroText = formatMacroSnapshot(macro, history);
  const etfText = formatETFPerformance(etfPerformance);
  const skillCore = getCoreSkill();
  const skillPostmarket = getPostmarketSkill();

  return `【角色定义】
你是宏观交易信号复盘专员。当前时间为北京时间${formatTime()}，A股已收盘。

## 今日已推送事件簇
${clusterText}

## 当前全球宏观锚定物
${macroText}

## 今日ETF实际表现
${etfText}

${skillCore}
${skillPostmarket}

请用简练的Markdown输出，必须体现复盘性质（逐条比对、验证逻辑），而非泛泛总结。`;
}

// ==================== 主入口 ====================
async function main() {
  const reviewType = getReviewType();
  const isPremarket = reviewType === 'premarket';
  const isLunchbreak = reviewType === 'lunchbreak';
  const isPostmarket = reviewType === 'postmarket';
  
  let title;
  if (isPremarket) title = '📅 A股盘前策略';
  else if (isLunchbreak) title = '☀️ A股午盘策略';
  else title = '📊 A股盘后复盘';

  console.log(`\n[${formatTime()}] 🚀 ${title}启动`);

  // 1. 拉取宏观数据并存入历史
  console.log('📊 拉取宏观数据...');
  const macro = await fetchSinaMacro();
  appendMacroHistory(macro);          // 存储到历史文件
  const macroHistory = loadMacroHistory(); // 加载全部宏观历史（用于趋势计算）

  // 2. 拉取已推送事件簇
  const hours = isPremarket ? 24 : (isLunchbreak ? 6 : 12);
  const clusters = getRecentPushedClusters(hours);
  console.log(`📋 获取到 ${clusters.length} 个事件簇`);
  const contentMap = getClusterContents(clusters);

  // 3. ETF数据（午盘/盘后需要）
  let etfHoldings = [];
  if (!isPremarket) {
    try {
      console.log('📈 拉取ETF行情数据...');
      const marketData = await getMarketData(true);
      etfHoldings = marketData.holdings || [];
      console.log(`   获取到 ${etfHoldings.length} 个ETF行情`);
      // 盘后保存收盘数据
      if (isPostmarket && etfHoldings.length > 0) {
        // 校验1：当前北京时间是否在收盘窗口（15:00-17:00）
        const { hour, minute } = getBeijingTime();
        const totalMinutes = hour * 60 + minute;
        const isCloseWindow = totalMinutes >= 900 && totalMinutes < 1020; // 15:00-17:00
        
        // 校验2：ETF数据不能全为零或异常
        const validCount = etfHoldings.filter(h => h.price > 0 && h.changeStr !== undefined).length;
        const isValidData = validCount > etfHoldings.length * 0.8; // 至少80%的ETF有有效数据

        if (isCloseWindow && isValidData) {
          saveETFClose(etfHoldings);
        } else {
          console.log(`⚠️ ETF收盘数据未保存：收盘窗口=${isCloseWindow}，数据有效率=${(validCount/etfHoldings.length*100).toFixed(0)}%`);
        }
      }
    } catch (e) {
      console.log('⚠️ ETF数据获取失败');
    }
  }

  // 4. 构建 Prompt（传入 history）
  let prompt;
  if (isPremarket) {
    prompt = buildPremarketPrompt(clusters, macro, contentMap, history);
  } else if (isLunchbreak) {
    prompt = buildLunchbreakPrompt(clusters, macro, etfHoldings, contentMap, history);
  } else {
    prompt = buildPostmarketPrompt(clusters, macro, etfHoldings, contentMap, history);
  }
  // console.log(prompt);
  // return;
  // 5. 主模型分析
  const mainModel = CONFIG.LLM.MODEL;
  console.log(`🤖 主模型 [${mainModel}] 分析中...`);
  const mainAnalysis = await callLLM(prompt);
  await pushWechatReview(title, `### 主模型 [${mainModel.split('/').pop()}]\n${mainAnalysis}`);

  // 6. 对比模型分析
  if (CONFIG.LLM.MODEL_COMPARE) {
    const compareModel = CONFIG.LLM.MODEL_COMPARE;
    console.log(`🔍 对比模型 [${compareModel}] 分析中...`);
    const compareAnalysis = await callLLM(prompt, compareModel);
    const compareTitle = `${title} (对比模型)`;
    await pushWechatReview(
      compareTitle,
      `### 对比模型 [${compareModel.split('/').pop()}]\n${compareAnalysis}`,
      CONFIG.WECHAT_WEBHOOK_REVIEW_COMPARE
    );
  }

  // 7. 解析交易信号并保存
  console.log('🔍 解析交易信号...');
  const marketData = await getMarketData(true);
  const signals = parseSignalsFromAnalysis(mainAnalysis, reviewType);
  for (const signal of signals) {
    const result = addSignalWithValidation(signal, marketData);
    if (result.validation.passed) {
      const gradeEmoji = result.techCheck.grade === 'A' ? '🌟' : result.techCheck.grade === 'B' ? '✨' : result.techCheck.grade === 'C' ? '⚠️' : '❌';
      console.log(`   ✅ ${gradeEmoji} ${signal.etfName} (评分:${result.techCheck.score}/${result.techCheck.grade})`);
      if (result.validation.warnings.length > 0) {
        console.log(`      ⚠️ ${result.validation.warnings.join(', ')}`);
      }
    } else {
      console.log(`   ❌ ${signal.etfName} 被拒绝: ${result.validation.reasons.join(', ')}`);
    }
  }

  // 8. 更新现有信号状态
  console.log('📈 更新信号状态...');
  const result = updateSignals(marketData);
  const { alerts } = result;

  if (alerts.entries.length > 0 || alerts.exits.length > 0) {
    console.log('   🎯 发现交易信号!');
    for (const entry of alerts.entries) {
      console.log(`      🚀 买入: ${entry.message}`);
    }
    for (const exit of alerts.exits) {
      console.log(`      💰 卖出: ${exit.message}`);
    }
  }

  // 9. 生成并推送报告
  console.log('📊 生成专业交易报告...');
  const activeSignals = getActiveSignals();
  const history = getHistory();
  let proReport = generateProTraderReport(activeSignals, history);
  
  if (alerts.entries.length > 0 || alerts.exits.length > 0) {
    let alertSection = '## 🎯 交易信号提醒\n\n';
    
    if (alerts.entries.length > 0) {
      alertSection += '### 🚀 买入信号\n';
      for (const alert of alerts.entries) {
        const s = alert.signal;
        alertSection += `**${s.etfName}** (${s.direction === 'long' ? '做多' : '做空'})\n`;
        alertSection += `- 入场价：${alert.currentPrice}\n`;
        alertSection += `- 止损：${s.stopLoss}\n`;
        alertSection += `- 止盈：${s.takeProfit}\n`;
        if (s.positionSize && s.positionSize.positionValue > 0) {
          alertSection += `- 建议仓位：¥${s.positionSize.positionValue.toLocaleString()}\n`;
        }
        alertSection += '\n';
      }
    }
    
    if (alerts.exits.length > 0) {
      alertSection += '### 💰 卖出信号\n';
      for (const alert of alerts.exits) {
        const s = alert.signal;
        const profitStr = alert.profit ? `${alert.profit > 0 ? '+' : ''}${alert.profit.toFixed(2)}%` : '';
        alertSection += `**${s.etfName}** (${s.direction === 'long' ? '做多' : '做空'})\n`;
        alertSection += `- 出场价：${alert.currentPrice}\n`;
        alertSection += `- 盈亏：${profitStr}\n`;
        alertSection += `- 原因：${s.exits[s.exits.length - 1]?.reason || ''}\n\n`;
      }
    }
    
    proReport = alertSection + '\n---\n' + proReport;
  }
  
  await pushWechatReview('🎯 专业交易员报告', proReport);

  console.log(`[${formatTime()}] ✅ ${title}完成\n`);
}

// ==================== 交易信号解析 ====================
function parseSignalsFromAnalysis(analysis, reviewType) {
  const signals = [];
  
  try {
    const lines = analysis.split('\n');
    let currentSignal = null;
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      const etfMatch = trimmed.match(/(纳斯达克|纳指|科创50|创业板|沪深300|上证50|中证500|黄金|白银|原油|油气|军工|半导体|芯片|科技|消费|医药|地产|金融|券商|银行|保险)ETF/i);
      if (etfMatch && !trimmed.includes('---') && !trimmed.includes('##')) {
        const etfName = etfMatch[1] + 'ETF';
        
        const priceMatch = trimmed.match(/(\d+\.?\d*)/g);
        if (priceMatch && priceMatch.length >= 2) {
          let direction = 'long';
          if (trimmed.includes('做空') || trimmed.includes('看空') || trimmed.includes('卖出')) {
            direction = 'short';
          }
          
          currentSignal = {
            etfName,
            direction,
            trend: trimmed.includes('上涨') || trimmed.includes('看涨') || trimmed.includes('多头') ? 'up' : 
                   trimmed.includes('下跌') || trimmed.includes('看空') || trimmed.includes('空头') ? 'down' : 'neutral',
            support: null,
            resistance: null,
            entryCondition: { type: 'price', targetPrice: null },
            stopLoss: null,
            takeProfit: null,
            reasoning: trimmed,
            source: reviewType
          };
          
          const prices = priceMatch.map(p => parseFloat(p)).filter(p => p > 0);
          if (prices.length >= 2) {
            prices.sort((a, b) => a - b);
            currentSignal.support = prices[0].toString();
            currentSignal.resistance = prices[prices.length - 1].toString();
            
            if (currentSignal.direction === 'long') {
              currentSignal.entryCondition.targetPrice = prices[0].toString();
              currentSignal.stopLoss = (prices[0] * 0.97).toFixed(3);
              currentSignal.takeProfit = prices[prices.length - 1].toString();
            } else {
              currentSignal.entryCondition.targetPrice = prices[prices.length - 1].toString();
              currentSignal.stopLoss = (prices[prices.length - 1] * 1.03).toFixed(3);
              currentSignal.takeProfit = prices[0].toString();
            }
          }
          
          if (currentSignal.entryCondition.targetPrice) {
            signals.push(currentSignal);
          }
        }
      }
    }
  } catch (e) {
    console.error('解析交易信号失败:', e.message);
  }
  
  return signals;
}

main().catch(err => {
  console.error('复盘脚本异常:', err);
  process.exit(1);
});