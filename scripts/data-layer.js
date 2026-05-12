import axios from 'axios';
import { HOLDINGS_MAP } from './const/index.js';
import { getChinaMarketStatus } from './utils/chinaMarket.js';

// ========== 布伦特原油（腾讯） ==========
async function getBrentFromTencent() {
  try {
    const url = 'https://qt.gtimg.cn/q=hf_OIL';
    const res = await axios.get(url, {
      headers: { 
        'Referer': 'https://finance.qq.com',
        'User-Agent': 'Mozilla/5.0'
      },
      timeout: 10000,
      responseType: 'text'
    });
    const match = res.data.trim().match(/v_hf_OIL="([^"]+)"/);
    if (!match) throw new Error('Parse failed');
    
    const d = match[1].split(',');
    return {
      name: '布伦特原油',
      price: parseFloat(d[0]).toFixed(2),
      change: parseFloat(d[1]),
      changeStr: parseFloat(d[1]) > 0 ? `+${d[1]}` : `${d[1]}`,
      high: parseFloat(d[4]).toFixed(2),
      low: parseFloat(d[5]).toFixed(2),
      updateTime: `${d[12]} ${d[6]}`,
      source: 'tencent'
    };
  } catch (e) {
    console.error('布伦特失败:', e.message);
    return null;
  }
}

// ========== A股ETF（腾讯） ==========
async function getHoldingsFromTencent() {
  try {
    const codes = Object.values(HOLDINGS_MAP).join(',');
    const url = `https://qt.gtimg.cn/q=${codes}`;
    
    const res = await axios.get(url, {
      headers: { 
        'Referer': 'https://finance.qq.com',
        'User-Agent': 'Mozilla/5.0'
      },
      timeout: 10000,
      responseType: 'text'
    });
    
    const results = [];
    const lines = res.data.trim().split('\n');
    const codeToName = Object.fromEntries(
      Object.entries(HOLDINGS_MAP).map(([name, code]) => [code, name])
    );
    
    for (const line of lines) {
      const match = line.match(/v_(sz|sh)(\d+)="([^"]*)"/);
      if (!match) continue;
      
      const [, market, codeNum, dataStr] = match;
      const fullCode = `${market}${codeNum}`;
      const d = dataStr.split('~');
      
      const name = codeToName[fullCode] || d[1];
      const price = parseFloat(d[3]);
      const prevClose = parseFloat(d[4]);
      
      let change = 0;
      if (prevClose > 0) {
        change = ((price - prevClose) / prevClose * 100);
      }
      
      results.push({
        name,
        code: d[2],
        price: price.toFixed(3),
        prevClose: prevClose.toFixed(3),
        change: parseFloat(change.toFixed(2)),
        changeStr: change > 0 ? `${change.toFixed(2)}` : `${change.toFixed(2)}`,
        isStale: false,  // A股数据是否过时
        source: 'tencent'
      });
    }
    return results;
  } catch (e) {
    console.error('获取持仓行情失败:', e.message);
    return [];
  }
}

// ========== 统一数据层 ==========
export async function getMarketData() {
  const marketStatus = getChinaMarketStatus();
  const isAOpen = marketStatus.isOpen;

  // 布伦特原油可以保持任何时间都请求（它是全球 24 小时大致报价）
  const oil = await getBrentFromTencent();

  // A 股：非交易时段直接不请求腾讯 ETF 接口
  let holdings = [];
  if (true) {
    holdings = await getHoldingsFromTencent();
  } else {
    console.log(`A股未开市（${marketStatus.reason || '非交易时间'}），跳过获取 ETF 盘面`);
  }

  return {
    marketStatus,
    isAOpen,
    oil: oil || { price: '未知', change: 0, changeStr: '0' },
    holdings,           // 休市时为 []
    timestamp: new Date().toISOString()
  };
}
