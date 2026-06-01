
const ETF_THEME_MAP = {
  '沪深300ETF': '宽基', '中证1000ETF': '宽基', '科创板50ETF': '宽基',
  '纳斯达克ETF': '海外', '恒生科技ETF': '海外', '日经225ETF': '海外',
  '半导体ETF': '科技', '人工智能ETF': '科技',
  '军工ETF': '防御', '医药ETF': '防御', '电力ETF': '防御', '银行ETF': '防御',
  '新能源车ETF': '制造', '消费ETF': '内需',
  '证券ETF': '金融', '银行ETF': '金融',
  '煤炭ETF': '周期', '有色ETF': '周期', '标普油气ETF': '周期',
  '黄金ETF': '避险', '国债ETF': '避险', '短融ETF': '避险',
};

export function calculateMainForceScore(etfName, etfData, capitalFlow) {
  let score = 50;

  const volRatio = etfData?.volumeRatio || 1;
  if (volRatio > 3) score += 30;
  else if (volRatio > 2) score += 20;
  else if (volRatio > 1.5) score += 10;
  else if (volRatio < 0.6) score -= 10;

  const mfRatio = capitalFlow?.mainForceRatio || 0;
  if (mfRatio > 15) score += 30;
  else if (mfRatio > 8) score += 20;
  else if (mfRatio > 0) score += 10;
  else if (mfRatio < -8) score -= 20;
  else if (mfRatio < -15) score -= 30;

  const pos = etfData?.pricePosition || 0.5;
  if (pos < 0.25 && mfRatio > 0) score += 10;
  if (pos > 0.85 && mfRatio < 0) score -= 10;

  const slRatio = capitalFlow?.superLargeRatio || 0;
  if (slRatio > 5) score += 10;
  else if (slRatio < -5) score -= 10;

  return Math.max(0, Math.min(100, Math.round(score)));
}

export function detectMarketTheme(etfHoldings, capitalFlows, scores) {
  const top5 = Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .filter(([_, s]) => s >= 60);

  if (top5.length < 2) return null;

  const themeScores = {};
  const themeETFs = {};
  for (const [etfName, score] of top5) {
    const theme = ETF_THEME_MAP[etfName];
    if (!theme) continue;
    themeScores[theme] = (themeScores[theme] || 0) + score;
    if (!themeETFs[theme]) themeETFs[theme] = [];
    themeETFs[theme].push(etfName);
  }

  const sorted = Object.entries(themeScores).sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) return null;

  const [topTheme, topScore] = sorted[0];
  if (topScore >= 130 && themeETFs[topTheme].length >= 2) {
    return { theme: topTheme, score: topScore, etfs: themeETFs[topTheme], type: 'strong' };
  }
  if (topScore >= 100) {
    return { theme: topTheme, score: topScore, etfs: themeETFs[topTheme], type: 'potential' };
  }
  return null;
}

export function detectDivergence(etfHoldings, scores) {
  const broadETFs = ['沪深300ETF', '中证1000ETF', '科创板50ETF'];
  const broadScores = broadETFs.map(n => scores[n] || 50).filter(Boolean);
  const broadAvg = broadScores.length ? broadScores.reduce((a, b) => a + b, 0) / broadScores.length : 50;

  const sectorEntries = Object.entries(scores).filter(([name]) => !broadETFs.includes(name));
  const sectorAvg = sectorEntries.length
    ? sectorEntries.reduce((sum, [_, s]) => sum + s, 0) / sectorEntries.length
    : 50;

  if (broadAvg < 45 && sectorAvg > 65) {
    return { signal: 'structural', label: '结构性行情', desc: '宽基失血，行业ETF获主力团' };
  }
  if (broadAvg > 65 && sectorAvg > 65) {
    return { signal: 'bullish', label: '普涨行情', desc: '宽基与行业共振，增量入场' };
  }
  if (broadAvg < 45 && sectorAvg < 45) {
    return { signal: 'bearish', label: '普跌行情', desc: '全线失血，避险模式' };
  }
  if (broadAvg > 60 && sectorAvg < 50) {  
    return { signal: 'defensive', label: '防御风格', desc: '资金涌向宽基，行业轮动停滞' };
  }
  return { signal: 'neutral', label: '震荡分化', desc: '方向不明，等待主线确认' };
}

export function formatCapitalFlowForPrompt(etfHoldings, capitalFlows, scores, theme, divergence, northBound = null) {
  const lines = [];
  lines.push('## 资金流向与主力信号');
  lines.push('');

  if (northBound) {
    const nbIcon = northBound.totalNet &gt; 0 ? '📈' : '📉';
    const shIcon = northBound.shNet &gt; 0 ? '🔺' : '🔻';
    const szIcon = northBound.szNet &gt; 0 ? '🔺' : '🔻';
    lines.push(nbIcon + ' **北向资金**: 净流入 ' + northBound.totalNet.toFixed(2) + '亿');
    lines.push('   沪股通: ' + shIcon + ' ' + northBound.shNet.toFixed(2) + '亿 | 深股通: ' + szIcon + ' ' + northBound.szNet.toFixed(2) + '亿');
    lines.push('');
  }

  lines.push('**市场风格判定**: ' + divergence.label + ' — ' + divergence.desc);
  lines.push('');

  if (theme) {
    const emoji = theme.type === 'strong' ? '🔥' : '⚡';
    lines.push(emoji + ' **当前主线**: ' + theme.theme + '（强度' + theme.score + '分）');
    lines.push('   涉及ETF: ' + theme.etfs.join('、'));
    lines.push('');
  } else {
    lines.push('⚖️ **当前主线**: 无明确主线（资金分散）');
    lines.push('');
  }

  const top5 = Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, 5);
  lines.push('**主力青睐 TOP5**（评分基于量比+主力动向+量价结构）:');
  for (const [name, score] of top5) {
    const flow = capitalFlows[name];
    const mfRatio = flow?.mainForceRatio ? (flow.mainForceRatio > 0 ? '+' : '') + flow.mainForceRatio.toFixed(2) + '%' : 'N/A';
    const icon = score >= 70 ? '🌟' : score >= 60 ? '✨' : score >= 50 ? '⚠️' : '❌'; 
    lines.push('   ' + icon + ' ' + name + ': ' + score + '分 | 主力净占比 ' + mfRatio);
  }
  lines.push('');

  const bottom3 = Object.entries(scores).sort((a, b) => a[1] - b[1]).slice(0, 3);
  lines.push('**主力回避 TOP3**:');
  for (const [name, score] of bottom3) {
    const flow = capitalFlows[name];
    const mfRatio = flow?.mainForceRatio ? (flow.mainForceRatio > 0 ? '+' : '') + flow.mainForceRatio.toFixed(2) + '%' : 'N/A';
    lines.push('   🔻 ' + name + ': ' + score + '分 | 主力净占比 ' + mfRatio);
  }
  lines.push('');

  return lines.join('\n');
}
