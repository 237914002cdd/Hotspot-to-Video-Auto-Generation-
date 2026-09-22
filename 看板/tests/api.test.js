'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { createApp } = require('../server');
const { hash } = require('../lib/store');
const { validateStoryboard } = require('../lib/blueprint');
const { fetchUrl, todayStr } = require('../fetcher');
async function workspace(t, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'creator-api-'));
  const dataDir = path.join(dir, 'data'), projectsDir = path.join(dir, 'projects');
  const app = createApp({ dataDir, projectsDir, autoFetch: false, disableOpenFolder: true, ...extra });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await app.locals.close(); await new Promise(resolve => server.close(resolve)); assert.ok(dir.startsWith(path.join(os.tmpdir(), 'creator-api-'))); fs.rmSync(dir, { recursive: true, force: true }); });
  const request = async (url, body, method = body === undefined ? 'GET' : 'POST', headers = {}) => {
    const response = await fetch(base + url, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const text = await response.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, data, headers: response.headers };
  };
  const add = async (ideas = [{ id: 1, title: '中文创作测试', status: 'pending' }]) => { const result = await request('/api/data', { ideas }); assert.equal(result.status, 200, JSON.stringify(result.data)); return result.data.ideas; };
  return { dir, dataDir, projectsDir, app, server, base, request, add };
}

