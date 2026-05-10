/**
 * A股盘前/盘后复盘脚本 (review.js)
 * 
 * 功能：
 * - 盘前：基于已推送事件簇 + 隔夜收盘数据，更新情景推演，给出开盘锚点
 * - 盘后：基于今日推送事件簇 + ETF实际涨跌，验证逻辑，修正框架
 * - 支持双模型对比分析（主模型 + CONFIG.LLM.MODEL_COMPARE）
 * 
 * 用法：
 *   node scripts/review.js premarket   # 强制盘前
 *   node scripts/review.js postmarket  # 强制盘后
 *   node scripts/review.js             # 自动判断（北京时间8:00-9:30盘前，15:00-16:00盘后）
 * 
 * 依赖：
 *   - fetchSinaMacro()   获取全球宏观数据
 *   - getMarketData()    获取ETF实时/收盘行情
 *   - loadState()        读取pushedClusters
 */
import { readFileSync, existsSync } from 'fs';
import axios from 'axios';
import { CONFIG } from './config.js';
import { fetchSinaMacro } from './macro-layer.js';
import { getMarketData } from './data-layer.js';
import { loadState } from './storage.js';

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
  if (mode === 'premarket' || mode === 'postmarket') return mode;
  
  const { totalMinutes } = getBeijingTime();
  // 盘前窗口：8:00 - 9:30
  if (totalMinutes >= 480 && totalMinutes < 570) return 'premarket';
  // 盘后窗口：15:00 - 16:00
  if (totalMinutes >= 900 && totalMinutes < 960) return 'postmarket';
  // 默认盘前（如果不在窗口内，一般是手动触发）
  return 'premarket';
}

// ==================== 获取已推送事件簇 ====================
function getRecentPushedClusters(hours = 24) {
  const state = loadState();
  const clusters = state.pushedClusters || [];
  const now = new Date();
  const cutoff = new Date(now.getTime() - hours * 60 * 60 * 1000);
  
  return clusters
    .filter(c => new Date(c.lastUpdateTime) > cutoff)
    .sort((a, b) => new Date(a.lastUpdateTime) - new Date(b.lastUpdateTime));
}

function getClusterContents(clusters) {
  const rawPath = CONFIG.PATHS.RAW;
  if (!existsSync(rawPath)) return {};
  const raw = JSON.parse(readFileSync(rawPath, 'utf-8'));
  const allItems = raw.items || [];  // 假设存储结构是 { items: [...] }
  
  const contentMap = {};
  for (const cluster of clusters) {
    // 用 lastUpdateId 匹配最新快讯
    const latestItem = allItems.find(item => item.id === cluster.lastUpdateId);
    if (latestItem) {
      contentMap[cluster.cluster] = latestItem.content || '';
    }
  }
  return contentMap;
}

// ==================== 格式化宏观快照 ====================
function formatMacroSnapshot(macro) {
  const lines = [];
  lines.push(`- 布伦特原油: $${macro.brent?.price || '?'} (${macro.brent?.change > 0 ? '+' : ''}${macro.brent?.change || 0}%)`);
  lines.push(`- 纽约原油: $${macro.crude.price} (${macro.crude.change > 0 ? '+' : ''}${macro.crude.change}%)`);
  lines.push(`- COMEX黄金: $${macro.gold.price} (${macro.gold.change > 0 ? '+' : ''}${macro.gold.change}%)`);
  lines.push(`- 纳指指数期货: ${macro.nasdaq.price} (${macro.nasdaq.change > 0 ? '+' : ''}${macro.nasdaq.change}%)`);
  lines.push(`- 日经225指数期货: ${macro.nke.price} (${macro.nke.change > 0 ? '+' : ''}${macro.nke.change}%)`);
  lines.push(`- 恒生科技指数: ${macro.hstech.price} (${macro.hstech.change > 0 ? '+' : ''}${macro.hstech.change}%)`);
  lines.push(`- 美元指数: ${macro.dxy.price} (${macro.dxy.change > 0 ? '+' : ''}${macro.dxy.change}%)`);
  lines.push(`- 离岸人民币: ${macro.usdcnh.price} (${macro.usdcnh.change > 0 ? '+' : ''}${macro.usdcnh.change}%)`);
  return lines.join('\n');
}

// ==================== 格式化事件簇列表及原文内容 ====================
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
        timeout: 300000
      }
    );
    return response.data.choices[0].message.content;
  } catch (error) {
    console.error(`❌ LLM [${targetModel}] 调用失败:`, error.message);
    return `LLM分析暂时不可用，请稍后重试。`;
  }
}

