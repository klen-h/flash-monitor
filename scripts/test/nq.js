import axios from 'axios';

async function fetchNqFutures() {
  const code = 'ft_NQ'; // 或 ft_NQ，以实际抓包结果为准
  const url = `https://hq.sinajs.cn/list=${code}`;

  const { data } = await axios.get(url, {
    headers: {
      Referer: 'https://finance.sina.com.cn',
      UserAgent: 'Mozilla/5.0 ...'
    },
    timeout: 10000,
    responseType: 'arraybuffer' // 防止 GBK 中文乱码
  });

  const text = Buffer.from(data, 'binary').toString('latin1');
  const m = text.match(/var hq_str_([A-Za-z0-9_]+)="([^"]*)"/);
  if (!m) return null;

  const name = m[1];
  const fields = m[2].split(',');
  // 注意：外盘期货字段顺序不固定，需按源码或页面对照；
  // 下面是常见布局（仅示例，请以实际为准）：
  return {
    code: name,
    // 仅示意，务必对照网页或源码调整下标
    price: parseFloat(fields[0]),       // 最新价
    open: parseFloat(fields[1]),       // 开盘
    high: parseFloat(fields[2]),       // 最高
    low: parseFloat(fields[3]),        // 最低
    prevClose: parseFloat(fields[4]),  // 昨收
    time: fields[fields.length - 1]    // 时间通常在尾部
  };
}

fetchNqFutures().then(data => console.log(data));
