// ============================================================
// 文案灵境 — 后端 API 服务
// Node.js + Express + OpenAI
// ============================================================

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');

const app = express();
const PORT = process.env.PORT || 3456;

// ---- Middleware ----
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ---- OpenAI Client ----
const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

// ---- In-memory usage tracking (reset daily) ----
const FREE_DAILY_LIMIT = 5;
const usageMap = new Map(); // ip -> { count, date }

function getUsage(ip) {
  const today = new Date().toDateString();
  const entry = usageMap.get(ip);
  if (!entry || entry.date !== today) return { count: 0, date: today };
  return entry;
}

function incrementUsage(ip) {
  const today = new Date().toDateString();
  const entry = usageMap.get(ip) || { count: 0, date: today };
  if (entry.date !== today) entry.count = 0;
  entry.count += 1;
  entry.date = today;
  usageMap.set(ip, entry);
  return entry;
}

// ---- Prompt Builder ----
function buildPrompt({ name, features, audience, platform, tone }) {
  const platformNames = {
    xiaohongshu: '小红书',
    pengyouquan: '微信朋友圈',
    taobao: '淘宝详情页',
    douyin: '抖音短视频口播',
  };

  const toneDescriptions = {
    lively: '活泼种草风格，使用大量emoji和网络热词，语气热情洋溢',
    professional: '专业可信赖风格，理性分析、数据支撑、客观中肯',
    emotional: '走心共情风格，温柔治愈、生活感悟、情感共鸣',
    trendy: '标题党/高转化风格，紧迫感强、悬念开头、强行动号召',
  };

  const platformGuides = {
    xiaohongshu: `小红书文案要求：
- 开头用emoji+感叹句抓眼球
- 正文用短句分行，像聊天一样自然
- 用"姐妹们""宝子们"等亲切称呼
- 末尾加3-5个热门话题标签 #xxx
- 整体像真实用户分享，不要太像广告
- 字数150-400字`,
    pengyouquan: `朋友圈文案要求：
- 语气像跟朋友聊天，真实自然
- 可以口语化，适当用表情
- 不要太长（80-200字）
- 强调个人真实体验
- 可加"私我拿链接"等互动引导
- 避免太硬广，要有种草感`,
    taobao: `淘宝详情页文案要求：
- 结构化展示卖点，用符号分隔
- 突出价格优势、物流保障、售后承诺
- 用感叹号营造紧迫感
- 列出3-5个核心卖点（✅❇️🔥等符号）
- 有明确的购买引导
- 字数200-500字`,
    douyin: `抖音口播脚本要求：
- 用【时间轴】标注节奏（如【0-3秒 抓眼球】）
- 开头3秒必须有强烈hook
- 短句、口语化、适合念出来
- 标注情绪提示（如夸张表情、惊喜脸）
- 15秒内完成一个完整循环
- 要有明确的促单引导（左下角链接）`,
  };

  return `你是一个专业的电商文案写手，擅长为不同平台创作高转化率的营销文案。

【平台】${platformNames[platform] || platform}
【风格】${toneDescriptions[tone] || tone}
【产品名称】${name}
【核心卖点】${features}
【目标人群】${audience || '一般消费者'}

${platformGuides[platform] || ''}

请生成3个不同角度的文案方案（方案A、方案B、方案C），用"---方案A---"、"---方案B---"、"---方案C---"作为分隔。

要求：
1. 每个方案都必须符合该平台的文案风格
2. 巧妙融入产品的核心卖点
3. 针对目标人群的语言习惯
4. 不使用"你好""欢迎"等客服语气
5. 让人看了就想点击/购买/咨询`;
}

// ---- Fallback: Template-based generation when no API key ----
function fallbackGenerate({ name, features, audience, platform, tone }) {
  const fallbacks = [
    `✨ 发现宝藏了！！【${name}】真的太绝了

${features.split('、')[0] || '效果惊艳'}
${features.split('、')[1] || '体验拉满'}
${features.split('、')[2] || '用一次就爱上'}

${audience || '所有朋友'}闭眼入！！真的不踩雷`,
    `🔥 分享一个被问爆的好东西——

【${name}】

为什么这么火？👇
· ${features.split('、')[0] || '品质在线'}
· ${features.split('、')[1] || '口碑爆棚'}
· ${features.split('、')[2] || '性价比高'}

${audience ? audience + '的朋友赶紧冲！' : '需要的赶紧安排！'}`,
    `💡 真诚推荐 | ${name}

做了很多功课，总结几点：
✅ ${features.split('、')[0] || '核心优势突出'}
✅ ${features.split('、')[1] || '细节做到位'}
✅ ${features.split('、')[2] || '用着放心'}

适合：${audience || '大多数场景'}
供参考，理性种草～`,
  ];

  return fallbacks;
}

