'use strict';
const https = require('node:https');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
function todayStr(now = new Date()) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now); }
function fetchUrl(url, opts = {}, redirects = 0) {
  return new Promise((resolve, reject) => {
    const target = new URL(url), transport = target.protocol === 'https:' ? https : http;
    if (!['https:', 'http:'].includes(target.protocol)) return reject(new Error('Unsupported protocol'));
    const req = transport.get(target, { timeout: opts.timeout || 8000, headers: { 'User-Agent': 'CreatorWorkspace/2.0', Accept: 'application/json', ...opts.headers } }, res => {
      if ([301, 302, 307, 308].includes(res.statusCode)) {
        res.resume(); let next;
        try { next = new URL(res.headers.location || '', target); } catch { return reject(new Error('Invalid redirect')); }
        if (redirects >= 2 || next.hostname !== target.hostname || next.protocol !== target.protocol) return reject(new Error('Unexpected redirect'));
        return fetchUrl(next.href, opts, redirects + 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      const chunks = []; let size = 0, tooLarge = false;
      res.on('data', chunk => { size += chunk.length; if (size > (opts.maxBytes || 2 * 1024 * 1024)) { tooLarge = true; reject(new Error('Response too large')); res.destroy(); req.destroy(); } else chunks.push(chunk); });
      res.on('error', reject); res.on('end', () => { if (!tooLarge) resolve(Buffer.concat(chunks).toString('utf8')); });
    });
    const deadline = setTimeout(() => req.destroy(new Error('Request deadline exceeded')), opts.timeout || 8000);
    req.on('close', () => clearTimeout(deadline)); req.on('error', reject); req.on('timeout', () => req.destroy(new Error('Request timeout')));
  });
}
async function fetchGitHub() {
  const since = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const query = encodeURIComponent(`AI tool created:>${since}`);
  const data = JSON.parse(await fetchUrl(`https://api.github.com/search/repositories?q=${query}&sort=stars&order=desc&per_page=10`));
  if (!Array.isArray(data.items)) throw new Error('Invalid GitHub response');
  return data.items.map(r => ({ title: r.full_name, score: Math.max(1, Math.min(5, Math.ceil(Math.log2((r.stargazers_count || 0) + 1) / 3))), source: 'github', url: r.html_url, trend: `${r.stargazers_count || 0} stars · ${(r.description || '').slice(0, 180)}` }));
}
async function fetchHN() {
  const ids = JSON.parse(await fetchUrl('https://hacker-news.firebaseio.com/v0/topstories.json'));
  if (!Array.isArray(ids)) throw new Error('Invalid HN response');
  const items = [];
  for (let offset = 0; offset < Math.min(ids.length, 18); offset += 6) {
    const batch = await Promise.allSettled(ids.slice(offset, offset + 6).map(async id => JSON.parse(await fetchUrl(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, { timeout: 5000 }))));
    items.push(...batch.filter(r => r.status === 'fulfilled' && r.value?.title).map(r => r.value));
  }
  if (ids.length && !items.length) throw new Error('All HN item requests failed');
  return items.filter(item => /\b(ai|llm|gpt|claude|openai|agent|code|software|video)\b|machine learning|artificial intelligence/i.test(item.title)).slice(0, 10).map(item => ({ title: item.title, score: Math.min(5, Math.max(1, Math.ceil(Math.log2((item.score || 0) + 1) / 2))), source: 'hackernews', url: /^https?:\/\//.test(item.url || '') ? item.url : `https://news.ycombinator.com/item?id=${item.id}`, trend: `${item.score || 0} points · ${item.descendants || 0} comments` }));
}
async function fetchToutiao() {
  const data = JSON.parse(await fetchUrl('https://www.toutiao.com/hot-event/hot-board/?origin=hot_board', { timeout: 8000 }));
  if (!Array.isArray(data.data)) throw new Error('Invalid Toutiao response or upstream access restriction');
  return data.data.slice(0, 10).flatMap(item => {
    const title = item.Title || item.title || item.word;
    if (typeof title !== 'string' || !title.trim()) return [];
    const hot = Number(item.HotValue || item.hot_value || item.hot || 0), url = item.Url || item.url || '';
    return [{ title, score: Math.min(5, Math.max(1, Math.ceil((Number.isFinite(hot) ? hot : 0) / 500000))), source: 'toutiao', url: /^https?:\/\//.test(url) ? url : `https://www.toutiao.com/search/?keyword=${encodeURIComponent(title)}`, trend: `热度 ${Number.isFinite(hot) ? hot.toLocaleString('zh-CN') : '未提供'}` }];
  });
}
async function aggregateTrends() {
  const inputs = [{ name: 'github', load: fetchGitHub }, { name: 'hackernews', load: fetchHN }, { name: 'toutiao', load: fetchToutiao }];
  const reports = await Promise.all(inputs.map(async source => { const startedAt = Date.now(); try { const items = await source.load(); return { name: source.name, status: 'success', count: items.length, durationMs: Date.now() - startedAt, items }; } catch (err) { return { name: source.name, status: 'error', count: 0, durationMs: Date.now() - startedAt, error: err.message, items: [] }; } }));
  const seen = new Set(), items = [];
  for (const item of reports.flatMap(r => r.items)) {
    if (typeof item.title !== 'string' || !item.title.trim()) continue;
    const key = item.title.toLowerCase().trim(); if (seen.has(key)) continue; seen.add(key);
    items.push({ ...item, title: item.title.slice(0, 300), id: `auto-${randomUUID()}`, date: todayStr(), time: new Date().toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' }) });
  }
  return { items, sources: reports.map(({ items, ...report }) => report) };
}
module.exports = { aggregateTrends, fetchUrl, todayStr };
