'use strict';
// One state store and one event stream. All user content is escaped or assigned as text.
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today = () => new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Hong_Kong',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const addDays = (date, n) => { const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const weekStart = date => { const d = new Date(date + 'T12:00:00Z').getUTCDay(); return addDays(date, d === 0 ? -6 : 1 - d); };
const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const fmt = value => Number(value).toLocaleString('zh-CN', {maximumFractionDigits:1});
const text = (id, value) => { if ($(id)) $(id).textContent = String(value ?? ''); };
const html = (id, value) => { if ($(id)) $(id).innerHTML = value; };
const val = id => $(id)?.value ?? '';
const setVal = (id, value) => { if ($(id)) $(id).value = value ?? ''; };
const sameId = (a, b) => String(a) === String(b);
const clone = value => JSON.parse(JSON.stringify(value));
let idCounter = 0;
const nextId = () => Date.now() + idCounter++;
const platforms = {douyin:'抖音',xiaohongshu:'小红书',both:'抖音 + 小红书',multiple:'多平台',manual:'手动发现',github:'GitHub',hackernews:'Hacker News',toutiao:'今日头条',baidu:'百度'};
const formats = {'hyperframes-text':'观点解读','remotion-demo':'步骤教程','remotion-compare':'对比评测','hyperframes-narrate':'清单盘点','image-text':'图文讲解'};
const statuses = {pending:'待制作',in_progress:'制作中',completed:'已完成',skipped:'暂缓',draft:'草稿',scheduled:'计划发布',published:'已人工发布',video_ready:'视频已生成'};
const titles = {overview:'Pipeline Studio',hot:'Hotspots',matrix:'Topic Matrix',calendar:'Content Calendar',review:'Performance Review',playbook:'Creator Playbook',assets:'Asset Board',studio:'Project Studio',settings:'Workspace Settings'};
const empty = (message, extra = '') => `<div class="empty"><span class="material-symbols-outlined" aria-hidden="true">layers_clear</span>${esc(message)}${extra ? `<p class="help">${esc(extra)}</p>` : ''}</div>`;
const button = (label, action, data = {}, cls = 'btn btn-g btn-sm') => `<button type="button" class="${cls}" data-action="${action}" ${Object.entries(data).map(([k,v]) => `data-${k}="${esc(v)}"`).join(' ')}>${esc(label)}</button>`;
const safeUrl = value => { try { const u = new URL(value); return ['http:','https:'].includes(u.protocol) ? u.href : ''; } catch { return ''; } };
const fileUrl = (slug, kind, download = false) => `/api/projects/${encodeURIComponent(slug)}/files/${kind}${download ? '?download=1' : ''}`;
const metric = (label, value, detail, icon) => `<div class="metric glass-card"><div class="metric-label">${esc(label)}<span class="material-symbols-outlined" aria-hidden="true">${esc(icon)}</span></div><div class="metric-value">${esc(value)}</div><p class="help">${esc(detail)}</p></div>`;
const score = i => +(num(i.hot)*.3 + num(i.wall)*.25 + num(i.duration)*.25 + num(i.money)*.2).toFixed(2);
const priority = n => n >= 4 ? 'P0' : n >= 3.5 ? 'P1' : n >= 3 ? 'P2' : 'Skip';
const priorityLabel = value => value === 'Skip' || value === '跳过' ? '暂缓' : value;
let S = {hotTopics:[],autoTopics:[],ideas:[],calendar:[],reviews:[],searchWords:[],weeklyNotes:[],projects:[],versions:{}};
let jobs = [], health = null, recommendations = [], hotFilter = 'all', matrixFilter = 'all', weekOffset = 0, currentPage = 'overview';
const editVersions = {};
let studio = null, refreshPromise = null, pollBusy = false, mutationBusy = false, initialized = false, stream = null, refreshTimer = null;
let studioOpenRequest = 0;