test('static resources are allowlisted, localhost Host and same-origin are enforced', async t => {
  const w = await workspace(t);
  assert.equal((await w.request('/')).status, 200);
  assert.equal((await w.request('/fonts/server.js')).status, 404);
  for (const url of ['/server.js', '/fetcher.js', '/package.json', '/data/workspace.json', '/lib/store.js', '/api/data/nope']) assert.equal((await w.request(url)).status, 404, url);
  assert.equal((await w.request('/api/data', undefined, 'GET', { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await w.request('/api/data', undefined, 'GET', { Origin: w.base })).status, 200);
  assert.equal((await w.request('/api/data', undefined, 'GET', { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  const hostileHost = await new Promise((resolve, reject) => { http.get(w.base + '/api/data', { headers: { Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); }).on('error', reject); });
  assert.equal(hostileHost, 403);
});

test('strict collection boundaries, atomic backup, and concurrent revision conflict', async t => {
  const w = await workspace(t), original = (await w.request('/api/data')).data;
  assert.equal((await w.request('/api/data/notAllowed', [], 'PUT')).status, 404);
  assert.equal((await w.request('/api/data', { nonsense: [] })).status, 404);
  assert.equal((await w.request('/api/data', { ideas: [{ id: 1, title: 'x', unexpected: true }] })).status, 400);
  assert.equal((await w.request('/api/data', { ideas: [{ id: 1, title: '' }] })).status, 400);
  assert.equal((await w.request('/api/data', { ideas: [{ id: 1, title: 'x', hot: -1 }] })).status, 400);
  assert.equal((await w.request('/api/data', { ideas: [{ id: 1, title: 'x', hotlink: 'javascript:alert(1)' }] })).status, 400);
  const item = { word: '视频', count: 3, date: todayStr() };
  assert.equal((await w.request('/api/data', { searchWords: [item], versions: { searchWords: original.versions.searchWords } })).status, 200);
  assert.equal((await w.request('/api/data', { searchWords: [], versions: { searchWords: original.versions.searchWords } })).status, 409);
  assert.deepEqual((await w.request('/api/data')).data.searchWords, [item]);
  assert.equal((await w.request('/api/data/weeklyNotes', { data: [{ note: '保留备份', date: todayStr() }], version: original.versions.weeklyNotes }, 'PUT')).status, 200);
  assert.ok(fs.existsSync(path.join(w.dataDir, 'workspace.backup.json')));
  assert.deepEqual(fs.readdirSync(w.dataDir).filter(name => name.endsWith('.tmp')), []);
});

test('two Chinese ideas get distinct stable projects; title edits preserve asset paths', async t => {
  const w = await workspace(t), ideas = await w.add([{ id: 1, title: '中文选题甲' }, { id: 2, title: '中文选题乙' }]);
  assert.notEqual(ideas[0].projectPath, ideas[1].projectPath);
  const asset = path.join(w.projectsDir, ideas[0].projectPath, '02-制作文件', 'keep.txt'); fs.writeFileSync(asset, 'keep');
  const saved = await w.request('/api/data', { ideas: ideas.map(i => ({ ...i, title: i.title + '改名' })) });
  assert.equal(saved.status, 200); assert.equal(saved.data.ideas[0].projectPath, ideas[0].projectPath); assert.equal(fs.readFileSync(asset, 'utf8'), 'keep');
  const projects = (await w.request('/api/projects')).data.projects; assert.equal(projects.length, 2);
  const d = (await w.request(`/api/projects/${ideas[0].projectPath}`)).data;
  assert.ok(d.files.cover); assert.equal(d.files.video, null); assert.equal(d.project.hasStoryboard, false);
});

test('content, template blueprint, saved preview, and repeatable escaped cover edits work over HTTP', async t => {
  const w = await workspace(t), [idea] = await w.add(), slug = idea.projectPath;
  const d = (await w.request(`/api/projects/${slug}`)).data;
  let updated = await w.request(`/api/projects/${slug}/content`, { title: '新版标题', plan: '# 新版标题\n\n第一段事实\n第二段观点', version: d.version }, 'PUT');
  assert.equal(updated.status, 200);
  assert.equal((await w.request(`/api/projects/${slug}/content`, { copy: '过期编辑', version: d.version }, 'PUT')).status, 409);
  const bp = await w.request('/api/projects/generate-blueprint', { slug });
  assert.equal(bp.status, 200); assert.equal(bp.data.mode, 'template'); assert.match(bp.data.html_content, /新版标题/);
  assert.equal((await w.request('/api/projects/save-script', { slug, html_content: '<script>bad()</script>' })).status, 400);
  updated = await w.request('/api/projects/save-script', { slug, storyboard: bp.data.storyboard, copy_content: bp.data.copy_content, version: updated.data.version });
  assert.equal(updated.status, 200); assert.ok(updated.data.files.preview);
  const preview = await w.request(updated.data.files.preview); assert.equal(preview.status, 200); assert.match(preview.headers.get('content-security-policy'), /sandbox allow-scripts/);
  assert.equal((await w.request('/api/projects/update-cover', { slug, fields: { TITLE_LINE_1: '<script>alert("bad")</script>' } })).status, 200);
  let cover = await w.request(updated.data.files.cover); assert.match(cover.data, /&lt;script&gt;/); assert.doesNotMatch(cover.data, /<script>/);
  assert.equal((await w.request('/api/projects/update-cover', { slug, fields: { TITLE_LINE_1: '第二次调整' } })).status, 200);
  cover = await w.request(updated.data.files.cover); assert.match(cover.data, /第二次调整/); assert.doesNotMatch(cover.data, /alert/);
  assert.equal((await w.request(`/api/projects/${slug}/files/copy?download=1`)).headers.get('content-disposition').startsWith('attachment'), true);
  assert.equal((await w.request('/api/export')).data.projects[0].content.title, '新版标题');
});

test('path traversal and linked project directories cannot escape workspace', async t => {
  const w = await workspace(t), [idea] = await w.add();
  for (const slug of ['../outside', '..\\outside', 'C:\\Windows', 'CON', 'a/b']) assert.equal((await w.request('/api/projects/generate-blueprint', { slug })).status, 400);
  assert.equal((await w.request('/api/projects/open-folder', { slug: idea.projectPath, sub: '..' })).status, 400);
  const outside = path.join(w.dir, 'outside'); fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'sentinel.txt'), 'untouched');
  fs.symlinkSync(outside, path.join(w.projectsDir, 'linked-project'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await w.request('/api/projects/linked-project')).status, 400);
  assert.equal((await w.request('/api/projects/update-cover', { slug: 'linked-project', fields: { TITLE_LINE_1: 'blocked' } })).status, 400);
  assert.equal(fs.readFileSync(path.join(outside, 'sentinel.txt'), 'utf8'), 'untouched');
  const projectDir = path.join(w.projectsDir, idea.projectPath), linkedChild = path.join(projectDir, '04-项目记录');
  fs.rmdirSync(linkedChild); fs.symlinkSync(outside, linkedChild, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await w.request('/api/projects/open-folder', { slug: idea.projectPath, sub: '04-项目记录' })).status, 400);
});

test('maximum-length cover fields remain complete, escaped, and inside disjoint text areas in Chromium', async t => {
  const w = await workspace(t), [idea] = await w.add(), slug = idea.projectPath;
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1080, height: 1440 } });
  const fields = {
    BADGE: '长徽章文字'.repeat(16), TITLE_LINE_1: '完整展示八十字中文标题不裁切不重叠'.repeat(5).slice(0, 80),
    TITLE_LINE_2: 'Wide WWWM 中文 Mixed title & <xml> '.repeat(3).slice(0, 80),
    SUBTITLE: '副标题带有中英文说明 Creator Workflow & 视频制作 '.repeat(3).slice(0, 80),
    FEATURE_1: '第一要点需要完整显示所有中文内容'.repeat(5).slice(0, 80),
    FEATURE_2: 'W'.repeat(80), FEATURE_3: '<script>alert("unsafe")</script> & '.repeat(3).slice(0, 80),
    TAG_1_LABEL: '标签标题'.repeat(20), TAG_1_VAL: '标签内容'.repeat(20),
    TAG_2_LABEL: 'W'.repeat(80), TAG_2_VAL: 'i'.repeat(80),
    TAG_3_LABEL: '完整标签'.repeat(20), TAG_3_VAL: '创作成果'.repeat(20),
    CTA: '行动提示与下一步安排'.repeat(8), FOOTER: '页脚也需要完整显示'.repeat(9).slice(0, 80),
  };
  const result = await w.request('/api/projects/update-cover', { slug, fields }); assert.equal(result.status, 200);
  const svg = (await w.request(`/api/projects/${slug}/files/cover`)).data;
  assert.doesNotMatch(svg, /<script>/); assert.match(svg, /&lt;script&gt;/);
  await page.setContent(svg); await page.evaluate(() => document.fonts.ready);
  const actual = await page.evaluate(() => [...document.querySelectorAll('text[data-field]')].map(element => {
    const box = element.getBBox();
    return { field: element.dataset.field, text: element.textContent, x: box.x, y: box.y, width: box.width, height: box.height, bounds: element.dataset.box.split(',').map(Number), size: Number(element.getAttribute('font-size')), lines: element.querySelectorAll('tspan').length };
  }));
  assert.equal(actual.length, Object.keys(fields).length);
  for (const item of actual) {
    assert.equal(item.text, fields[item.field].replace(/\s+/gu, ' ').trim(), `${item.field} lost characters`);
    const [x, y, width, height] = item.bounds;
    assert.ok(item.x >= x - 1 && item.x + item.width <= x + width + 1, `${item.field} exceeds horizontal area: ${JSON.stringify(item)}`);
    assert.ok(item.y >= y - 1 && item.y + item.height <= y + height + 1, `${item.field} exceeds vertical area: ${JSON.stringify(item)}`);
    if (['TITLE_LINE_1', 'TITLE_LINE_2', 'SUBTITLE', 'FEATURE_1', 'FEATURE_2', 'FEATURE_3'].includes(item.field)) { assert.ok(item.lines > 1, `${item.field} should wrap`); assert.ok(item.size >= 18, `${item.field} is too small`); }
  }
  for (let i = 0; i < actual.length; i++) for (let j = i + 1; j < actual.length; j++) {
    const a = actual[i], b = actual[j];
    assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y, `${a.field} overlaps ${b.field}`);
  }
  const evidenceDir = path.resolve(__dirname, '..', 'data', 'qa'); fs.mkdirSync(evidenceDir, { recursive: true });
  await page.locator('svg').screenshot({ path: path.join(evidenceDir, 'cover-long-fields.png') });
});

