import axios from 'axios';

export async function fetchSinaMacro() {
  // 【修复1】增加纳指期货(hf_NQ)和恒生科技指数(rt_hkHSTECH)
  const url = 'https://hq.sinajs.cn/list=hf_CL,hf_GC,hf_XAU,DINIW,fx_susdcnh,hf_NQ,rt_hkHSTECH';
  
  try {
    const { data } = await axios.get(url, {
      headers: {
        'Referer': 'https://finance.sina.com.cn',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 10000,
      responseType: 'arraybuffer',
    });
    const text = Buffer.from(data, 'binary').toString('latin1');
    
    const map = {};
    const lines = text.trim().split('\n');
    for (const line of lines) {
      const m = line.match(/var hq_str_(\w+)="([^"]*)"/);
      if (!m) continue;
      map[m[1]] = m[2].split(',');
    }

    // ================= 解析 WTI 原油 hf_CL =================
    const cl = map['hf_CL'] || [];
    const crude = {
      price: parseFloat(cl[0]) || 0,
      prevClose: parseFloat(cl[2]) || 0,
      high: parseFloat(cl[4]) || 0,
      low: parseFloat(cl[5]) || 0,
      change: cl[2] > 0 ? ((cl[0] - cl[2]) / cl[2] * 100).toFixed(2) : '0',
      time: `${cl[12]} ${cl[6]}`,
    };

    // ================= 解析 COMEX 黄金 hf_GC =================
    const gc = map['hf_GC'] || [];
    const gold = {
      price: parseFloat(gc[0]) || 0,
      prevClose: parseFloat(gc[8]) || 0, // 8 是昨收
      high: parseFloat(gc[4]) || 0,
      low: parseFloat(gc[5]) || 0,
      change: gc[8] > 0 ? ((gc[0] - gc[8]) / gc[8] * 100).toFixed(2) : '0',
      time: `${gc[12]} ${gc[6]}`,
    };

    // ================= 解析 纳指期货 hf_NQ =================
    const nq = map['hf_NQ'] || [];
    // console.log(nq);
    const nasdaq = {
      price: parseFloat(nq[0]) || 0,
      prevClose: parseFloat(nq[8]) || 0, // 8 是昨收
      high: parseFloat(nq[4]) || 0,
      low: parseFloat(nq[5]) || 0,
      change: nq[8] > 0 ? ((nq[0] - nq[8]) / nq[8] * 100).toFixed(2) : '0',
      time: `${nq[12]} ${nq[6]}`,
    };

    // ================= 解析 恒生科技 rt_hkHSTECH =================
    const hst = map['rt_hkHSTECH'] || [];
    // console.log(hst);
    const hstech = {
      price: parseFloat(hst[6]) || 0,
      prevClose: parseFloat(hst[3]) || 0,
      high: parseFloat(hst[4]) || 0,
      low: parseFloat(hst[5]) || 0,
      change: parseFloat(hst[8]) || 0, // 8 是涨跌幅
      time: `${hst[17]} ${hst[18]}`,
    };

    // ================= 解析 伦敦金现货 hf_XAU =================
    const xau = map['hf_XAU'] || [];
    const xauNums = [xau[0], xau[2], xau[3], xau[4], xau[5]].map(Number).filter(n => !isNaN(n) && n > 0);
    const goldSpot = {
      price: parseFloat(xau[0]) || 0,
      high: Math.max(...xauNums),
      low: Math.min(...xauNums),
      time: `${xau[12]} ${xau[6]}`,
    };

    // ================= 解析 美元指数 DINIW =================
    const dxy = map['DINIW'] || [];
    // 结构: 0时间, 1现价, 3昨收, 5开盘, 4成交量, 6最高, 7最低, 8卖价, 9名称, 10日期
    const dxyData = {
      price: parseFloat(dxy[1]) || 0,
      prevClose: parseFloat(dxy[3]) || 0,
      high: parseFloat(dxy[6]) || 0,
      low: parseFloat(dxy[7]) || 0,
      time: `${dxy[10]} ${dxy[0]}`,
    };
    // 计算涨跌幅
    dxyData.change = dxyData.prevClose > 0 ? ((dxyData.price - dxyData.prevClose) / dxyData.prevClose * 100).toFixed(2) : '0';

    // ================= 解析 离岸人民币 fx_susdcnh =================
    const cnh = map['fx_susdcnh'] || [];
    let usdcnhData = { price: 0, prevClose: 0, high: 0, low: 0, time: '', change: '0' };
    
    if (cnh.length > 0) {
      const rawStr = cnh.join(','); // 把数组拼回字符串方便正则匹配
      
      // 1. 提取所有形如 6.xxxx 的价格数字
      const priceRegex = /6\.\d{4}/g;
      const validPrices = [];
      let m;
      while ((m = priceRegex.exec(rawStr)) !== null) {
        validPrices.push(parseFloat(m[0]));
      }
      
      // 2. 提取时间 (HH:MM:SS)
      const timeRegex = /\d{2}:\d{2}:\d{2}/;
      const timeMatch = rawStr.match(timeRegex);
      
      // 3. 提取日期 (YYYY-MM-DD)
      const dateRegex = /\d{4}-\d{2}-\d{2}/;
      const dateMatch = rawStr.match(dateRegex);

      // 4. 赋值逻辑
      if (validPrices.length > 0) {
        // 现价通常是第一个出现的
        usdcnhData.price = validPrices[0]; 
        // 最高最低直接用 Math.max/min 算，100%准确
        usdcnhData.high = Math.max(...validPrices);
        usdcnhData.low = Math.min(...validPrices);
        
        // 昨收：通常是最后一个，或者如果价格全一样，就同现价
        usdcnhData.prevClose = validPrices.length > 1 ? validPrices[validPrices.length - 1] : validPrices[0];
        
        // 计算涨跌幅
        if (usdcnhData.prevClose > 0) {
          usdcnhData.change = ((usdcnhData.price - usdcnhData.prevClose) / usdcnhData.prevClose * 100).toFixed(2);
        }
        
        // 拼接时间
        if (dateMatch && timeMatch) {
          usdcnhData.time = `${dateMatch[0]}${timeMatch[0]}`;
        } else if (timeMatch) {
          usdcnhData.time = timeMatch[0];
        }
      }
    }

    return { crude, gold, goldSpot, dxy: dxyData, usdcnh: usdcnhData, nasdaq, hstech };

  } catch (e) {
    console.error('❌ 新浪宏观数据获取失败:', e.message);
    // 兜底返回，防止程序因为外部接口挂掉而崩溃
    return { 
      crude: { price: 0 }, 
      gold: { price: 0 }, 
      goldSpot: { price: 0 }, 
      dxy: { price: 0, change: '0' }, 
      usdcnh: { price: 0, change: '0' },
      nasdaq: { price: 0, change: '0' },
      hstech: { price: 0, change: '0' }
    };
  }
}

// 测试运行
// fetchSinaMacro().then(res => console.log(JSON.stringify(res, null, 2)));