function toast(message) { const el = document.createElement('div'); el.className = 'toast'; el.textContent = String(message); $('toast-box').appendChild(el); setTimeout(() => el.remove(), 5500); }
function showError(error) { const message = error?.message || String(error); toast(message); if (error?.status === 409 || !initialized) { const el = $('app-error'); el.hidden = false; el.textContent = message; const reload = document.createElement('button'); reload.className = 'btn btn-g'; reload.textContent = '刷新列表'; reload.dataset.action = 'refresh'; el.append(' ', reload); } }
async function api(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeout || 60000);
  const {timeout, ...request} = options;
  try {
    const response = await fetch(path, {...request,signal:controller.signal,headers:{'Accept':'application/json',...(request.body ? {'Content-Type':'application/json'} : {}),...request.headers}});
    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('application/json') ? await response.json() : {error:await response.text()};
    if (!response.ok || data.ok === false) { const e = new Error(response.status === 409 && data.code === 'VERSION_CONFLICT' ? '数据已被其他页面或任务更新。当前编辑已保留；请重新打开记录或重新读取项目，合并修改后保存。' : (data.error || data.message || `请求失败 (${response.status})`)); e.status = response.status; throw e; }
    return data;
  } catch (e) { if (e.name === 'AbortError') throw new Error('请求超时，请检查连接并刷新任务状态后再试。'); if (e instanceof TypeError) throw new Error('无法连接本地服务，请确认服务运行后刷新。'); throw e; }
  finally { clearTimeout(timer); }
}
const post = (path, body = {}) => api(path, {method:'POST',body:JSON.stringify(body)});
async function busy(el, operation) { const previous = el?.disabled; if (el) { el.disabled = true; el.setAttribute('aria-busy','true'); } try { return await operation(); } finally { if (el?.isConnected) { el.disabled = previous; el.removeAttribute('aria-busy'); if (el.id === 'studio-render') renderJobLists(); } } }
function normalize(data) { const result = {...data}; for (const key of ['hotTopics','autoTopics','ideas','calendar','reviews','searchWords','weeklyNotes','projects']) result[key] = Array.isArray(data[key]) ? data[key] : []; result.versions ||= {}; return result; }
async function refresh() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => { const data = await api('/api/data'); S = normalize(data); initialized = true; $('app-error').hidden = true; renderAll(); return S; })().finally(() => { refreshPromise = null; });
  return refreshPromise;
}
async function saveCollections(patch, expectedVersions = {}) {
  if (mutationBusy) throw new Error('上一笔数据仍在保存，请稍后再试。');
  mutationBusy = true;
  const versions = Object.fromEntries(Object.keys(patch).filter(k => S.versions[k]).map(k => [k,expectedVersions[k] || S.versions[k]]));
  try { if (refreshPromise) await refreshPromise; await post('/api/data', {...patch,versions}); if (refreshPromise) await refreshPromise; await refresh(); }
  catch (e) { if (e.status === 409) { await refresh().catch(() => {}); } throw e; }
  finally { mutationBusy = false; }
}
function setOptions(id, items, placeholder = '— 请选择 —') { const select = $(id); if (!select) return; const selected = select.value; select.replaceChildren(); select.add(new Option(placeholder,'')); items.forEach(([value,label]) => select.add(new Option(label, String(value)))); if ([...select.options].some(o => o.value === selected)) select.value = selected; }
function goPage(page) {
  if (!titles[page]) return;
  if (page !== 'studio') studioOpenRequest++;
  currentPage = page;
  document.querySelectorAll('.pg').forEach(el => el.classList.toggle('on', el.id === 'p-' + page));
  document.querySelectorAll('.aura-nav-item[data-p]').forEach(el => { const active = el.dataset.p === page; el.classList.toggle('on', active); el.setAttribute('aria-current', active ? 'page' : 'false'); });
  text('pt', titles[page]);
  history.replaceState(null, '', page === 'studio' && studio ? `#studio/${encodeURIComponent(studio.slug)}` : '#' + page);
  if (page === 'settings') loadHealth().catch(showError);
  window.scrollTo({top:0,behavior:'auto'});
}
function toggleTheme() { const dark = document.documentElement.classList.toggle('dark'); localStorage.setItem('pipeline-theme', dark ? 'dark' : 'light'); text('tt', dark ? 'Light' : 'Dark'); }
function publishedOptions() { return S.calendar.filter(c => c.status === 'published').map(c => [c.id, `${c.title} · ${platforms[c.platform] || c.platform}`]); }
function updateSelects() { setOptions('rv-pick',publishedOptions(),'— 选择已发布内容 —'); setOptions('qe-pick',publishedOptions(),'— 选择已发布内容 —'); setOptions('calendar-project',S.projects.map(p => [p.path || p.name,p.title || p.name]),'不关联项目'); }
function latestReviews() { const map = new Map(); S.reviews.forEach(r => { const key = `${r.calId}:${r.platform}`; const prior = map.get(key); if (!prior || r.date > prior.date || (r.date === prior.date && num(r.id) > num(prior.id))) map.set(key,r); }); return [...map.values()]; }
function avg(records,key) { const known = records.filter(r => r[key] !== null && r[key] !== undefined && r[key] !== ''); return known.length ? (known.reduce((a,r) => a + num(r[key]),0)/known.length).toFixed(1) + '%' : '—'; }
function renderAll() { renderOverview(); renderHot(); renderIdeas(); renderCalendar(); renderReviews(); renderAssets(); renderNotes(); renderKeywords(); updateSelects(); renderJobLists(); }
function renderOverview() {
  const start = weekStart(today()), end = addDays(start,6), latest = latestReviews();
  const published = S.calendar.filter(c => c.date >= start && c.date <= end && c.status === 'published').length;
  const pending = S.ideas.filter(i => i.status === 'pending').length;
  const hotCount = [...S.hotTopics,...S.autoTopics].filter(x => x.date === today()).length;
  html('overview-metrics', metric('本周已发布',published,'按人工发布记录计数','send') + metric('平均完播率',avg(latest,'completion'),'最新记录的算术平均','play_circle') + metric('待制作选题',pending,`${S.ideas.length} 条选题已保存`,'lightbulb') + metric('今日热点',hotCount,'公开来源与手工发现','trending_up'));
  text('p0-badge',S.ideas.filter(i => priority(score(i)) === 'P0' && i.status === 'pending').length);
  const total = S.projects.length;
  text('flow-status',`${total} 个项目`);
  html('pipeline-stages', [['已建项目',total],['已存分镜',S.projects.filter(p => p.hasStoryboard).length],['已生成视频',S.projects.filter(p => p.videoCount > 0).length],['交付齐备',S.projects.filter(p => p.status === 'completed').length]].map(([name,count]) => `<div class="pipeline-item"><span>${name}</span><div class="pipeline-track"><div class="pipeline-fill" style="width:${total ? count/total*100 : 0}%"></div></div><strong>${count}</strong></div>`).join(''));
  html('proj-box-mini', S.projects.length ? S.projects.slice(0,4).map(p => `<div class="row"><div class="row-main"><div class="row-title">${esc(p.title || p.name)}</div><div class="row-sub">${esc(p.statusLabel || statuses[p.status])}</div></div>${button('打开','studio',{slug:p.path || p.name})}</div>`).join('') : empty('还没有项目','在选题矩阵保存第一个想法。'));
  const calendar = S.calendar.filter(c => c.date >= start && c.date <= end).sort((a,b) => a.date.localeCompare(b.date));
  html('overview-calendar',calendar.length ? calendar.map(c => `<div class="row"><span class="pill">${esc(c.date.slice(5))}</span><div class="row-main"><div class="row-title">${esc(c.title)}</div><div class="row-sub">${esc(platforms[c.platform])} · ${esc(statuses[c.status])}</div></div>${button('编辑','edit-calendar',{id:c.id})}</div>`).join('') : empty('本周暂无计划','完成作品后，为它安排一个发布时间。'));
  text('workspace-signal',`${S.reviews.filter(r => r.date === today()).length} 条今日指标 · ${S.projects.length} 个项目`);
  html('growth-summary',`<div class="metric-grid">${metric('累计播放',fmt(latest.reduce((n,r) => n+num(r.views),0)),'每内容 / 平台最新快照','visibility')}${metric('累计净增关注',latest.some(r => r.followers != null) ? fmt(latest.reduce((n,r) => n+num(r.followers),0)) : '—','缺失指标不参与汇总','person_add')}${metric('已记录内容',new Set(latest.map(r => r.calId)).size,'至少录入一次平台数据','movie')}${metric('复盘快照',S.reviews.length,'含历史快照','analytics')}</div>`);
  html('inventory-summary',`<p class="muted">${total} 个项目 · ${S.projects.filter(p => p.videoCount > 0).length} 个含视频 · ${S.projects.filter(p => p.hasCover).length} 个含封面 · ${S.projects.filter(p => p.hasCopy).length} 个含文案</p>`);
  renderGrowthChart(); renderRecommendations();
}
function renderGrowthChart() {
  const dates = Array.from({length:7},(_,i) => addDays(today(),i-6));
  const values = Object.fromEntries(dates.map(d => [d,0]));
  const observed = new Set(); const previous = new Map();
  S.reviews.filter(r => r.followers != null).slice().sort((a,b) => a.date.localeCompare(b.date) || num(a.id)-num(b.id)).forEach(r => { const key = `${r.calId}:${r.platform}`; const delta = num(r.followers) - (previous.get(key) || 0); previous.set(key,num(r.followers)); if (Object.hasOwn(values,r.date)) { values[r.date] += delta; observed.add(r.date); } });
  if (!observed.size) { html('growth-chart',empty('最近 7 天还没有关注数据','到数据复盘录入实际平台指标后，这里会显示变化。')); return; }
  const max = Math.max(...Object.values(values).map(Math.abs),1);
  html('growth-chart',`<div class="chart" role="img" aria-label="最近七天净增关注：${esc(dates.map(d => `${d} ${observed.has(d) ? values[d] : '未采集'}`).join('；'))}">${dates.map(d => `<div class="chart-day"><div class="chart-bar" style="height:${Math.max(2,Math.abs(values[d])/max*155)}px;opacity:${observed.has(d) ? 1 : .25};${values[d] < 0 ? 'background:var(--orange)' : ''}"><span class="chart-number">${observed.has(d) ? fmt(values[d]) : '—'}</span></div><span class="chart-label">${d.slice(5)}</span></div>`).join('')}</div><p class="help">以相邻累计快照的差额计入采集日；首次记录计入累计值。— 表示未采集。</p>`);
}
function hotItems() { return [...S.autoTopics.map((x,i) => ({...x,_auto:true,_key:`a-${i}`})),...S.hotTopics.map((x,i) => ({...x,_auto:false,_key:`m-${i}`}))].sort((a,b) => String(b.date).localeCompare(String(a.date)) || num(b.score)-num(a.score)); }
function renderHot() {
  const all = hotItems(), current = all.filter(x => x.date === today());
  const visible = all.filter(x => hotFilter === 'all' || (hotFilter === 'manual' ? !x._auto : x.source === hotFilter));
  text('hot-count',visible.length);
  const top = current.slice().sort((a,b) => num(b.score)-num(a.score))[0];
  text('tp-title',top?.title || '从一个值得讲的热点开始'); text('tp-detail',top ? `${platforms[top.source] || top.source} · 来源 / 主观热度 ${top.score || '—'} / 5 · ${top.trend || '请进一步核对原始信息'}` : '获取公开热点，或添加自己的观察。'); $('tp-create-btn').disabled = !top; $('tp-create-btn').dataset.key = top?._key || '';
  html('hot-box',visible.length ? visible.map(x => { const url = safeUrl(x.url); return `<div class="row"><span class="pill">${esc(platforms[x.source] || x.source)}</span><div class="row-main"><div class="row-title">${url ? `<a class="text-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(x.title)} ↗</a>` : esc(x.title)}</div><div class="row-sub">${esc(x.date)} · 热度 ${esc(x.score ?? '—')} / 5 ${x.trend ? ' · '+esc(x.trend) : ''}</div></div><div class="actions">${button('选题','hot-to-idea',{key:x._key},'btn btn-p btn-sm')}${!x._auto ? button('删除','delete-hot',{id:x.id}) : ''}</div></div>`; }).join('') : empty('暂无匹配热点','使用「获取最新热点」或手动添加。'));
  html('hot-summary',`<div class="row"><span class="row-main">今日采集 / 添加</span><strong>${current.length}</strong></div><div class="row"><span class="row-main">今日来源数</span><strong>${new Set(current.map(x => x.source)).size}</strong></div><div class="row"><span class="row-main">已转入选题</span><strong>${S.ideas.length}</strong></div>`);
  const fetchState = S.fetchStatus || health?.fetchStatus;
  text('fetch-status', fetchState?.updatedAt ? `上次获取：${new Date(fetchState.updatedAt).toLocaleString('zh-CN')} · ${{success:'成功',partial:'部分来源失败',error:'失败，保留旧数据',never:'尚未获取'}[fetchState.status] || fetchState.status}。${(fetchState.sources || []).map(s => (platforms[s.source || s.name] || s.source || s.name || '') + '：' + (s.status === 'error' ? '失败' : '成功')).join('；')}` : '显示已保存的来源数据。网络抓取可能受来源可用性影响，旧热点保留原日期。');
}
function renderRecommendations() { const list = recommendations.length ? recommendations : hotItems().filter(x => x.date === today()).slice(0,4).map(x => ({...x,reason:'按来源热度排序；请人工核实后再制作'})); html('rc-box', list.length ? list.slice(0,4).map((x,i) => `<div class="row"><div class="row-main"><div class="row-title">${esc(x.title)}</div><div class="row-sub">${esc(x.reason || '基于关键词与来源的规则建议')}</div></div>${button('选择','recommend-idea',{index:i})}</div>`).join('') : empty('暂无选题参考','先添加或获取热点。')); }
function renderIdeas() {
  const all = S.ideas.slice().sort((a,b) => score(b)-score(a)); const visible = all.filter(i => matrixFilter === 'all' || priority(score(i)) === matrixFilter); text('ic-ct',S.ideas.length);
  html('itb', visible.length ? visible.map(i => `<article class="glass-card topic-card"><div class="section-head"><span class="pill green">${priorityLabel(priority(score(i)))} · ${score(i).toFixed(2)}</span><span class="help">${esc(statuses[i.status] || i.status)}</span></div><h3>${esc(i.title)}</h3><p class="help">${esc(i.desc || '尚未补充内容角度')}</p><div class="score-grid">${[['热度',i.hot],['匹配',i.wall],['长尾',i.duration],['商业',i.money]].map(([k,v]) => `<div>${k}<strong>${esc(v)}</strong></div>`).join('')}</div><div class="help">${esc(formats[i.format] || i.format)} · ${esc(platforms[i.platform] || i.platform)}</div><div class="actions">${button('Build / 工作室','build-idea',{id:i.id},'btn btn-p btn-sm')}${button('编辑','edit-idea',{id:i.id})}${button('删除','delete-idea',{id:i.id})}</div></article>`).join('') : empty('这里还没有选题','保存一个灵感，或从热点创建。'));
}
function renderCalendar() {
  const start = addDays(weekStart(today()),weekOffset*7), end = addDays(start,6), platform = val('calendar-filter') || 'all';
  text('cal-lb', `${start.slice(5)} — ${end.slice(5)}`);
  const visible = S.calendar.filter(c => c.date >= start && c.date <= end && (platform === 'all' || c.platform === platform || (['multiple','both'].includes(c.platform) && !['multiple','both'].includes(platform)))).sort((a,b) => a.date.localeCompare(b.date));
  html('cal-grid',Array.from({length:7},(_,i) => { const date = addDays(start,i); const rows = visible.filter(c => c.date === date); return `<div class="week-day${date === today() ? ' today' : ''}"><div class="week-heading">${['周一','周二','周三','周四','周五','周六','周日'][i]} ${date.slice(5)}</div>${rows.length ? rows.map(c => `<button class="calendar-chip ${esc(c.status)}" data-action="edit-calendar" data-id="${esc(c.id)}">${esc(c.title)}<div class="help">${esc(statuses[c.status])}</div></button>`).join('') : '<span class="help">暂无安排</span>'}</div>`; }).join(''));
  html('cal-tb',visible.length ? visible.map(c => { const url = safeUrl(c.url); return `<div class="row"><span class="pill">${esc(c.date.slice(5))}</span><div class="row-main"><div class="row-title">${esc(c.title)}</div><div class="row-sub">${esc(platforms[c.platform])} · ${esc(statuses[c.status])}${c.projectPath ? ' · 已关联项目' : ''}${url ? ` · <a class="text-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">查看发布 ↗</a>` : ''}</div></div><div class="actions">${c.projectPath ? button('项目','studio',{slug:c.projectPath}) : ''}${c.status === 'published' ? button('复盘','review-calendar',{id:c.id}) : ''}${button('编辑','edit-calendar',{id:c.id})}${button('删除','delete-calendar',{id:c.id})}</div></div>`; }).join('') : empty('本周没有匹配的发布记录'));
}
function renderReviews() {
  const latest = latestReviews();
  html('rv-metrics',metric('累计播放',fmt(latest.reduce((s,r) => s+num(r.views),0)),'每内容 / 平台最新快照','visibility') + metric('平均完播率',avg(latest,'completion'),'已采集内容的算术平均','play_circle') + metric('平均互动率',avg(latest,'interact'),'已采集内容的算术平均','favorite') + metric('累计净增关注',latest.some(r => r.followers != null) ? fmt(latest.reduce((s,r) => s+num(r.followers),0)) : '—','每内容 / 平台最新快照','person_add'));
  ['douyin','xiaohongshu'].forEach(platform => { const list = S.reviews.filter(r => r.platform === platform).slice().sort((a,b) => b.date.localeCompare(a.date) || num(b.id)-num(a.id)); html('rv-'+platform+'-list',list.length ? list.map(r => `<div class="row"><div class="row-main"><div class="row-title">${esc(r.title)}</div><div class="row-sub">${esc(r.date)} · 播放 ${fmt(r.views)} · 完播 ${r.completion == null ? '未采集' : fmt(r.completion)+'%'} · 关注 ${r.followers == null ? '未采集' : fmt(r.followers)} ${latest.includes(r) ? ' · 最新快照' : ''}</div></div><div class="actions">${button('编辑','edit-review',{id:r.id})}${button('删除','delete-review',{id:r.id})}</div></div>`).join('') : empty(`暂无${platforms[platform]}数据`)); });
}
function renderNotes() { html('notes-box',S.weeklyNotes.length ? S.weeklyNotes.slice().reverse().map((n,i) => `<div class="row"><div class="row-main"><p class="help">${esc(n.date || n.week || '')}</p><p class="row-title" style="white-space:pre-wrap;font-weight:400">${esc(n.text || n.content || n.note || '')}</p></div>${button('删除','delete-note',{index:S.weeklyNotes.length-1-i})}</div>`).join('') : empty('还没有复盘笔记')); }
function renderKeywords() { html('sw-box',S.searchWords.length ? S.searchWords.slice().reverse().map((s,i) => `<div class="row"><div class="row-main"><div class="row-title">${esc(s.word)}</div><div class="row-sub">${esc(s.date)} · ${fmt(s.count)}</div></div>${button('删除','delete-keyword',{index:S.searchWords.length-1-i})}</div>`).join('') : empty('还没有搜索词观察')); }
function renderAssets() {
  const query = val('project-search').trim().toLowerCase(); let errorBox = $('asset-errors'); if (!errorBox) { errorBox = document.createElement('div'); errorBox.id = 'asset-errors'; $('asset-grid').before(errorBox); } errorBox.innerHTML = S.projects.filter(p => p.status === 'error').map(p => `<div class="notice error"><strong>${esc(p.title || p.name)}</strong><p>${esc(p.statusLabel || '项目读取失败')}</p>${button('打开目录检查','open-folder',{slug:p.path || p.name})}</div>`).join('');
  for (const [status,col] of [['in_progress','ip'],['video_ready','vr'],['completed','co']]) { const list = S.projects.filter(p => (p.status || 'in_progress') === status && `${p.title || ''} ${p.name}`.toLowerCase().includes(query)); text(`ac-${col}-count`,list.length); html(`ac-col-${col}`,list.length ? list.map(p => { const slug = p.path || p.name; return `<article class="asset-card"><div class="asset-thumb">${p.hasCover ? `<img src="${fileUrl(slug,'cover')}?v=${encodeURIComponent(p.updatedAt || '')}" alt="${esc(p.title || p.name)} 的封面" loading="lazy">` : '<span class="material-symbols-outlined" aria-hidden="true">movie</span>'}</div><h3>${esc(p.title || p.name)}</h3><p class="help">${esc(p.statusLabel || statuses[status])}${p.staleVideo ? ' · 分镜已更新，需重新渲染' : ''}${p.archivedAt ? ' · 已归档' : ''}</p><div class="actions"><span class="pill">${p.hasStoryboard ? '分镜 ✓' : '待写分镜'}</span><span class="pill">视频 ${num(p.videoCount)}</span><span class="pill">${p.hasCopy ? '文案 ✓' : '待写文案'}</span></div><div class="actions">${button('打开工作室','studio',{slug},'btn btn-p')}${p.videoCount > 0 ? button('下载 MP4','download',{slug,kind:'video'}) : ''}</div></article>`; }).join('') : empty(query ? '没有匹配项目' : '暂无项目')); }
}
function activeJob(job) { return ['queued','running','rendering','cancelling'].includes(job?.status); }
function jobLabel(job) { return ({queued:'排队中',running:'渲染中',rendering:'渲染中',completed:'已完成',failed:'失败',cancelled:'已取消',canceled:'已取消',cancelling:'正在取消',idle:'未开始'})[job?.status] || job?.status || '未开始'; }
function jobMarkup(job, compact = false) { if (!job) return '<p class="help">暂无渲染任务。保存分镜后即可开始。</p>'; const slug = job.slug || studio?.slug; const progress = Math.max(0,Math.min(100,num(job.progress))); return `<div class="job-row">${!compact ? `<div class="row-title">${esc(job.title || slug)}</div>` : ''}<div class="section-head"><span>${esc(jobLabel(job))}</span><span class="pill">${progress.toFixed(0)}%</span></div><progress class="job-progress" max="100" value="${progress}" aria-label="渲染进度"></progress><p class="help">${esc(job.message || job.stage || '')}</p>${job.error ? `<pre>${esc(job.error)}</pre>` : ''}<div class="actions">${activeJob(job) ? button('取消渲染','cancel-render',{slug}) : ['failed','cancelled','canceled'].includes(job.status) ? button('重试渲染','retry-render',{slug},'btn btn-p btn-sm') : ''}${!compact ? button('打开项目','studio',{slug}) : ''}</div></div>`; }
function renderJobLists() { const markup = jobs.length ? jobs.slice().reverse().map(j => jobMarkup(j)).join('') : empty('还没有渲染任务','打开项目工作室开始制作。'); html('overview-jobs',markup); html('settings-jobs',markup); if (studio) { const job = jobs.find(j => j.slug === studio.slug) || studio.detail.job; html('studio-job',jobMarkup(job,true)); const render = $('studio-render'); if (render) render.disabled = activeJob(job) || !studio.detail.content?.storyboard || health?.capabilities?.available === false; } }
async function loadJobs() {
  const target = studio;
  const data = await api('/api/jobs');
  const old = new Map(jobs.map(j => [j.slug,j.status]));
  jobs = Array.isArray(data.jobs) ? data.jobs : []; renderJobLists();
  if (jobs.some(j => old.has(j.slug) && old.get(j.slug) !== j.status && !activeJob(j))) {
    await refresh();
    if (target && studio === target) await updateStudioMedia(target);
  }
}
async function loadHealth() { health = await api('/api/health'); const c = health.capabilities || {}; html('health-box',`<div class="row"><span class="row-main">运行模式</span><span class="pill">本地工作空间</span></div><div class="row"><span class="row-main">版本</span><span>${esc(health.version || '未提供')}</span></div><div class="row"><span class="row-main">文字视频渲染</span><span class="pill">${c.available ? '可用' : '不可用'}</span></div><p class="help">${c.available ? `真实 MP4 · ${esc(c.fps || 24)} fps · 文字动效 · 无声` : esc(typeof c.setup === 'string' ? c.setup : '请检查本地 FFmpeg 和浏览器依赖。')}</p><div class="row"><span class="row-main">AI 视频 / 配音</span><span class="pill">未接入</span></div><div class="row"><span class="row-main">社交自动发布</span><span class="pill">未接入</span></div><p class="help">公开热点可按需获取。能力可用不代表已完成渲染，请以任务结果和下载文件为准。</p>`); renderJobLists(); }

function resetIdea() { editVersions.idea = null; $('idea-form').reset(); setVal('idea-id',''); document.querySelectorAll('.score-select').forEach(s => s.value = '3'); text('idea-form-title','新建选题'); text('idea-submit','保存并创建项目'); }
function editIdea(id) { const i = S.ideas.find(i => sameId(i.id,id)); if (!i) throw new Error('选题已不存在，请刷新列表。'); editVersions.idea = S.versions.ideas; goPage('matrix'); [['idea-id',i.id],['it',i.title],['id2',i.desc],['ih',i.hot],['iw',i.wall],['idu2',i.duration],['im',i.money],['ifmt',i.format],['iplat',i.platform],['idea-status',i.status]].forEach(([key,value]) => setVal(key,value)); text('idea-form-title','编辑选题'); text('idea-submit','保存选题'); $('it').focus(); }
function prefillIdea(topic) { resetIdea(); goPage('matrix'); setVal('it',topic.title); setVal('id2',topic.trend || topic.reason || ''); setVal('ih',Math.max(1,Math.min(5,Math.round(num(topic.hotScore || topic.score) || 3)))); setVal('iw',topic.wallScore || 3); setVal('idu2',topic.durScore || 3); setVal('im',topic.moneyScore || 3); if (topic.format) setVal('ifmt',topic.format); if (topic.platform) setVal('iplat',topic.platform); $('it').focus(); }
async function saveIdea() { const id = val('idea-id'); const prior = S.ideas.find(i => sameId(i.id,id)); if (id && !prior) throw new Error('这条选题已被删除，请清空编辑后新建。'); const item = {...prior,id:prior?.id || nextId(),title:val('it').trim(),desc:val('id2').trim(),hot:Number(val('ih')),wall:Number(val('iw')),duration:Number(val('idu2')),money:Number(val('im')),format:val('ifmt'),platform:val('iplat'),createdAt:prior?.createdAt || today(),status:val('idea-status')}; if (!item.title) throw new Error('请填写选题标题。'); item.score = score(item); item.pri = priority(item.score); const list = prior ? S.ideas.map(i => sameId(i.id,item.id) ? item : i) : [item,...S.ideas]; await saveCollections({ideas:list}, {ideas:editVersions.idea}); resetIdea(); toast(prior ? '选题已更新。' : '选题已保存，可以打开工作室继续制作。'); }
async function quickIdea(inputId) { const title = val(inputId).trim(); if (!title) throw new Error('请先填写灵感。'); const item = {id:nextId(),title,desc:'',hot:3,wall:3,duration:3,money:3,score:3,pri:'P2',format:'hyperframes-text',platform:'both',createdAt:today(),status:'pending'}; await saveCollections({ideas:[item,...S.ideas]}); setVal(inputId,''); toast('灵感已保存到选题矩阵。'); }
async function buildIdea(id) { const idea = S.ideas.find(i => sameId(i.id,id)); if (!idea) throw new Error('选题不存在。'); if (!idea.projectPath) { await saveCollections({ideas:S.ideas.map(i => sameId(i.id,id) ? {...i,synced:false} : i)}); } const saved = S.ideas.find(i => sameId(i.id,id)); if (!saved?.projectPath) throw new Error('项目尚未创建成功，请检查服务日志后重试。'); await openStudio(saved.projectPath); }
async function saveHot() { const item = {id:nextId(),title:val('hi').trim(),source:val('hs'),score:Number(val('hsc')),trend:val('ht').trim(),date:today(),time:new Date().toLocaleTimeString('zh-CN')}; if (!item.title) throw new Error('请填写热点标题。'); await saveCollections({hotTopics:[item,...S.hotTopics]}); $('hot-form').reset(); toast('热点已保存。'); }
async function fetchHot() { const data = await post('/api/trigger-fetch'); await refresh(); await loadRecommendations(); toast(data.fetched ? `已获取 ${data.fetched} 条热点。` : '此次没有获取到新热点，请查看来源状态或稍后重试。'); }
async function loadRecommendations() { const data = await post('/api/today/recommend'); recommendations = data.recommendations || []; renderRecommendations(); }
async function generateBrief() { const data = await post('/api/brief/generate'); $('brief-box').hidden = false; const b = data.brief; html('brief-body',b ? `<p class="help">${esc(b.date)} · ${num(b.hotCount)} 条今日热点 · 规则整理</p>${(b.topHot || []).map(t => `<div class="row"><div class="row-main"><strong>${esc(t.title)}</strong><p class="help">${esc(platforms[t.source] || t.source)}</p></div></div>`).join('')}<p class="help">选题与表述需人工审核；这里不调用 AI 模型。</p>` : empty('今天没有热点，暂时无法整理简报。')); }
function resetCalendar() { editVersions.calendar = null; $('calendar-form').reset(); setVal('calendar-id',''); setVal('calendar-date',today()); text('calendar-form-title','发布记录 / 计划'); }
function editCalendar(id) { const c = S.calendar.find(c => sameId(c.id,id)); if (!c) throw new Error('发布记录已不存在。'); editVersions.calendar = S.versions.calendar; goPage('calendar'); [['calendar-id',c.id],['pt2',c.title],['calendar-date',c.date],['calendar-project',c.projectPath],['pf',c.format],['pp',c.platform === 'multiple' ? 'both' : c.platform],['ps',c.status],['calendar-url',c.url]].forEach(([k,v]) => setVal(k,v)); text('calendar-form-title','编辑发布记录 / 计划'); $('calendar-form').scrollIntoView({behavior:'smooth',block:'start'}); }
function validDate(value, label) { if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(value+'T12:00:00Z').toISOString().slice(0,10) !== value) throw new Error(`${label}无效。`); return value; }
async function saveCalendar() { const id = val('calendar-id'), prior = S.calendar.find(c => sameId(c.id,id)); if (id && !prior) throw new Error('这条发布记录已被删除，请清空编辑后新建。'); const date = validDate(val('calendar-date'),'发布日期'); const status = val('ps'); if (status === 'published' && date > today()) throw new Error('已发布记录不能使用未来日期。请选择计划发布。'); const url = val('calendar-url').trim(); if (url && !safeUrl(url)) throw new Error('发布链接必须为 http 或 https 地址。'); const title = val('pt2').trim(); if (!title) throw new Error('请填写内容标题。'); if (prior && status !== 'published' && S.reviews.some(r => sameId(r.calId,prior.id))) throw new Error('该记录已有复盘数据，请先删除关联复盘后再改回未发布状态。'); const item = {...prior,id:prior?.id || nextId(),title,date,format:val('pf'),platform:val('pp'),status,projectPath:val('calendar-project'),url,publishedAt:status === 'published' ? (prior?.publishedAt || date) : undefined,views:prior?.views ?? null,pri:prior?.pri || 'P2',score:prior?.score || 3}; if (!val('calendar-project')) delete item.projectPath; if (status !== 'published') delete item.publishedAt; await saveCollections({calendar:prior ? S.calendar.map(c => sameId(c.id,item.id) ? item : c) : [...S.calendar,item]}, {calendar:editVersions.calendar}); resetCalendar(); weekOffset = Math.round((new Date(weekStart(date)+'T12:00:00Z')-new Date(weekStart(today())+'T12:00:00Z'))/(7*86400000)); renderCalendar(); toast('发布记录已保存。'); }
async function deleteCalendar(id) { const c = S.calendar.find(c => sameId(c.id,id)); if (!c) return; const related = S.reviews.filter(r => sameId(r.calId,id)); if (!confirm(`删除「${c.title}」的日历记录？${related.length ? `同时删除 ${related.length} 条关联复盘数据。` : ''}项目文件会保留。`)) return; const patch = {calendar:S.calendar.filter(c => !sameId(c.id,id))}; if (related.length) patch.reviews = S.reviews.filter(r => !sameId(r.calId,id)); await saveCollections(patch); if (sameId(val('calendar-id'),id)) resetCalendar(); toast('记录已删除。'); }
function resetReview() { editVersions.review = null; $('review-form').reset(); setVal('review-id',''); setVal('review-date',today()); text('review-form-title','录入数据'); }
function numericInput(id, label, {optional = false,min = 0,max = Number.MAX_SAFE_INTEGER,integer = false} = {}) { const raw = val(id).trim(); if (raw === '' && optional) return null; const value = Number(raw); if (raw === '' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw new Error(`${label}请填写${integer ? '整数' : '数值'}${max === 100 ? '（0–100）' : min === 0 ? '（不能为负数）' : ''}。`); return value; }
function validateReviewContext(calId, platform, date) { const cal = S.calendar.find(c => sameId(c.id,calId)); if (!cal || cal.status !== 'published') throw new Error('请选择已人工发布的内容。'); validDate(date,'采集日期'); if (date > today() || date < cal.date) throw new Error('采集日期应介于发布日期与今天之间。'); if (cal.platform !== 'multiple' && cal.platform !== 'both' && cal.platform !== platform) throw new Error(`该发布记录的平台是${platforms[cal.platform]}，请使用匹配的平台。`); return cal; }
function mergeReview(records, item, editingId = null) { const found = records.find(r => sameId(r.calId,item.calId) && r.platform === item.platform && r.date === item.date && !sameId(r.id,editingId)); if (editingId && found) throw new Error('目标日期已有这条内容的平台数据，请编辑该条记录，避免重复。'); const id = editingId || found?.id || nextId(); return [...records.filter(r => !sameId(r.id,id)),{...found,...item,id}]; }
async function saveReview() { const platform = val('rv-platform'), date = val('review-date'), cal = validateReviewContext(val('rv-pick'),platform,date); const item = {calId:cal.id,title:cal.title,platform,date,views:numericInput('rv-v','播放量',{integer:true}),completion:numericInput('rv-c','完播率',{optional:true,max:100}),interact:numericInput('rv-i','互动率',{optional:true,max:100}),followers:numericInput('rv-f','净增关注',{optional:true,min:-Number.MAX_SAFE_INTEGER,integer:true}),search:numericInput('rv-s','搜索流量比例',{optional:true,max:100})}; const edit = S.reviews.find(r => sameId(r.id,val('review-id'))); if (val('review-id') && !edit) throw new Error('这条复盘已被删除，请清空编辑后新建。'); await saveCollections({reviews:mergeReview(S.reviews,item,edit?.id)}, {reviews:editVersions.review}); resetReview(); toast('复盘数据已保存。'); }
async function quickReview() { const date = val('qe-date'); let list = S.reviews.slice(), count = 0; for (const [platform,prefix] of [['douyin','dy'],['xiaohongshu','xhs']]) { if (val(`qe-${prefix}-v`) === '' && val(`qe-${prefix}-c`) === '') continue; const cal = validateReviewContext(val('qe-pick'),platform,date); const prior = list.find(r => sameId(r.calId,cal.id) && r.platform === platform && r.date === date); const views = numericInput(`qe-${prefix}-v`,`${platforms[platform]}播放量`,{integer:true}); const completion = numericInput(`qe-${prefix}-c`,`${platforms[platform]}完播率`,{optional:true,max:100}); list = mergeReview(list,{...prior,calId:cal.id,title:cal.title,platform,date,views,completion,interact:prior?.interact ?? null,followers:prior?.followers ?? null,search:prior?.search ?? null}); count++; } if (!count) throw new Error('请至少填写一个平台的播放量；完播率可选填。'); await saveCollections({reviews:list}); ['qe-dy-v','qe-dy-c','qe-xhs-v','qe-xhs-c'].forEach(id => setVal(id,'')); toast(`已保存 ${count} 条平台记录。`); }
function editReview(id) { const r = S.reviews.find(r => sameId(r.id,id)); if (!r) throw new Error('复盘记录已不存在。'); editVersions.review = S.versions.reviews; goPage('review'); [['review-id',r.id],['rv-pick',r.calId],['rv-platform',r.platform],['review-date',r.date],['rv-v',r.views],['rv-c',r.completion],['rv-i',r.interact],['rv-f',r.followers],['rv-s',r.search]].forEach(([k,v]) => setVal(k,v)); text('review-form-title','编辑复盘数据'); $('review-form').scrollIntoView({behavior:'smooth',block:'start'}); }
function reviewCalendar(id) { const c = S.calendar.find(c => sameId(c.id,id)); if (!c) throw new Error('发布记录不存在。'); resetReview(); goPage('review'); setVal('rv-pick',c.id); if (['douyin','xiaohongshu'].includes(c.platform)) setVal('rv-platform',c.platform); $('review-form').scrollIntoView({behavior:'smooth',block:'start'}); }
async function saveNote() { const note = val('wn').trim(); if (!note) throw new Error('请填写复盘笔记。'); await saveCollections({weeklyNotes:[...S.weeklyNotes,{id:nextId(),date:today(),note}]}); setVal('wn',''); toast('笔记已保存。'); }
async function saveKeyword() { const word = val('sw').trim(); if (!word) throw new Error('请填写搜索词。'); const count = numericInput('swc','搜索量',{integer:true}); await saveCollections({searchWords:[...S.searchWords,{id:nextId(),word,count,date:today()}]}); $('keyword-form').reset(); toast('搜索词观察已保存。'); }

const templates = [
  {format:'hyperframes-text',name:'观点解读',icon:'article',label:'一个问题，一个清晰答案',body:'用问题引出观点，通过三条证据展开，以结论与行动收束。',steps:['提出问题','核心观点','证据与例子','总结行动']},
  {format:'remotion-demo',name:'步骤教程',icon:'school',label:'让观众带走可执行的方法',body:'明确学习目标，按顺序展示操作，最后给出结果与下一步。',steps:['目标与成果','第一步','第二步','总结检查']},
  {format:'remotion-compare',name:'对比评测',icon:'compare_arrows',label:'帮观众做出有依据的选择',body:'先确定比较标准，分别陈述差异，再给出适用场景。',steps:['比较的问题','方案 A','方案 B','如何选择']},
  {format:'hyperframes-narrate',name:'清单盘点',icon:'format_list_numbered',label:'用有顺序的要点建立节奏',body:'先交代筛选标准，再逐项说明价值，最后标出优先尝试项。',steps:['盘点范围','要点一','要点二','优先尝试']}
];
function renderTemplates() { html('template-grid',templates.map(t => `<article class="glass-card topic-card"><span class="material-symbols-outlined">${t.icon}</span><h3>${t.name}</h3><strong class="row-title">${t.label}</strong><p class="help">${t.body}</p><p class="help">${t.steps.join(' → ')}</p>${button('用此模板创建选题','template',{format:t.format},'btn btn-p')}</article>`).join('')); }
function studioDirty() { return studio && (studio.dirty || studio.coverDirty); }
async function openStudio(slug) {
  if (studioDirty() && !confirm('当前项目有未保存修改。放弃这些修改并打开项目？')) return;
  const request = ++studioOpenRequest;
  let detail;
  try { detail = await api(`/api/projects/${encodeURIComponent(slug)}`); }
  catch (error) { if (request !== studioOpenRequest) return false; throw error; }
  if (request !== studioOpenRequest) return false;
  studio = {slug,detail,dirty:false,coverDirty:false,tab:'content'};
  renderStudio(); goPage('studio');
  return true;
}
function sceneMarkup(scene,index) { return `<div class="scene-card" data-scene-index="${index}"><div class="section-head"><strong>镜头 ${index+1}</strong><div class="actions">${button('↑','scene-up',{index},'btn btn-g btn-sm')}${button('↓','scene-down',{index},'btn btn-g btn-sm')}${button('删除','scene-remove',{index},'btn btn-g btn-sm')}</div></div><div class="form-grid"><label>镜头标题<input class="fi scene-title" value="${esc(scene.title)}" maxlength="80" required></label><label>时长（秒）<input class="fi scene-duration" type="number" min="2" max="15" step="0.1" value="${num(scene.duration) || 5}" required></label></div><label>屏幕文字<textarea class="ft scene-body" maxlength="260" rows="3">${esc(scene.body)}</textarea></label></div>`; }
function renderScenes(scenes) { html('scene-list',scenes.length ? scenes.map(sceneMarkup).join('') : empty('还没有分镜','添加镜头，或使用模板草稿开始。')); updateDuration(); }
function readScenes() { return [...document.querySelectorAll('#scene-list [data-scene-index]')].map(el => ({title:el.querySelector('.scene-title').value,body:el.querySelector('.scene-body').value,duration:Number(el.querySelector('.scene-duration').value)})); }
function updateDuration() { const scenes = readScenes(), duration = scenes.reduce((s,x) => s+num(x.duration),0); text('scene-total',`${scenes.length} / 12 镜头 · ${Number(duration.toFixed(1))} / 120 秒`); const el = $('scene-total'); if (el) el.style.color = duration > 120 ? 'var(--error)' : ''; }
function renderStudio() {
  const d = studio.detail, c = d.content || {}, board = c.storyboard || {theme:'midnight',aspect:'9:16',scenes:[]};
  $('studio-loading').hidden = true; $('studio-content').hidden = false;
  html('studio-content',`<div class="studio-toolbar"><div><span class="eyebrow">PROJECT STUDIO</span><h2 id="studio-heading">${esc(c.title || d.project?.title || studio.slug)}</h2><p class="help">文字动效 · 无声 · ${esc(studio.slug)}</p></div><div class="actions">${button('返回作品','page',{page:'assets'})}${button('重新读取','reload-studio')}${button('安排发布','schedule-studio',{},'btn btn-p')}</div></div><div class="studio-layout"><div class="stack"><div class="capsule-container studio-tabs"><button class="capsule-btn active" data-action="studio-tab" data-tab="content">方案与文案</button><button class="capsule-btn" data-action="studio-tab" data-tab="scenes">视频分镜</button><button class="capsule-btn" data-action="studio-tab" data-tab="cover">封面</button></div><div id="studio-tab-content" class="studio-tab-panel panel glass-card stack"><label>项目标题<input id="studio-title" class="fi" maxlength="120" required value="${esc(c.title || d.project?.title || '')}"></label><label>内容方案<textarea id="studio-plan" class="ft" rows="9" maxlength="50000" placeholder="目标受众、核心问题、信息来源、内容大纲…">${esc(c.plan || '')}</textarea></label><label>发布文案<textarea id="studio-copy" class="ft" rows="9" maxlength="50000" placeholder="标题、正文、标签…">${esc(c.copy || '')}</textarea></label>${button('复制发布文案','copy-studio')}</div><div id="studio-tab-scenes" class="studio-tab-panel panel glass-card stack" hidden><div class="notice">模板草稿不会调用 AI。请补充准确内容，再保存与预览。当前渲染输出为无声文字动效视频。</div><div class="form-grid"><label>视觉主题<select id="studio-theme" class="fs"><option value="midnight">Midnight · 深夜蓝</option><option value="paper">Paper · 纸白</option><option value="lime">Lime · 青柠</option></select></label><label>视频比例<select id="studio-aspect" class="fs"><option value="9:16">9:16 · 竖版</option><option value="16:9">16:9 · 横版</option><option value="1:1">1:1 · 方形</option></select></label></div><div class="actions">${button('填入模板草稿','generate-draft',{},'btn btn-p')}${button('+ 添加镜头','scene-add')}<span id="scene-total" class="help"></span></div><div id="scene-list" class="stack"></div></div><form id="studio-cover-form" class="studio-tab-panel panel glass-card stack" hidden><h2>封面文字</h2><p class="help">保存后更新项目 SVG 封面，支持反复编辑。</p>${[['TITLE_LINE_1','标题第一行'],['TITLE_LINE_2','标题第二行'],['SUBTITLE','副标题'],['FEATURE_1','要点一'],['FEATURE_2','要点二'],['FEATURE_3','要点三']].map(([key,label]) => `<label>${label}<input class="fi cover-field" data-field="${key}" maxlength="80" value="${esc(d.coverFields?.[key] || '')}"></label>`).join('')}<button class="btn btn-p">保存封面</button><p id="cover-save-state" class="saved-text"></p></form><div class="panel glass-card"><div class="actions">${button('保存方案、文案与分镜','save-studio',{},'btn btn-p')}${button('保存并预览','preview-studio')}</div><p id="studio-save-state" class="saved-text">已读取服务器保存的内容。</p><p id="studio-validation" class="validation-error" role="alert"></p></div></div><aside class="stack studio-media"><div class="panel glass-card"><div class="section-head"><h2>Preview & Export</h2><span class="pill">无声 MP4</span></div><div id="studio-media"></div><div class="actions" style="margin-top:16px"><button class="btn btn-p" id="studio-render" data-action="render-studio">保存并渲染 MP4</button>${button('刷新状态','refresh-studio-media')}</div><p id="render-capability" class="help"></p><div id="studio-job"></div></div><div class="panel glass-card"><h2>交付文件</h2><div id="studio-downloads"></div><div class="actions" style="margin-top:16px">${button('打开本地目录','open-folder',{slug:studio.slug})}${button(d.project?.archivedAt ? '已归档' : '归档交付','archive-studio')}</div><p class="help">归档只记录本地交付完成，不会向社交平台发布。</p></div></aside></div>`);
  setVal('studio-theme',board.theme); setVal('studio-aspect',board.aspect); renderScenes(board.scenes || []); renderStudioMedia(); renderJobLists();
}
function renderStudioMedia() {
  if (!studio) return;
  const d = studio.detail, files = d.files || {}, stamp = encodeURIComponent(d.version || Date.now());
  let markup = d.project?.staleVideo ? '<div class="notice">分镜已更新。下方 MP4 是上次渲染的旧版本，请重新渲染后再交付。</div>' : '';
  if (files.video) markup += `<video id="studio-video" class="studio-video" controls preload="metadata" aria-label="项目 MP4 视频"><source src="${fileUrl(studio.slug,'video')}?v=${stamp}" type="video/mp4">当前浏览器不支持视频播放，请下载 MP4。</video><p class="help">上一次成功生成的 MP4。修改分镜后需重新渲染。</p>`;
  if (files.preview) markup += `<details ${!files.video ? 'open' : ''}><summary class="help">已保存分镜的动态预览</summary><iframe id="studio-preview" title="已保存分镜预览" class="preview-frame" sandbox="allow-scripts" referrerpolicy="no-referrer" src="${fileUrl(studio.slug,'preview')}?v=${stamp}"></iframe></details>`;
  if (!markup) markup = empty('先保存分镜，再查看预览','可在「视频分镜」中添加镜头或填入模板草稿。');
  if (files.cover) markup += `<details><summary class="help">封面预览</summary><img class="studio-cover" alt="项目封面" src="${fileUrl(studio.slug,'cover')}?v=${stamp}"></details>`;
  html('studio-media',markup);
  html('studio-downloads',`<div class="download-grid">${[['video','MP4 视频'],['cover','SVG 封面'],['copy','发布文案'],['plan','内容方案'],['subtitles','SRT 字幕']].map(([kind,label]) => files[kind] ? button(`↓ ${label}`,'download',{slug:studio.slug,kind}) : `<span class="help">${label}：尚未生成</span>`).join('')}</div>`);
  text('render-capability',health?.capabilities?.available === false ? '渲染暂不可用，请到设置查看本地依赖状态。' : '保存当前编辑后开始渲染。视频为文字动效，无音轨。渲染期间可继续查看其他页面。');
}
async function updateStudioMedia(target = studio) {
  if (!target || studio !== target) return false;
  let detail;
  try { detail = await api(`/api/projects/${encodeURIComponent(target.slug)}`); }
  catch (error) { if (studio !== target) return false; throw error; }
  if (studio !== target) return false;
  // Media refreshes never replace editor fields or silently rebase their version.
  target.detail.files = detail.files; target.detail.job = detail.job; target.detail.project = detail.project;
  if (detail.version !== target.detail.version) text('studio-save-state','服务端内容版本已变化。当前表单已保留，请重新读取项目并合并修改后保存。');
  renderStudioMedia(); renderJobLists();
  return true;
}
function collectStudioContent() { if (!studio) throw new Error('请先打开项目。'); const title = val('studio-title').trim(); if (!title) throw new Error('项目标题不能为空。'); const scenes = readScenes().map(s => ({...s,title:s.title.trim(),body:s.body.trim()})); const payload = {title,plan:val('studio-plan'),copy:val('studio-copy'),version:studio.detail.version}; if (scenes.length || studio.detail.content?.storyboard) { if (scenes.length < 1 || scenes.length > 12) throw new Error('分镜数量需要在 1–12 个之间。'); if (scenes.some(s => !s.title || !Number.isFinite(s.duration) || s.duration < 2 || s.duration > 15)) throw new Error('每个镜头都需要标题和 2–15 秒的时长。'); if (scenes.some(s => s.title.length > 80 || s.body.length > 260 || s.body.split('\n').length > 6)) throw new Error('每个镜头标题最多 80 字，正文最多 260 字和 6 行，请拆分过长内容。'); if (scenes.reduce((sum,s) => sum+s.duration,0) > 120) throw new Error('视频总时长不能超过 120 秒。'); payload.storyboard = {title,theme:val('studio-theme'),aspect:val('studio-aspect'),scenes}; } return payload; }
async function saveStudio(target = studio) {
  if (!target || studio !== target) return false;
  const slug = target.slug, payload = collectStudioContent();
  text('studio-validation','');
  try {
    const data = await api('/api/projects/' + encodeURIComponent(slug) + '/content', {method:'PUT',body:JSON.stringify(payload)});
    if (studio !== target) return false;
    let changedWhileSaving = true;
    try { changedWhileSaving = JSON.stringify(collectStudioContent()) !== JSON.stringify(payload); } catch {}
    target.detail = data; target.dirty = changedWhileSaving;
    text('studio-save-state',changedWhileSaving ? '提交的内容已保存；保存期间的新修改仍需再次保存。' : '已保存 · ' + new Date().toLocaleTimeString('zh-CN'));
    text('studio-heading',payload.title); renderStudioMedia(); renderJobLists();
    await refresh();
    return studio === target;
  } catch (error) { if (studio !== target) return false; throw error; }
}
async function generateDraft() {
  const target = studio;
  if (!target) return false;
  if (readScenes().length && !confirm('先保存当前编辑，再用模板草稿替换分镜？新的草稿需要再次保存才会生效。')) return false;
  if (!val('studio-title').trim()) throw new Error('请先填写项目标题。');
  try {
    if (!(await saveStudio(target)) || studio !== target) return false;
    const data = await post('/api/projects/generate-blueprint',{slug:target.slug});
    if (studio !== target) return false;
    if (!data.storyboard) throw new Error('服务没有返回结构化分镜，请检查版本。');
    const board = data.storyboard;
    renderScenes(board.scenes || []); setVal('studio-theme',board.theme || 'midnight'); setVal('studio-aspect',board.aspect || '9:16');
    if (!val('studio-copy').trim() && data.copy_content) setVal('studio-copy',data.copy_content);
    target.dirty = true;
    text('studio-save-state','模板草稿已填入，尚未保存。请审核并补充内容。'); toast('已填入模板草稿（非 AI 生成），请编辑后保存。');
    return true;
  } catch (error) { if (studio !== target) return false; throw error; }
}
async function saveCover() {
  const target = studio;
  if (!target) return false;
  const slug = target.slug, version = target.detail.version;
  const fields = Object.fromEntries([...document.querySelectorAll('.cover-field')].map(el => [el.dataset.field,el.value.trim()]));
  try {
    const result = await post('/api/projects/update-cover',{slug,fields,version});
    if (studio !== target) return false;
    const detail = await api('/api/projects/' + encodeURIComponent(slug));
    if (studio !== target) return false;
    target.detail.version = result.version; target.detail.files = detail.files; target.detail.coverFields = result.fields; target.detail.project = detail.project;
    target.coverDirty = [...document.querySelectorAll('.cover-field')].some(el => el.value.trim() !== fields[el.dataset.field]);
    text('cover-save-state',target.coverDirty ? '已提交的封面已保存，新修改尚未保存。' : '封面已保存。');
    renderStudioMedia();
    await refresh();
    if (studio !== target) return false;
    toast('封面已更新。');
    return true;
  } catch (error) { if (studio !== target) return false; throw error; }
}
async function renderStudioVideo() {
  const target = studio;
  if (!target) return false;
  try {
    if (!(await saveStudio(target)) || studio !== target) return false;
    if (!target.detail.content?.storyboard) throw new Error('请先添加至少一个镜头并保存。');
    if (!(await startRender(target.slug, target)) || studio !== target) return false;
    return true;
  } catch (error) { if (studio !== target) return false; throw error; }
}
async function startRender(slug, target = null) {
  if (target && studio !== target) return false;
  await post('/api/projects/render',{slug});
  if (target && studio !== target) return false;
  await loadJobs();
  if (target && studio !== target) return false;
  toast('渲染任务已提交，完成后会显示 MP4 播放器和下载按钮。');
  return true;
}
async function cancelRender(slug) { await post('/api/projects/render-cancel',{slug}); await loadJobs(); toast('已提交取消请求。'); }
async function downloadFile(slug,kind) { if (!['video','cover','copy','plan','subtitles'].includes(kind)) throw new Error('不支持的下载类型。'); const url = fileUrl(slug,kind,true); const head = await fetch(url,{method:'HEAD'}); if (!head.ok) throw new Error('文件不存在或暂不可下载，请刷新项目。'); const a = document.createElement('a'); a.href = url; a.download = ''; document.body.appendChild(a); a.click(); a.remove(); toast('已开始下载。'); }
async function exportData() { const response = await fetch('/api/export'); if (!response.ok) throw new Error('备份导出失败，请检查服务后重试。'); const blob = await response.blob(); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `pipeline-backup-${today()}.json`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url),60000); toast('备份已下载，视频素材请单独保存。'); }
async function copyStudio() { const content = val('studio-copy'); if (!content.trim()) throw new Error('发布文案为空。'); if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(content); } else { const el = $('studio-copy'); el.focus(); el.select(); if (!document.execCommand('copy')) throw new Error('浏览器未允许复制，请手动选择文案复制。'); } toast('发布文案已复制。'); }
function scheduleStudio() { if (!studio) return; resetCalendar(); goPage('calendar'); setVal('pt2',val('studio-title') || studio.detail.content?.title); setVal('calendar-project',studio.slug); setVal('ps','scheduled'); $('calendar-form').scrollIntoView({behavior:'smooth'}); }
async function archiveStudio() {
  const target = studio;
  if (!target) return false;
  if (!target.detail.files?.video || !target.detail.files?.cover || !target.detail.files?.copy) throw new Error('归档需要真实视频、封面和非空发布文案，请先补齐。');
  if (target.detail.project?.staleVideo) throw new Error('分镜已变更，现有视频是旧版本。请重新渲染后再归档。');
  if (target.dirty || target.coverDirty) throw new Error('请先保存未完成的编辑，再归档。');
  try {
    await post('/api/projects/archive',{slug:target.slug});
    if (studio !== target) return false;
    if (!(await updateStudioMedia(target)) || studio !== target) return false;
    await refresh();
    if (studio !== target) return false;
    toast('本地交付已归档。社交发布需由你手工完成。');
    return true;
  } catch (error) { if (studio !== target) return false; throw error; }
}

