'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { chromium } = require('playwright');
const { validateStoryboard, renderHtml, subtitles, ASPECTS } = require('./blueprint');
const FPS = 24;
function fault(message, status = 400) { const error = new Error(message); error.status = status; return error; }
function atomic(file, value) {
  const tmp = `${file}.${crypto.randomUUID()}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try { fs.writeFileSync(tmp, value); fs.renameSync(tmp, file); }
  finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
}
function safeProject(root, slug) {
  if (typeof slug !== 'string' || !/^[\p{L}\p{N}_-]{1,100}$/u.test(slug) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(slug)) throw fault('无效的项目标识');
  const resolvedRoot = fs.realpathSync(root), dir = path.join(resolvedRoot, slug);
  if (!fs.existsSync(dir) || fs.lstatSync(dir).isSymbolicLink()) throw fault('项目不存在或不是普通目录', 404);
  const rel = path.relative(resolvedRoot, fs.realpathSync(dir));
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw fault('项目路径不合法');
  return dir;
}
function checkChild(dir, name) {
  const file = path.join(dir, name);
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw fault('不允许链接文件');
  return file;
}
function createRenderer({ dataDir, projectsDir, broadcast = () => {} }) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(projectsDir, { recursive: true });
  const jobsFile = path.join(dataDir, 'render-jobs.json');
  let jobs = fs.existsSync(jobsFile) ? JSON.parse(fs.readFileSync(jobsFile, 'utf8')) : [];
  if (!Array.isArray(jobs)) throw new Error('渲染任务记录格式错误，请从备份恢复');
  const persist = () => atomic(jobsFile, JSON.stringify(jobs, null, 2));
  let interrupted = false;
  for (const job of jobs) if (['queued', 'rendering'].includes(job.status)) {
    Object.assign(job, { status: 'failed', error: '服务曾中断，请重新渲染；已存在的成片不受影响。', finishedAt: new Date().toISOString() }); interrupted = true;
  }
  if (interrupted) persist();
  const queue = [], controls = new Map(); let active = false, closing = false;
  const update = (job, fields) => {
    Object.assign(job, fields, { updatedAt: new Date().toISOString() }); persist();
    broadcast('render-update', { ...job });
    if (['completed', 'failed', 'cancelled'].includes(job.status)) broadcast('data-update', { collection: 'projects', slug: job.slug });
  };
  let cachedCaps;
  function capabilities() {
    if (cachedCaps && Date.now() - cachedCaps.at < 30000) return cachedCaps.value;
    const ffmpeg = spawnSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-version'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
    const ffprobe = spawnSync(process.env.FFPROBE_PATH || 'ffprobe', ['-version'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
    const browser = fs.existsSync(process.env.CHROMIUM_PATH || chromium.executablePath());
    const value = { available: ffmpeg.status === 0 && ffprobe.status === 0 && browser, ffmpeg: ffmpeg.status === 0, ffprobe: ffprobe.status === 0, browser, fps: FPS, audio: false, engine: 'Chromium + FFmpeg', setup: 'npm run setup:browser；并安装 FFmpeg（含 ffprobe）' };
    cachedCaps = { at: Date.now(), value }; return value;
  }
  function get(slug) { return jobs.find(j => j.slug === slug) || null; }
  function start(slug) {
    if (closing) throw fault('服务正在关闭', 503);
    const previous = get(slug);
    if (previous && ['queued','rendering'].includes(previous.status)) return { ...previous };
    if (queue.length >= 20) throw fault('任务队列已满，请稍后重试', 429);
    const dir = safeProject(projectsDir, slug), boardFile = checkChild(dir, 'storyboard.json');
    if (!fs.existsSync(boardFile)) throw fault('请先在工作室保存分镜，再开始渲染');
    const board = validateStoryboard(JSON.parse(fs.readFileSync(boardFile, 'utf8')));
    if (!capabilities().available) throw fault('渲染环境未就绪：请检查 Chromium、FFmpeg 和 ffprobe', 503);
    const now = new Date().toISOString(), [width, height] = ASPECTS[board.aspect];
    const job = { id: crypto.randomUUID(), slug, status: 'queued', progress: 0, createdAt: now, updatedAt: now, duration: board.scenes.reduce((n,s)=>n+s.duration,0), width, height, fps: FPS, hasAudio: false, inputHash: crypto.createHash('sha256').update(JSON.stringify(board)).digest('hex') };
    jobs.unshift(job); jobs = jobs.slice(0, 200); persist(); queue.push({ job, board });
    broadcast('render-update', { ...job }); setImmediate(pump); return { ...job };
  }
  async function run({ job, board }) {
    const control = { cancelled: false, browser: null, child: null };
    controls.set(job.id, control);
    let timer, temp;
    try {
      const dir = safeProject(projectsDir, job.slug), outputDir = checkChild(dir, '03-成品');
      fs.mkdirSync(outputDir, { recursive: true });
      temp = path.join(outputDir, `.render-${job.id}.mp4`);
      update(job, { status: 'rendering', startedAt: new Date().toISOString(), error: null });
      timer = setTimeout(() => { control.cancelled = true; control.timeout = true; control.child?.kill(); control.browser?.close().catch(()=>{}); }, 15 * 60 * 1000);
      control.browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
      if (control.cancelled) throw new Error('任务已取消');
      const context = await control.browser.newContext({ viewport: { width: job.width, height: job.height }, deviceScaleFactor: 1, serviceWorkers: 'block' });
      await context.route('**/*', route => route.abort());
      const page = await context.newPage();
      await page.addInitScript(() => { window.__RENDER_MODE__ = true; });
      await page.goto('about:blank');
      await page.setContent(renderHtml(board), { waitUntil: 'load' });
      await page.evaluate(() => { window.__RENDER_MODE__ = true; return document.fonts.ready; });
      let stderr = '', processError;
      const child = spawn(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner','-loglevel','error','-y','-f','image2pipe','-vcodec','mjpeg','-framerate',String(FPS),'-i','pipe:0','-an','-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-movflags','+faststart',temp], { windowsHide: true, stdio: ['pipe','ignore','pipe'] });
      control.child = child;
      child.stderr.on('data', c => { stderr = (stderr + c).slice(-3000); });
      child.stdin.on('error', e => { processError = e; });
      const exited = new Promise(resolve => { child.once('error', e => { processError = e; resolve(-1); }); child.once('close', resolve); });
      const count = Math.ceil(job.duration * FPS);
      for (let i = 0; i < count; i++) {
        if (control.cancelled) throw new Error('任务已取消');
        if (processError || child.exitCode !== null) throw processError || new Error(stderr || '编码进程提前结束');
        await page.evaluate(t => window.seek(t), i / FPS);
        const frame = await page.screenshot({ type: 'jpeg', quality: 90, animations: 'disabled' });
        await new Promise((resolve, reject) => child.stdin.write(frame, error => error ? reject(error) : resolve()));
        const progress = Math.floor((i + 1) / count * 95);
        if (progress >= job.progress + 5) update(job, { progress });
      }
      child.stdin.end();
      const code = await exited;
      if (control.cancelled) throw new Error('任务已取消');
      if (code !== 0) throw new Error(stderr || processError?.message || `FFmpeg 退出 ${code}`);
      const result = spawnSync(process.env.FFPROBE_PATH || 'ffprobe', ['-v','error','-show_streams','-show_format','-of','json',temp], { encoding: 'utf8', timeout: 15000, windowsHide: true });
      if (result.status !== 0) throw new Error('成片校验失败：ffprobe 无法读取视频');
      const probe = JSON.parse(result.stdout), video = probe.streams.find(s => s.codec_type === 'video');
      if (!video || video.width !== job.width || video.height !== job.height || Math.abs(Number(probe.format.duration) - job.duration) > .2 || fs.statSync(temp).size < 1000) throw new Error('成片尺寸、时长或数据不符合分镜');
      // Publish a complete immutable asset set through one atomic pointer. Failure
      // while writing subtitles/metadata never replaces the previous deliverable.
      const versionsDir = checkChild(outputDir, 'versions');
      fs.mkdirSync(versionsDir, { recursive: true });
      const versionDir = checkChild(versionsDir, job.id);
      fs.mkdirSync(versionDir);
      const target = path.join(versionDir, 'video.mp4');
      fs.renameSync(temp, target);
      atomic(path.join(versionDir, 'subtitles.srt'), subtitles(board));
      const metadata = { width: video.width, height: video.height, duration: Number(probe.format.duration), fps: FPS, codec: video.codec_name, size: fs.statSync(target).size, hasAudio: false, jobId: job.id, inputHash: job.inputHash, renderedAt: new Date().toISOString() };
      atomic(path.join(versionDir, 'video-meta.json'), JSON.stringify(metadata, null, 2));
      atomic(checkChild(outputDir, 'current-video.json'), JSON.stringify({ schema: 1, id: job.id }));
      update(job, { status: 'completed', progress: 100, finishedAt: new Date().toISOString(), output: `/api/projects/${encodeURIComponent(job.slug)}/files/video`, metadata });
    } catch (error) {
      update(job, { status: control.cancelled && !control.timeout ? 'cancelled' : 'failed', error: control.timeout ? '渲染超过 15 分钟，任务已停止，请缩短分镜后重试。' : error.message, finishedAt: new Date().toISOString() });
    } finally {
      clearTimeout(timer); control.child?.kill(); await control.browser?.close().catch(()=>{}); controls.delete(job.id);
      if (temp && fs.existsSync(temp)) fs.unlinkSync(temp);
    }
  }
  async function pump() {
    if (active || closing) return;
    active = true;
    try { while (queue.length && !closing) { const item = queue.shift(); if (item.job.status === 'queued') await run(item); } }
    finally { active = false; }
  }
  function cancel(slug) {
    const job = get(slug);
    if (!job) throw fault('任务不存在', 404);
    if (job.status === 'queued') update(job, { status: 'cancelled', finishedAt: new Date().toISOString(), error: '已取消排队' });
    if (job.status === 'rendering') { const control = controls.get(job.id); if (control) { control.cancelled = true; control.child?.kill(); control.browser?.close().catch(()=>{}); } }
    return { ...job };
  }
  async function close() {
    closing = true;
    for (const job of jobs.filter(j => ['queued','rendering'].includes(j.status))) cancel(job.slug);
    await Promise.all([...controls.values()].map(c => c.browser?.close().catch(()=>{})));
  }
  return { start, get: slug => { const job=get(slug); return job ? { ...job } : null; }, list: () => jobs.map(j => ({ ...j })), cancel, close, capabilities };
}
module.exports = { createRenderer };
