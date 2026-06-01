
import axios from 'axios';

function parseEMCode(fullCode) {
  if (fullCode.startsWith('sh')) return { market: '1', code: fullCode.replace('sh', '') };
  if (fullCode.startsWith('sz')) return { market: '0', code: fullCode.replace('sz', '') };
  return { market: '1', code: fullCode };
}

export async function fetchETFCapitalFlow(fullCode) {
  const { market, code } = parseEMCode(fullCode);
  try {
    const url = 'https://push2.eastmoney.com/api/qt/stock/fflow/daykline/get';
    const params = {
      lmt: 1, klt: 101, secid: market + '.' + code,
      fields1: 'f1,f2,f3,f7',
      fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63,f64,f65'
    };
    const res = await axios.get(url, { params, timeout: 8000 });
    const klines = res.data?.data?.klines;
    if (!klines || klines.length === 0) return null;
    const parts = klines[0].split(',');
    if (parts.length < 13) return null;
    return {
      code: fullCode,
      mainForceNet: parseFloat(parts[6]) || 0,
      superLargeNet: parseFloat(parts[7]) || 0,
      largeNet: parseFloat(parts[8]) || 0,
      mediumNet: parseFloat(parts[9]) || 0,
      smallNet: parseFloat(parts[10]) || 0,
      mainForceRatio: parseFloat(parts[11]) || 0,
      superLargeRatio: parseFloat(parts[12]) || 0,
    };
  } catch (e) {
    return null;
  }
}

export async function fetchAllETFCapitalFlows(holdingsMap) {
  const flows = {};
  const entries = Object.entries(holdingsMap);
  for (let i = 0; i < entries.length; i += 3) {
    const batch = entries.slice(i, i + 3);
    const results = await Promise.all(
      batch.map(async ([name, code]) => {
        const flow = await fetchETFCapitalFlow(code);
        return { name, code, flow };
      })
    );
    for (const r of results) {
      flows[r.name] = r.flow;
    }
  }
  return flows;
}

export async function fetchNorthBoundOverview() {
  try {
    const url = 'https://push2.eastmoney.com/api/qt/kamt.rtmin/get';
    const res = await axios.get(url, { timeout: 8000 });
    const s2n = res.data?.data?.s2n;
    if (!s2n) return null;
    return {
      totalNet: s2n.f51, shNet: s2n.f52, szNet: s2n.f53 };
  } catch (e) {
    return null;
  }
}