const actions = {
  page: el => goPage(el.dataset.page),
  refresh: async () => { await refresh(); await loadJobs(); toast('列表已刷新，正在编辑的表单会保留。'); },
  'overview-tab': el => { ['overview','growth','inventory','operations'].forEach(tab => { $('ov-'+tab).hidden = tab !== el.dataset.tab; }); el.closest('.capsule-container').querySelectorAll('button').forEach(b => b.classList.toggle('active',b === el)); },
  'filter-hot': el => { hotFilter = el.dataset.value; el.parentElement.querySelectorAll('button').forEach(b => b.classList.toggle('active',b === el)); renderHot(); },
  'filter-matrix': el => { matrixFilter = el.dataset.value; el.parentElement.querySelectorAll('button').forEach(b => b.classList.toggle('active',b === el)); renderIdeas(); },
  'fetch-hot': fetchHot,
  recommend: loadRecommendations,
  brief: generateBrief,
  'hide-brief': () => { $('brief-box').hidden = true; },
  'hot-to-idea': el => { const topic = hotItems().find(x => x._key === el.dataset.key); if (topic) prefillIdea(topic); },
  'top-pick': el => { const topic = hotItems().find(x => x._key === el.dataset.key); if (topic) prefillIdea(topic); },
  'recommend-idea': el => { const list = recommendations.length ? recommendations : hotItems().filter(x => x.date === today()).slice(0,4); const topic = list[Number(el.dataset.index)]; if (topic) prefillIdea(topic); },
  'delete-hot': async el => { if (!confirm('删除这条手动热点？')) return; await saveCollections({hotTopics:S.hotTopics.filter(h => !sameId(h.id,el.dataset.id))}); },
  'edit-idea': el => editIdea(el.dataset.id),
  'build-idea': el => buildIdea(el.dataset.id),
  'reset-idea': resetIdea,
  'delete-idea': async el => { if (!confirm('删除这个选题？已经建立的项目与文件会保留在 Asset Board。')) return; await saveCollections({ideas:S.ideas.filter(i => !sameId(i.id,el.dataset.id))}); if (sameId(val('idea-id'),el.dataset.id)) resetIdea(); },
  'new-calendar': () => { resetCalendar(); $('calendar-form').scrollIntoView({behavior:'smooth'}); $('pt2').focus(); },
  'edit-calendar': el => editCalendar(el.dataset.id),
  'delete-calendar': el => deleteCalendar(el.dataset.id),
  'reset-calendar': resetCalendar,
  'review-calendar': el => reviewCalendar(el.dataset.id),
  week: el => { weekOffset += Number(el.dataset.offset); renderCalendar(); },
  'week-today': () => { weekOffset = 0; renderCalendar(); },
  'edit-review': el => editReview(el.dataset.id),
  'reset-review': resetReview,
  'delete-review': async el => { if (!confirm('删除这条复盘快照？')) return; await saveCollections({reviews:S.reviews.filter(r => !sameId(r.id,el.dataset.id))}); if (sameId(val('review-id'),el.dataset.id)) resetReview(); },
  'delete-note': async el => { if (!confirm('删除这条复盘笔记？')) return; await saveCollections({weeklyNotes:S.weeklyNotes.filter((_,i) => i !== Number(el.dataset.index))}); },
  'delete-keyword': async el => { if (!confirm('删除这条搜索词记录？')) return; await saveCollections({searchWords:S.searchWords.filter((_,i) => i !== Number(el.dataset.index))}); },
  template: el => { resetIdea(); goPage('matrix'); setVal('ifmt',el.dataset.format); const template = templates.find(t => t.format === el.dataset.format); setVal('id2',template.steps.map((step,i) => `${i+1}. ${step}`).join('\n')); $('it').focus(); },
  studio: el => openStudio(el.dataset.slug),
  'reload-studio': () => openStudio(studio.slug),
  'studio-tab': el => { studio.tab = el.dataset.tab; ['content','scenes','cover'].forEach(tab => { $(tab === 'cover' ? 'studio-cover-form' : 'studio-tab-'+tab).hidden = tab !== studio.tab; }); el.parentElement.querySelectorAll('button').forEach(b => b.classList.toggle('active',b === el)); },
  'scene-add': () => { const scenes = readScenes(); if (scenes.length >= 12) throw new Error('最多 12 个镜头。'); scenes.push({title:`镜头 ${scenes.length+1}`,body:'',duration:5}); renderScenes(scenes); markStudioDirty(); },
  'scene-remove': el => { const scenes = readScenes(); const index = Number(el.dataset.index); if ((scenes[index].body || scenes[index].title) && !confirm('删除这个镜头？修改会在保存后生效。')) return; scenes.splice(index,1); renderScenes(scenes); markStudioDirty(); },
  'scene-up': el => moveScene(Number(el.dataset.index),-1),
  'scene-down': el => moveScene(Number(el.dataset.index),1),
  'generate-draft': generateDraft,
  'save-studio': async () => { const target = studio; if (await saveStudio(target) && studio === target) toast('方案、文案和分镜已保存。'); },
  'preview-studio': async () => { const target = studio; if (!(await saveStudio(target)) || studio !== target) return; if (!target.detail.files?.preview) throw new Error('请先在「视频分镜」添加镜头。'); const preview = $('studio-preview'); if (preview) { preview.closest('details').open = true; preview.scrollIntoView({behavior:'smooth',block:'center'}); } toast('预览已更新为已保存分镜。'); },
  'render-studio': renderStudioVideo,
  'cancel-render': el => cancelRender(el.dataset.slug),
  'retry-render': el => { if (studio?.slug === el.dataset.slug && studio.dirty) throw new Error('当前分镜有未保存修改，请在工作室点击「保存并渲染 MP4」。'); return startRender(el.dataset.slug); },
  'refresh-studio-media': async () => { const target = studio; await loadJobs(); if (!target || studio !== target) return; if (await updateStudioMedia(target) && studio === target) toast('任务与文件状态已刷新。'); },
  'copy-studio': copyStudio,
  'schedule-studio': scheduleStudio,
  'archive-studio': archiveStudio,
  'open-folder': async el => { await post('/api/projects/open-folder',{slug:el.dataset.slug}); toast('已请求系统打开项目目录。'); },
  download: el => downloadFile(el.dataset.slug,el.dataset.kind),
  health: loadHealth,
  'export-data': exportData
};
function markStudioDirty() { if (!studio) return; studio.dirty = true; text('studio-save-state','有未保存的修改。预览和下载仍对应上次保存 / 渲染结果。'); }
function moveScene(index,delta) { const scenes = readScenes(), target = index+delta; if (target < 0 || target >= scenes.length) return; [scenes[index],scenes[target]] = [scenes[target],scenes[index]]; renderScenes(scenes); markStudioDirty(); }
const forms = {'hot-form':saveHot,'idea-form':saveIdea,'quick-idea-form':() => quickIdea('qi'),'matrix-quick-form':() => quickIdea('qe-idea'),'calendar-form':saveCalendar,'review-form':saveReview,'quick-review-form':quickReview,'note-form':saveNote,'keyword-form':saveKeyword,'studio-cover-form':saveCover};
document.addEventListener('click',event => { const el = event.target.closest('[data-action]'); if (!el || el.disabled) return; const action = actions[el.dataset.action]; if (!action) return; const actionStudio = studio; event.preventDefault(); busy(el,() => Promise.resolve().then(() => action(el))).catch(e => { if (currentPage === 'studio' && studio === actionStudio) text('studio-validation',e.message); showError(e); }); });
document.addEventListener('submit',event => { const handler = forms[event.target.id]; if (!handler) return; event.preventDefault(); const button = event.submitter || event.target.querySelector('button[type="submit"],button:not([type])'); busy(button,handler).catch(showError); });
document.addEventListener('input',event => { const el = event.target; if (el.id === 'project-search') renderAssets(); if (el.closest('#studio-content')) { if (el.classList.contains('cover-field')) { studio.coverDirty = true; text('cover-save-state','封面文字尚未保存。'); } else { markStudioDirty(); if (el.closest('#scene-list')) updateDuration(); } } });
document.addEventListener('change',event => { const el = event.target; if (el.id === 'calendar-filter') renderCalendar(); if (['studio-theme','studio-aspect'].includes(el.id)) markStudioDirty(); if (el.id === 'rv-pick') { const c = S.calendar.find(c => sameId(c.id,el.value)); if (['douyin','xiaohongshu'].includes(c?.platform)) setVal('rv-platform',c.platform); } if (el.id === 'calendar-project' && el.value && !val('pt2').trim()) { const p = S.projects.find(p => (p.path || p.name) === el.value); setVal('pt2',p?.title || p?.name || ''); } });
window.addEventListener('beforeunload',event => { if (studioDirty()) { event.preventDefault(); event.returnValue = ''; } });
function connectEvents() {
  if (stream) stream.close();
  stream = new EventSource('/api/sse');
  stream.addEventListener('connected',() => { $('cd').className = 'cd on'; text('ctxt','已连接'); });
  const scheduleRefresh = () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => { if (mutationBusy) return; refresh().catch(showError); },350); };
  stream.addEventListener('data-update',scheduleRefresh); stream.addEventListener('auto-fetch',scheduleRefresh); stream.addEventListener('fetch-status',scheduleRefresh);
  stream.addEventListener('render-update',() => { if (!pollBusy) pollJobs(); });
  stream.addEventListener('render-progress',() => { if (!pollBusy) pollJobs(); });
  stream.addEventListener('render-complete',() => { if (!pollBusy) pollJobs(); });
  stream.addEventListener('render-error',() => { if (!pollBusy) pollJobs(); });
  stream.onerror = () => { $('cd').className = 'cd er'; text('ctxt','连接中断，重试中'); };
}
async function pollJobs() { if (pollBusy || document.hidden) return; pollBusy = true; try { await loadJobs(); } catch (e) { text('ctxt','任务状态暂不可用'); } finally { pollBusy = false; } }
async function init() {
  try { if (localStorage.getItem('pipeline-theme') === 'dark') document.documentElement.classList.add('dark'); } catch {}
  text('tt',document.documentElement.classList.contains('dark') ? 'Light' : 'Dark'); text('td',today());
  document.querySelectorAll('.score-select').forEach(select => { for (let i = 5; i >= 1; i--) select.add(new Option(String(i),String(i))); select.value = '3'; });
  document.querySelectorAll('.aura-nav-item[data-p]').forEach(el => { el.setAttribute('title',titles[el.dataset.p]); el.setAttribute('aria-label',titles[el.dataset.p]); });
  const settings = document.createElement('button'); settings.className = 'aura-nav-item'; settings.dataset.p = 'settings'; settings.dataset.action = 'page'; settings.dataset.page = 'settings'; settings.title = '平台设置'; settings.setAttribute('aria-label','平台设置'); settings.innerHTML = '<span class="nav-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"/><path d="m9 3-1 3-3 1-2 4 2 2-1 3 3 3 3-1 2 3 4-2 1-3 3-1 1-4-3-2-1-3-4-1-2 1Z"/></svg></span><span class="nav-label">Settings</span>';
  document.querySelector('.aura-nav').appendChild(settings);
  setVal('qe-date',today()); setVal('review-date',today()); setVal('calendar-date',today()); $('review-date').max = today(); $('qe-date').max = today(); renderTemplates();
  const route = location.hash.slice(1);
  try { await refresh(); } catch (e) { showError(e); }
  await Promise.allSettled([loadJobs(),loadHealth(),loadRecommendations()]).then(results => { if (results[1].status === 'rejected') html('health-box',empty(results[1].reason.message)); });
  connectEvents();
  if (route.startsWith('studio/')) { try { await openStudio(decodeURIComponent(route.slice(7))); } catch (e) { goPage('assets'); showError(e); } }
  else if (titles[route]) goPage(route);
  setInterval(pollJobs,3500);
}
init().catch(showError);
