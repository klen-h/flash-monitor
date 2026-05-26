import fs from 'fs';
import { CONFIG } from './config.js';

export function loadState() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG.PATHS.STATE, 'utf-8'));
  } catch {
    return { lastId: '', pushedClusters: [] };
  }
}

export function saveState(state) {
  ensureDataDir();
  fs.writeFileSync(CONFIG.PATHS.STATE, JSON.stringify(state, null, 2));
}

export function saveRawData(allItems, newItems) {
  ensureDataDir();

  let history = { date: '', items: [] };
  try {
    history = JSON.parse(fs.readFileSync(CONFIG.PATHS.RAW, 'utf-8'));
  } catch {}

  const today = new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const existingIds = new Set(history.items.map(i => i.id));
  const uniqueNew = newItems.filter(i => !existingIds.has(i.id));

  history.items = [...uniqueNew, ...history.items].slice(0, 300);
  history.date = today;
  history.lastUpdated = new Date().toISOString();

  fs.writeFileSync(CONFIG.PATHS.RAW, JSON.stringify(history, null, 2));
}

export function saveAnalysis(analyzedItems) {
  ensureDataDir();

  let history = { analyses: [] };
  try {
    history = JSON.parse(fs.readFileSync(CONFIG.PATHS.ANALYSIS, 'utf-8'));
  } catch {}

  history.analyses.unshift({
    time: new Date().toISOString(),
    clusters: analyzedItems.map(i => ({
      cluster: i._cluster,
      hot: i._clusterHot,
      size: i._clusterSize,
      content: i.content.slice(0, 100),
    }))
  });

  history.analyses = history.analyses.slice(0, 50);
  fs.writeFileSync(CONFIG.PATHS.ANALYSIS, JSON.stringify(history, null, 2));
}

export function saveETFClose(holdings) {
  ensureDataDir();
  const today = new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const newData = {
    date: today,
    timestamp: new Date().toISOString(),
    holdings: holdings.map(h => ({
      name: h.name,
      code: h.code,
      price: h.price,
      prevClose: h.prevClose,
      change: h.change,
      changeStr: h.changeStr
    }))
  };

  let history = [];
  try {
    const existing = JSON.parse(fs.readFileSync(CONFIG.PATHS.ETF_CLOSE, 'utf-8'));
    if (Array.isArray(existing)) {
      history = existing.filter(d => d.date !== today);
    }
  } catch {}

  history.unshift(newData);
  history = history.slice(0, 30);
  fs.writeFileSync(CONFIG.PATHS.ETF_CLOSE, JSON.stringify(history, null, 2));
}

export function loadETFClose() {
  try {
    const data = JSON.parse(fs.readFileSync(CONFIG.PATHS.ETF_CLOSE, 'utf-8'));
    if (Array.isArray(data)) {
      return data[0] || null;
    }
    return data;
  } catch {
    return null;
  }
}

export function loadETFCloseHistory(days = 7) {
  try {
    const data = JSON.parse(fs.readFileSync(CONFIG.PATHS.ETF_CLOSE, 'utf-8'));
    if (Array.isArray(data)) {
      return data.slice(0, days);
    }
    return data ? [data] : [];
  } catch {
    return [];
  }
}

function ensureDataDir() {
  if (!fs.existsSync(CONFIG.PATHS.DATA_DIR)) {
    fs.mkdirSync(CONFIG.PATHS.DATA_DIR, { recursive: true });
  }
}
