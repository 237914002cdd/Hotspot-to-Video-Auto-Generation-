// ================================================================
// 内容决策看板 — 后端服务（含自动热点抓取 + 推荐引擎 + 项目联动）
// ================================================================
const express = require('express');
const fs = require('fs');
const path = require('path');
const { aggregateTrends } = require('./fetcher');

const PORT = 3456;
const DATA_DIR = path.join(__dirname, 'data');
const PROJECTS_DIR = path.join(__dirname, '..', '项目');
const TEMPLATE_DIR = path.join(__dirname, '..', '模板', '项目模板');
const COVER_TEMPLATE = path.join(TEMPLATE_DIR, '03-成品', 'template.svg');
const app = express();

app.use(express.json({ limit: '5mb' }));
app.use(express.static(__dirname));

// SSE
const clients = new Set();
function broadcast(event, payload) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) {
    try { res.write(msg); } catch (_) { clients.delete(res); }
  }
}
app.get('/api/sse', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'Access-Control-Allow-Origin': '*' });
  res.write(`event: connected\ndata: ${JSON.stringify({ ok: true })}\n\n`);
  clients.add(res);
  req.on('close', () => clients.delete(res));
});

// Data store
function ensureDataDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function collPath(name) { return path.join(DATA_DIR, `${name}.json`); }
function loadColl(name) {
  ensureDataDir();
  const fp = collPath(name);
  try { if (fs.existsSync(fp)) return JSON.parse(fs.readFileSync(fp, 'utf-8')); } catch (e) { console.warn(`[warn] ${name}:`, e.message); }
  const defaults = { hotTopics: [], ideas: [], calendar: [], reviews: [], searchWords: [], weeklyNotes: [], settings: { weights: { hot: 0.30, wall: 0.25, duration: 0.25, money: 0.20 } }, autoTopics: [] };
  return defaults[name] || [];
}
function saveColl(name, data) { ensureDataDir(); fs.writeFileSync(collPath(name), JSON.stringify(data, null, 2), 'utf-8'); }

// ===== Feature A: 选题加入时自动创建项目文件夹 =====
function todayStr() { const d = new Date(); const bj = new Date(d.getTime() + d.getTimezoneOffset() * 60000 + 480 * 60000); return bj.toISOString().slice(0, 10); }

function slugify(title) {
  const datePrefix = todayStr().replace(/-/g, '');
  // 提取英文数字字母做 slug
  const clean = title.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
  // 如果没有英文字母，用"topic"代替
  const slugPart = clean || 'topic';
  return `${datePrefix}-${slugPart}`.slice(0, 60);
}

