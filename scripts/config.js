import path from 'path';
import 'dotenv/config';

export const CONFIG = {
  FLASH_COOKIE: process.env.FLASH_COOKIE || '',
  WECHAT_WEBHOOK: process.env.WECHAT_WEBHOOK || 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=c8218e08-e74d-4614-aeaf-350fc4f4a0bc',
  LLM: {
    API_KEY: process.env.LLM_API_KEY,
    BASE_URL: process.env.LLM_BASE_URL || 'https://api.siliconflow.cn/v1',
    MODEL: process.env.LLM_MODEL,
  },
  PATHS: {
    DATA_DIR: path.resolve('public/data'),
    STATE: path.resolve('public/data/flash_state.json'),
    RAW: path.resolve('public/data/flash.json'),
    ANALYSIS: path.resolve('public/data/flash_analysis.json'),
  }
};