// ==================== 企业微信推送（支持自动分批） ====================
async function pushWechatReview(title, content, webhookOverride = null) {
  const webhook = webhookOverride || CONFIG.WECHAT_WEBHOOK_REVIEW;
  if (!webhook) {
    console.log('⚠️ 未配置推送 Webhook，跳过推送');
    return;
  }

  // 拼接完整消息
  const header = `## ${title}\n> 生成时间：${formatTime()} | 模式：${process.argv[2] || '自动'}\n---\n`;
  const fullMarkdown = header + content;
  const maxBytes = 3800; // 留出安全余量

  // 如果无需分批，直接发送
  if (Buffer.byteLength(fullMarkdown, 'utf8') <= maxBytes) {
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

  // 需要分批：按段落拆分
  const paragraphs = content.split(/\n\n+/); // 以空行分隔
  const batches = [];
  let currentBatch = '';

  for (const para of paragraphs) {
    const testContent = currentBatch ? `${currentBatch}\n\n${para}` : para;
    const testMarkdown = header + testContent;
    if (Buffer.byteLength(testMarkdown, 'utf8') <= maxBytes) {
      currentBatch = testContent;
    } else {
      // 当前段落加入会超长，保存当前批次并另起新批
      if (currentBatch) {
        batches.push(currentBatch);
      }
      // 如果单个段落本身就超长，强制截断
      if (Buffer.byteLength(header + para, 'utf8') > maxBytes) {
        const truncated = para.slice(0, Math.floor(maxBytes / 3)); // 粗略截断
        batches.push(truncated + '\n\n...(该段过长已截断)');
        currentBatch = '';
      } else {
        currentBatch = para;
      }
    }
  }
  if (currentBatch) batches.push(currentBatch);

  // 依次发送各批次
  for (let i = 0; i < batches.length; i++) {
    const batchTitle = batches.length > 1 ? `${title} (${i + 1}/${batches.length})` : title;
    const batchMarkdown = `## ${batchTitle}\n> 生成时间：${formatTime()} | 模式：${process.argv[2] || '自动'}\n---\n${batches[i]}`;
    try {
      const res = await axios.post(webhook, {
        msgtype: 'markdown',
        markdown: { content: batchMarkdown }
      }, { timeout: 30000 });
      if (res.data.errcode === 0) {
        console.log(`📲 [${batchTitle}] 推送成功`);
      } else {
        console.error(`❌ [${batchTitle}] 推送失败:`, res.data.errmsg);
      }
    } catch (error) {
      console.error(`❌ [${batchTitle}] 网络失败:`, error.message);
    }
  }
}

// ==================== 对比报告构建 ====================
function buildComparisonReport(mainAnalysis, compareAnalysis, reviewType, modelMain, modelCompare) {
  // 提取相关性状态（正则匹配）
  const extractState = (text) => {
    const patterns = [
      /(?:当前为|诊断为|相关性状态[：:]?\s*)[“"]?(D状态)[”"]?/,
      /(?:当前为|诊断为|相关性状态[：:]?\s*)[“"]?(正相关)[”"]?/,
      /(?:当前为|诊断为|相关性状态[：:]?\s*)[“"]?(负相关)[”"]?/,
    ];
    for (const p of patterns) {
      const m = text.match(p);
      if (m) return m[1];
    }
    return '未提取到';
  };

  // 提取策略基调
  const extractStance = (text) => {
    const m = text.match(/(偏进攻|防守观望|防守型|中性|偏防守)/);
    return m ? m[1] : '未提取到';
  };

  const mainState = extractState(mainAnalysis);
  const compareState = extractState(compareAnalysis);
  const mainStance = extractStance(mainAnalysis);
  const compareStance = extractStance(compareAnalysis);

  const stateDiff = mainState !== compareState ? '⚠️ 分歧' : '✅ 一致';
  const stanceDiff = mainStance !== compareStance ? '⚠️ 分歧' : '✅ 一致';

  return `## 🤖 双模型复盘对比
> 时间：${formatTime()} | 模式：${reviewType}

| 对比维度 | ${modelMain} | ${modelCompare} | 一致性 |
|:---|:---|:---|:---:|
| **相关性诊断** | ${mainState} | ${compareState} | ${stateDiff} |
| **策略基调** | ${mainStance} | ${compareStance} | ${stanceDiff} |

${stateDiff.includes('分歧') ? `> 🚨 相关性诊断分歧，建议以 ${modelMain} 为参考基准` : ''}
${stanceDiff.includes('分歧') ? `> ⚠️ 策略基调相反，请结合情景推演综合判断` : ''}

> 注：完整分析已推送。`;
}

// ==================== 盘前策略 Prompt ====================
function buildPremarketPrompt(clusters, macro, contentMap) {
  const clusterText = formatClusterList(clusters, contentMap);
  const macroText = formatMacroSnapshot(macro);

return `【角色定义】
你是宏观交易策略复盘与决策引擎。当前时间为北京时间${formatTime()}，A股即将开盘。

## 隔夜事件链（最近24小时已推送的事件簇）
${clusterText}

## 当前全球宏观锚定物
${macroText}

## 任务
**在完成以下所有任务时，必须遵守这些核心约束：**

1.  **相关性状态声明**：开篇必须基于宏观数据中的原油和黄金涨跌方向，明确计算并声明当前的"原油-黄金"相关性状态（正相关/负相关/D状态（原油跌+黄金涨/平 = D状态）），并将其作为所有策略建议的根本出发点。
    **D状态专属规则**（若诊断为D状态则强制执行）：
    - ❌ 严禁推荐做空黄金
    - ❌ 严禁推荐抄底油气ETF
    - ✅ 允许推荐科技ETF（成本下降逻辑）、黄金ETF（独立支撑）、军工ETF（对冲地缘风险）

2.  **事件驱动的情景更新**：更新情景概率时，必须明确引用"隔夜事件链"中的具体事件簇，并说明该事件是"强化"还是"削弱"了某个情景。不允许脱离具体事件空谈宏观。

3.  **矛盾信号识别与权衡**：【必须作为独立章节，标题为"⚡ 矛盾信号识别"】
    **数据时效性提醒**：在当前盘前时段，恒生科技与日经225为昨日收盘后的**静态数据**，仅用于复盘昨日逻辑，**不参与**今日盘前情绪的实时对比。纳指期货、美元、原油、黄金为**实时数据**，反映隔夜最新变化。
    - 矛盾信号应主要从**同期实时数据**中寻找（例如：纳指大涨与黄金同涨之间的风险偏好分歧、俄乌和谈信号与伊朗局势升温之间的地缘方向矛盾）。
    - 分析市场当前选择相信哪一方，以及未来反转的条件。

4.  **策略的传导链依据**：给出任何方向建议时，必须附带完整的传导链（例如："美联储降息预期升温 → 实际利率下行 → 利好科技股估值 → 关注纳斯达克ETF"），不允许跳步推荐。

---

**具体任务清单：**

1. **情景概率更新**：基于上述事件簇和资产收线，对昨日可能的情景（例如软着陆、滞胀、衰退等）概率进行倾向性调整。说明哪个情景在强化，哪个在消退。
2. **核心叙事修正**：当前市场的主导叙事是否有变化？如有，请指出新叙事和脆弱点。
3. **开盘关键锚点**：给出今日A股开盘最需关注的3个价格/指标（如纳指指数期货关键位、纽约原油压力、美元指数位置、离岸人民币等）。
4. **今日策略基调**：整体仓位建议（偏进攻/防守/观望），重点关注方向（宽基、科技、消费、周期、防御等），并说明理由（附传导链）。
5. **风险警示**：列出今日可能出现的黑天鹅或灰犀牛。

请用简练的Markdown输出，包含 emoji 增强可读性。`;
}

// ==================== 盘后复盘 Prompt ====================
function buildPostmarketPrompt(clusters, macro, etfPerformance, contentMap) {
  const clusterText = formatClusterList(clusters, contentMap);
  const macroText = formatMacroSnapshot(macro);
  const etfText = formatETFPerformance(etfPerformance);

  return `【角色定义】
你是宏观交易信号复盘专员。当前时间为北京时间${formatTime()}，A股已收盘。

## 今日已推送事件簇
${clusterText}

## 当前全球宏观锚定物
${macroText}

## 今日ETF实际表现
${etfText}

## 任务
**在完成以下所有任务时，必须遵守这些核心约束：**

1. **相关性状态复核**：开篇必须复核当前的"原油-黄金"相关性状态，判断是否与今日推送时的诊断一致。若发生变化，说明原因。

2. **逐条验证原则**：回顾"今日已推送事件簇"中的每条，必须逐一对照"今日ETF实际表现"，说明该事件的传导链是被验证、被否定、还是无法判断。不允许跳条。
   **数据时效性提醒**：当前为盘后复盘，恒生科技指数及所有ETF行情均为**今日实际收盘数据**，可以直接用于逻辑验证，不再受盘前"静态数据"限制。

3. **逻辑断点定位**：如果某条推送的推荐方向与今日盘面相反，必须明确指出逻辑断在哪里——是事件判断错了，还是传导链的某个环节不成立。对于涉及恒生科技/日经/港股相关ETF的判断，今日收盘数据是最直接的验证依据。

4. **漏推信号反思**：对照"今日ETF实际表现"中的领涨/领跌板块，检查是否有明显异动无法用"今日已推送事件簇"解释。如有，标注为"可能的过滤遗漏"。恒生科技ETF和日经225ETF的今日走势是判断亚洲市场情绪的重要线索，不可忽略。

---

**具体任务清单：**
1. **事件簇影响评估**：回顾今日推送的事件簇中，哪些对盘面产生了实质性影响？其传导链是否成立？
2. **逻辑自洽检验**：基于今日资产表现，是否有证据表明之前的宏观框架需要修正？
3. **错失信号识别**：今日盘面是否存在明显异动而无法用今日推送事件解释？
4. **框架修正建议**：是否需要调整原油-黄金的相关性判断？对D状态（原油跌+黄金涨/平 = D状态）的规则下的持仓建议有何反思？
5. **明日初步预案**：基于今日收盘状况，明日的核心观察指标和潜在情景是什么？

请用简练的Markdown输出，必须体现复盘性质（逐条比对、验证逻辑），而非泛泛总结。`;
}

// ==================== 主入口 ====================
async function main() {
  const reviewType = getReviewType();
  const isPremarket = reviewType === 'premarket';
  const title = isPremarket ? '📅 A股盘前策略' : '📊 A股盘后复盘';

  console.log(`\n[${formatTime()}] 🚀 ${title}启动`);

  // 1. 拉取宏观数据
  console.log('📊 拉取宏观数据...');
  const macro = await fetchSinaMacro();

  // 2. 拉取已推送事件簇（盘前24小时，盘后取当天）
  const hours = isPremarket ? 24 : 12;
  const clusters = getRecentPushedClusters(hours);
  console.log(`📋 获取到 ${clusters.length} 个事件簇`);

  // 2.5 获取簇对应的原文
  const contentMap = getClusterContents(clusters);

  // 3. 盘后需要 ETF 收盘数据
  let etfHoldings = [];
  if (!isPremarket) {
    try {
      console.log('📈 拉取ETF收盘数据...');
      const marketData = await getMarketData();
      etfHoldings = marketData.holdings || [];
      console.log(`   获取到 ${etfHoldings.length} 个ETF行情`);
    } catch (e) {
      console.log('⚠️ ETF数据获取失败，将跳过盘面验证');
    }
  }

  // 4. 构建 Prompt
const prompt = isPremarket 
  ? buildPremarketPrompt(clusters, macro, contentMap)
  : buildPostmarketPrompt(clusters, macro, etfHoldings, contentMap);
//   console.log(prompt);
  // 5. 主模型分析
  const mainModel = CONFIG.LLM.MODEL;
  console.log(`🤖 主模型 [${mainModel}] 分析中...`);
  const mainAnalysis = await callLLM(prompt);
  await pushWechatReview(title, `### 主模型 [${mainModel.split('/').pop()}]\n${mainAnalysis}`);

  // 6. 对比模型分析（如果配置了）
  if (CONFIG.LLM.MODEL_COMPARE) {
    const compareModel = CONFIG.LLM.MODEL_COMPARE;
    console.log(`🔍 对比模型 [${compareModel}] 分析中...`);
    const compareAnalysis = await callLLM(prompt, compareModel);

    // 推送对比模型的完整结果到对比 Webhook
    const compareTitle = `${title} (对比模型)`;
    await pushWechatReview(
      `### 对比模型 [${compareModel.split('/').pop()}]\n${compareAnalysis}`,
      compareTitle,
      CONFIG.WECHAT_WEBHOOK_REVIEW_COMPARE
    );

    // 构建并推送对比摘要报告
    const comparisonReport = buildComparisonReport(
      mainAnalysis,
      compareAnalysis,
      reviewType,
      mainModel.split('/').pop(),
      compareModel.split('/').pop()
    );
    await pushWechatReview('🤖 双模型复盘对比', comparisonReport, CONFIG.WECHAT_WEBHOOK_REVIEW_COMPARE);
  }

  console.log(`[${formatTime()}] ✅ ${title}完成\n`);
}

main().catch(err => {
  console.error('复盘脚本异常:', err);
  process.exit(1);
});