function copyTemplateRecursively(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyTemplateRecursively(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// 覆盖原有 POST /api/data — 当 ideas 变化时自动创建项目
const originalPost = app.post;
app.post = undefined; // 需要覆盖，用 app._router 方式处理

// 重写 API
const apiRouter = express.Router();

apiRouter.get('/data', (req, res) => {
  const status = scanProjects();
  res.json({
    hotTopics: loadColl('hotTopics'),
    autoTopics: loadColl('autoTopics'),
    ideas: loadColl('ideas'),
    calendar: loadColl('calendar'),
    reviews: loadColl('reviews'),
    searchWords: loadColl('searchWords'),
    weeklyNotes: loadColl('weeklyNotes'),
    settings: loadColl('settings'),
    projects: status,
  });
});

apiRouter.post('/data', async (req, res) => {
  const body = req.body;
  const collections = ['hotTopics', 'autoTopics', 'ideas', 'calendar', 'reviews', 'searchWords', 'weeklyNotes'];
  for (const coll of collections) { if (body[coll] !== undefined) saveColl(coll, body[coll]); }
  if (body.settings) saveColl('settings', body.settings);

  // 检测新选题：如果 ideas 新增了条目，同步创建项目文件夹
  if (body.ideas) {
    const freshIdeas = body.ideas.filter(i => i.status === 'pending' || !i.synced);
    for (const idea of freshIdeas) {
      const folderName = slugify(idea.title);
      const projectPath = path.join(PROJECTS_DIR, folderName);
      if (!fs.existsSync(projectPath) && fs.existsSync(TEMPLATE_DIR)) {
        try {
          copyTemplateRecursively(TEMPLATE_DIR, projectPath);
          // 自动生成封面：用 template.svg 替换占位符
          generateCover(folderName, idea.title);
          idea.synced = true;
          idea.projectPath = folderName;
          console.log(`[project] 创建项目: ${folderName}`);
        } catch (e) {
          console.warn(`[project] 创建失败 ${folderName}:`, e.message);
        }
      } else {
        idea.synced = true; // 已存在则标记同步
      }
    }
    saveColl('ideas', body.ideas);
  }

  broadcast('data-update', { updated: Object.keys(body) });
  res.json({ ok: true });
});

apiRouter.put('/data/:collection', (req, res) => {
  saveColl(req.params.collection, req.body);
  broadcast('data-update', { collection: req.params.collection });
  res.json({ ok: true });
});

// Trigger fetch
apiRouter.post('/trigger-fetch', async (req, res) => {
  const newItems = await aggregateTrends();
  const auto = loadColl('autoTopics');
  const today = todayStr();
  const kept = auto.filter(t => t.date === today);
  const all = [...newItems, ...kept];
  const seen = new Set();
  const deduped = [];
  for (const item of all) { const key = item.title.toLowerCase().slice(0, 30); if (!seen.has(key)) { seen.add(key); deduped.push(item); } }
  saveColl('autoTopics', deduped.slice(0, 30));
  broadcast('data-update', { collection: 'autoTopics', count: newItems.length });
  res.json({ ok: true, fetched: newItems.length, total: deduped.length });
});

function todayStr() { const d = new Date(); const bj = new Date(d.getTime() + d.getTimezoneOffset() * 60000 + 480 * 60000); return bj.toISOString().slice(0, 10); }

// Brief
apiRouter.post('/brief/generate', (req, res) => {
  const hot = loadColl('hotTopics'); const auto = loadColl('autoTopics'); const today = todayStr();
  const todays = [...hot.filter(t => t.date === today), ...auto.filter(t => t.date === today)];
  const seen = new Set(); const merged = [];
  for (const t of todays) { const key = (t.title||'').toLowerCase().replace(/[^a-z0-9一-龥]/g, '').slice(0, 30); if (!seen.has(key)) { seen.add(key); merged.push(t); } }
  if (!merged.length) return res.json({ ok: true, brief: null });
  const suggestions = merged.slice(0, 5).flatMap(t => [{ title: `${t.title} 入门教程`, hot: t.score || 3, type: 'remotion-demo', source: t.source }, { title: `${t.title} 深度解读`, hot: t.score || 3, type: 'hyperframes-text', source: t.source }]).slice(0, 8);
  res.json({ ok: true, brief: { date: today, hotCount: merged.length, topHot: merged.slice(0, 3), suggestions } });
});

// Recommendation engine
apiRouter.post('/today/recommend', (req, res) => {
  const hot = loadColl('hotTopics'); const auto = loadColl('autoTopics'); const today = todayStr();
  const todays = [...hot.filter(t => t.date === today), ...auto.filter(t => t.date === today)];
  const seen = new Set(); const merged = [];
  for (const t of todays) { const key = (t.title||'').toLowerCase().replace(/[^a-z0-9一-龥]/g, '').slice(0, 30); if (!seen.has(key)) { seen.add(key); merged.push(t); } }
  if (!merged.length) return res.json({ ok: true, recommendations: [] });
  const yourStrengths = ['claude','figma','design','ui','ux','visual','architecture','建筑','css','html','react','animation','代码','编程','product','产品','pm','prototype','原型','app','prompt','提示词','workflow','工作流','自动化','tutorial','教程','guide','指南','入门','beginner','starter','agent','智能体','tool','工具','pipeline','frontend','web','interface','界面','交互','code','developer','dev','engineer','build','builder','ppt','presentation','slide','笔记','writing','write','video','render','动画','motion','creative'];
  const monetizable = ['tool','工具','saas','平台','app','product','productivity','效率','自动化','pipeline','workflow','工作流','template','模板','tutorial','教程','course','课程'];
  const recommendations = merged.map(item => {
    const text = `${item.title} ${item.trend || ''}`.toLowerCase();
    const sourceScore = item.score || 3;
    const hotScore = sourceScore;
    const strengthMatch = yourStrengths.filter(s => text.includes(s)).length;
    let wallScore = 3; if (strengthMatch >= 3) wallScore = 5; else if (strengthMatch >= 2) wallScore = 4;
    let durScore = 2; if (item.source === 'github') durScore = 4; else if (item.source === 'hackernews') durScore = 3;
    if (text.includes('tutorial') || text.includes('教程') || text.includes('入门') || text.includes('guide') || text.includes('awesome')) durScore = 5;
    if (text.includes('agent') || text.includes('ai ')) durScore = Math.max(durScore, 4);
    const moneyMatch = monetizable.filter(s => text.includes(s)).length;
    let moneyScore = 2; if (moneyMatch >= 2) moneyScore = 4; else if (moneyMatch >= 1) moneyScore = 3;
    if (item.source === 'github') moneyScore = Math.max(moneyScore, 3);
    const score = +(hotScore * 0.30 + wallScore * 0.25 + durScore * 0.25 + moneyScore * 0.20).toFixed(2);
    const pri = score >= 4 ? 'P0' : score >= 3.5 ? 'P1' : score >= 3 ? 'P2' : '跳过';
    const reasons = [];
    if (strengthMatch >= 2) reasons.push(`匹配你的能力（${yourStrengths.filter(s => text.includes(s)).slice(0, 3).join('/')}）`);
    if (hotScore >= 4) reasons.push('当前热度高');
    if (wallScore >= 4) reasons.push('你能做出差异化，壁垒高');
    if (durScore >= 4) reasons.push('长尾流量，长期有效');
    if (moneyScore >= 3) reasons.push('有变现空间');
    const reasonsText = reasons.length ? reasons.join('；') : '常规选题';
    let suggestedFormat = 'hyperframes-text';
    if (text.includes('vs') || text.includes('compar') || text.includes('对比') || (text.includes('claude') && text.includes('figma')) || (strengthMatch >= 2 && text.includes('design'))) suggestedFormat = 'remotion-compare';
    else if (wallScore >= 4) suggestedFormat = 'remotion-compare';
    else if (text.includes('ppt') || text.includes('slide') || text.includes('演示')) suggestedFormat = 'remotion-demo';
    else if (text.includes('tutorial') || text.includes('教程') || text.includes('入门')) suggestedFormat = 'remotion-demo';
    else if (text.includes('review') || text.includes('盘点') || text.includes('awesome')) suggestedFormat = 'hyperframes-narrate';
    let suggestedPlatform = 'both';
    if (suggestedFormat === 'remotion-demo' || suggestedFormat === 'remotion-compare') { suggestedPlatform = 'douyin'; }
    if (suggestedFormat === 'hyperframes-narrate' || suggestedFormat === 'hyperframes-text') { suggestedPlatform = 'xiaohongshu'; }
    if (strengthMatch >= 3 || text.includes('tutorial') || text.includes('教程')) { suggestedPlatform = 'both'; }
    if (text.includes('盘点') || text.includes('awesome') || text.includes('review')) { suggestedPlatform = 'xiaohongshu'; }
    if (text.includes('vs') || text.includes('对比') || text.includes('compar')) { suggestedPlatform = 'douyin'; }
    return { title: item.title, source: item.source, url: item.url || '', trend: item.trend || '', hotScore, wallScore, durScore, moneyScore, score, pri, reason: reasonsText, format: suggestedFormat, platform: suggestedPlatform };
  });
  recommendations.sort((a, b) => b.score - a.score);
  const p0 = recommendations.filter(r => r.pri === 'P0'); const p1 = recommendations.filter(r => r.pri === 'P1'); const p2 = recommendations.filter(r => r.pri === 'P2'); const skip = recommendations.filter(r => r.pri === '跳过');
  res.json({ ok: true, total: merged.length, recommendations: recommendations.slice(0, 15), groups: { p0: p0.length, p1: p1.length, p2: p2.length, skip: skip.length } });
});

// ===== Feature B: 扫描项目目录 =====
function scanProjects() {
  const statusList = [];
  if (!fs.existsSync(PROJECTS_DIR)) return statusList;
  const entries = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const projectPath = path.join(PROJECTS_DIR, entry.name);
    // 跳过隐藏目录和非标准目录
    if (entry.name.startsWith('.') || entry.name.startsWith('_') || entry.name === '-') continue;
    // 必须包含 01-内容方案 才认为是视频项目
    if (!fs.existsSync(path.join(projectPath, '01-内容方案'))) continue;
    const deliverablesPath = path.join(projectPath, '03-成品');
    const hasDeliverables = fs.existsSync(deliverablesPath);
    const cPath = path.join(projectPath, '01-内容方案');
    const hasContent = fs.existsSync(cPath);

    // 检测是否有视频文件、封面、文案
    let videoCount = 0;
    let hasCover = false;
    let hasCopy = false;
    if (hasDeliverables) {
      try {
        const files = fs.readdirSync(deliverablesPath);
        videoCount = files.filter(f => f.endsWith('.mp4')).length;
        hasCover = files.some(f => f.endsWith('.svg') || f.endsWith('.png'));
      } catch(e) {}
    }
    if (hasContent) {
      try {
        const files = fs.readdirSync(cPath);
        hasCopy = files.some(f => f.endsWith('.md') && f !== 'README.md');
      } catch(e) {}
    }

    let status, statusLabel;
    if (videoCount > 0 && hasCover && hasCopy) {
      status = 'completed'; statusLabel = '✨ 100% 完工';
    } else if (videoCount > 0) {
      status = 'video_ready'; statusLabel = '🎬 视频已成/待包装';
    } else {
      status = 'in_progress'; statusLabel = '⏳ 制作中';
    }

    // 检测是否有 index.html（脚本）— 扫描根目录和 hyperframes/ 子目录
    let hasScript = fs.existsSync(path.resolve(projectPath, 'index.html'));
    if (!hasScript) {
      hasScript = fs.existsSync(path.resolve(projectPath, 'hyperframes', 'index.html'));
    }

    statusList.push({
      name: entry.name,
      path: entry.name,
      videoCount,
      hasCover,
      hasCopy,
      hasScript,
      status,
      statusLabel,
    });
  }
  return statusList;
}

// ===== Feature C: 智能封面生成（从 video-plan.md 动态提取） =====
function parsePlanForCover(slug) {
  const planPath = path.join(PROJECTS_DIR, slug, '01-内容方案', 'video-plan.md');
  const copyPath = path.join(PROJECTS_DIR, slug, '01-内容方案', 'short-video-copy.md');
  let text = slug;

  if (fs.existsSync(planPath)) {
    try { const c = fs.readFileSync(planPath, 'utf-8').trim(); if (c) text = c; } catch(e) {}
  } else if (fs.existsSync(copyPath)) {
    try { const c = fs.readFileSync(copyPath, 'utf-8').trim(); if (c) text = c; } catch(e) {}
  }

  // 从文本中提取所有行
  const lines = text.split('\n').filter(l => l.trim());

  // 从 # 标题中提取主标题
  let titleLine1 = '', titleLine2 = '指南';
  const firstHash = lines.find(l => l.trim().startsWith('# ') || l.trim().match(/^##?\s/));
  if (firstHash) {
    const rawTitle = firstHash.replace(/^##?\s*/, '').trim();
    // 按标点/空格分割，或者按长度
    const mid = Math.min(Math.ceil(rawTitle.length / 2), 12);
    titleLine1 = rawTitle.slice(0, mid).trim();
    titleLine2 = rawTitle.slice(mid).trim() || '指南';
  } else {
    const words = text.replace(/^[#\s*]+/, '').trim().split(/[\s,，、_\-—]+/).filter(w => w.length > 1);
    titleLine1 = words.slice(0, Math.min(words.length, 3)).join(' ') || slug;
    titleLine2 = words.slice(3, 5).join(' ') || '指南';
  }

  // 从 ## 子标题提取特性
  const subTitles = lines.filter(l => l.trim().startsWith('##') && !l.trim().startsWith('###')).slice(0, 3).map(l => l.replace(/^##\s*/, '').replace(/\([^)]*\)/g, '').trim());

  // 提取副标题（第二行非空非标题行）
  let subtitle = '点击查看详情';
  const nonTitleLines = lines.filter(l => !l.startsWith('#') && l.trim().length > 0 && l.trim().length < 60);
  if (nonTitleLines.length > 0) subtitle = nonTitleLines[0].trim().replace(/^[-\s*·◆]+/, '');

  // 从 ## 子标题提取特性
  const subItems = lines.filter(l => l.trim().match(/^##\s+/)).slice(0, 4);
  const cleanFeature = function(s) {
    if (!s) return null;
    // 提取数字编号后的文字，去掉时间标记
    var cleaned = s.replace(/^##\s*/, '').replace(/^\s*\d+\s*[-.、．\s]+/, '').replace(/\s*\([^)]*\)/g, '').replace(/\s*~?\d+\s*[s秒]+\s*$/g, '').replace(/\|.*/, '').trim();
    return cleaned.length > 2 ? cleaned.slice(0, 18) : null;
  };
  // 提取非标题非时间符号的正文行
  const bodySentences = lines.filter(function(l) {
    return !l.trim().match(/^#/) && !l.trim().match(/^>/) && !l.trim().match(/^\|/) && l.trim().length > 5 && l.trim().length < 80;
  }).map(function(l) { return l.replace(/^[-•·\s]+/, '').trim(); }).filter(function(l) { return l.length > 4; });

  let feature1 = cleanFeature(subItems[0]) || (bodySentences[0] ? bodySentences[0].slice(0, 18) : '🔥 热门推荐');
  let feature2 = cleanFeature(subItems[1]) || (bodySentences[1] ? bodySentences[1].slice(0, 18) : '⚡ 快速上手');
  let feature3 = cleanFeature(subItems[2]) || (bodySentences[2] ? bodySentences[2].slice(0, 18) : '📊 数据分析');
  // 如果特性包含 '#' 说明提取不干净，降级
  if (feature1 && feature1.includes('#')) feature1 = bodySentences[0] ? bodySentences[0].slice(0, 18) : '🔥 热门推荐';
  if (feature2 && feature2.includes('#')) feature2 = bodySentences[1] ? bodySentences[1].slice(0, 18) : '⚡ 快速上手';
  if (feature3 && feature3.includes('#')) feature3 = bodySentences[2] ? bodySentences[2].slice(0, 18) : '📊 数据分析';

  // 提取数字做标签值
  const nums = text.match(/\d+/g) || [];
  const tag1Val = nums[0] ? nums[0] + (nums[0].length < 4 ? '+' : '') : '10万+';

  return {
    badge: text.includes('2026') ? '2026 最新' : (text.includes('AI') ? 'AI 工具' : '热门推荐'),
    titleLine1: titleLine1 || '新项目',
    titleLine2: titleLine2 || '指南',
    subtitle: subtitle,
    feature1: feature1,
    feature2: feature2,
    feature3: feature3,
    tag1Label: '关注',
    tag1Val: tag1Val,
    tag2Label: '类型',
    tag2Val: text.includes('教程') ? '教程' : text.includes('AI') ? 'AI' : text.includes('签证') ? '攻略' : '指南',
    tag3Label: '状态',
    tag3Val: 'NEW',
    cta: '👆 链接在评论区',
    footer: 'PROMPT · BUILD · DELIVER',
  };
}

function generateCover(projectSlug, titleHint) {
  const templatePath = COVER_TEMPLATE;
  if (!fs.existsSync(templatePath)) return;
  const coverDest = path.join(PROJECTS_DIR, projectSlug, '03-成品', 'cover.svg');
  const designDest = path.join(PROJECTS_DIR, projectSlug, '02-制作文件', 'cover.svg');
  try {
    let svg = fs.readFileSync(templatePath, 'utf-8');
    const data = titleHint
      ? { badge: '⚡ AI TOOL', titleLine1: (titleHint.split(/[\s-]/).slice(0,2).join(' ')) || 'NEW', titleLine2: 'RELEASE', subtitle: '点击查看详情', feature1: '🔥 热门推荐', feature2: '⚡ 快速上手', feature3: '📊 数据分析', tag1Label: 'RATING', tag1Val: 'TOP 1', tag2Label: 'STARS', tag2Val: '1.8k', tag3Label: 'STATUS', tag3Val: 'NEW', cta: '👆 链接在评论区', footer: 'PROMPT · BUILD · DELIVER' }
      : parsePlanForCover(projectSlug);
    const map = { '{{BADGE}}': data.badge, '{{TITLE_LINE_1}}': data.titleLine1, '{{TITLE_LINE_2}}': data.titleLine2, '{{SUBTITLE}}': data.subtitle, '{{FEATURE_1}}': data.feature1, '{{FEATURE_2}}': data.feature2, '{{FEATURE_3}}': data.feature3, '{{TAG_1_LABEL}}': data.tag1Label, '{{TAG_1_VAL}}': data.tag1Val, '{{TAG_2_LABEL}}': data.tag2Label, '{{TAG_2_VAL}}': data.tag2Val, '{{TAG_3_LABEL}}': data.tag3Label, '{{TAG_3_VAL}}': data.tag3Val, '{{CTA}}': data.cta, '{{FOOTER}}': data.footer };
    for (const [k, v] of Object.entries(map)) svg = svg.replaceAll(k, v);
    if (fs.existsSync(path.dirname(designDest))) fs.writeFileSync(designDest, svg, 'utf-8');
    fs.writeFileSync(coverDest, svg, 'utf-8');
    console.log(`[cover] 已生成: ${projectSlug}`);
  } catch (e) {
    console.warn(`[cover] 生成失败: ${projectSlug}: ${e.message}`);
  }
}

// ===== API: AI 智能封面生成 =====
apiRouter.post('/projects/generate-cover-svg', (req, res) => {
  const { slug } = req.body;
  if (!slug) return res.status(400).json({ ok: false, error: '缺少 slug' });
  const projectDir = path.join(PROJECTS_DIR, slug);
  if (!fs.existsSync(projectDir)) return res.status(404).json({ ok: false, error: '项目不存在' });

  const data = parsePlanForCover(slug);

  const templatePath = COVER_TEMPLATE;
  if (!fs.existsSync(templatePath)) return res.status(500).json({ ok: false, error: '模板不存在' });

  try {
    let svg = fs.readFileSync(templatePath, 'utf-8');
    const map = { '{{BADGE}}': data.badge, '{{TITLE_LINE_1}}': data.titleLine1, '{{TITLE_LINE_2}}': data.titleLine2, '{{SUBTITLE}}': data.subtitle, '{{FEATURE_1}}': data.feature1, '{{FEATURE_2}}': data.feature2, '{{FEATURE_3}}': data.feature3, '{{TAG_1_LABEL}}': data.tag1Label, '{{TAG_1_VAL}}': data.tag1Val, '{{TAG_2_LABEL}}': data.tag2Label, '{{TAG_2_VAL}}': data.tag2Val, '{{TAG_3_LABEL}}': data.tag3Label, '{{TAG_3_VAL}}': data.tag3Val, '{{CTA}}': data.cta, '{{FOOTER}}': data.footer };
    for (const [k, v] of Object.entries(map)) svg = svg.replaceAll(k, v);

    const designDir = path.join(projectDir, '02-制作文件');
    if (!fs.existsSync(designDir)) fs.mkdirSync(designDir, { recursive: true });
    fs.writeFileSync(path.join(designDir, 'cover.svg'), svg, 'utf-8');

    const deliverablesDir = path.join(projectDir, '03-成品');
    if (fs.existsSync(deliverablesDir)) fs.writeFileSync(path.join(deliverablesDir, 'cover.svg'), svg, 'utf-8');

    console.log(`[cover-api] 智能封面已生成: ${slug}`);
    res.json({ ok: true, slug, fields: data });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ===== Feature D: 封面微调 API =====
apiRouter.post('/projects/update-cover', (req, res) => {
  const { slug, fields } = req.body;
  if (!slug || !fields) return res.status(400).json({ ok: false, error: '缺少参数' });
  const coverPath = path.join(PROJECTS_DIR, slug, '03-成品', 'cover.svg');
  if (!fs.existsSync(coverPath)) return res.status(404).json({ ok: false, error: '封面文件不存在' });
  try {
    let svg = fs.readFileSync(coverPath, 'utf-8');
    for (const [key, val] of Object.entries(fields)) {
      svg = svg.replaceAll(`{{${key}}}`, val);
    }
    fs.writeFileSync(coverPath, svg, 'utf-8');
    console.log(`[cover] 已更新: ${slug}`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 项目状态扫描 API
apiRouter.get('/projects', (req, res) => {
  res.json({ projects: scanProjects() });
});

// ===== Phase 3.2: AI 脚本生成 + 保存 =====

// 模拟 AI 剧本生成（无 LLM API 时的 mock）
const MOCK_HTML_TEMPLATE = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=1080, height=1920" />
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{margin:0;width:1080px;height:1920px;overflow:hidden;background:#000;font-family:-apple-system,"Helvetica Neue","SF Pro Display",sans-serif;-webkit-font-smoothing:antialiased;color:#fff}
.clip{position:absolute}.abs{position:absolute}
.pill{display:inline-flex;align-items:center;gap:14px;padding:18px 40px;border-radius:100px;font-size:32px;font-weight:500;color:rgba(255,255,255,0.5);background:rgba(255,255,255,0.04);backdrop-filter:blur(60px);border:0.5px solid rgba(255,255,255,0.06)}
.h1{font-size:96px;font-weight:700;line-height:1.1;letter-spacing:-2px}
.h1 .lt{font-weight:400;color:rgba(255,255,255,0.45)}
.card{padding:40px 48px;border-radius:44px;background:rgba(255,255,255,0.03);border:0.5px solid rgba(255,255,255,0.05)}
.sn{position:absolute;top:5%;right:6%;font-size:27px;font-weight:500;color:rgba(255,255,255,0.15);letter-spacing:3px;z-index:5}
.sub{position:absolute;bottom:100px;left:60px;right:60px;padding:20px 36px;border-radius:32px;background:rgba(0,0,0,0.5);backdrop-filter:blur(60px);text-align:center;pointer-events:none;z-index:100}
.sub-t{font-size:36px;font-weight:400;color:rgba(255,255,255,0.9);line-height:1.4}
.bg-g{background:radial-gradient(ellipse 80% 40% at 50% 20%,rgba(10,132,255,0.08),transparent)}
.tag{display:inline-flex;padding:16px 38px;border-radius:100px;font-size:32px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.06)}
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="30" data-width="1080" data-height="1920">
  <div class="clip" data-start="0" data-duration="6" data-track-index="0" style="inset:0"><div class="bg-g" style="position:absolute;inset:0"></div></div>
  <div class="clip" data-start="0" data-duration="6" data-track-index="1" style="inset:0">
    <div class="sn">01 / 04</div>
    <div id="s1-title" class="h1" style="position:absolute;top:32%;left:6%;right:6%;text-align:center;opacity:0">标题占位<br><span class="lt">副标题占位</span></div>
    <div id="s1-sub" style="position:absolute;top:52%;left:6%;right:6%;text-align:center;opacity:0;font-size:36px;color:rgba(255,255,255,0.35)">描述占位</div>
  </div>
  <div class="clip sub" id="subBar" data-start="0" data-duration="30" data-track-index="2" style="opacity:0"><div class="sub-t" id="subText"></div></div>
</div>
<script>
window.__timelines = window.__timelines || {};
var tl = gsap.timeline({ paused: true });
var subs = ['第一句', '第二句', '第三句'];

// S1
tl.fromTo("#s1-title", {opacity:0,y:60,scale:0.95,skewX:-4}, {opacity:1,y:0,scale:1,skewX:0,duration:0.7,ease:"back.out(1.2)"}, 0.5);
tl.call(function(){document.getElementById('subText').textContent=subs[0];document.getElementById('subBar').style.opacity='1';},[],0.3);

window.__timelines["main"] = tl;
</script>
</body>
</html>`;

apiRouter.post('/projects/generate-blueprint', (req, res) => {
  const { slug, topic } = req.body;
  if (!slug) return res.status(400).json({ ok: false, error: '缺少 slug' });

  // === 读取 SOP 标准的视频方案文件 ===
  const planPath = path.join(PROJECTS_DIR, slug, '01-内容方案', 'video-plan.md');
  let context = topic || slug;
  if (fs.existsSync(planPath)) {
    try {
      const planContent = fs.readFileSync(planPath, 'utf-8').trim();
      if (planContent) context = planContent;
    } catch(e) {}
  }

  // === 基于 context 动态生成 HTML ===
  // 将主题/方案内容拆出行数和关键词
  const lines = context.split('\n').filter(l => l.trim());
  const titleLine = lines.find(l => l.includes('主题') || l.includes('标题') || l.includes('#')) || context.slice(0, 30);
  const cleanTitle = titleLine.replace(/^[#\s*]+/, '').trim();
  const subtitleLine = lines.find(l => l.includes('副标题') || l.includes('描述')) || '';
  const cleanSub = subtitleLine.replace(/^[#\s*-]+/, '').trim() || 'AI 自动生成';

  // 动态构建 HTML — 严格遵循 SOP GSAP 规范
  const sceneCount = Math.min(Math.max(Math.ceil(lines.length / 2), 3), 6);
  let scenesHtml = '';
  let gsapAnimations = '';
  let subsScript = '';
  const subs = [];

  for (let i = 0; i < sceneCount; i++) {
    const sceneTitle = lines[i * 2] || `场景 ${i + 1}`;
    const sceneDesc = lines[i * 2 + 1] || `${cleanTitle} 详细介绍`;
    const cleanSceneTitle = sceneTitle.replace(/^[#\s*-]+/, '').trim();
    const startTime = i * 6;
    const duration = 6;
    subs.push(cleanSceneTitle);

    scenesHtml += `
  <div class="clip" data-start="${startTime}" data-duration="${duration}" data-track-index="0" style="inset:0;opacity:${i === 0 ? 1 : 0}"><div class="bg-g" style="position:absolute;inset:0"></div></div>
  <div class="clip" data-start="${startTime}" data-duration="${duration}" data-track-index="1" style="inset:0;opacity:${i === 0 ? 1 : 0}">
    <div class="sn">${String(i + 1).padStart(2, '0')} / ${String(sceneCount).padStart(2, '0')}</div>
    <div class="h1" style="position:absolute;top:32%;left:6%;right:6%;text-align:center;opacity:0" id="t${i}">${cleanSceneTitle}<br><span class="lt">${i < sceneCount - 1 ? '继续' : cleanSub}</span></div>
  </div>`;

    gsapAnimations += `tl.fromTo("#t${i}", {opacity:0,y:60,scale:0.95,skewX:-4}, {opacity:1,y:0,scale:1,skewX:0,duration:0.7,ease:"back.out(1.2)"}, ${startTime + 0.5});\n`;
    gsapAnimations += `tl.call(function(){document.getElementById('subText').textContent=subs[${i}];document.getElementById('subBar').style.opacity='1';},[],${startTime + 0.3});\n`;
    gsapAnimations += `tl.to("#subBar",{opacity:0,duration:0.3},${startTime + duration - 0.5});\n`;

    if (i < sceneCount - 1) {
      gsapAnimations += `tl.to(".clip[data-start='${startTime}']", {opacity:0,duration:0.3},${startTime + duration - 0.3});\n`;
      gsapAnimations += `tl.to(".clip[data-start='${startTime + duration}']", {opacity:1,duration:0.4},${startTime + duration});\n`;
    }
  }

  const totalDuration = sceneCount * 6;
  subsScript = `var subs = [${subs.map(s => `'${s.replace(/'/g, "\\'")}'`).join(',')}];`;

  const generatedHtml = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" /><meta name="viewport" content="width=1080,height=1920"/>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{margin:0;width:1080px;height:1920px;overflow:hidden;background:#000;font-family:-apple-system,"Helvetica Neue","SF Pro Display",sans-serif;-webkit-font-smoothing:antialiased;color:#fff}
.clip{position:absolute}
.h1{font-size:96px;font-weight:700;line-height:1.1;letter-spacing:-2px;text-align:center}
.h1 .lt{font-weight:400;color:rgba(255,255,255,0.45)}
.sn{position:absolute;top:5%;right:6%;font-size:27px;font-weight:500;color:rgba(255,255,255,0.15);letter-spacing:3px;z-index:5}
.bg-g{background:radial-gradient(ellipse 80% 40% at 50% 20%,rgba(10,132,255,0.08),transparent)}
.sub{position:absolute;bottom:100px;left:60px;right:60px;padding:20px 36px;border-radius:32px;background:rgba(0,0,0,0.5);backdrop-filter:blur(60px);text-align:center;pointer-events:none;z-index:100}
.sub-t{font-size:36px;font-weight:400;color:rgba(255,255,255,0.9);line-height:1.4}
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${totalDuration}" data-width="1080" data-height="1920">
  <div class="clip sub" id="subBar" data-start="0" data-duration="${totalDuration}" data-track-index="2" style="opacity:0"><div class="sub-t" id="subText"></div></div>
  ${scenesHtml}
  <audio id="narration-audio" data-start="0" data-duration="${totalDuration}" data-track-index="3" src="assets/narration.mp3"></audio>
</div>
<script>
window.__timelines = window.__timelines || {};
var tl = gsap.timeline({ paused: true });
${subsScript}
${gsapAnimations}
window.__timelines["main"] = tl;
</script>
</body>
</html>`;

  // === 基于 context 动态生成社交文案（从 plan 中提取内容） ===
  // 提取 plan 中的关键句作为特性
  const planLines = context.split('\n').filter(l => l.trim());
  // 找到不带 # 符号的真实内容句
  const realSentences = planLines.filter(l => !l.trim().startsWith('#') && !l.trim().startsWith('>') && !l.trim().match(/^[\|\-\s]+$/) && l.trim().length > 5 && l.trim().length < 100);
  // 进一步过滤：排除只包含分隔符或格式符号的行
  const cleanLines = realSentences.filter(l => !l.trim().match(/^[\|\-:\s]+$/) && !l.trim().match(/^\|.+?\|.+?\|/));
  const tag = context.includes('2026') || context.includes('WHV') ? '#2026最新' : (context.includes('AI') ? '#AI工具' : '#推荐');

  // 提取表格中的口播文案列
  const tableLines = planLines.filter(l => l.trim().startsWith('|')).slice(2);
  const speechLines = tableLines.map(l => {
    var cols = l.split('|').filter(function(c){return c.trim();});
    return cols[2] ? cols[2].trim().replace(/\*\*/g, '') : null;
  }).filter(function(s){return s && s.length > 5 && s.length < 100;});

  const featureSource = speechLines.length >= 3 ? speechLines : cleanLines;
  const features = featureSource.slice(0, 5).map(s => s.replace(/^[-•·\s\|\*]+/, '').replace(/\|.*/, '').replace(/\*\*/g, '').trim()).filter(s => s.length > 4);
  const f1 = features[0] ? features[0].slice(0, 25) : '详情点击查看';
  const f2 = features[1] ? features[1].slice(0, 25) : '快速上手';
  const f3 = features[2] ? features[2].slice(0, 25) : '值得一试';

  const copy = {
    xiaohongshu: {
      title: `🔥 ${cleanTitle || '最新发现'}！你一定要知道`,
      body: `最近发现了这个真的太惊喜了 🎉\n\n📌 ${cleanTitle}\n\n简单说几个重点 👇\n\n① ${f1}\n② ${f2}\n③ ${f3}\n\n链接在评论区，去试试！\n\n${tag} #推荐`,
      tags: `${tag} #推荐`,
    },
    douyin: {
      title: `${cleanTitle || '这个工具'}也太强了吧 🔥`,
      body: `${cleanTitle}！\n\n${f1}\n\n链接在评论区 👇\n\n${tag} #效率 #推荐`,
      tags: `${tag} #效率 #推荐`,
    },
  };

  res.json({ ok: true, slug, html: generatedHtml, copy });
});

apiRouter.post('/projects/save-script', (req, res) => {
  const { slug, html_content, copy_content } = req.body;
  if (!slug || !html_content) return res.status(400).json({ ok: false, error: '缺少参数' });
  const projectPath = path.join(PROJECTS_DIR, slug);
  if (!fs.existsSync(projectPath)) return res.status(404).json({ ok: false, error: '项目目录不存在' });
  try {
    // 写入 index.html
    fs.writeFileSync(path.join(projectPath, 'index.html'), html_content, 'utf-8');
    console.log(`[script] 已写入: ${slug}/index.html`);

    // 记录执行开始时间到 meta.json
    const metaPath = path.join(projectPath, 'meta.json');
    let meta = {};
    if (fs.existsSync(metaPath)) {
      try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')); } catch(e) {}
    }
    meta.executionStartedAt = new Date().toISOString();
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
    console.log(`[script] 执行计时开始: ${slug}`);

    // 同时写文案到 SOP 标准路径 01-内容方案/short-video-copy.md
    if (copy_content) {
      const copyDir = path.join(projectPath, '01-内容方案');
      if (!fs.existsSync(copyDir)) fs.mkdirSync(copyDir, { recursive: true });
      fs.writeFileSync(path.join(copyDir, 'short-video-copy.md'), copy_content, 'utf-8');
      console.log(`[script] 文案已写入: ${slug}/01-内容方案/short-video-copy.md`);
    }

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ===== Phase 4.2: 渲染自动化 =====

// 渲染状态存储（内存中，服务重启后重置）
const renderJobs = {};

apiRouter.post('/projects/render', (req, res) => {
  const { slug } = req.body;
  if (!slug) return res.status(400).json({ ok: false, error: '缺少 slug' });

  const projectDir = path.join(PROJECTS_DIR, slug);
  if (!fs.existsSync(projectDir)) return res.status(404).json({ ok: false, error: '项目目录不存在' });

  const htmlPath = path.join(projectDir, 'index.html');
  if (!fs.existsSync(htmlPath)) return res.status(400).json({ ok: false, error: 'index.html 不存在，请先生成剧本' });

  // 标记渲染中
  renderJobs[slug] = { status: 'rendering', startedAt: Date.now() };

  // 非阻塞异步执行
  const child = require('child_process');
  child.exec('npx hyperframes render', { cwd: projectDir, timeout: 600000 }, (err, stdout, stderr) => {
    if (err) {
      renderJobs[slug] = { status: 'failed', error: stderr || err.message };
      console.log(`[render] 失败 ${slug}: ${err.message}`);
      return;
    }
    // 提取 MP4 输出路径
    const match = stdout.match(/(renders\/[^\s]+\.mp4)/);
    const outputPath = match ? match[1] : null;
    renderJobs[slug] = { status: 'completed', output: outputPath, stderr };
    console.log(`[render] 完成 ${slug}: ${outputPath || '未知路径'}`);
  });

  res.json({ ok: true, status: 'rendering', slug });
});

apiRouter.get('/projects/render-status/:slug', (req, res) => {
  const { slug } = req.params;
  const job = renderJobs[slug];
  if (!job) return res.json({ ok: true, status: 'idle', slug });
  res.json({ ok: true, slug, ...job });
});

// ===== Phase 4.3: 本地资产一键外呼 =====
apiRouter.post('/projects/open-folder', (req, res) => {
  const { slug, sub } = req.body;
  if (!slug) return res.status(400).json({ ok: false, error: '缺少 slug' });
  const target = sub
    ? path.resolve(PROJECTS_DIR, slug, sub)
    : path.resolve(PROJECTS_DIR, slug);
  if (!fs.existsSync(target)) return res.status(404).json({ ok: false, error: '路径不存在' });
  require('child_process').exec('cmd.exe /c start "" "' + target + '"', function(err) {
    if (err) return res.status(500).json({ ok: false, error: err.message });
    res.json({ ok: true });
  });
});

// ===== Phase 6.1: 终极归档 =====
const OBSIDIAN_LOG = path.join(__dirname, '..', 'Obsidian_Notes', '项目发布记录.md');

apiRouter.post('/projects/archive', (req, res) => {
  const { slug } = req.body;
  if (!slug) return res.status(400).json({ ok: false, error: '缺少 slug' });

  const projectDir = path.join(PROJECTS_DIR, slug);
  if (!fs.existsSync(projectDir)) return res.status(404).json({ ok: false, error: '项目不存在' });

  const deliverablesDir = path.join(projectDir, '03-成品');
  const rendersDir = path.join(projectDir, 'renders');
  const contentDir = path.join(projectDir, '01-内容方案');
  const recordDir = path.join(projectDir, '04-项目记录');
  const coverDesignDir = path.join(projectDir, '02-制作文件');

  // 确保目录
  if (!fs.existsSync(recordDir)) fs.mkdirSync(recordDir, { recursive: true });
  if (!fs.existsSync(deliverablesDir)) fs.mkdirSync(deliverablesDir, { recursive: true });

  // 1. 搬运 mp4（renders/ → 03-成品/；若无 renders，直接检查 03-成品/）
  let videoFile = null;
  if (fs.existsSync(rendersDir)) {
    const mp4s = fs.readdirSync(rendersDir).filter(f => f.endsWith('.mp4'));
    if (mp4s.length) {
      videoFile = mp4s.sort().pop();
      fs.copyFileSync(path.join(rendersDir, videoFile), path.join(deliverablesDir, `${slug}.mp4`));
    }
  }
  // 兜底：renders 不存在或为空，但 03-成品 已有 mp4
  if (!videoFile && fs.existsSync(deliverablesDir)) {
    const existingMp4s = fs.readdirSync(deliverablesDir).filter(f => f.endsWith('.mp4'));
    if (existingMp4s.length) {
      videoFile = existingMp4s.sort().pop();
      // 已就位，无需复制
      console.log(`[archive] 就地检测到 mp4: ${videoFile}`);
    }
  }

  // 2. 搬运封面（02-制作文件/ → 03-成品/；若无制作文件，直接检查 03-成品/）
  let coverCopied = false;
  if (fs.existsSync(coverDesignDir)) {
    const svgFiles = fs.readdirSync(coverDesignDir).filter(f => f.endsWith('.svg'));
    if (svgFiles.length) {
      const svgFile = svgFiles.sort().pop();
      fs.copyFileSync(path.join(coverDesignDir, svgFile), path.join(deliverablesDir, 'cover.svg'));
      coverCopied = true;
    }
  }
  // 兜底：02-制作文件 无 SVG，但 03-成品 已有 cover.svg
  if (!coverCopied && fs.existsSync(deliverablesDir)) {
    const existingSvgs = fs.readdirSync(deliverablesDir).filter(f => f.endsWith('.svg'));
    if (existingSvgs.length) {
      coverCopied = true;
      console.log(`[archive] 就地检测到封面: ${existingSvgs.sort().pop()}`);
    }
  }

  // 3. 读取时间线：研发总耗时 + 项目执行耗时
  let createdAt = null;
  let executionStartedAt = null;
  const metaPath = path.join(projectDir, 'meta.json');
  if (fs.existsSync(metaPath)) {
    try { const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')); createdAt = meta.createdAt; executionStartedAt = meta.executionStartedAt; } catch(e) {}
  }
  if (!createdAt) {
    const ideas = loadColl('ideas');
    const matchingIdea = ideas.find(i => slugify(i.title) === slug);
    if (matchingIdea && matchingIdea.createdAt) createdAt = matchingIdea.createdAt;
  }
  const now = new Date();
  const nowStr = now.toISOString().replace('T', ' ').slice(0, 19);
  const createdStr = createdAt ? new Date(createdAt).toISOString().replace('T', ' ').slice(0, 19) : '未知';

  // 研发总耗时（想法 → 归档）
  let rndStr = '未知';
  if (createdAt) {
    const rndMs = now - new Date(createdAt);
    const rndH = Math.floor(rndMs / 3600000);
    const rndM = Math.floor((rndMs % 3600000) / 60000);
    rndStr = rndH > 0 ? `${rndH} 小时 ${rndM} 分钟` : `${rndM} 分钟`;
  }

  // 项目执行耗时（生成剧本 → 渲染完成）
  let execStr = '未记录';
  if (executionStartedAt) {
    // 用 mp4 的最后修改时间作为执行结束时间
    let execEnd = null;
    // 检查重命名后的 {slug}.mp4
    const slugMp4 = path.join(deliverablesDir, `${slug}.mp4`);
    if (fs.existsSync(slugMp4)) {
      execEnd = fs.statSync(slugMp4).mtime;
    } else if (videoFile && fs.existsSync(path.join(deliverablesDir, videoFile))) {
      execEnd = fs.statSync(path.join(deliverablesDir, videoFile)).mtime;
    } else if (videoFile && fs.existsSync(path.join(rendersDir, videoFile))) {
      execEnd = fs.statSync(path.join(rendersDir, videoFile)).mtime;
    }
    if (!execEnd) execEnd = now;
    const execMs = execEnd - new Date(executionStartedAt);
    if (execMs > 0) {
      const execH = Math.floor(execMs / 3600000);
      const execM = Math.floor((execMs % 3600000) / 60000);
      execStr = execH > 0 ? `${execH} 小时 ${execM} 分钟` : `${execM} 分钟`;
    }
  }

  // 4. 读取发布文案
  let copySummary = '';
  const copyPath = path.join(contentDir, 'short-video-copy.md');
  if (fs.existsSync(copyPath)) {
    try { copySummary = fs.readFileSync(copyPath, 'utf-8').slice(0, 500); } catch(e) {}
  }

  // 5. 写 03-成品/README.md
  const deliverableReadme = `# ${slug} — 成品说明

## 基本信息

| 项目 | 内容 |
|------|------|
| 项目名 | ${slug} |
| 归档时间 | ${nowStr} |
| 视频 | ${videoFile || '无'} |
| 封面 | cover.svg |

## 文件清单

- \`${slug}.mp4\` — 最终成品视频
- \`cover.svg\` — 封面矢量图
`;
  fs.writeFileSync(path.join(deliverablesDir, 'README.md'), deliverableReadme, 'utf-8');

  // 6. 写 04-项目记录/README.md
  const recordReadme = `# ${slug} — 项目记录

## 生产日志

| 项目 | 内容 |
|------|------|
| 项目名 | ${slug} |
| 创建时间 | ${createdStr} |
| 归档时间 | ${nowStr} |
| 研发总耗时 | ${rndStr} |
| 项目执行耗时 | ${execStr} |
| 视频文件 | ${videoFile || '无'} |

## 资产清单

- \`index.html\` — 视频剧本
- \`03-成品/${slug}.mp4\` — 成品视频
- \`03-成品/cover.svg\` — 封面
- \`01-内容方案/short-video-copy.md\` — 发布文案
`;
  fs.writeFileSync(path.join(recordDir, 'README.md'), recordReadme, 'utf-8');

  // 7. 追加到 Obsidian 日志
  try {
    if (!fs.existsSync(path.dirname(OBSIDIAN_LOG))) fs.mkdirSync(path.dirname(OBSIDIAN_LOG), { recursive: true });
    const obsidianEntry = `\n---\n项目: ${slug}\n归档时间: ${nowStr}\n研发总耗时: ${rndStr}\n项目执行耗时: ${execStr}\n---\n### 发布文案摘要\n${copySummary.slice(0, 300) || '无'}\n`;
    fs.appendFileSync(OBSIDIAN_LOG, obsidianEntry, 'utf-8');
    console.log(`[archive] Obsidian 已追加: ${slug}`);
  } catch(e) {
    console.warn(`[archive] Obsidian 写入失败: ${e.message}`);
  }

  console.log(`[archive] 归档完成: ${slug}`);
  res.json({ ok: true, slug, rnd: rndStr, exec: execStr, video: videoFile });
});

// 挂载路由 — 清除旧路由 — 这行必须在所有路由定义之后
app._router = undefined;
app.use('/api', apiRouter);

// Auto-fetch timer
const FETCH_INTERVAL = 30 * 60 * 1000;
async function autoFetch() {
  try {
    const items = await aggregateTrends();
    const auto = loadColl('autoTopics'); const today = todayStr();
    const kept = auto.filter(t => t.date === today);
    const all = [...items, ...kept]; const seen = new Set(); const deduped = [];
    for (const item of all) { const key = item.title.toLowerCase().slice(0, 30); if (!seen.has(key)) { seen.add(key); deduped.push(item); } }
    saveColl('autoTopics', deduped.slice(0, 30));
    broadcast('auto-fetch', { count: items.length, total: deduped.length });
    console.log(`[auto-fetch] ${items.length} new, ${deduped.length} total today`);
  } catch (e) { console.warn('[auto-fetch] failed:', e.message); }
}

app.listen(PORT, () => {
  console.log(`\n  ╔══════════════════════════════════════════╗\n  ║  内容决策看板 · Content Dashboard        ║\n  ║  http://localhost:${PORT}                 ║\n  ║  自动抓取: 每 ${FETCH_INTERVAL / 60000} 分钟           ║\n  ║  项目联动: 选题自动建文件夹 / 目录扫描    ║\n  ╚══════════════════════════════════════════╝\n  `);

  // 启动时扫描项目状态
  const projects = scanProjects();
  console.log(`[project-scan] 扫描到 ${projects.length} 个项目`);
  projects.forEach(p => console.log(`  ${p.status}: ${p.name}`));

  setTimeout(autoFetch, 5000);
  setInterval(autoFetch, FETCH_INTERVAL);
});
