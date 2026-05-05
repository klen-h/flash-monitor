import axios from 'axios';

// ========== 国际指数（新浪） ==========
const INDEX_CODES = {
  '恒生指数': 'rt_hkHSI',
  '恒生科技指数': 'rt_hkHSTECH',
  '日经225': 'int_nikkei',
  '韩国KOSPI': 'int_kospi'
};

async function getIndicesFromSina() {
  const codes = Object.values(INDEX_CODES).join(',');
  const url = `https://hq.sinajs.cn/list=${codes}`;
  
  try {
    const res = await axios.get(url, {
      headers: {
        'Referer': 'https://finance.sina.com.cn',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 10000,
      responseType: 'text'
    });
    console.log(res.data);
    const results = [];
    const lines = res.data.trim().split('\n');
    
    // 反向映射
    const codeToName = Object.fromEntries(
      Object.entries(INDEX_CODES).map(([name, code]) => [code, name])
    );
    
    for (const line of lines) {
      // var hq_str_rt_hkHSI="恒生指数,23456.78,123.45,0.53,...";
      const match = line.match(/var hq_str_([^=]+)="([^"]*)";/);
      if (!match) continue;
      
      const [, code, dataStr] = match;
      if (!dataStr || !codeToName[code]) continue;
      
      const d = dataStr.split(',');
      // 新浪国际指数格式：名称,最新价,涨跌额,涨跌幅,...
      // 但不同指数字段顺序可能略有差异，优先用能识别的
      
      const name = codeToName[code];
      let price = 0, change = 0;
      
      // 港股指数格式：名称,最新价,涨跌额,涨跌幅,...
      if (code.startsWith('rt_hk')) {
        price = parseFloat(d[1]);
        change = parseFloat(d[3]); // 涨跌幅%
      } 
      // 日韩指数格式可能：名称,最新价,涨跌额,涨跌幅,... 或 代码,名称,价格,...
      else {
        // 尝试多种解析
        price = parseFloat(d[1]) || parseFloat(d[2]) || 0;
        change = parseFloat(d[3]) || parseFloat(d[4]) || 0;
      }
      
      if (price > 0) {
        results.push({
          name,
          code,
          price: price.toFixed(2),
          change: parseFloat(change.toFixed(2)),
          changeStr: change >= 0 ? `+${change.toFixed(2)}` : `${change.toFixed(2)}`,
          isRealTime: true,
          source: 'sina'
        });
      }
    }
    console.log(results);
    return results;
    
  } catch (e) {
    console.error('❌ 指数失败:', e.message);
    return [];
  }
}

getIndicesFromSina()