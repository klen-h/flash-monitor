import axios from 'axios';

// ========== 日韩指数（腾讯） ==========
const ASIA_INDEX_CODES = {
  '日经225': 'idx_jp225',
  '韩国KOSPI': 'idx_ks11'
};

// 尝试腾讯获取日韩指数
async function getAsiaIndicesFromTencent() {
  const codes = Object.values(ASIA_INDEX_CODES).join(',');
  const url = `https://qt.gtimg.cn/q=${codes}`;
  
  try {
    const res = await axios.get(url, {
      headers: { 'Referer': 'https://finance.qq.com', 'User-Agent': 'Mozilla/5.0' },
      timeout: 10000, responseType: 'text'
    });
    
    const results = [];
    const nameMap = Object.fromEntries(
      Object.entries(ASIA_INDEX_CODES).map(([n,c])=>[c,n])
    );
    console.log(res);
    
    for (const line of res.data.trim().split('\n')) {
      // 尝试匹配 idx_jp225 或 idx_ks11
      const m = line.match(/v_(idx_\w+)="([^"]*)"/);
      if (!m) continue;
      
      const [, code, dataStr] = m;
      const name = nameMap[code];
      if (!name || !dataStr) continue;
      
      const d = dataStr.split('~');
      // 腾讯指数格式可能和ETF类似：名称~最新价~...
      // 也可能是：最新价,涨跌幅,...
      
      let price = 0, change = 0;
      
      // 尝试ETF格式
      if (d.length > 3) {
        price = parseFloat(d[2]);  // 或 d[1]
        const prev = parseFloat(d[3] || 0);
        if (prev > 0) change = ((price - prev) / prev * 100);
      } else {
        // 逗号格式
        const c = dataStr.split(',');
        price = parseFloat(c[0]);
        change = parseFloat(c[1]);
      }
      
      if (price > 0) {
        results.push({
          name, code, price: price.toFixed(2),
          change: parseFloat(change.toFixed(2)),
          changeStr: change >= 0 ? `+${change.toFixed(2)}` : `${change.toFixed(2)}`,
          isRealTime: true, source: 'tencent'
        });
      }
    }
    return results;
  } catch (e) {
    console.error('❌ 日韩指数失败:', e.message);
    return [];
  }
}

getAsiaIndicesFromTencent()