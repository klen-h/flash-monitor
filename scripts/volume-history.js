// 量比计算需要
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { CONFIG } from './config.js';

const VOL_PATH = CONFIG.PATHS.VOLUME_HISTORY || './data/volume-history.json';

function loadVolumeHistory() {
  if (!existsSync(VOL_PATH)) return {};
  try {
    return JSON.parse(readFileSync(VOL_PATH, 'utf-8'));
  } catch { return {}; }
}

function saveVolumeHistory(data) {
  writeFileSync(VOL_PATH, JSON.stringify(data, null, 2));
}

/**
 * 保存当日成交量，并返回近N日平均成交量
 */
export function recordDailyVolume(etfHoldings, keepDays = 10) {
  const history = loadVolumeHistory();
  const today = new Date().toISOString().split('T')[0];
  
  for (const h of etfHoldings) {
    if (!history[h.name]) history[h.name] = [];
    history[h.name].push({ date: today, volume: h.volume || 0 });
    // 只保留最近 keepDays 天
    history[h.name] = history[h.name].slice(-keepDays);
  }
  
  saveVolumeHistory(history);
  return history;
}

/**
 * 获取某只ETF的近N日平均成交量
 */
export function getAvgVolume(etfName, days = 5) {
  const history = loadVolumeHistory();
  const records = history[etfName];
  if (!records || records.length < 2) return null;
  const recent = records.slice(-days);
  const sum = recent.reduce((acc, r) => acc + (r.volume || 0), 0);
  return sum / recent.length;
}