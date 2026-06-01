// 数据增强层
import { getAvgVolume } from './volume-history.js';

/**
 * 给 ETF holdings 增加量比、价格位置等衍生字段
 */
export function enrichETFData(etfHoldings, stockInfoMap = {}) {
  // stockInfoMap 可以从 yahoo finance 或本地缓存获取 52周高低点
  // 如果暂时没有，pricePosition 先跳过或根据历史收盘估算
  
  return etfHoldings.map(h => {
    const avgVol = getAvgVolume(h.name, 5);
    const volumeRatio = avgVol && avgVol > 0 ? (h.volume || 0) / avgVol : 1;
    
    // 价格位置：需要 52周高低点，暂时从 stockInfoMap 取，没有则默认0.5
    let pricePosition = 0.5;
    const info = stockInfoMap[h.name];
    if (info && info.fiftyTwoWeekHigh && info.fiftyTwoWeekLow) {
      const high = parseFloat(info.fiftyTwoWeekHigh);
      const low = parseFloat(info.fiftyTwoWeekLow);
      const price = parseFloat(h.price);
      if (high > low) {
        pricePosition = (price - low) / (high - low);
      }
    }
    
    return {
      ...h,
      volumeRatio: parseFloat(volumeRatio.toFixed(2)),
      pricePosition: parseFloat(pricePosition.toFixed(2))
    };
  });
}