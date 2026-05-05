// ========== A股交易状态判断 (2026年版，北京时间) ==========
/**
 * 获取A股市场当前交易状态
 * @returns {Object} { isOpen: boolean, reason: string }
 * 
 * 数据源：上交所公告〔2025〕45号、深交所/北交所同步公告
 * 节假日安排：
 * - 元旦：1月1日-1月3日
 * - 春节：2月15日-2月23日
 * - 清明节：4月4日-4月6日
 * - 劳动节：5月1日-5月5日
 * - 端午节：6月19日-6月21日
 * - 中秋节：9月25日-9月27日
 * - 国庆节：10月1日-10月7日
 */
export function getChinaMarketStatus() {
  // ===== 强制使用北京时间 (UTC+8) =====
  const now = new Date();
  const beijingTime = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Shanghai" }));
  
  const year = beijingTime.getFullYear();
  const month = beijingTime.getMonth() + 1;
  const date = beijingTime.getDate();
  const day = beijingTime.getDay(); // 0=周日, 1=周一, ..., 6=周六
  const hour = beijingTime.getHours();
  const minute = beijingTime.getMinutes();
  const time = hour * 100 + minute;
  
  // ===== 1. 节假日休市判断 (优先于周末) =====
  if (year === 2026) {
    if (month === 1 && date >= 1 && date <= 3) {
      return { isOpen: false, reason: '元旦假期休市 (1/1-1/3)' };
    }
    if (month === 2 && date >= 15 && date <= 23) {
      return { isOpen: false, reason: '春节假期休市 (2/15-2/23)' };
    }
    if (month === 4 && date >= 4 && date <= 6) {
      return { isOpen: false, reason: '清明节假期休市 (4/4-4/6)' };
    }
    if (month === 5 && date >= 1 && date <= 5) {
      return { isOpen: false, reason: '劳动节假期休市 (5/1-5/5)' };
    }
    if (month === 6 && date >= 19 && date <= 21) {
      return { isOpen: false, reason: '端午节假期休市 (6/19-6/21)' };
    }
    if (month === 9 && date >= 25 && date <= 27) {
      return { isOpen: false, reason: '中秋节假期休市 (9/25-9/27)' };
    }
    if (month === 10 && date >= 1 && date <= 7) {
      return { isOpen: false, reason: '国庆节假期休市 (10/1-10/7)' };
    }
  }
  
  // ===== 2. 周末休市判断 =====
  if (day === 0 || day === 6) {
    return { isOpen: false, reason: '周末休市' };
  }
  
  // ===== 3. 交易时段判断 =====
  // A股交易时间规则：
  // - 开盘集合竞价：9:15-9:25
  // - 上午连续竞价：9:30-11:30
  // - 午间休市：11:30-13:00
  // - 下午连续竞价：13:00-14:57
  // - 收盘集合竞价：14:57-15:00 (深市/创业板/科创板)
  
  if (time < 915) {
    return { isOpen: false, reason: '未开盘 (9:15前)' };
  }
  
  if (time >= 915 && time < 925) {
    return { isOpen: true, reason: '开盘集合竞价中 (9:15-9:25)' };
  }
  
  if (time >= 925 && time <= 1130) {
    return { isOpen: true, reason: '上午交易中 (9:25-11:30)' };
  }
  
  if (time > 1130 && time < 1300) {
    return { isOpen: false, reason: '午间休市 (11:30-13:00)' };
  }
  
  if (time >= 1300 && time < 1457) {
    return { isOpen: true, reason: '下午交易中 (13:00-14:57)' };
  }
  
  if (time >= 1457 && time <= 1500) {
    return { isOpen: true, reason: '收盘集合竞价中 (14:57-15:00)' };
  }
  
  if (time > 1500) {
    return { isOpen: false, reason: '已收盘 (15:00后)' };
  }
  
  return { isOpen: false, reason: '未知状态' };
}