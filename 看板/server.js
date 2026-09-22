'use strict';
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { aggregateTrends } = require('./fetcher');
const { createRenderer } = require('./lib/renderer');
const { createProjects, today } = require('./lib/projects');
const { AppError, fail, plain, safePath, readJson, atomicWrite, createStore, names, validateCollection } = require('./lib/store');

function createApp(options = {}) {
  const dataDir = path.resolve(options.dataDir || process.env.DATA_DIR || path.join(__dirname, 'data'));
  const projectsDir = path.resolve(options.projectsDir || process.env.PROJECTS_DIR || path.join(__dirname, '..', '项目'));
  const store = createStore(dataDir), app = express(), clients = new Set();
  let fetchPending = null, timer, initialTimer;
  const broadcast = (event, payload) => {
    for (const res of clients) { try { res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`); } catch { clients.delete(res); } }
  };
  safePath(dataDir, 'render-jobs.json');
  safePath(projectsDir);
  const renderer = options.renderer || createRenderer({ dataDir, projectsDir, broadcast });
  const projects = createProjects({ projectsDir, renderer });
  const fetchStatePath = safePath(dataDir, 'fetch-status.json');
  let fetchStatus = readJson(fetchStatePath, { status: 'never', sources: [], updatedAt: null });
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'SAMEORIGIN' });
    let host;
    try { host = new URL(`http://${req.headers.host || ''}`); } catch { return res.status(403).json({ ok: false, error: '无效 Host', code: 'HOST_DENIED' }); }
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host.hostname) || host.username || host.password || host.pathname !== '/' || Number(host.port || 80) !== req.socket.localPort) return res.status(403).json({ ok: false, error: '仅允许本机地址访问', code: 'HOST_DENIED' });
    if (req.headers.origin) {
      try { if (new URL(req.headers.origin).origin !== `http://${req.headers.host}`) throw new Error(); }
      catch { return res.status(403).json({ ok: false, error: '跨站请求已拒绝', code: 'ORIGIN_DENIED' }); }
    }
    if (req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ ok: false, error: '跨站请求已拒绝', code: 'ORIGIN_DENIED' });
    if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '2mb', strict: true }));
  app.get('/api/health', async (req, res) => res.json({ ok: true, version: '2.0.0', mode: 'local', capabilities: await renderer.capabilities(), fetchStatus }));
  app.get('/api/sse', (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' }); res.flushHeaders();
    res.write('event: connected\ndata: {"ok":true}\n\n'); clients.add(res);
    const pulse = setInterval(() => res.write(': heartbeat\n\n'), 20000); pulse.unref();
    req.on('close', () => { clearInterval(pulse); clients.delete(res); });
  });
  app.get('/api/data', (req, res) => { const data = store.load(); res.json({ ...data, projects: projects.list(), versions: store.versions(data), fetchStatus }); });
  function saveData(changes, expected) {
    const before = store.check(changes, expected);
    if (changes.reviews || changes.calendar) {
      const calendar = changes.calendar || before.calendar, reviews = changes.reviews || before.reviews;
      const seen = new Set();
      for (const review of reviews) {
        const entry = calendar.find(item => String(item.id) === String(review.calId));
        if (!entry || entry.status !== 'published') fail('复盘必须关联已发布的内容；删除日历时请先删除对应复盘');
        if (review.date > today() || review.date < entry.date) fail('复盘日期必须介于发布日期与今天之间');
        if (entry.platform !== 'both' && entry.platform !== review.platform) fail('复盘平台必须与发布记录一致');
        const key = `${review.calId}:${review.platform}:${review.date}`;
        if (seen.has(key)) fail('同一内容、平台和日期只能保留一条复盘'); seen.add(key);
      }
    }
    if (changes.calendar) for (const entry of changes.calendar) {
      if (entry.status === 'published' && entry.date > today()) fail('发布日期不能晚于今天');
      if (entry.projectPath) projects.root(entry.projectPath);
    }
    if (changes.ideas) changes.ideas = projects.syncIdeas(changes.ideas, before.ideas);
    const saved = store.save(changes, expected); broadcast('data-update', { updated: Object.keys(changes) });
    return { ok: true, versions: saved.versions, ...(changes.ideas ? { ideas: saved.collections.ideas } : {}) };
  }
  app.post('/api/data', (req, res) => {
    if (!plain(req.body)) fail('请求内容必须是对象');
    const { versions = {}, ...changes } = req.body;
    res.json(saveData(changes, versions));
  });
  app.put('/api/data/:collection', (req, res) => {
    const name = req.params.collection;
    if (!names.includes(name)) throw new AppError(404, '未知数据集合');
    const wrapped = plain(req.body) && Object.hasOwn(req.body, 'data');
    if (wrapped && Object.keys(req.body).some(k => !['data', 'version'].includes(k))) fail('集合保存参数无效');
    const version = wrapped ? req.body.version : req.headers['if-match'];
    res.json(saveData({ [name]: wrapped ? req.body.data : req.body }, version === undefined ? {} : { [name]: version }));
  });
  async function fetchTrends() {
    if (fetchPending) return fetchPending;
    fetchPending = (async () => {
      const report = await (options.fetchTrends || aggregateTrends)();
      const incoming = Array.isArray(report) ? report : report.items;
      const sources = report.sources || [];
      if (!Array.isArray(incoming)) throw new AppError(502, '热点服务返回格式无效', 'FETCH_FAILED');
      validateCollection('autoTopics', incoming);
      const failed = !incoming.length && (!sources.length || sources.every(s => s.status === 'error'));
      fetchStatus = { status: failed ? 'error' : sources.some(s => s.status === 'error') ? 'partial' : 'success', sources, updatedAt: new Date().toISOString(), fetched: incoming.length };
      atomicWrite(fetchStatePath, JSON.stringify(fetchStatus, null, 2));
      if (failed) { broadcast('fetch-status', fetchStatus); throw new AppError(502, '全部热点来源抓取失败，已保留最近一次数据', 'FETCH_FAILED'); }
      const old = store.load().autoTopics, seen = new Set();
      const merged = [...incoming, ...old].filter(item => { const key = item.title.toLowerCase().replace(/\s+/g, ' ').trim(); if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, 100);
      store.save({ autoTopics: merged });
      broadcast('auto-fetch', { count: incoming.length, total: merged.length });
      return { ok: true, fetched: incoming.length, total: merged.length, sources, fetchStatus };
    })().catch(err => {
      if (err.code !== 'FETCH_FAILED') { fetchStatus = { status: 'error', sources: [], updatedAt: new Date().toISOString(), error: '热点抓取失败，最近数据已保留' }; atomicWrite(fetchStatePath, JSON.stringify(fetchStatus, null, 2)); }
      throw err;
    }).finally(() => { fetchPending = null; });
    return fetchPending;
  }
  app.post('/api/trigger-fetch', async (req, res) => res.json(await fetchTrends()));
  function topics() { const data = store.load(), seen = new Set(); return { data, items: [...data.hotTopics, ...data.autoTopics].filter(t => t.date === today()).filter(t => { const key = t.title.toLowerCase().trim(); if (seen.has(key)) return false; seen.add(key); return true; }) }; }
  app.post('/api/brief/generate', (req, res) => {
    const { items } = topics();
    res.json({ ok: true, mode: 'rules', brief: items.length ? { date: today(), hotCount: items.length, topHot: items.slice().sort((a, b) => b.score - a.score).slice(0, 3), suggestions: items.slice(0, 5).map(t => ({ title: `${t.title}：关键事实与解读`, hot: t.score || 3, type: 'hyperframes-text', source: t.source, url: t.url || '' })) } : null });
  });
  app.post('/api/today/recommend', (req, res) => {
    const { data, items } = topics(), w = data.settings.weights;
    const recommendations = items.map(item => {
      const text = `${item.title} ${item.trend || ''}`.toLowerCase();
      const tutorial = /tutorial|教程|入门|guide|how to|awesome/.test(text), tooling = /tool|工具|saas|product|产品|workflow|工作流|template|模板/.test(text);
      const hotScore = item.score || 3, wallScore = 3, durScore = tutorial ? 4 : 3, moneyScore = tooling ? 3 : 2;
      const score = +(hotScore * w.hot + wallScore * w.wall + durScore * w.duration + moneyScore * w.money).toFixed(2), pri = score >= 4 ? 'P0' : score >= 3.5 ? 'P1' : score >= 3 ? 'P2' : '跳过';
      return { title: item.title, source: item.source, url: item.url || '', trend: item.trend || '', hotScore, wallScore, durScore, moneyScore, score, pri, reason: '规则估算：热度来自来源评分；差异化默认 3 分，请按自身经验调整。' + (tutorial ? '教程类内容增加长尾评分。' : '') + (tooling ? '工具类内容增加商业相关性评分。' : ''), format: tutorial ? 'remotion-demo' : 'hyperframes-text', platform: 'both', mode: 'rules' };
    }).sort((a, b) => b.score - a.score);
    const count = pri => recommendations.filter(item => item.pri === pri).length;
    res.json({ ok: true, total: items.length, mode: 'rules', weights: w, recommendations: recommendations.slice(0, 15), groups: { p0: count('P0'), p1: count('P1'), p2: count('P2'), skip: count('跳过') } });
  });
  app.get('/api/projects', (req, res) => res.json({ ok: true, projects: projects.list() }));
  app.get('/api/jobs', (req, res) => res.json({ ok: true, jobs: renderer.list() }));
  app.post('/api/projects/generate-blueprint', (req, res) => {
    const { slug, topic } = req.body || {}, result = projects.blueprint(slug, topic), title = projects.content(slug).title;
    res.json({ ok: true, slug, ...result, html: result.html_content, copy: { douyin: { title, body: result.copy_content, tags: '' }, xiaohongshu: { title, body: result.copy_content, tags: '' } } });
  });
  app.post('/api/projects/save-script', (req, res) => {
    const { slug, storyboard, copy_content, version } = req.body || {};
    if (!storyboard) throw new AppError(400, '请提供结构化 storyboard；任意 HTML 不能作为渲染输入');
    const result = projects.update(slug, { storyboard, ...(copy_content !== undefined ? { copy: copy_content } : {}), ...(version !== undefined ? { version } : {}) });
    broadcast('data-update', { project: slug }); res.json(result);
  });
  app.post('/api/projects/generate-cover-svg', (req, res) => { const { slug, version } = req.body || {}; const result = projects.setCover(slug, {}, version); broadcast('data-update', { project: slug }); res.json(result); });
  app.post('/api/projects/update-cover', (req, res) => { const { slug, fields, version } = req.body || {}; if (!plain(fields)) fail('缺少封面字段'); const result = projects.setCover(slug, fields, version); broadcast('data-update', { project: slug }); res.json(result); });
  app.post('/api/projects/render', async (req, res) => {
    const { slug } = req.body || {}; projects.root(slug);
    const storyboardFile = projects.file(slug, 'storyboard.json'); if (!fs.existsSync(storyboardFile)) throw new AppError(409, '请先生成并保存结构化分镜', 'STORYBOARD_REQUIRED');
    require('./lib/blueprint').validateStoryboard(readJson(storyboardFile, null));
    for (const sub of ['meta.json', 'index.html', '03-成品', '03-成品/current-video.json', '03-成品/versions', '03-成品/video.mp4', '03-成品/subtitles.srt', '02-制作文件']) projects.file(slug, sub);
    const job = await renderer.start(slug); broadcast('data-update', { project: slug }); res.status(202).json({ ok: true, slug, ...job, job });
  });
  app.get('/api/projects/render-status/:slug', (req, res) => { const slug = req.params.slug; projects.root(slug); res.json({ ok: true, slug, ...(renderer.get(slug) || { status: 'idle' }) }); });
  app.post('/api/projects/render-cancel', async (req, res) => { const { slug } = req.body || {}; projects.root(slug); const job = await renderer.cancel(slug); res.json({ ok: true, slug, job }); });
  app.post('/api/projects/open-folder', async (req, res) => {
    const { slug, sub } = req.body || {}; if (sub !== undefined && !['', '01-内容方案', '02-制作文件', '03-成品', '04-项目记录'].includes(sub)) fail('子目录无效');
    const target = projects.file(slug, sub || ''); if (!fs.existsSync(target)) throw new AppError(404, '目录不存在');
    if (options.disableOpenFolder) throw new AppError(503, '当前运行模式不支持打开本地目录');
    const command = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    await new Promise((resolve, reject) => { const child = spawn(command, [target], { detached: true, stdio: 'ignore', windowsHide: true, shell: false }); child.once('error', () => reject(new AppError(503, '无法打开系统文件管理器，请使用下载链接'))); child.once('spawn', () => { child.unref(); resolve(); }); });
    res.json({ ok: true });
  });
  app.post('/api/projects/archive', (req, res) => { const result = projects.archive(req.body?.slug); broadcast('data-update', { project: req.body.slug }); res.json(result); });
  app.get('/api/projects/:slug/files/:kind', (req, res, next) => {
    const kind = req.params.kind, target = projects.getFile(req.params.slug, kind);
    if (kind === 'preview') res.set('Content-Security-Policy', "sandbox allow-scripts; default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:");
    if (kind === 'cover' && target.endsWith('.svg')) res.set('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'");
    if (req.query.download === '1') return res.download(target, path.basename(target), err => { if (err && !res.headersSent) next(err); });
    res.sendFile(target, err => { if (err && !res.headersSent) next(err); });
  });
  app.get('/api/projects/:slug', (req, res) => res.json(projects.detail(req.params.slug)));
  app.put('/api/projects/:slug/content', (req, res) => { const result = projects.update(req.params.slug, req.body); broadcast('data-update', { project: req.params.slug }); res.json(result); });
  app.get('/api/export', (req, res) => {
    const data = store.load();
    const snapshot = { schema: 'creator-workspace-backup-v1', exportedAt: new Date().toISOString(), collections: data, projects: projects.list().map(p => p.status === 'error' ? { project: p } : projects.detail(p.path)), note: '此文件包含工作区数据、方案、分镜和发布文案；视频与封面二进制请通过项目下载链接另行保存。' };
    res.attachment(`creator-workspace-${today()}.json`).json(snapshot);
  });
  const publicFiles = new Map([['/', 'index.html'], ['/index.html', 'index.html'], ['/app.js', 'app.js'], ['/platform.css', 'platform.css'], ['/tailwind.css', 'tailwind.css'], ['/fonts.css', 'fonts.css']]);
  for (const [route, filename] of publicFiles) app.get(route, (req, res) => { res.set('Cache-Control', 'no-cache'); res.sendFile(safePath(__dirname, filename)); });
  const fontFiles = new Set(['hanken-grotesk-latin-wght-normal.woff2', 'manrope-latin-wght-normal.woff2', 'jetbrains-mono-latin-wght-normal.woff2', 'material-symbols-outlined-latin-400-normal.woff2']);
  app.get('/fonts/:file', (req, res) => { if (!fontFiles.has(req.params.file)) throw new AppError(404, '字体不存在'); res.sendFile(safePath(__dirname, 'fonts', req.params.file)); });
  app.use((req, res) => res.status(404).json({ ok: false, error: '接口或资源不存在', code: 'NOT_FOUND' }));
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = err.status || (err.type === 'entity.too.large' ? 413 : err instanceof SyntaxError ? 400 : 500);
    if (status >= 500 && !(err instanceof AppError)) console.error('[server]', err);
    res.status(status).json({ ok: false, error: status === 500 ? '服务内部错误，请查看本地日志' : err.message, code: err.code || (status === 413 ? 'BODY_TOO_LARGE' : 'REQUEST_FAILED') });
  });
  if (options.autoFetch === true || (options.autoFetch !== false && process.env.AUTO_FETCH !== '0' && require.main === module)) {
    const run = () => fetchTrends().catch(err => console.warn('[fetch]', err.message));
    initialTimer = setTimeout(run, 5000); initialTimer.unref(); timer = setInterval(run, 30 * 60 * 1000); timer.unref();
  }
  app.locals.services = { store, projects, renderer, fetchTrends };
  app.locals.close = async () => { clearTimeout(initialTimer); clearInterval(timer); for (const res of clients) res.end(); clients.clear(); await renderer.close(); };
  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3456);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT 必须是 0–65535 的整数');
  const app = createApp();
  const server = app.listen(port, '127.0.0.1', () => console.log(`创作者工作台：http://127.0.0.1:${server.address().port}（本机模式）`));
  const shutdown = async () => { await app.locals.close(); server.close(() => process.exit(0)); };
  process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
}
module.exports = { createApp };
