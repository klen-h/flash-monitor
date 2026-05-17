import { readFileSync, writeFileSync, existsSync } from 'fs';
import { CONFIG } from './config.js';

const HISTORY_PATH = CONFIG.PATHS.MACRO_HISTORY || 'public/data/macro_history.json';

// 加载历史数组
export function loadMacroHistory() {
  if (!existsSync(HISTORY_PATH)) return [];
  try {
    return JSON.parse(readFileSync(HISTORY_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

// 追加一条快照（自动去重、限制长度）
export function appendMacroHistory(macro) {
  // console.log(macro);
  // 校验核心资产价格是否有效（不能为零或NaN）
  const coreAssets = ['brent', 'crude', 'gold', 'nasdaq', 'dxy'];
  const invalid = coreAssets.filter(k => {
    const val = macro[k]?.price;
    return !val || isNaN(val) || val <= 0;
  });
  
  if (invalid.length > 0) {
    console.warn(`⚠️ 宏观数据异常，跳过历史写入。异常资产：${invalid.join(', ')}`);
    return;
  }

  let history = loadMacroHistory();
  const now = new Date().toISOString();
  const newEntry = {
    time: now,
    brent: { price: macro.brent.price, change: parseFloat(macro.brent.change) || 0 },
    wti: { price: macro.crude.price, change: parseFloat(macro.crude.change) || 0 },
    gold: { price: macro.gold.price, change: parseFloat(macro.gold.change) || 0 },
    gld: { price: macro.gld.price, change: parseFloat(macro.gld.change) || 0 },
    us10yt: { price: macro.us10yt.price, change: parseFloat(macro.us10yt.change) || 0 },
    silver: { price: macro.silver.price, change: parseFloat(macro.silver.change) || 0 },
    copper: { price: macro.copper.price, change: parseFloat(macro.copper.change) || 0 },
    nasdaq: { price: macro.nasdaq.price, change: parseFloat(macro.nasdaq.change) || 0 },
    nke: { price: macro.nke.price, change: parseFloat(macro.nke.change) || 0 },
    hstech: { price: macro.hstech.price, change: parseFloat(macro.hstech.change) || 0 },
    dxy: { price: macro.dxy.price, change: parseFloat(macro.dxy.change) || 0 },
    usdcnh: { price: macro.usdcnh.price, change: parseFloat(macro.usdcnh.change) || 0 },
    copperOilRatio: macro.copperOilRatio,
    goldSilverRatio: macro.goldSilverRatio,
    gldRatio: macro.gldRatio,
    copperGoldRatio: macro.copperGoldRatio,
  };

  // 去重：若最后一条与当前时间相差小于 3 分钟，覆盖
  if (history.length) {
    const lastTime = new Date(history[history.length - 1].time).getTime();
    if (new Date(now).getTime() - lastTime < 3 * 60 * 1000) {
      history[history.length - 1] = newEntry;
    } else {
      history.push(newEntry);
    }
  } else {
    history.push(newEntry);
  }

  // 只保留最近 150 条
  if (history.length > 150) history = history.slice(-150);

  writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2), 'utf-8');
}