test('corrupt persistent data returns 503 and is never replaced by empty state', async t => {
  const w = await workspace(t); await w.add();
  const file = path.join(w.dataDir, 'workspace.json'); fs.writeFileSync(file, '{broken-json');
  assert.equal((await w.request('/api/data')).status, 503);
  assert.equal((await w.request('/api/data', { ideas: [] })).status, 503);
  assert.equal(fs.readFileSync(file, 'utf8'), '{broken-json');
});

test('failed fetch preserves previous topics and recommendations use saved weights', async t => {
  let attempt = 0;
  const item = { id: 'auto-test', title: 'AI tool 教程', source: 'github', score: 5, date: todayStr(), url: 'https://github.com/example/project' };
  const w = await workspace(t, { fetchTrends: async () => (++attempt === 1 ? { items: [item], sources: [{ name: 'github', status: 'success' }] } : { items: [], sources: [{ name: 'github', status: 'error', error: 'HTTP 429' }] }) });
  assert.equal((await w.request('/api/trigger-fetch', {})).status, 200);
  assert.equal((await w.request('/api/trigger-fetch', {})).status, 502);
  let d = (await w.request('/api/data')).data; assert.deepEqual(d.autoTopics, [item]); assert.equal(d.fetchStatus.status, 'error');
  assert.equal((await w.request('/api/data', { settings: { weights: { hot: 1, wall: 0, duration: 0, money: 0 } } })).status, 200);
  d = (await w.request('/api/today/recommend', {})).data; assert.equal(d.recommendations[0].score, 5); assert.equal(d.mode, 'rules');
  assert.equal((await w.request('/api/brief/generate', {})).data.brief.hotCount, 1);
});

