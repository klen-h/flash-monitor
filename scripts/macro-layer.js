import axios from 'axios';

export async function fetchSinaMacro() {
  // 【修复1】增加纳指期货(hf_NQ)和恒生科技指数(rt_hkHSTECH)
  const url = 'https://hq.sinajs.cn/list=hf_CL,hf_GC,hf_XAU,DINIW,fx_susdcnh,hf_NQ,rt_hkHSTECH,hf_OIL,hf_NK,hf_SI,hf_HG';

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

    // ================= 解析 纽约原油 hf_CL =================
    const cl = map['hf_CL'] || [];
    // console.log(cl)
    const crude = {
      price: parseFloat(cl[0]) || 0,
      prevClose: parseFloat(cl[7]) || 0, // 7 是昨收/昨结算
      high: parseFloat(cl[4]) || 0,
      low: parseFloat(cl[5]) || 0,
      change: cl[7] > 0 ? ((cl[0] - cl[7]) / cl[7] * 100).toFixed(2) : '0',
      time: `${cl[12]} ${cl[6]}`,
    };

    // ================= 解析 布伦特原油 hf_OIL =================
    // 新浪代码表中布伦特原油代码是 "OIL"，请求时使用 hf_OIL
    const brent = map['hf_OIL'] || [];
    // console.log(brent);
    // 格式与 hf_CL 相同：[0]最新价, [2]昨收, [4]最高, [5]最低, [6]时间, [12]日期
    const brentData = {
      price: parseFloat(brent[0]) || 0,
      prevClose: parseFloat(brent[7]) || 0,
      high: parseFloat(brent[4]) || 0,
      low: parseFloat(brent[5]) || 0,
      change: brent[7] > 0 ? ((brent[0] - brent[7]) / brent[7] * 100).toFixed(2) : '0',
      time: `${brent[12]} ${brent[6]}`,
    };

    // ================= 解析 COMEX 黄金 hf_GC =================
    const gc = map['hf_GC'] || [];
    // console.log(gc);
    const gold = {
      price: parseFloat(gc[0]) || 0,
      prevClose: parseFloat(gc[7]) || 0, // 7 是昨收
      high: parseFloat(gc[4]) || 0,
      low: parseFloat(gc[5]) || 0,
      change: gc[7] > 0 ? ((gc[0] - gc[7]) / gc[7] * 100).toFixed(2) : '0',
      time: `${gc[12]} ${gc[6]}`,
    };

    // ================= 解析 COMEX 白银 hf_SI =================
    const si = map['hf_SI'] || [];
    // console.log(si);
    const silver = {
      price: parseFloat(si[0]) || 0,
      prevClose: parseFloat(si[7]) || 0, // 7 是昨收
      high: parseFloat(si[4]) || 0,
      low: parseFloat(si[5]) || 0,
      change: si[7] > 0 ? ((si[0] - si[7]) / si[7] * 100).toFixed(2) : '0',
      time: `${si[12]} ${si[6]}`,
    };

    // ================= 解析 美铜 hf_HG =================
    const hg = map['hf_HG'] || [];
    // console.log(hg);
    const copper = {
      price: parseFloat(hg[0]) || 0,
      prevClose: parseFloat(hg[7]) || 0, // 7 是昨收
      high: parseFloat(hg[4]) || 0,
      low: parseFloat(hg[5]) || 0,
      change: hg[7] > 0 ? ((hg[0] - hg[7]) / hg[7] * 100).toFixed(2) : '0',
      time: `${hg[12]} ${hg[6]}`,
    };

    // ================= 解析 纳指期货 hf_NQ =================
    const nq = map['hf_NQ'] || [];
    // console.log(nq);
    const nasdaq = {
      price: parseFloat(nq[0]) || 0,
      prevClose: parseFloat(nq[7]) || 0, // 7 是昨收
      high: parseFloat(nq[4]) || 0,
      low: parseFloat(nq[5]) || 0,
      change: nq[7] > 0 ? ((nq[0] - nq[7]) / nq[7] * 100).toFixed(2) : '0',
      time: `${nq[12]} ${nq[6]}`,
    };

    // ================= 解析 日经225指数 hf_NK =================
    const nk = map['hf_NK'] || [];
    // console.log(nk);
    const nke = {
      price: parseFloat(nk[0]) || 0,
      prevClose: parseFloat(nk[7]) || 0, // 7 是昨收
      high: parseFloat(nk[4]) || 0,
      low: parseFloat(nk[5]) || 0,
      change: nk[7] > 0 ? ((nk[0] - nk[7]) / nk[7] * 100).toFixed(2) : '0',
      time: `${nk[12]} ${nk[6]}`,
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
    // console.log(cnh);
    let usdcnhData = { price: 0, prevClose: 0, high: 0, low: 0, time: '', change: '0' };
    if (cnh.length > 0) {
      usdcnhData = {
        price: parseFloat(cnh[1]) || 0,
        prevClose: parseFloat(cnh[3]) || 0,
        high: parseFloat(cnh[6]) || 0,
        low: parseFloat(cnh[7]) || 0,
        change: parseFloat(cnh[10])?.toFixed(2) || '0', // 10 是涨跌幅
        time: `${cnh[17]} ${cnh[0]}`,
      };
    }

    const copperOilRatio = (brentData.price > 0) ? (copper.price / brentData.price).toFixed(2) : '0';
    // 注意：COMEX铜是美分/磅，布伦特是美元/桶。如果需要量纲对齐，铜通常用美元/吨或美元/磅，此处直接用价格比作为相对指标，追踪趋势变化而非绝对值。

    const goldSilverRatio = (silver.price > 0) ? (gold.price / silver.price).toFixed(2) : '0';

    return { 
      brent: brentData, 
      crude,
      gold, 
      goldSpot, 
      dxy: dxyData, 
      usdcnh: usdcnhData, 
      nasdaq, 
      nke, 
      hstech, 
      silver, 
      copper, 
      copperOilRatio,
      goldSilverRatio,
    };

  } catch (e) {
    console.error('❌ 新浪宏观数据获取失败:', e.message);
    // 兜底返回，防止程序因为外部接口挂掉而崩溃
    return {
      crude: { price: 0, change: '0' },
      gold: { price: 0, change: '0' },
      goldSpot: { price: 0, change: '0' },
      dxy: { price: 0, change: '0' },
      usdcnh: { price: 0, change: '0' },
      nasdaq: { price: 0, change: '0' },
      hstech: { price: 0, change: '0' },
      brent: { price: 0, change: '0' },
      nke: { price: 0, change: '0' },
      silver: { price: 0, change: '0' },
      copper: { price: 0, change: '0' },
      copperOilRatio: '0',
      goldSilverRatio: '0',
    };
  }
}

// 测试运行
// fetchSinaMacro().then(res => console.log(JSON.stringify(res, null, 2)));