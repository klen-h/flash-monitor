import axios from 'axios';
import { CONFIG } from '../config.js';
console.log(CONFIG);

async function testQw() {
    try {
        const content = `## 📉 金十快讯 [高不确定性] <font color="warning">高度敏感，等待方向</font> 
> 时间：05/07 00:58 | 布伦特: **$101.75** (-7.39%)
> 核心叙事：**市场正在交易美伊战争可能结束的预期，但协议细节及提前泄露的交易行为使叙事脆弱。**
--- 
### 🎭 情景推演 (Scenarios)
> **协议顺利推进并签署** (中等偏低)
> 路径: 油价中枢下移。观察: <font color="comment">下周谈判声明、协议细节。</font>
> 动作: 减仓或对冲标普油气ETF；考虑加仓科技类ETF。

> **谈判陷入僵局或破裂** (中等偏高)
> 路径: 油价快速反弹。观察: <font color="comment">强硬言论、谈判延期。</font>
> 动作: 标普油气ETF博弈反弹；黄金ETF作为避险资产。

--- 
### <font color="warning">[原油][紧急]</font> **观望/调仓 标普油气ETF**
**逻辑：** 鉴于【D状态】（原油跌，黄金涨/平）规则，严禁基于“协议达成”逻辑做空黄金，也严禁抄底油气。最佳策略是等待开盘后观察联动关系。若黄金在美元走平的情况下独立走强，则可持有。
**盘面：** 逻辑自洽性检验：新闻簇高度一致，均指向协议可能性增加。需开盘后验证黄金、美元、纳指期指表现。
---
### 📅 每日策略
> **总仓位：防御为主，降低风险敞口。**
> **核心逻辑：** 市场处于地缘预期驱动波动期。首要任务是确认市场状态（是否处于D状态：原油跌+黄金涨/平）。
> **开盘清单：** 
> 1. 黄金走势：与原油暴跌是否形成负相关？
> 2. 美元指数：确认D状态下的资金流向。
> 3. 纳指期指：风险情绪是回暖还是恶化？
> 4. 油气ETF开盘价：是否充分计价？
---
**当前盘面：** 休市中`;

        const res = await axios.post(CONFIG.WECHAT_WEBHOOK, {
            msgtype: 'markdown', markdown: {
                content: content
            }
        }, { timeout: 15000 });

        if (res.data.errcode === 0) {
            console.log('📲 企微推送成功');
        } else {
            console.error('❌ 企微推送失败:', res.data.errmsg);
        }
    } catch (error) {
        console.error('❌ 网络请求失败:', error.message);
    }
}

testQw();