// ---- API Route: Generate ----
app.post('/api/generate', async (req, res) => {
  try {
    const { name, features, audience, platform, tone } = req.body;

    // ---- Validate ----
    if (!name || !features) {
      return res.status(400).json({ error: '请填写产品名称和核心卖点' });
    }

    const validPlatforms = ['xiaohongshu', 'pengyouquan', 'taobao', 'douyin'];
    const validTones = ['lively', 'professional', 'emotional', 'trendy'];

    if (!validPlatforms.includes(platform)) {
      return res.status(400).json({ error: '无效的平台类型' });
    }
    if (!validTones.includes(tone)) {
      return res.status(400).json({ error: '无效的风格类型' });
    }

    // ---- Usage check ----
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const userIsPro = isPro(ip);
    const usage = getUsage(ip);

    if (!userIsPro && usage.count >= FREE_DAILY_LIMIT) {
      return res.status(429).json({
        error: `今日免费额度已用完（${FREE_DAILY_LIMIT}次/天）。升级 Pro 版 ¥19.9/月 享无限生成！`,
        usage: { used: usage.count, limit: FREE_DAILY_LIMIT },
      });
    }

    // ---- Generate ----
    let results;
    let usedAI = false;

    if (openai) {
      // Try real AI generation with timeout
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000); // 15s timeout

        const completion = await openai.chat.completions.create({
          model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
          messages: [
            { role: 'system', content: '你是专业电商文案写手。严格按照要求输出，不做额外解释。' },
            { role: 'user', content: buildPrompt({ name, features, audience, platform, tone }) },
          ],
          temperature: 0.85,
          max_tokens: 1500,
        }, { signal: controller.signal });

        clearTimeout(timeout);

        const rawText = completion.choices[0]?.message?.content || '';
        const parts = rawText.split(/---方案[A-C]---/).filter(s => s.trim());
        results = parts.length >= 3 ? parts.slice(0, 3) : [rawText, rawText, rawText];
        usedAI = true;
      } catch (aiErr) {
        console.warn('OpenAI call failed, falling back to template:', aiErr.message);
        // Fall through to template mode
      }
    }

    // Fallback to template-based generation
    if (!results) {
      results = fallbackGenerate({ name, features, audience, platform, tone });
      usedAI = false;
    }

    // ---- Track usage ----
    const updatedUsage = incrementUsage(ip);

    res.json({
      success: true,
      results: results.map(text => text.trim()),
      usage: {
        used: updatedUsage.count,
        limit: FREE_DAILY_LIMIT,
        remaining: FREE_DAILY_LIMIT - updatedUsage.count,
      },
      ai_mode: usedAI,
    });
  } catch (err) {
    console.error('Generate error:', err);
    res.status(500).json({ error: '生成失败，请稍后重试。' + (err.message || '') });
  }
});

// ---- API Route: Health ----

// ---- Pro Activation System ----
// Pre-generated activation codes (in production, generate per purchase)
const PRO_CODES = new Map([
  ['PRO-DEMO-FREE', { type: 'monthly', activatedAt: null, expiresAt: null }],
  ['PRO-TEST-001', { type: 'monthly', activatedAt: null, expiresAt: null }],
  ['PRO-TEST-002', { type: 'yearly', activatedAt: null, expiresAt: null }],
]);

// Track which IP has Pro status
const proUsers = new Map(); // ip -> { expiresAt }

// Activate Pro license
app.post('/api/activate', (req, res) => {
  const { code } = req.body;
  const ip = req.ip || req.connection.remoteAddress || 'unknown';

  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: '请输入激活码' });
  }

  const codeData = PRO_CODES.get(code.trim().toUpperCase());
  if (!codeData) {
    return res.status(400).json({ error: '激活码无效' });
  }

  if (codeData.activatedAt) {
    return res.status(400).json({ error: '激活码已被使用' });
  }

  const now = Date.now();
  const duration = codeData.type === 'yearly'
    ? 365 * 24 * 60 * 60 * 1000
    : 30 * 24 * 60 * 60 * 1000;

  codeData.activatedAt = now;
  codeData.expiresAt = now + duration;
  proUsers.set(ip, { expiresAt: now + duration, type: codeData.type });

  res.json({
    success: true,
    message: `🎉 Pro 激活成功！${codeData.type === 'yearly' ? '年费' : '月费'}会员已生效`,
    expiresAt: new Date(now + duration).toISOString(),
  });
});

// Check Pro status
app.get('/api/pro-status', (req, res) => {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const pro = proUsers.get(ip);

  if (pro && pro.expiresAt > Date.now()) {
    res.json({
      pro: true,
      expiresAt: new Date(pro.expiresAt).toISOString(),
      remaining: Math.max(0, pro.expiresAt - Date.now()),
    });
  } else {
    res.json({ pro: false });
  }
});

// Helper: check if IP is Pro
function isPro(ip) {
  const pro = proUsers.get(ip);
  return pro && pro.expiresAt > Date.now();
}

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    ai_ready: !!openai,
    free_limit: FREE_DAILY_LIMIT,
  });
});

// ---- Start ----
app.listen(PORT, () => {
  console.log(`\n🚀 文案灵境 API 已启动: http://localhost:${PORT}`);
  console.log(`📋 免费额度: ${FREE_DAILY_LIMIT} 次/天`);
  console.log(`🤖 AI 模式: ${openai ? '✅ 已启用 (OpenAI)' : '⚠️ 模板模式（设置 OPENAI_API_KEY 启用 AI）'}\n`);
});