test('review metrics distinguish missing observations and allow negative net followers', async t => {
  const w = await workspace(t), date = todayStr();
  const calendar = [{ id: 1, title: '已发布视频', date, status: 'published', platform: 'douyin' }];
  const review = { id: 2, calId: 1, title: '已发布视频', date, platform: 'douyin', views: 100, completion: null, interact: 2, search: null, followers: -2 };
  assert.equal((await w.request('/api/data', { calendar, reviews: [review] })).status, 200);
  assert.equal((await w.request('/api/data', { reviews: [{ ...review, completion: 101 }] })).status, 400);
  assert.equal((await w.request('/api/data', { reviews: [review, { ...review, id: 3 }] })).status, 400);
  assert.equal((await w.request('/api/data', { reviews: [{ ...review, date: '2099-01-01' }] })).status, 400);
  assert.equal((await w.request('/api/data', { calendar: [] })).status, 400);
});

test('archive requires valid media, is idempotent, and blocks stale storyboard deliverables', async t => {
  const w = await workspace(t), [idea] = await w.add(), slug = idea.projectPath;
  assert.equal((await w.request('/api/projects/archive', { slug })).status, 409);
  const bp = (await w.request('/api/projects/generate-blueprint', { slug })).data;
  assert.equal((await w.request('/api/projects/save-script', { slug, storyboard: bp.storyboard, copy_content: '已审核发布文案' })).status, 200);
  const out = path.join(w.projectsDir, slug, '03-成品');
  fs.writeFileSync(path.join(out, '.render-partial.mp4'), 'partial');
  assert.equal((await w.request(`/api/projects/${slug}`)).data.project.videoCount, 0);
  fs.writeFileSync(path.join(out, 'video.mp4'), 'not-video');
  fs.writeFileSync(path.join(out, 'video-meta.json'), JSON.stringify({ inputHash: hash(validateStoryboard(bp.storyboard)) }));
  assert.equal((await w.request('/api/projects/archive', { slug })).status, 409);
  const render = spawnSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=green:s=128x128:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(out, 'video.mp4')], { windowsHide: true, timeout: 20000 });
  assert.equal(render.status, 0, render.stderr?.toString());
  const versionId = require('node:crypto').randomUUID(), versionDir = path.join(out, 'versions', versionId); fs.mkdirSync(versionDir, { recursive: true });
  fs.renameSync(path.join(out, 'video.mp4'), path.join(versionDir, 'video.mp4'));
  fs.renameSync(path.join(out, 'video-meta.json'), path.join(versionDir, 'video-meta.json'));
  fs.writeFileSync(path.join(versionDir, 'subtitles.srt'), '1\n00:00:00,000 --> 00:00:01,000\n测试\n');
  fs.writeFileSync(path.join(out, 'current-video.json'), JSON.stringify({ schema: 1, id: versionId }));
  const versioned = await w.request(`/api/projects/${slug}`); assert.equal(versioned.status, 200); assert.equal(versioned.data.project.staleVideo, false); assert.ok(versioned.data.project.videoMeta.inputHash);
  assert.equal((await w.request(versioned.data.files.video)).status, 200);
  const first = await w.request('/api/projects/archive', { slug }); assert.equal(first.status, 200); assert.equal(first.data.alreadyArchived, false);
  const again = await w.request('/api/projects/archive', { slug }); assert.equal(again.status, 200); assert.equal(again.data.archivedAt, first.data.archivedAt); assert.equal(again.data.alreadyArchived, true);
  bp.storyboard.scenes[0].body = '修改后的内容';
  const edited = await w.request(`/api/projects/${slug}/content`, { storyboard: bp.storyboard }, 'PUT'); assert.equal(edited.status, 200); assert.equal(edited.data.project.staleVideo, true); assert.notEqual(edited.data.project.status, 'completed');
  assert.equal((await w.request('/api/projects/archive', { slug })).data.code, 'STALE_VIDEO');
  fs.writeFileSync(path.join(out, 'current-video.json'), JSON.stringify({ schema: 1, id: '../outside' }));
  assert.equal((await w.request(`/api/projects/${slug}/files/video`)).status, 503);
});

