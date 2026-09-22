'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

class AppError extends Error {
  constructor(status, message, code = 'INVALID_REQUEST') { super(message); this.status = status; this.code = code; }
}
const fail = (message) => { throw new AppError(400, message); };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const hash = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
function safePath(root, ...parts) {
  const base = path.resolve(root), target = path.resolve(base, ...parts);
  if (target !== base && !target.startsWith(base + path.sep)) throw new AppError(400, '路径超出项目范围', 'UNSAFE_PATH');
  const parsed = path.parse(target); let current = parsed.root;
  for (const part of target.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try { if (fs.lstatSync(current).isSymbolicLink()) throw new AppError(400, '不允许使用符号链接或目录联接', 'UNSAFE_PATH'); }
    catch (err) { if (err.code !== 'ENOENT') throw err; }
  }
  return target;
}
function atomicWrite(file, text) {
  safePath(path.dirname(file), path.basename(file));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${crypto.randomUUID()}.tmp`;
  let fd;
  try {
    fd = fs.openSync(tmp, 'wx', 0o600); fs.writeFileSync(fd, text, 'utf8'); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    fs.renameSync(tmp, file);
  } finally { if (fd !== undefined) fs.closeSync(fd); if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
}
function readJson(file, fallback) {
  if (!fs.existsSync(file)) return structuredClone(fallback);
  try { return JSON.parse(fs.readFileSync(safePath(path.dirname(file), path.basename(file)), 'utf8')); }
  catch (err) { if (err instanceof AppError) throw err; throw new AppError(503, `${path.basename(file)} 数据损坏，已保留原文件；请从备份恢复`, 'DATA_CORRUPT'); }
}
const defaults = { hotTopics: [], autoTopics: [], ideas: [], calendar: [], reviews: [], searchWords: [], weeklyNotes: [], settings: { weights: { hot: .3, wall: .25, duration: .25, money: .2 } } };
const names = Object.keys(defaults);
function str(value, label, max = 1000, required = false) {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value) || (required && !value.trim())) fail(`${label} 必须是${required ? '非空' : ''}文本（最多 ${max} 字符）`);
}
function numeric(value, label, min = 0, max = 1e12) { if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(`${label} 必须在 ${min}–${max} 范围内`); }
function identifier(value, label) { if (!(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) && !(typeof value === 'string' && /^[\w-]{1,120}$/u.test(value))) fail(`${label} 无效`); }
function date(value, label) { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) fail(`${label} 日期无效`); }
function url(value, label) { str(value, label, 2000); if (value) { try { if (!['https:', 'http:'].includes(new URL(value).protocol)) fail(`${label} 只允许 http/https 链接`); } catch { fail(`${label} 链接无效`); } } }
const fields = {
  hotTopics: 'id title source trend score date time url', autoTopics: 'id title source trend score date time url',
  ideas: 'id title desc hot wall duration money score pri format platform hotlink createdAt status synced projectPath',
  calendar: 'id title format status platform date views pri score projectPath url publishedAt',
  reviews: 'id calId title platform completion interact followers search views date revenue projectPath',
  searchWords: 'id word count date', weeklyNotes: 'id note date week',
};
const required = { hotTopics: ['id', 'title', 'date'], autoTopics: ['id', 'title', 'date'], ideas: ['id', 'title'], calendar: ['id', 'title', 'date'], reviews: ['id', 'calId', 'title', 'date'], searchWords: ['word', 'count', 'date'], weeklyNotes: ['note', 'date'] };
function validateCollection(name, data) {
  if (!names.includes(name)) throw new AppError(404, '未知数据集合');
  if (name === 'settings') {
    if (!plain(data) || Object.keys(data).some(k => k !== 'weights') || !plain(data.weights)) fail('settings 仅支持 weights');
    if (Object.keys(data.weights).sort().join(',') !== 'duration,hot,money,wall') fail('weights 需要 hot、wall、duration、money');
    for (const [key, val] of Object.entries(data.weights)) numeric(val, key, 0, 1);
    if (Math.abs(Object.values(data.weights).reduce((a, b) => a + b, 0) - 1) > .0001) fail('评分权重之和必须为 1');
    return structuredClone(data);
  }
  if (!Array.isArray(data) || data.length > 10000) fail(`${name} 必须是数组，最多 10000 条`);
  const allowed = new Set(fields[name].split(' ')), ids = new Set();
  for (const item of data) {
    if (!plain(item) || Object.keys(item).some(k => !allowed.has(k))) fail(`${name} 存在未知字段或无效条目`);
    for (const key of required[name]) if (item[key] === undefined) fail(`${name} 缺少 ${key}`);
    for (const [key, val] of Object.entries(item)) {
      const label = `${name}.${key}`;
      if (key === 'id' || key === 'calId') identifier(val, label);
      else if (['title', 'word', 'note'].includes(key)) str(val, label, key === 'note' ? 20000 : name === 'ideas' && key === 'title' ? 120 : 300, true);
      else if (['date', 'week'].includes(key)) date(val, label);
      else if (['score', 'hot', 'wall', 'duration', 'money'].includes(key)) numeric(val, label, 0, 5);
      else if (['completion', 'interact', 'search'].includes(key)) { if (val !== null) numeric(val, label, 0, 100); }
      else if (key === 'followers') { if (val !== null) { numeric(val, label, -1e12, 1e12); if (!Number.isInteger(val)) fail(`${label} 必须是整数`); } }
      else if (['views', 'count', 'revenue'].includes(key)) { if (!(key === 'views' && val === null)) { numeric(val, label); if (key !== 'revenue' && !Number.isInteger(val)) fail(`${label} 必须是整数`); } }
      else if (['url', 'hotlink'].includes(key)) url(val, label);
      else if (key === 'synced') { if (typeof val !== 'boolean') fail(`${label} 必须是布尔值`); }
      else if (key === 'projectPath') { str(val, label, 140); if (!validSlug(val)) fail('项目路径无效'); }
      else if (key === 'platform') { if (!['both', 'douyin', 'xiaohongshu', 'youtube', 'bilibili', 'other'].includes(val)) fail(`${label} 平台无效`); }
      else if (key === 'status') { if (!['pending', 'draft', 'planned', 'scripting', 'producing', 'editing', 'ready', 'scheduled', 'published', 'archived', 'completed', 'in_progress', 'done', 'skipped'].includes(val)) fail(`${label} 状态无效`); }
      else if (key === 'pri') { if (!['P0', 'P1', 'P2', 'Skip', '跳过'].includes(val)) fail(`${label} 优先级无效`); }
      else str(val, label, key === 'desc' ? 20000 : 1000);
    }
    if (item.id !== undefined) { const id = String(item.id); if (ids.has(id)) fail(`${name} ID 重复`); ids.add(id); }
  }
  return structuredClone(data);
}
function validSlug(slug) { return typeof slug === 'string' && /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,139}$/u.test(slug) && !/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(slug); }
function createStore(dataDir) {
  safePath(dataDir); fs.mkdirSync(dataDir, { recursive: true });
  const file = safePath(dataDir, 'workspace.json');
  function load() {
    let collections;
    if (fs.existsSync(file)) { const record = readJson(file, {}); if (record.schema !== 1 || !plain(record.collections)) throw new AppError(503, '工作区数据库结构损坏，原文件已保留', 'DATA_CORRUPT'); collections = record.collections; }
    else collections = Object.fromEntries(names.map(name => [name, readJson(safePath(dataDir, `${name}.json`), defaults[name])]));
    try { for (const name of names) validateCollection(name, collections[name]); }
    catch (err) { throw new AppError(503, `工作区数据格式无效，原文件已保留：${err.message}`, 'DATA_CORRUPT'); }
    return structuredClone(collections);
  }
  function versions(collections) { return Object.fromEntries(names.map(name => [name, hash(collections[name])])); }
  function check(changes, expected = {}) {
    if (!plain(changes) || !plain(expected)) fail('数据及版本必须是对象');
    if (!Object.keys(changes).length) fail('没有待保存的数据');
    const current = load(), currentVersions = versions(current);
    for (const [name, data] of Object.entries(changes)) {
      validateCollection(name, data);
      if (expected[name] !== undefined && expected[name] !== currentVersions[name]) throw new AppError(409, '数据已被其他页面更新，请重新加载后合并修改', 'VERSION_CONFLICT');
    }
    return current;
  }
  function save(changes, expected) {
    const current = check(changes, expected); const merged = { ...current, ...changes };
    if (fs.existsSync(file)) atomicWrite(safePath(dataDir, 'workspace.backup.json'), fs.readFileSync(file, 'utf8'));
    atomicWrite(file, JSON.stringify({ schema: 1, updatedAt: new Date().toISOString(), collections: merged }, null, 2));
    return { collections: merged, versions: versions(merged) };
  }
  return { load, save, check, versions };
}
module.exports = { AppError, fail, plain, hash, safePath, atomicWrite, readJson, validSlug, validateCollection, createStore, names, str };
