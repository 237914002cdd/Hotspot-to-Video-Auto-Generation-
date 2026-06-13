// ================================================================
// 趋势数据自动抓取器（多源，容忍失败，含跳转链接）
// ================================================================
const https = require('https');
const http = require('http');

function fetchUrl(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, {
      timeout: opts.timeout || 12000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json, text/html, */*',
        ...(opts.headers || {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', function () { this.destroy(); reject(new Error('timeout')); });
  });
}

async function fetchGitHubAI() {
  const queries = ['AI+tool+created:>2026-04-01&sort=stars&order=desc', 'artificial-intelligence+tool+created:>2026-03-01&sort=stars&order=desc', 'llm+agent+tool+created:>2026-03-01&sort=stars&order=desc'];
  const seen = new Set();
  const results = [];
  for (const q of queries) {
    try {
      const json = await fetchUrl(`https://api.github.com/search/repositories?q=${q}&per_page=5`, { timeout: 8000, headers: { 'Accept': 'application/vnd.github.v3+json' } });
      const data = JSON.parse(json);
      for (const r of (data.items || [])) {
        const title = r.full_name;
        if (seen.has(title)) continue;
        seen.add(title);
        results.push({ title, score: Math.min(5, Math.ceil(Math.log2((r.stargazers_count || 0) + 1) / 3)), source: 'github', url: r.html_url || `https://github.com/${title}`, trend: `${(r.stargazers_count || 0).toLocaleString()} ⭐ ${r.description ? '· ' + r.description.slice(0, 50) : ''}` });
      }
    } catch (e) { /* skip */ }
  }
  return results.slice(0, 8);
}

async function fetchHN() {
  try {
    const idsJson = await fetchUrl('https://hacker-news.firebaseio.com/v0/topstories.json', { timeout: 8000 });
    const ids = JSON.parse(idsJson).slice(0, 30);
    const items = [];
    for (const id of ids) {
      try {
        const json = await fetchUrl(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, { timeout: 5000 });
        const item = JSON.parse(json);
        if (item && item.title) items.push({ ...item, hnId: id });
      } catch (_) { /* skip */ }
    }
    const aiKeywords = ['ai', 'llm', 'gpt', 'machine learning', 'deep learning', 'neural', 'chatgpt', 'claude', 'openai', 'agent', 'artificial intelligence', 'rag', 'embedding', 'token', 'transformer', 'diffusion', 'sora', 'video generation'];
    const aiItems = items.filter(item => aiKeywords.some(kw => item.title.toLowerCase().includes(kw)));
    return aiItems.slice(0, 8).map(item => ({ title: item.title, score: Math.min(5, Math.max(2, Math.ceil(Math.log2((item.score || 0) + 1) / 2))), source: 'hackernews', url: item.url || `https://news.ycombinator.com/item?id=${item.hnId}`, trend: `${item.score || 0} points${item.descendants ? ` · ${item.descendants} comments` : ''}` }));
  } catch (e) { console.warn('[fetcher] HN failed:', e.message); return []; }
}

async function fetchChineseTrends() {
  const results = [];
  try {
    const json = await fetchUrl('https://www.toutiao.com/hot-event/hot-board/?origin=hot_board', { timeout: 6000, headers: { 'Cookie': '' } });
    const data = JSON.parse(json);
    const items = data?.data || [];
    for (const item of items.slice(0, 5)) {
      const title = item.Title || item.title || item.word || '';
      if (!title) continue;
      const hot = parseInt(item.HotValue || item.hot_value || item.hot || 0);
      results.push({ title, score: Math.min(5, Math.max(1, Math.ceil(hot / 500000))), source: 'toutiao', url: item.Url || item.url || `https://www.toutiao.com/search/?keyword=${encodeURIComponent(title)}`, trend: `热度 ${hot.toLocaleString()}` });
    }
  } catch (e) { /* silent */ }
  return results;
}

async function fetchAIToolsNews() {
  try {
    const json = await fetchUrl('https://api.github.com/search/repositories?q=AI+tool+in:topics&sort=updated&order=desc&per_page=10', { timeout: 8000, headers: { 'Accept': 'application/vnd.github.v3+json' } });
    const data = JSON.parse(json);
    return (data.items || []).slice(0, 5).map(r => ({ title: r.full_name, score: Math.min(5, Math.max(1, Math.ceil(Math.log2((r.stargazers_count || 0) + 1) / 3))), source: 'github', url: r.html_url || `https://github.com/${r.full_name}`, trend: `${(r.stargazers_count || 0).toLocaleString()} ⭐ · ${(r.description || '').slice(0, 50)}` }));
  } catch (e) { console.warn('[fetcher] AIToolsNews failed:', e.message); return []; }
}

async function aggregateTrends() {
  const sources = await Promise.allSettled([fetchGitHubAI(), fetchHN(), fetchChineseTrends(), fetchAIToolsNews()]);
  const all = sources.filter(s => s.status === 'fulfilled').flatMap(s => s.value).filter(t => t.title && t.title.length > 2);
  const seen = new Set();
  const deduped = [];
  for (const t of all) {
    const key = t.title.toLowerCase().replace(/[^a-z0-9一-龥]/g, '').slice(0, 30);
    if (!seen.has(key)) { seen.add(key); deduped.push({ ...t, id: `auto-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, date: todayStr(), time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) }); }
  }
  console.log(`[fetcher] aggregated ${deduped.length} items from ${sources.filter(s => s.status === 'fulfilled').length} sources`);
  return deduped;
}

function todayStr() { const d = new Date(); const bj = new Date(d.getTime() + d.getTimezoneOffset() * 60000 + 480 * 60000); return bj.toISOString().slice(0, 10); }

module.exports = { aggregateTrends };