test('SSE connects and render endpoints enforce saved storyboard then support cancel', async t => {
  const w = await workspace(t), [idea] = await w.add(), slug = idea.projectPath;
  const abort = new AbortController();
  const stream = await fetch(w.base + '/api/sse', { signal: abort.signal }); const reader = stream.body.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /event: connected/); abort.abort();
  assert.equal((await w.request('/api/projects/render', { slug })).status, 409);
  const board = { title: '可取消任务', aspect: '9:16', theme: 'midnight', scenes: [{ title: '可取消任务', body: '测试', duration: 2 }] };
  assert.equal((await w.request('/api/projects/save-script', { slug, storyboard: board })).status, 200);
  const caps = (await w.request('/api/health')).data.capabilities; assert.equal(caps.audio, false);
  if (!caps.available) { assert.equal((await w.request('/api/projects/render', { slug })).status, 503); return; }
  const started = await w.request('/api/projects/render', { slug }); assert.equal(started.status, 202); assert.ok(started.data.id);
  const duplicate = await w.request('/api/projects/render', { slug }); assert.equal(duplicate.data.id, started.data.id);
  assert.equal((await w.request('/api/projects/render-cancel', { slug })).status, 200);
  let status;
  for (let attempt = 0; attempt < 80; attempt++) { status = (await w.request(`/api/projects/render-status/${slug}`)).data; if (['cancelled', 'completed', 'failed'].includes(status.status)) break; await new Promise(resolve => setTimeout(resolve, 100)); }
  assert.equal(status.status, 'cancelled'); assert.equal((await w.request('/api/jobs')).data.jobs[0].id, started.data.id);
});

test('fetch transport handles status, oversized bodies, timeouts, and Shanghai midnight', async t => {
  const server = http.createServer((req, res) => { if (req.url === '/429') { res.writeHead(429); res.end('rate limited'); } else if (req.url === '/big') res.end('x'.repeat(50)); else if (req.url === '/slow') setTimeout(() => res.end('slow'), 300); else res.end('{}'); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal(await fetchUrl(base), '{}');
  await assert.rejects(fetchUrl(base + '/429'), /HTTP 429/);
  await assert.rejects(fetchUrl(base + '/big', { maxBytes: 10 }), /Response too large/);
  await assert.rejects(fetchUrl(base + '/slow', { timeout: 30 }), /deadline|timeout/i);
  assert.equal(todayStr(new Date('2026-09-22T16:01:00Z')), '2026-09-23');
});
