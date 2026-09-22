'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { AppError, fail, plain, hash, safePath, atomicWrite, readJson, validSlug, str } = require('./store');
const { makeBlueprint, validateStoryboard, renderHtml } = require('./blueprint');
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const escapeXml = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const coverKeys = ['BADGE', 'TITLE_LINE_1', 'TITLE_LINE_2', 'SUBTITLE', 'FEATURE_1', 'FEATURE_2', 'FEATURE_3', 'TAG_1_LABEL', 'TAG_1_VAL', 'TAG_2_LABEL', 'TAG_2_VAL', 'TAG_3_LABEL', 'TAG_3_VAL', 'CTA', 'FOOTER'];

function createProjects({ projectsDir, renderer }) {
  safePath(projectsDir); fs.mkdirSync(projectsDir, { recursive: true });
  function root(slug) { if (!validSlug(slug)) fail('项目标识无效'); const dir = safePath(projectsDir, slug); if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new AppError(404, '项目不存在'); return dir; }
  function file(slug, ...parts) { return safePath(root(slug), ...parts); }
  function exists(p) { return fs.existsSync(p) && fs.statSync(p).isFile() && fs.statSync(p).size > 0; }
  function read(p) { if (!exists(p)) return ''; if (fs.statSync(p).size > 2 * 1024 * 1024) throw new AppError(413, '文本文件超过 2 MB，请在本地编辑'); return fs.readFileSync(p, 'utf8'); }
  function meta(slug) { const value = readJson(file(slug, 'meta.json'), {}); if (!plain(value)) throw new AppError(503, '项目元数据格式无效', 'DATA_CORRUPT'); return value; }
  function saveMeta(slug, value) { atomicWrite(file(slug, 'meta.json'), JSON.stringify(value, null, 2)); }
  function first(slug, directory, pattern) {
    const dir = file(slug, directory); if (!fs.existsSync(dir)) return null;
    return fs.readdirSync(dir).filter(name => !name.startsWith('.') && pattern.test(name)).map(name => safePath(dir, name)).filter(exists).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || null;
  }
  function assets(slug) {
    const current = currentVideo(slug);
    const preferred = (sub, alternative) => { const p = file(slug, sub); return exists(p) ? p : alternative(); };
    return {
      video: current?.video || preferred('03-成品/video.mp4', () => first(slug, '03-成品', /\.mp4$/i) || first(slug, 'renders', /\.mp4$/i)),
      cover: preferred('03-成品/cover.svg', () => first(slug, '03-成品', /\.(png|jpg|jpeg|svg)$/i) || first(slug, '02-制作文件', /\.(png|jpg|jpeg|svg)$/i)),
      copy: preferred('01-内容方案/short-video-copy.md', () => null),
      plan: preferred('01-内容方案/video-plan.md', () => null),
      preview: preferred('index.html', () => { const p = file(slug, 'hyperframes', 'index.html'); return exists(p) ? p : null; }),
      subtitles: current?.subtitles || preferred('03-成品/subtitles.srt', () => null),
    };
  }
  function currentVideo(slug) {
    const pointer = readJson(file(slug, '03-成品', 'current-video.json'), null);
    if (pointer === null) return null;
    if (!plain(pointer) || pointer.schema !== 1 || typeof pointer.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pointer.id)) throw new AppError(503, '视频版本指针损坏，已保留原始文件', 'DATA_CORRUPT');
    const base = file(slug, '03-成品', 'versions', pointer.id);
    const current = { video: safePath(base, 'video.mp4'), subtitles: safePath(base, 'subtitles.srt'), meta: safePath(base, 'video-meta.json') };
    if (Object.values(current).some(p => !exists(p))) throw new AppError(503, '视频版本文件不完整，请重新渲染或恢复备份', 'DATA_CORRUPT');
    return current;
  }
  function content(slug) {
    const m = meta(slug), plan = read(file(slug, '01-内容方案', 'video-plan.md'));
    return { title: m.title || plan.match(/^#\s+(.+)$/m)?.[1] || slug, plan, copy: read(file(slug, '01-内容方案', 'short-video-copy.md')), storyboard: readJson(file(slug, 'storyboard.json'), null) };
  }
  function coverFields(slug) { return readJson(file(slug, 'cover-fields.json'), {}); }
  function revision(slug) { return hash({ content: content(slug), coverFields: coverFields(slug) }); }
  function checkVersion(slug, version) { if (version !== undefined && version !== revision(slug)) throw new AppError(409, '项目已被其他页面修改，请刷新后合并', 'VERSION_CONFLICT'); }
  function assertEditable(slug) { const job = renderer.get(slug); if (job && ['queued', 'rendering', 'running'].includes(job.status)) throw new AppError(409, '项目正在渲染，请等待完成或先取消任务', 'RENDER_BUSY'); }
  function summary(slug) {
    const a = assets(slug), m = meta(slug), job = renderer.get(slug);
    const videoMeta = readJson(currentVideo(slug)?.meta || file(slug, '03-成品', 'video-meta.json'), null), storyboard = content(slug).storyboard;
    const staleVideo = !!a.video && !!storyboard && (!videoMeta?.inputHash || videoMeta.inputHash !== hash(validateStoryboard(storyboard)));
    const hasCopy = !!a.copy && !!read(a.copy).trim(), completed = !!a.video && !!a.cover && hasCopy && !staleVideo;
    const status = completed ? 'completed' : a.video ? 'video_ready' : 'in_progress';
    return { name: slug, path: slug, title: content(slug).title, videoCount: a.video ? 1 : 0, hasCover: !!a.cover, hasCopy, hasScript: !!a.preview, hasStoryboard: exists(file(slug, 'storyboard.json')), status, statusLabel: staleVideo ? '分镜已修改，需重新渲染' : status === 'completed' ? '成品齐备' : status === 'video_ready' ? '视频就绪，待完善包装' : '制作中', staleVideo, needsRender: !a.video || staleVideo, videoMeta, archivedAt: staleVideo ? null : m.archivedAt || null, createdAt: m.createdAt || fs.statSync(root(slug)).birthtime.toISOString(), updatedAt: m.updatedAt || null, job: job || null };
  }
  function list() {
    const results = [];
    for (const entry of fs.readdirSync(projectsDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !validSlug(entry.name)) continue;
      try { if (fs.existsSync(file(entry.name, '01-内容方案'))) results.push(summary(entry.name)); }
      catch (err) { results.push({ name: entry.name, path: entry.name, title: entry.name, status: 'error', statusLabel: err.message, error: err.code || 'PROJECT_ERROR', videoCount: 0, hasCopy: false, hasCover: false, hasScript: false }); }
    }
    return results.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }
  function detail(slug) {
    return { ok: true, project: summary(slug), content: content(slug), coverFields: coverFields(slug), files: Object.fromEntries(Object.entries(assets(slug)).map(([kind, value]) => [kind, value ? `/api/projects/${encodeURIComponent(slug)}/files/${kind}` : null])), job: renderer.get(slug) || null, version: revision(slug) };
  }
  function defaultCover(title) { const chars = [...title]; return { BADGE: 'CREATOR STUDIO', TITLE_LINE_1: chars.slice(0, 15).join(''), TITLE_LINE_2: chars.slice(15, 30).join(''), SUBTITLE: '内容创作 · 项目封面', FEATURE_1: '', FEATURE_2: '', FEATURE_3: '', TAG_1_LABEL: '', TAG_1_VAL: '', TAG_2_LABEL: '', TAG_2_VAL: '', TAG_3_LABEL: '', TAG_3_VAL: '', CTA: '', FOOTER: 'TOPIC · CREATE · REVIEW' }; }
  function renderCover(fields) {
    const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'grapheme' });
    const normalized = key => String(fields[key] || '').replace(/\s+/gu, ' ').trim();
    // Width estimates distinguish CJK, narrow Latin glyphs and wide glyphs. SVG
    // textLength supplies a final bound even if the reader uses a fallback font.
    const glyphWidth = glyph => /\s/u.test(glyph) ? .34 : /^[ilI1|.,:;!'`]$/.test(glyph) ? .34 : /^[MW@#%&]$/.test(glyph) ? 1 : /^[\x20-\x7e]$/.test(glyph) ? .65 : 1.08;
    const widthOf = text => [...segmenter.segment(text)].reduce((sum, part) => sum + glyphWidth(part.segment), 0);
    function textBox(key, x, y, width, height, maxSize, color, weight = 400) {
      const value = normalized(key); if (!value) return '';
      const glyphs = [...segmenter.segment(value)].map(part => part.segment);
      let size = maxSize, lines;
      for (; size >= 6; size--) {
        lines = []; let line = '', used = 0;
        for (const glyph of glyphs) {
          const next = glyphWidth(glyph) * size;
          if (line && used + next > width - 8) { lines.push(line); line = ''; used = 0; }
          line += glyph; used += next;
        }
        if (line) lines.push(line);
        if (lines.length * size * 1.4 <= height - 4) break;
      }
      const lineHeight = size * 1.4, top = y + (height - lines.length * lineHeight) / 2;
      return `<text data-field="${key}" data-box="${x},${y},${width},${height}" font-size="${size}" font-weight="${weight}" fill="${color}" xml:space="preserve">${lines.map((line, i) => `<tspan x="${x + 4}" y="${(top + size * 1.12 + i * lineHeight).toFixed(2)}" textLength="${Math.min(width - 8, widthOf(line) * size).toFixed(2)}" lengthAdjust="spacingAndGlyphs">${escapeXml(line)}</tspan>`).join('')}</text>`;
    }
    const badgeWidth = Math.min(928, Math.max(300, widthOf(normalized('BADGE')) * 27 + 80));
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1440" viewBox="0 0 1080 1440"><rect width="1080" height="1440" fill="#071810"/><circle cx="990" cy="180" r="330" fill="#164831"/><rect x="76" y="84" width="${badgeWidth}" height="74" rx="37" fill="#bbed92"/><g font-family="Microsoft YaHei,Arial,sans-serif">${textBox('BADGE', 108, 94, badgeWidth - 64, 54, 27, '#071810')}${textBox('TITLE_LINE_1', 76, 285, 928, 210, 62, '#f3f7ec', 700)}${textBox('TITLE_LINE_2', 76, 510, 928, 210, 62, '#bbed92', 700)}${textBox('SUBTITLE', 76, 740, 928, 125, 32, '#b9c8bd')}${['FEATURE_1', 'FEATURE_2', 'FEATURE_3'].map((key, i) => textBox(key, 76, 887 + i * 80, 928, 72, 30, '#e2eadf')).join('')}${[1, 2, 3].map((n, i) => textBox(`TAG_${n}_LABEL`, 76 + i * 312, 1150, 292, 42, 20, '#95b9a2') + textBox(`TAG_${n}_VAL`, 76 + i * 312, 1197, 292, 67, 30, '#bbed92')).join('')}${textBox('CTA', 76, 1290, 928, 62, 27, '#e2eadf')}${textBox('FOOTER', 76, 1370, 928, 42, 20, '#779886')}</g></svg>`;
  }
  function setCover(slug, changes = {}, version) {
    checkVersion(slug, version);
    if (!plain(changes) || Object.keys(changes).some(k => !coverKeys.includes(k))) fail('封面字段无效');
    for (const [key, val] of Object.entries(changes)) str(val, key, 80);
    const fields = { ...defaultCover(content(slug).title), ...coverFields(slug), ...changes };
    atomicWrite(file(slug, 'cover-fields.json'), JSON.stringify(fields, null, 2));
    const svg = renderCover(fields); atomicWrite(file(slug, '03-成品', 'cover.svg'), svg); atomicWrite(file(slug, '02-制作文件', 'cover.svg'), svg);
    saveMeta(slug, { ...meta(slug), updatedAt: new Date().toISOString(), archivedAt: null });
    return { ok: true, slug, fields, mode: 'template', version: revision(slug) };
  }
  function create(idea) {
    const same = list().find(p => { try { return String(meta(p.path).ideaId) === String(idea.id); } catch { return false; } });
    if (same) return same.path;
    const label = idea.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 35) || 'topic';
    let slug; do { slug = `${today().replaceAll('-', '')}-${label}-${crypto.randomUUID().slice(0, 8)}`; } while (fs.existsSync(safePath(projectsDir, slug)));
    fs.mkdirSync(safePath(projectsDir, slug));
    for (const sub of ['01-内容方案', '02-制作文件', '03-成品', '04-项目记录']) fs.mkdirSync(file(slug, sub));
    saveMeta(slug, { schema: 1, title: idea.title, ideaId: idea.id, createdAt: new Date().toISOString(), generationMode: 'template' });
    atomicWrite(file(slug, '01-内容方案', 'video-plan.md'), `# ${idea.title}\n\n${idea.desc || ''}\n`);
    setCover(slug);
    return slug;
  }
  function syncIdeas(ideas, oldIdeas) {
    return ideas.map(idea => {
      const old = oldIdeas.find(i => String(i.id) === String(idea.id));
      const linked = old?.projectPath || idea.projectPath;
      if (linked) { root(linked); const owner = meta(linked).ideaId; if (owner !== undefined && String(owner) !== String(idea.id)) fail('项目已绑定其他选题'); return { ...idea, synced: true, projectPath: linked }; }
      return { ...idea, synced: true, projectPath: create(idea) };
    });
  }
  function update(slug, input) {
    if (!plain(input) || Object.keys(input).some(k => !['title', 'plan', 'copy', 'storyboard', 'version'].includes(k))) fail('项目内容字段无效');
    checkVersion(slug, input.version); assertEditable(slug);
    for (const key of ['title', 'plan', 'copy']) if (input[key] !== undefined) str(input[key], key, key === 'title' ? 120 : key === 'plan' ? 50000 : 100000, key === 'title');
    let normalized;
    if (input.storyboard !== undefined) normalized = validateStoryboard(input.storyboard);
    if (input.plan !== undefined) atomicWrite(file(slug, '01-内容方案', 'video-plan.md'), input.plan);
    if (input.copy !== undefined) atomicWrite(file(slug, '01-内容方案', 'short-video-copy.md'), input.copy);
    if (normalized) { atomicWrite(file(slug, 'storyboard.json'), JSON.stringify(normalized, null, 2)); atomicWrite(file(slug, 'index.html'), renderHtml(normalized)); }
    saveMeta(slug, { ...meta(slug), ...(input.title !== undefined ? { title: input.title } : {}), updatedAt: new Date().toISOString(), archivedAt: null });
    return detail(slug);
  }
  function blueprint(slug, topic) { const c = content(slug); if (topic !== undefined) str(topic, 'topic', 50000); return makeBlueprint({ title: c.title, plan: c.plan || topic || '' }); }
  function getFile(slug, kind) { const a = assets(slug); if (!Object.hasOwn(a, kind)) throw new AppError(404, '未知文件类型'); if (!a[kind]) throw new AppError(404, '文件尚未生成'); return a[kind]; }
  function archive(slug) {
    assertEditable(slug); const a = assets(slug), c = content(slug);
    if (!a.video || !a.cover || !c.copy.trim()) throw new AppError(409, '归档需要有效视频、封面和发布文案', 'INCOMPLETE_DELIVERABLES');
    if (summary(slug).staleVideo) throw new AppError(409, '分镜已修改，请先重新渲染再归档；旧成片已保留', 'STALE_VIDEO');
    const probe = spawnSync(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', a.video], { encoding: 'utf8', timeout: 20000, windowsHide: true, maxBuffer: 1024 * 1024 });
    let media; try { media = JSON.parse(probe.stdout || '{}'); } catch { media = {}; }
    if (probe.status !== 0 || !media.streams?.some(s => s.codec_type === 'video' && s.width > 0 && s.height > 0) || !(Number(media.format?.duration) > 0)) throw new AppError(409, '视频校验失败，无法归档；请先成功渲染', 'INVALID_VIDEO');
    const m = meta(slug); if (m.archivedAt) return { ok: true, slug, alreadyArchived: true, archivedAt: m.archivedAt, video: path.basename(a.video) };
    const archivedAt = new Date().toISOString();
    const record = `# ${c.title}\n\n归档时间：${archivedAt}\n\n${Object.entries(a).filter(([, p]) => p).map(([kind, p]) => `- ${kind}: ${path.relative(root(slug), p).replaceAll('\\', '/')}`).join('\n')}\n\n## 发布文案\n\n${c.copy}\n`;
    atomicWrite(file(slug, '04-项目记录', 'archive.md'), record);
    saveMeta(slug, { ...m, archivedAt });
    return { ok: true, slug, archivedAt, alreadyArchived: false, video: path.basename(a.video), duration: Number(media.format.duration) };
  }
  return { root, file, list, detail, meta, saveMeta, revision, checkVersion, content, assets, create, syncIdeas, update, blueprint, setCover, getFile, archive, assertEditable };
}
module.exports = { createProjects, today };
