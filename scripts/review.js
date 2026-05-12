/**
 * A股盘前/午盘/盘后复盘脚本 (review.js)
 * 
 * 功能：
 * - 盘前：基于已推送事件簇 + 隔夜收盘数据，更新情景推演，给出开盘锚点
 * - 午盘：基于上午事件 + 盘面表现，更新策略，给出下午交易建议
 * - 盘后：基于今日推送事件簇 + ETF实际涨跌，验证逻辑，修正框架
 * - 支持双模型对比分析（主模型 + CONFIG.LLM.MODEL_COMPARE）
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
 */
import { readFileSync, existsSync } from 'fs';
import axios from 'axios';
import { CONFIG } from './config.js';
import { fetchSinaMacro } from './macro-layer.js';
import { getMarketData } from './data-layer.js';
import { loadState } from './storage.js';
// import { verifyPredictions, generateAccuracyReport } from './accuracy-tracker.js';

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
  if (mode === 'premarket' || mode === 'lunchbreak' || mode === 'postmarket') return mode;
  
  const { totalMinutes } = getBeijingTime();
  // 盘前窗口：8:00 - 9:30
  if (totalMinutes >= 480 && totalMinutes < 570) return 'premarket';
  // 午盘窗口：11:30 - 13:00
  if (totalMinutes >= 690 && totalMinutes < 780) return 'lunchbreak';
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
  lines.push(`- COMEX白银: $${macro.silver.price} (${macro.silver.change > 0 ? '+' : ''}${macro.silver.change}%)`);
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

function truncateToByteLength(str, maxByteLen) {
  let buf = Buffer.from(str, 'utf8');
  if (buf.length <= maxByteLen) return str;
  // 逐字符后退，避免截断多字节字符
  let truncated = buf.slice(0, maxByteLen).toString('utf8');
  // 如果最后一个字符被截断（出现乱码），则再向前退一个字符
  while (Buffer.byteLength(truncated, 'utf8') > maxByteLen) {
    truncated = truncated.slice(0, -1);
  }
  return truncated;
}

// ==================== 企业微信推送（支持自动分批） ====================
const MAX_CONTENT_BYTES = 4000; // 留出96字节安全余量

async function pushWechatReview(title, content, webhookOverride = null) {
  const webhook = webhookOverride || CONFIG.WECHAT_WEBHOOK_REVIEW;
  if (!webhook) {
    console.log('⚠️ 未配置推送 Webhook，跳过推送');
    return;
  }

  const makeHeader = (t) => `## ${t}\n> 生成时间：${formatTime()} | 模式：${process.argv[2] || '自动'}\n---\n`;
  const fullMarkdown = makeHeader(title) + content;

  // 如果无需分批，直接发送
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

  // 需要分批：按段落拆分，预留批次标题变长的空间
  const paragraphs = content.split(/\n\n+/);
  const batches = [];
  let currentBatch = '';

  for (const para of paragraphs) {
    // 预估最大标题（批次1/n）
    const testTitle = `${title} (${batches.length + 1}/9)`;
    const testHeader = makeHeader(testTitle);
    const candidate = currentBatch ? `${currentBatch}\n\n${para}` : para;
    if (Buffer.byteLength(testHeader + candidate, 'utf8') <= MAX_CONTENT_BYTES) {
      currentBatch = candidate;
    } else {
      if (currentBatch) {
        batches.push(currentBatch);
      }
      // 单段落本身超长则截断
      if (Buffer.byteLength(testHeader + para, 'utf8') > MAX_CONTENT_BYTES) {
        const maxParaBytes = MAX_CONTENT_BYTES - Buffer.byteLength(testHeader + '\n\n...(该段过长已截断)', 'utf8');
        const truncated = truncateToByteLength(para, maxParaBytes);
        batches.push(truncated + '\n\n...(该段过长已截断)');
        currentBatch = '';
      } else {
        currentBatch = para;
      }
    }
  }
  if (currentBatch) batches.push(currentBatch);

  // 依次发送，每条消息再次校验长度
  for (let i = 0; i < batches.length; i++) {
    const batchTitle = batches.length > 1 ? `${title} (${i + 1}/${batches.length})` : title;
    let batchMarkdown = makeHeader(batchTitle) + batches[i];

    // 最终安全截断（防止因后缀长度变化导致超限）
    if (Buffer.byteLength(batchMarkdown, 'utf8') > MAX_CONTENT_BYTES) {
      const overflow = Buffer.byteLength(batchMarkdown, 'utf8') - MAX_CONTENT_BYTES;
      const truncatedContent = truncateToByteLength(batches[i], Buffer.byteLength(batches[i], 'utf8') - overflow - 10);
      batchMarkdown = makeHeader(batchTitle) + truncatedContent + '\n\n...(截断)';
    }

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

1.  **相关性状态声明**：开篇必须基于宏观数据中的原油和黄金涨跌方向，明确计算并声明当前的"原油-黄金"相关性状态。
    **状态诊断强制核对表**（必须逐项对应）：
    - 原油涨 + 黄金涨 = 正相关 → 通胀/滞胀交易（需求过热或供给冲击）
    - 原油涨 + 黄金跌 = 负相关 → 紧缩/实际利率飙升（通胀预期倒逼加息，压制金价）
    - 原油跌 + 黄金跌 = 正相关 → 衰退或流动性危机
    - 原油跌 + 黄金涨/平 = 负相关 → **D状态**
      **D状态专属规则（若诊断为D状态则强制执行）**：
      - ❌ 严禁推荐做空黄金
      - ❌ 严禁推荐抄底油气ETF
      - ✅ 允许推荐科技ETF（成本下降逻辑）、黄金ETF（独立支撑）、军工ETF（对冲地缘风险）
    **禁止在核对表外自创状态名称或叙事逻辑。**

    ### 白银交叉验证（辅助判断，非必选）
    若白银数据可用，需在分析中检验：
    - 若白银涨幅明显大于黄金（日内差距>2%），说明市场同时定价了地缘避险+工业需求，此时负相关（原油涨+黄金跌）可能是假象，黄金被特殊事件压制而非实际利率驱动。
    - 若白银与原油同向且涨幅接近，优先判断为供给冲击叙事，强化滞胀情景。
    - 若白银独自异动而黄金/原油平稳，可能为白银自身供需因素，不急于纳入宏观框架。

2.  **事件驱动的情景更新**：更新情景概率时，必须明确引用"隔夜事件链"中的具体事件簇，并说明该事件是"强化"还是"削弱"了某个情景。不允许脱离具体事件空谈宏观。

3.  **矛盾信号识别与权衡**：【必须作为独立章节，标题为"⚡ 矛盾信号识别"】
    **数据时效性提醒**：在当前盘前时段，恒生科技与日经225为昨日收盘后的**静态数据**，仅用于复盘昨日逻辑，**不参与**今日盘前情绪的实时对比。纳指期货、美元、原油、黄金为**实时数据**，反映隔夜最新变化。
    - 矛盾信号应主要从**同期实时数据**中寻找（例如：纳指大涨与黄金同涨之间的风险偏好分歧、俄乌和谈信号与伊朗局势升温之间的地缘方向矛盾）。
    - 分析市场当前选择相信哪一方，以及未来反转的条件。

4.  **策略的传导链依据**：给出任何方向建议时，必须附带完整的传导链（例如："美联储降息预期升温 → 实际利率下行 → 利好科技股估值 → 关注纳斯达克ETF"），不允许跳步推荐。

5.  **策略建议的审慎性**：给出方向性建议时，必须考虑相关资产隔夜是否已出现极端波动（如单日涨跌幅超过4%）。若已在极端高位/低位，追涨杀跌需给出明确反转信号，否则建议观望或等待回调。

6.  **策略与诊断的一致性**：策略建议必须与第一步声明的相关性状态逻辑一致。若诊断为负相关（紧缩逻辑），则不推荐以“通胀/避险”为核心逻辑的配置，除非能明确指出该负相关是由特殊事件造成的假象（需在矛盾信号中已说明）。

---

**具体任务清单：**

1. **情景概率更新**：基于上述事件簇和资产收线，对昨日可能的情景（例如软着陆、滞胀、衰退等）概率进行倾向性调整。说明哪个情景在强化，哪个在消退。
2. **核心叙事修正**：当前市场的主导叙事是否有变化？如有，请指出新叙事和脆弱点。
3. **开盘关键锚点**：给出今日A股开盘最需关注的3个价格/指标（如纳指指数期货关键位、纽约原油压力、美元指数位置、离岸人民币等）。
4. **今日策略基调**：整体仓位建议（偏进攻/防守/观望），重点关注方向（宽基、科技、消费、周期、防御等），并说明理由（附传导链）。
5. **风险警示**：列出今日可能出现的黑天鹅或灰犀牛。

请用简练的Markdown输出，包含 emoji 增强可读性。`;
}

// ==================== 午盘复盘 Prompt ====================
function buildLunchbreakPrompt(clusters, macro, etfPerformance, contentMap) {
  const clusterText = formatClusterList(clusters, contentMap);
  const macroText = formatMacroSnapshot(macro);
  const etfText = formatETFPerformance(etfPerformance);

  return `【角色定义】
你是宏观交易策略午盘复盘与决策引擎。当前时间为北京时间${formatTime()}，A股上午收盘，下午即将开盘。

## 上午事件链（最近6小时已推送的事件簇）
${clusterText}

## 当前全球宏观锚定物
${macroText}

## 上午ETF实际表现
${etfText}

## 任务
**在完成以下所有任务时，必须遵守这些核心约束：**

1.  **相关性状态声明**：开篇必须基于宏观数据中的原油和黄金涨跌方向，明确计算并声明当前的"原油-黄金"相关性状态。
    **状态诊断强制核对表**（必须逐项对应）：
    - 原油涨 + 黄金涨 = 正相关 → 通胀/滞胀交易
    - 原油涨 + 黄金跌 = 负相关 → 紧缩/实际利率飙升
    - 原油跌 + 黄金跌 = 正相关 → 衰退或流动性危机
    - 原油跌 + 黄金涨/平 = 负相关 → **D状态**
      **D状态专属规则（若诊断为D状态则强制执行）**：
      - ❌ 严禁推荐做空黄金
      - ❌ 严禁推荐抄底油气ETF
      - ✅ 允许推荐科技ETF（成本下降逻辑）、黄金ETF（独立支撑）、军工ETF（对冲地缘风险）
    **禁止在核对表外自创状态名称或叙事逻辑。**

2.  **白银交叉验证（辅助判断，若数据可用）**：
    - 若白银涨幅明显大于黄金（日内>2%），说明市场同时定价了地缘避险+工业需求，此时负相关（原油涨+黄金跌）可能是假象。
    - 若白银与原油同向且涨幅接近，优先判断为供给冲击叙事，强化滞胀情景。
    - 若白银独自异动而黄金/原油平稳，可能为自身供需因素，不急于纳入宏观框架。

3.  **上午表现验证**：回顾"上午事件链"中的事件，对照"上午ETF实际表现"，说明哪些事件的传导链已被验证，哪些存在分歧。
    **数据时效性提醒**：恒生科技与日经225为实时数据，可用于情绪确认。

4.  **矛盾信号识别与权衡**：【必须作为独立章节，标题为"⚡ 矛盾信号识别"】
    - 分析上午盘面与事件、以及宏观数据之间的矛盾信号，判断市场相信什么以及下午反转条件。

5.  **策略的传导链依据**：给出方向建议时，必须附带完整的传导链，不允许跳步推荐。

6.  **策略建议的审慎性**：若上午某板块已出现极端波动（>4%），下午追高/杀跌需给出明确反转信号，否则建议观望。

---

**具体任务清单：**

1. **上午验证**：基于上午事件和ETF表现，验证早盘策略是否正确？哪些传导链成立，哪些不成立？
2. **情景概率更新**：基于上午的新信息，对当前情景概率进行调整。说明哪个情景在强化，哪个在消退。
3. **核心叙事修正**：上午的市场表现是否改变了当前的主导叙事？如有变化，指出新叙事和脆弱点。
4. **下午关键锚点**：给出下午交易最需关注的3个价格/指标。
5. **下午策略基调**：整体仓位建议（偏进攻/防守/观望），重点关注方向，并说明理由（附传导链）。
6. **风险警示**：列出下午可能出现的黑天鹅或灰犀牛。

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

**A. 盘后复盘专属规则（必须执行）：**

1. **相关性状态复核**：开篇必须复核当前的"原油-黄金"相关性状态，判断是否与今日推送时的诊断一致。若发生变化，说明原因。

2. **逐条验证原则**：回顾"今日已推送事件簇"中的每条，必须逐一对照"今日ETF实际表现"，说明该事件的传导链是被验证、被否定、还是无法判断。不允许跳条。
   **数据时效性提醒**：当前为盘后复盘，恒生科技指数及所有ETF行情均为**今日实际收盘数据**，可以直接用于逻辑验证，不再受盘前"静态数据"限制。

3. **逻辑断点定位**：如果某条推送的推荐方向与今日盘面相反，必须明确指出逻辑断在哪里——是事件判断错了，还是传导链的某个环节不成立。对于涉及恒生科技/日经/港股相关ETF的判断，今日收盘数据是最直接的验证依据。

4. **漏推信号反思**：对照"今日ETF实际表现"中的领涨/领跌板块，检查是否有明显异动无法用"今日已推送事件簇"解释。如有，标注为"可能的过滤遗漏"。恒生科技ETF和日经225ETF的今日走势是判断亚洲市场情绪的重要线索，不可忽略。

**B. 通用核心规则（所有复盘模块统一遵守）：**

5. **框架一致性强制检查**：
   - 复盘中的“相关性状态”必须严格使用系统已定义的四种状态，**严禁自创新状态名称或变体**。四种状态为：
     - 原油涨 + 黄金涨 = 正相关（通胀/滞胀交易）
     - 原油涨 + 黄金跌 = 负相关（紧缩/实际利率飙升）
     - 原油跌 + 黄金跌 = 正相关（衰退/流动性危机）
     - 原油跌 + 黄金涨/平 = 负相关 → **D 状态**
       **D状态专属规则**：
       - ❌ 严禁推荐做空黄金
       - ❌ 严禁推荐抄底油气ETF
       - ✅ 允许推荐科技ETF（成本下降）、黄金ETF（独立支撑）、军工ETF（对冲风险）
   - 若诊断为负相关（非 D 状态），需进一步区分是“实际利率驱动”还是“风险偏好/特殊事件驱动”，并说明对策略的不同影响。
   - 提出的任何框架修正建议，不得与系统核心规则（特别是 D 状态专属规则）冲突，冲突时以核心规则为准。

6. **白银交叉验证**（辅助判断，非必选）：
   - 若白银涨幅明显大于黄金（日内差距>2%），说明市场同时定价了地缘避险+工业需求，此时负相关（原油涨+黄金跌）可能是假象，黄金被特殊事件压制而非实际利率驱动。
   - 若白银与原油同向且涨幅接近，优先判断为供给冲击叙事，强化滞胀情景。
   - 若白银独自异动而黄金/原油平稳，可能为白银自身供需因素，不急于纳入宏观框架。
   - 在负相关复盘时，若白银涨幅>黄金涨幅，须质疑“实际利率驱动”的单一解释，并分析是否是地缘风险溢价被黄金需求事件压制，白银成为更真实的避险指标。
   - 若当日白银出现极端行情（如日内>5%），需单独评估其是否影响了今日ETF表现中的有色ETF、半导体ETF（光伏用银）等，并与事件簇对照。

7. **策略建议的审慎性**：
   - 给出的方向性建议必须考虑当前价格是否处于极端波动后的短期高位/低位。
   - 禁止在日内暴涨暴跌（如单日涨跌幅超过 4%）后立即推荐追涨/杀跌，除非有明确的反转信号且已在报告中说明。

8. **D 状态规则的复盘**（仅在当天实际触发 D 状态时激活）：
   - 若今日盘面诊断曾出现 D 状态，需额外验证：是否有人为推荐做空黄金或抄底油气？若有，必须标注为“违规推荐”并修正。
   - 若 D 状态专属推荐（科技、黄金、军工 ETF）被实际走势否定，需分析是传导链失效还是事件冲击，并记录为框架潜在弱点。

---

**具体任务清单：**

1. **事件簇影响评估**：回顾今日推送的事件簇中，哪些对盘面产生了实质性影响？其传导链是否成立？
2. **逻辑自洽检验**：基于今日资产表现，是否有证据表明之前的宏观框架需要修正？
3. **错失信号识别**：今日盘面是否存在明显异动而无法用今日推送事件解释？
4. **框架修正建议**：是否需要调整原油-黄金的相关性判断？对 D 状态规则下的持仓建议有何反思？
5. **明日初步预案**：基于今日收盘状况，明日的核心观察指标和潜在情景是什么？

请用简练的Markdown输出，必须体现复盘性质（逐条比对、验证逻辑），而非泛泛总结。`;
}

// ==================== 主入口 ====================
async function main() {
  const reviewType = getReviewType();
  const isPremarket = reviewType === 'premarket';
  const isLunchbreak = reviewType === 'lunchbreak';
  const isPostmarket = reviewType === 'postmarket';
  
  let title;
  if (isPremarket) {
    title = '📅 A股盘前策略';
  } else if (isLunchbreak) {
    title = '☀️ A股午盘策略';
  } else {
    title = '📊 A股盘后复盘';
  }

  console.log(`\n[${formatTime()}] 🚀 ${title}启动`);

  // 1. 拉取宏观数据
  console.log('📊 拉取宏观数据...');
  const macro = await fetchSinaMacro();

  // 2. 拉取已推送事件簇
  let hours;
  if (isPremarket) {
    hours = 24;
  } else if (isLunchbreak) {
    hours = 6;
  } else {
    hours = 12;
  }
  const clusters = getRecentPushedClusters(hours);
  console.log(`📋 获取到 ${clusters.length} 个事件簇`);

  // 2.5 获取簇对应的原文
  const contentMap = getClusterContents(clusters);

  // 3. 午盘和盘后需要 ETF 数据
  let etfHoldings = [];
  if (!isPremarket) {
    try {
      console.log('📈 拉取ETF行情数据...');
      const marketData = await getMarketData();
      etfHoldings = marketData.holdings || [];
      console.log(`   获取到 ${etfHoldings.length} 个ETF行情`);
    } catch (e) {
      console.log('⚠️ ETF数据获取失败，将跳过盘面验证');
    }
  }

  // 4. 构建 Prompt
  let prompt;
  if (isPremarket) {
    prompt = buildPremarketPrompt(clusters, macro, contentMap);
  } else if (isLunchbreak) {
    prompt = buildLunchbreakPrompt(clusters, macro, etfHoldings, contentMap);
  } else {
    prompt = buildPostmarketPrompt(clusters, macro, etfHoldings, contentMap);
  }
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

  // 7. LLM 预测验证与准确率报告（午盘和盘后）
  // if (!isPremarket && etfHoldings.length > 0) {
  //   const verifyHours = isLunchbreak ? 6 : 24;
  //   console.log(`🔍 验证 LLM 预测结果（最近${verifyHours}小时）...`);
  //   const verified = verifyPredictions(etfHoldings, verifyHours);
  //   console.log(`   完成验证 ${verified.length} 个预测`);
    
  //   const accuracyReport = generateAccuracyReport();
  //   await pushWechatReview('📊 LLM 预测准确率', accuracyReport);
  // }

  console.log(`[${formatTime()}] ✅ ${title}完成\n`);
}

main().catch(err => {
  console.error('复盘脚本异常:', err);
  process.exit(1);
});
