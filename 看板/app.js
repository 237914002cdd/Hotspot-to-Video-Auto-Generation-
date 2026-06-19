
const $ = id => document.getElementById(id);
const T = () => { const d = new Date(); const b = new Date(d.getTime() + d.getTimezoneOffset() * 60000 + 480 * 60000); return b.toISOString().slice(0, 10); };
const FD = s => { const d = new Date(s + 'T00:00:00+08:00'); return `${(d.getMonth()+1).toString().padStart(2,'0')}/${d.getDate().toString().padStart(2,'0')} ${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()]}`; };
const WR = s => { const d = new Date(s + 'T00:00:00+08:00'); const x = d.getDay(); const m = new Date(d.getTime() + (x === 0 ? -6 : 1 - x) * 864e5); return { ms: m.toISOString().slice(0, 10), ss: new Date(m.getTime() + 6 * 864e5).toISOString().slice(0, 10) }; };
const CS = (h, w, d, m) => +(h * .3 + w * .25 + d * .25 + m * .2).toFixed(2);
const PL = s => s >= 4 ? 'P0' : s >= 3.5 ? 'P1' : s >= 3 ? 'P2' : 'Skip';
const SC = s => s >= 4 ? 's-g' : s >= 3.5 ? 's-o' : 's-r';
const DOTS = v => { let h = '<div class="dt">'; for (let i = 0; i < 5; i++) h += `<div class="d${i < v ? ' fl' : ''}"></div>`; return h + '</div>'; };
const PRI = s => { const p = PL(s); return `<span class="pri p-p${p === 'P0' ? '0' : p === 'P1' ? '1' : p === 'P2' ? '2' : 'k'}">${p}</span>`; };
const TAG = (t, c) => `<span class="tag t-${c}">${t}</span>`;
const EMPTY = (m, s) => `<div class="em"><p>${m}</p>${s ? `<div class="sb2">${s}</div>` : ''}</div>`;
const TOAST = m => { const c = $('toast-box'); const t = document.createElement('div'); t.className = 'toast'; t.innerHTML = m; c.appendChild(t); setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 300); }, 3000); };
const hid = id => { $(id).style.display = 'none'; };

let S = { hotTopics: [], autoTopics: [], ideas: [], calendar: [], reviews: [], searchWords: [], weeklyNotes: [] };
let wkOff = 0, cf = 'all';

async function loadAll() { const r = await fetch('/api/data'); return r.json(); }
async function saveAll(d) { return fetch('/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) }); }

// SSE
let sseT = null;
function css() {
  if (sseT) { clearTimeout(sseT); sseT = null; }
  const dot = $('cd'), txt = $('ctxt');
  dot.className = 'cd cn'; txt.textContent = 'Connecting...';
  const es = new EventSource('/api/sse');
  let ok = false;
  es.addEventListener('connected', () => { ok = true; dot.className = 'cd on'; txt.textContent = 'Connected'; });
  es.addEventListener('data-update', () => refresh());
  es.addEventListener('auto-fetch', e => { try { const d = JSON.parse(e.data); refresh(); TOAST(`📡抓取<span class="hl">${d.count}</span>条`); } catch(_) {} });
  es.onerror = () => { es.close(); dot.className = 'cd er'; txt.textContent = ok ? 'Disconnected' : 'Failed'; sseT = setTimeout(css, 3000); };
}

// Routing
const TT = { overview: 'Pipeline Studio', hot: '热点简报', matrix: '选题矩阵', calendar: '内容日历', review: '数据复盘', playbook: '模板匹配', assets: 'Asset Board' };
function goPage(n) {
  document.querySelectorAll('.aura-nav-item[data-p]').forEach(x => x.classList.remove('on'));
  const target = document.querySelector(`.aura-nav-item[data-p="${n}"]`);
  if (target) target.classList.add('on');
  document.querySelectorAll('.pg.on').forEach(x => x.classList.remove('on'));
  const page = $('p-' + n);
  if (page) page.classList.add('on');
  $('pt').textContent = TT[n] || n;
  // Update playbook date when navigated to
  if (n === 'playbook') { var d = $('pb-date'); if (d) d.textContent = T(); }
}

async function refresh() { try { S = await loadAll(); } catch(e) {} ro(); rh(); ri(); rc2(); rr(); rsr(); rnotes(); popRV(); popQE(); ra(); loadProjectsMini(); }

// === Overview ===
function ro() {
  const t = T(), w = WR(t);
  // Safe setters — prevent TypeError if target element doesn't exist
  const st = (id, v) => { const e = $(id); if (e) e.textContent = v; };
  const sh = (id, v) => { const e = $(id); if (e) e.innerHTML = v; };

  st('s-pub', S.calendar.filter(c => c.date >= w.ms && c.date <= w.ss && c.status === 'published').length);
  const rvs = S.reviews;
  sh('s-cpl', rvs.length ? (rvs.reduce((s, r) => s + r.completion, 0) / rvs.length).toFixed(1) + '<span class="u">%</span>' : '—<span class="u">%</span>');
  st('s-flw', rvs.filter(r => r.date >= w.ms && r.date <= w.ss).reduce((s, r) => s + r.followers, 0));
  st('s-idea', S.ideas.filter(i => i.status === 'pending').length);
  const td = T();
  st('s-hot', (S.autoTopics || []).filter(x => x.date === td).length + (S.hotTopics || []).filter(x => x.date === td).length);
  const p0c = S.ideas.filter(i => i.pri === 'P0' && i.status === 'pending').length;
  st('s-p0', p0c); st('p0-badge', p0c);
  const dy = rvs.filter(r => r.date >= w.ms && r.date <= w.ss && r.platform === 'douyin');
  const xh = rvs.filter(r => r.date >= w.ms && r.date <= w.ss && r.platform === 'xiaohongshu');
  st('s-dy-pub', S.calendar.filter(c => c.date >= w.ms && c.date <= w.ss && c.status === 'published').length);
  sh('s-dy-cpl', dy.length ? (dy.reduce((s, r) => s + r.completion, 0) / dy.length).toFixed(1) + '%' : '—');
  st('s-dy-flw', dy.reduce((s, r) => s + r.followers, 0));
  st('s-dy-v', dy.reduce((s, r) => s + r.views, 0));
  st('s-xhs-pub', S.calendar.filter(c => c.date >= w.ms && c.date <= w.ss && c.status === 'published').length);
  sh('s-xhs-cpl', xh.length ? (xh.reduce((s, r) => s + r.completion, 0) / xh.length).toFixed(1) + '%' : '—');
  st('s-xhs-flw', xh.reduce((s, r) => s + r.followers, 0));
  st('s-xhs-v', xh.reduce((s, r) => s + r.views, 0));
  popQE(); if (!window._rl) loadRecs();
}

// === Hot Topics ===
async function ah() {
  const t = $('hi').value.trim(), s = $('hs').value, tr = $('ht').value.trim(), sc = parseInt($('hsc').value);
  if (!t) { alert('Enter topic name'); return; }
  S.hotTopics.unshift({ id: Date.now(), title: t, source: s, trend: tr, score: sc, date: T(), time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) });
  await saveAll({ hotTopics: S.hotTopics }); rh(); $('hi').value = ''; $('ht').value = '';
}
function rh() {
  const td = T();
  const m = S.hotTopics.filter(x => x.date === td);
  const a = S.autoTopics.filter(x => x.date === td);
  const all = [...a.map(x=>({...x, isAuto:true})), ...m.map(x=>({...x, isAuto:false}))];
  const al = { baidu: 'Baidu', github: 'GitHub', hackernews: 'HN', toutiao: 'Toutiao' };
  const at2 = { baidu: 'o', github: 'b', hackernews: 'o', toutiao: 'r' };
  const sn = { douyin: 'Douyin', xiaohongshu: 'Xiaohongshu', manual: 'Manual' };

  // Update hot count
  $('hot-count').textContent = all.length;

  // Render auto-box (auto-fetched + manual in a unified list)
  const ael = $('auto-box');
  if (a.length) {
    ael.innerHTML = a.map((x, i) => renderHotRow(x, i, at2[x.source]||'gray', al[x.source]||x.source, true)).join('');
  } else {
    ael.innerHTML = EMPTY('⏳', 'No topics fetched yet');
  }

  // Render hot-box (manual entries)
  const el = $('hot-box');
  if (m.length) {
    el.innerHTML = m.map((x, i) => renderHotRow(x, i, 'gray', sn[x.source]||x.source, false, x.id)).join('');
  } else {
    el.innerHTML = EMPTY('No hot topics');
  }

  // Update Top Pick
  updateTopPick(all);
  // Update Market Velocity
  updateMarketVelocity(all);

  if (!window._rl) loadRecs();
}

function renderHotRow(x, i, tagColor, sourceLabel, isAuto, id) {
  // 4D score generation from single score
  const score = x.score || 3;
  const heat = Math.min(100, score * 20 + 10);
  const barrier = Math.max(10, 100 - score * 18 + (Math.random()*10-5));
  const tail = Math.min(100, score * 15 + 25);
  const monet = Math.min(100, score * 22 + 5);

  const rankLabel = i < 3 ? ['🥇','🥈','🥉'][i] : (i+1);
  const rankColor = i < 3 ? '' : 'color:var(--on-surface-variant)';

  const delBtn = isAuto ? '' : `<button class="btn btn-xs btn-g" onclick="deleteHot(${id})" style="border-radius:9999px;padding:3px 10px;font-size:9px">✕</button>`;

  const titleHtml = x.url
    ? `<a href="${x.url}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">${escHtml(x.title)}</a>`
    : escHtml(x.title);

  return `
  <div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--outline-variant);border-bottom-opacity:0.2">
    <span style="font-family:var(--font-label);font-size:11px;font-weight:600;min-width:20px;text-align:center;${rankColor}">${rankLabel}</span>
    <div style="flex:1;min-width:0">
      <div style="font-size:13px;font-weight:500;color:var(--on-surface);margin-bottom:4px">${titleHtml}</div>
      <div style="display:flex;gap:8px;font-size:10px;color:var(--on-surface-variant)">
        <span class="tag t-${tagColor}">${sourceLabel}</span>
        ${x.trend ? `<span>↗ ${escHtml(x.trend)}</span>` : ''}
      </div>
    </div>
    
    <div style="display:flex;gap:3px;align-items:center;min-width:100px">
      <div style="display:flex;gap:3px;flex:1">
        <div style="flex:1;height:4px;background:var(--surface-container-high);border-radius:2px;overflow:hidden"><div style="height:100%;width:${heat}%;background:var(--primary-fixed);border-radius:2px"></div></div>
        <div style="flex:1;height:4px;background:var(--surface-container-high);border-radius:2px;overflow:hidden"><div style="height:100%;width:${barrier}%;background:var(--orange);border-radius:2px"></div></div>
        <div style="flex:1;height:4px;background:var(--surface-container-high);border-radius:2px;overflow:hidden"><div style="height:100%;width:${tail}%;background:var(--blueL);border-radius:2px"></div></div>
        <div style="flex:1;height:4px;background:var(--surface-container-high);border-radius:2px;overflow:hidden"><div style="height:100%;width:${monet}%;background:var(--pink);border-radius:2px"></div></div>
      </div>
    </div>
    <div style="display:flex;gap:4px;flex-shrink:0">
      <button class="btn btn-xs" onclick="pb('${x.title.replace(/'/g,"\\'")}',${score},3,3,3,'remotion-demo','both')" style="border-radius:9999px;padding:3px 10px;background:var(--primary-fixed);color:var(--on-surface);font-weight:600;font-size:9px;border:none;cursor:pointer">Create</button>
      ${delBtn}
    </div>
  </div>`;
}

function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function fmt(n) { if (n >= 1000000) return (n/1000000).toFixed(1)+'M'; if (n >= 1000) return (n/1000).toFixed(1)+'K'; return String(n); }

function updateTopPick(all) {
  const cp = $('top-pick-card');
  if (!cp) return;
  if (!all.length) {
    $('tp-title').textContent = '等待热点分析…';
    $('tp-heat-val').textContent = '—'; $('tp-heat-bar').style.width = '0%';
    $('tp-barrier-val').textContent = '—'; $('tp-barrier-bar').style.width = '0%';
    $('tp-tail-val').textContent = '—'; $('tp-tail-bar').style.width = '0%';
    $('tp-monet-val').textContent = '—'; $('tp-monet-bar').style.width = '0%';
    return;
  }
  // Pick highest scored item
  const top = all.reduce((a,b) => (a.score||0) >= (b.score||0) ? a : b);
  const s = top.score || 3;
  $('tp-title').textContent = top.title;
  $('tp-source').textContent = top.source ? top.source.toUpperCase() : 'TRENDING';
  const h = Math.min(100, s * 20 + 10);
  const b = Math.max(10, 100 - s * 18);
  const t = Math.min(100, s * 15 + 25);
  const m = Math.min(100, s * 22 + 5);
  $('tp-heat-val').textContent = Math.round(h/10) + '/10'; $('tp-heat-bar').style.width = h + '%';
  $('tp-barrier-val').textContent = Math.round(b/10) + '/10'; $('tp-barrier-bar').style.width = b + '%';
  $('tp-tail-val').textContent = Math.round(t/10) + '/10'; $('tp-tail-bar').style.width = t + '%';
  $('tp-monet-val').textContent = Math.round(m/10) + '/10'; $('tp-monet-bar').style.width = m + '%';
  // Store top pick title for create action
  cp.dataset.topPickTitle = top.title;
  cp.dataset.topPickScore = s;
}

function updateMarketVelocity(all) {
  const totalScore = all.reduce((sum, x) => sum + (x.score || 3), 0);
  const avg = all.length ? totalScore / all.length : 0;
  const creatorVal = (all.length * avg * 12000).toFixed(0);
  $('mv-value').textContent = '+$' + Number(creatorVal).toLocaleString();

}

async function ch() { const t = T(); S.hotTopics = S.hotTopics.filter(h => h.date !== t); S.autoTopics = S.autoTopics.filter(h => h.date !== t); await saveAll({ hotTopics: S.hotTopics }); rh(); TOAST('Cleared today\'s topics'); }
async function tf() {
  const btn = $('ft-btn'); btn.textContent = '抓取中…'; btn.disabled = true;
  try {
    const r = await fetch('/api/trigger-fetch', { method: 'POST' });
    if (!r.ok) { TOAST('❌服务器 ' + r.status); btn.textContent = 'Fetch Now'; btn.disabled = false; return; }
    const d = await r.json();
    if (d.ok) { TOAST(`✅抓到 ${d.fetched} 条，正在刷新…`); refresh(); }
    else { TOAST('❌返回异常'); }
  } catch(e) { TOAST('❌网络错误'); }
  btn.textContent = '立即抓取'; btn.disabled = false;
}
async function gb() {
  const r = await fetch('/api/brief/generate', { method: 'POST' }); const d = await r.json();
  if (!d.brief) { alert('暂无热点'); return; }
  const b = d.brief;
  $('brief-body').innerHTML = `<div style="font-size:11px;color:var(--text2);margin-bottom:10px">基于${b.hotCount}条热点</div>${b.suggestions.map(s => `<div class="bi"><div class="bt">${s.title}</div><div class="bd2">热度${s.hot}/5</div><div class="fr" style="margin-top:6px"><button class="btn btn-xs btn-p" onclick="pb('${s.title.replace(/'/g,"\\'")}',${s.hot},3,3,3,'${s.type}','both')">以此选题</button></div></div>`).join('')}`;
  $('brief-box').style.display = 'block';
}

// === Recommendations ===
window._rl = false;
async function loadRecs() {
  window._rl = true;
  try {
    const r = await fetch('/api/today/recommend', { method: 'POST' }); const d = await r.json();
    if (!d.recommendations || !d.recommendations.length) { $('rc-box').innerHTML = EMPTY('No recommendations'); $('hrc-box').innerHTML = EMPTY('暂无推荐'); return; }
    $('rc-ct').textContent = `${d.total}条·P0:${d.groups.p0} P1:${d.groups.p1}`; $('hrc-ct').textContent = `${d.total}条·P0:${d.groups.p0} P1:${d.groups.p1}`;
    const html = mkRecs(d.recommendations); $('rc-box').innerHTML = html; $('hrc-box').innerHTML = html;
  } catch(e) { $('rc-box').innerHTML = EMPTY('Analysis failed'); $('hrc-box').innerHTML = EMPTY('分析失败'); }
}
function mkRecs(r) {
  const fn = {'remotion-demo':'R演示','remotion-compare':'R对比','hyperframes-text':'HF文','hyperframes-narrate':'HF配'}, sn = {github:'GitHub',hackernews:'HN',toutiao:'头条'}, pf2 = {douyin:'🎵抖音',xiaohongshu:'📕小红书',both:'🎵📕'};
  const p0 = r.filter(x => x.pri === 'P0'), p1 = r.filter(x => x.pri === 'P1'), rs = r.filter(x => x.pri !== 'P0' && x.pri !== 'P1');
  let h = '';
  if (p0.length) { h += `<div style="margin-bottom:8px">${TAG('P0·Today','r')}<span style="font-size:10px;color:var(--text3);margin-left:6px">${p0.length}个</span></div>` + p0.map(x => rc(x, fn, sn, pf2)).join(''); }
  if (p1.length) { h += `<div style="margin:12px 0 8px">${TAG('P1·This Week','o')}<span style="font-size:10px;color:var(--text3);margin-left:6px">${p1.length}个</span></div>` + p1.map(x => rc(x, fn, sn, pf2)).join(''); }
  if (rs.length) { h += `<div style="margin:10px 0 4px"><span style="font-size:10px;color:var(--text3)">其余</span></div>` + rs.slice(0,3).map(x => `<div class="hi" style="opacity:.45"><div class="hb"><div class="ht" style="font-size:11px">${x.title}</div><div class="hm"><span>${x.score}分·${x.pri}</span><span>${x.reason}</span></div></div></div>`).join(''); }
  return h;
}
function rc(x, fn, sn, pf2) {
  const ua = x.url ? `href="${x.url}" target="_blank"` : '';
  return `<div class="bi"><div style="display:flex;align-items:flex-start;gap:10px"><div style="flex:1;min-width:0"><div class="bt">${ua?`<a ${ua} style="color:inherit;text-decoration:none" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">${x.title}</a>`:x.title}</div><div class="bd2" style="margin-top:2px">${TAG(sn[x.source]||x.source,x.source==='github'?'b':'o')} ${TAG(pf2[x.platform]||'Multi',x.platform==='douyin'?'p':x.platform==='xiaohongshu'?'o':'gray')} ${x.trend?x.trend.slice(0,30):''}</div></div><div style="text-align:center;flex-shrink:0"><div class="sn ${SC(x.score)}">${x.score}</div><div>${TAG(x.pri,x.pri==='P0'?'r':'o')}</div></div></div><div style="display:flex;gap:6px;margin:4px 0 2px;font-size:9px;color:var(--text3)">🔥${x.hotScore}🧱${x.wallScore}⏳${x.durScore}💰${x.moneyScore}</div><div style="font-size:10px;color:var(--text2);line-height:1.4">${x.reason}</div><div class="fr" style="margin-top:5px">${TAG(fn[x.format]||x.format,'gray')}<button class="btn btn-xs btn-p" onclick="pb('${x.title.replace(/'/g,"\\'")} 教程',${x.hotScore},${x.wallScore},${x.durScore},${x.moneyScore},'${x.format}','${x.platform||'both'}')">以此选题</button><button class="btn btn-xs btn-g" onclick="pb('${x.title.replace(/'/g,"\\'")} 解读',${x.hotScore},${x.wallScore},${x.durScore},${x.moneyScore},'hyperframes-text','${x.platform||'both'}')">解读</button></div></div>`;
}

// === Topic Matrix ===
function pb(t, h, w, d, m, f, p) { goPage('matrix'); $('it').value = t; $('ih').value = h; $('iw').value = w; $('idu2').value = d; $('im').value = m; if (f) $('ifmt').value = f; if (p) $('iplat').value = p; }
async function ai() {
  const t = $('it').value.trim(); if (!t) { alert('Enter a title'); return; }
  const h = parseInt($('ih').value), w = parseInt($('iw').value), d = parseInt($('idu2').value), m = parseInt($('im').value);
  const f = $('ifmt').value, sc = CS(h, w, d, m), pr = PL(sc), p = $('iplat').value || 'both';
  S.ideas.push({ id: Date.now(), title: t, desc: '', hot: h, wall: w, duration: d, money: m, score: sc, pri: pr, format: f, platform: p, hotlink: '', createdAt: T(), status: 'pending' });
  await saveAll({ ideas: S.ideas }); ri(); $('it').value = ''; $('id2').value = ''; TOAST(`✅${pr}${sc}分`);
}
function ri() {
  var s = [...S.ideas].sort(function(a, b) { return b.score - a.score; });
  var el = $('itb');
  $('ic-ct').textContent = s.length;
  $('mtr-p0').textContent = s.filter(function(x) { return x.pri === 'P0'; }).length;
  $('mtr-p1').textContent = s.filter(function(x) { return x.pri === 'P1'; }).length;
  if (!s.length) { el.innerHTML = EMPTY('No topics'); return; }
  var fn = {'remotion-demo':'Demo','remotion-compare':'Compare','hyperframes-text':'HF Text','hyperframes-narrate':'HF Narration','image-text':'Image+Text'};
  var pf3 = {'douyin':'🎵Douyin','xiaohongshu':'📕Xiaohongshu','both':'🎵📕'};
  el.innerHTML = s.map(function(x) {
    var barColor = x.pri === 'P0' ? 'var(--primary-fixed)' : x.pri === 'P1' ? 'var(--orange)' : x.pri === 'P2' ? 'var(--blueL)' : 'var(--on-surface-variant)';
    var platIcon = x.platform === 'douyin' ? 'music_note' : x.platform === 'xiaohongshu' ? 'menu_book' : 'public';
    return '<div class="glass-card" style="border:1px solid var(--outline-variant);padding:20px;border-radius:12px;position:relative;overflow:hidden;display:flex;flex-direction:column;justify-content:space-between">' +
      // Card header: platform icon + score badge
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">' +
        '<span class="material-symbols-outlined" style="color:var(--outline)">' + platIcon + '</span>' +
        '<span style="font-family:var(--font-display);font-size:24px;font-weight:700;letter-spacing:-0.03em;color:' + barColor + '">' + x.score + '</span>' +
      '</div>' +
      // Card title: line-clamp-2
      '<div style="margin-bottom:8px">' +
        '<div class="font-headline-md" style="font-size:16px;color:var(--on-surface);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;line-height:1.3">' + escHtml(x.title) + '</div>' +
        '<div class="font-body-md" style="font-size:12px;color:var(--outline);margin-top:4px">' + (fn[x.format]||x.format) + ' · ' + (pf3[x.platform]||'🎵📕') + '</div>' +
      '</div>' +
      // 4D bars
      '<div style="display:flex;flex-direction:column;gap:3px;margin-bottom:8px">' +
        '<div><div style="display:flex;justify-content:space-between;font-size:9px;font-family:var(--font-label);color:var(--on-surface-variant);margin-bottom:1px"><span>🔥 Heat</span><span>' + x.hot + '/5</span></div><div style="height:4px;background:var(--surface-container-high);border-radius:2px"><div style="width:' + (x.hot * 20) + '%;height:100%;background:var(--pink);border-radius:2px"></div></div></div>' +
        '<div><div style="display:flex;justify-content:space-between;font-size:9px;font-family:var(--font-label);color:var(--on-surface-variant);margin-bottom:1px"><span>🧱 Barrier</span><span>' + x.wall + '/5</span></div><div style="height:4px;background:var(--surface-container-high);border-radius:2px"><div style="width:' + (x.wall * 20) + '%;height:100%;background:var(--blue);border-radius:2px"></div></div></div>' +
        '<div><div style="display:flex;justify-content:space-between;font-size:9px;font-family:var(--font-label);color:var(--on-surface-variant);margin-bottom:1px"><span>⏳ Long-tail</span><span>' + x.duration + '/5</span></div><div style="height:4px;background:var(--surface-container-high);border-radius:2px"><div style="width:' + (x.duration * 20) + '%;height:100%;background:var(--green);border-radius:2px"></div></div></div>' +
        '<div><div style="display:flex;justify-content:space-between;font-size:9px;font-family:var(--font-label);color:var(--on-surface-variant);margin-bottom:1px"><span>💰 Monetization</span><span>' + x.money + '/5</span></div><div style="height:4px;background:var(--surface-container-high);border-radius:2px"><div style="width:' + (x.money * 20) + '%;height:100%;background:var(--orange);border-radius:2px"></div></div></div>' +
      '</div>' +
      // Bottom: metadata status bar
      '<div style="display:flex;justify-content:space-between;align-items:center;padding-top:10px;border-top:1px solid var(--outline-variant)">' +
        '<div style="display:flex;gap:8px;font-size:11px;font-family:var(--font-label);color:var(--on-surface-variant)">' +
          '<span>📽️ ' + (x.hot * 2000).toLocaleString() + '</span>' +
          '<span class="tag t-' + (x.pri === 'P0' ? 'r' : x.pri === 'P1' ? 'o' : x.pri === 'P2' ? 'b' : 'gray') + '" style="font-size:9px">' + x.pri + '</span>' +
        '</div>' +
        '<div style="display:flex;gap:6px">' +
          '<button class="btn btn-xs" onclick="buildPipeline(' + x.id + ')" style="border-radius:9999px;background:var(--primary-fixed);color:var(--on-surface);font-weight:600;border:none;font-size:9px;padding:4px 10px;cursor:pointer">Build</button>' +
          '<button class="btn btn-xs btn-g" onclick="di(' + x.id + ')" style="border-radius:9999px;font-size:9px;padding:4px 8px;border:none;cursor:pointer">✕</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');
}


function filterMatrix(filter) {
  document.querySelectorAll('#p-matrix .capsule-btn').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
  const cards = document.querySelectorAll('#itb > div');
  cards.forEach(card => {
    const badge = card.querySelector('.tag');
    const pri = badge ? badge.textContent.trim().charAt(0) : '';
    let show = true;
    if (filter === 'p0') show = pri === 'P';
    else if (filter === 'p1') show = pri === 'P' || pri === 'P';
    // Simple filter by P0/P1 for now
    if (filter === 'p0') show = card.innerHTML.includes('P0');
    else if (filter === 'p1') show = card.innerHTML.includes('P1') || card.innerHTML.includes('P0');
    else if (filter === 'p2') show = card.innerHTML.includes('P2');
    card.style.display = show ? '' : 'none';
  });
}

async function di(id) { S.ideas = S.ideas.filter(i => i.id !== id); await saveAll({ ideas: S.ideas }); ri(); }
async function qi() { const v = $('qi').value.trim(); if (!v) return; const s = CS(3,3,3,3); S.ideas.push({ id: Date.now(), title: v, desc: '', hot: 3, wall: 3, duration: 3, money: 3, score: s, pri: PL(s), format: 'hyperframes-text', platform: 'both', hotlink: '', createdAt: T(), status: 'pending' }); await saveAll({ ideas: S.ideas }); $('qi').value = ''; TOAST('✅ Added to topic pool, project folder created'); }

// === Calendar ===
function sw(d) { wkOff += d; rc2(); }
function setCF(v) { cf = v; rc2(); }
function rc2() {
  var ref = new Date();
  ref.setDate(ref.getDate() + wkOff * 7);
  var refStr = ref.toISOString().slice(0, 10);
  var w = WR(refStr);

  // Update month label
  var monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  $('cal-lb').textContent = monthNames[ref.getMonth()] + ' ' + ref.getFullYear();

  // Update capsule filter buttons
  ['cf-all','cf-dy','cf-xhs'].forEach(function(id, i) {
    var b = $(id);
    if (!b) return;
    b.className = 'capsule-btn';
    if ((i===0&&cf==='all')||(i===1&&cf==='douyin')||(i===2&&cf==='xiaohongshu')) b.classList.add('active');
  });

  // Get items for displayed month
  var monthStart = refStr.slice(0,7) + '-01';
  var nextMonth = new Date(ref.getFullYear(), ref.getMonth() + 1, 1);
  var monthEnd = nextMonth.toISOString().slice(0, 10);
  var items = S.calendar.filter(function(c) { return c.date >= monthStart && c.date < monthEnd; }).sort(function(a, b) { return a.date.localeCompare(b.date); });
  if (cf !== 'all') items = items.filter(function(c) { return c.platform === cf || c.platform === 'multiple'; });

  var fn = {'remotion-demo':'Demo','remotion-compare':'Compare','hyperframes-text':'HF','hyperframes-narrate':'HF Narration','image-text':'Image+Text'};
  var sn2 = {'published':'Published','scheduled':'Scheduled','draft':'In Progress'};
  var pf4 = {'douyin':'🎵Douyin','xiaohongshu':'📕Xiaohongshu','multiple':'🎵📕'};
  var statusColor = {'published':'var(--primary-fixed)','scheduled':'var(--orange)','draft':'var(--blueL)'};

  // Build day grid: first day of month -> what weekday it starts on
  var firstDay = new Date(ref.getFullYear(), ref.getMonth(), 1);
  var startDow = firstDay.getDay(); // 0=Sun
  // Convert to Mon=0: (startDow + 6) % 7
  var startOffset = (startDow + 6) % 7;
  var daysInMonth = new Date(ref.getFullYear(), ref.getMonth() + 1, 0).getDate();
  var today = new Date();
  var todayStr = today.toISOString().slice(0, 10);

  // Build a map of date -> items
  var itemMap = {};
  items.forEach(function(x) {
    if (!itemMap[x.date]) itemMap[x.date] = [];
    itemMap[x.date].push(x);
  });

  var grid = $('cal-grid');
  var totalCells = startOffset + daysInMonth;
  var totalRows = Math.ceil(totalCells / 7);
  var html = '';

  for (var row = 0; row < totalRows; row++) {
    html += '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px">';
    for (var col = 0; col < 7; col++) {
      var cellIdx = row * 7 + col - startOffset + 1;
      if (cellIdx < 1 || cellIdx > daysInMonth) {
        html += '<div style="min-height:100px;border-radius:12px;background:transparent"></div>';
      } else {
        var dateStr = refStr.slice(0,7) + '-' + String(cellIdx).padStart(2,'0');
        var cellItems = itemMap[dateStr] || [];
        var isToday = dateStr === todayStr;
        html += '<div style="min-height:100px;border-radius:12px;background:var(--surface-container-low);padding:6px;display:flex;flex-direction:column;gap:2px;' + (isToday ? 'border:2px solid var(--primary-fixed);' : 'border:1px solid var(--outline-variant);') + '">';
        // Date number
        html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">';
        html += '<span class="font-label-sm" style="font-size:11px;' + (isToday ? 'color:var(--primary-fixed);font-weight:700' : 'color:var(--on-surface-variant)') + '">' + cellIdx + '</span>';
        if (cellItems.length > 0) html += '<span class="font-label-sm" style="font-size:8px;color:var(--on-surface-variant)">' + cellItems.length + '</span>';
        html += '</div>';
        // Items in cell
        var shown = cellItems.slice(0, 2);
        shown.forEach(function(x) {
          var sc = statusColor[x.status] || 'var(--on-surface-variant)';
          html += '<div style="background:' + sc + '20;border-radius:6px;padding:4px 6px;font-size:9px;color:var(--on-surface);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;display:flex;align-items:center;gap:3px" onclick="dc(' + x.id + ')">';
          html += '<span style="width:4px;height:4px;border-radius:50%;background:' + sc + ';flex-shrink:0"></span>';
          html += '<span style="overflow:hidden;text-overflow:ellipsis">' + (x.title.length > 12 ? x.title.slice(0, 12) + '..' : x.title) + '</span>';
          html += '</div>';
        });
        if (cellItems.length > 2) {
          html += '<span class="font-label-sm" style="font-size:8px;color:var(--on-surface-variant);text-align:center;margin-top:2px">+' + (cellItems.length - 2) + ' more</span>';
        }
        html += '</div>';
      }
    }
    html += '</div>';
  }
  grid.innerHTML = html;
}
async function ac() { const t = $('pt2').value.trim(); if (!t) { alert('Enter a title'); return; } S.calendar.push({ id: Date.now(), title: t, format: $('pf').value, status: $('ps').value, platform: $('pp').value, date: T(), views: null, pri: 'P2', score: 3 }); await saveAll({ calendar: S.calendar }); rc2(); $('pt2').value = ''; TOAST('📅 Recorded'); }
async function dc(id) { S.calendar = S.calendar.filter(c => c.id !== id); await saveAll({ calendar: S.calendar }); rc2(); }
async function cc() { S.calendar = []; await saveAll({ calendar: S.calendar }); rc2(); }

// === Review ===
function popRV() { const sel = $('rv-pick'); sel.innerHTML = '<option value="">— Select —</option>' + S.calendar.filter(c => c.status === 'published' || c.status === 'draft').map(c => `<option value="${c.id}">${c.title}</option>`).join(''); }
function popQE() { const sel = $('qe-pick'); if (!sel) return; sel.innerHTML = '<option value="">—选择—</option>' + S.calendar.filter(c => c.status === 'published' || c.status === 'draft').map(c => `<option value="${c.id}">${c.title}</option>`).join(''); $('qe-date').value = T(); }

async function ar() {
  const id = $('rv-pick').value; if (!id) { alert('Select item'); return; }
  const c = parseFloat($('rv-c').value) || 0, i = parseFloat($('rv-i').value) || 0, f = parseInt($('rv-f').value) || 0, s = parseFloat($('rv-s').value) || 0, v = parseInt($('rv-v').value) || 0, p = $('rv-platform').value || 'douyin';
  const cal = S.calendar.find(c => c.id == id); if (cal) cal.views = v;
  S.reviews.push({ id: Date.now(), calId: parseInt(id), title: cal ? cal.title : '未知', platform: p, completion: c, interact: i, followers: f, search: s, views: v, date: T() });
  await saveAll({ reviews: S.reviews, calendar: S.calendar }); rr(); rc2(); TOAST('📊 Recorded');
  $('rv-c').value = ''; $('rv-i').value = ''; $('rv-f').value = ''; $('rv-s').value = ''; $('rv-v').value = '';
}
async function qeSave() {
  const id = $('qe-pick').value; if (!id) { alert('Select item'); return; }
  const cal = S.calendar.find(c => c.id == id); if (!cal) { alert('Not found'); return; }
  const dt = $('qe-date').value || T();
  const dyV = parseInt($('qe-dy-v').value)||0, dyC = parseFloat($('qe-dy-c').value)||0, dyI = parseFloat($('qe-dy-i').value)||0, dyF = parseInt($('qe-dy-f').value)||0, dyS = parseFloat($('qe-dy-s').value)||0;
  const xhsV = parseInt($('qe-xhs-v').value)||0, xhsC = parseFloat($('qe-xhs-c').value)||0, xhsI = parseFloat($('qe-xhs-i').value)||0, xhsF = parseInt($('qe-xhs-f').value)||0, xhsS = parseFloat($('qe-xhs-s').value)||0;
  cal.status = 'published';
  if (dyV > 0) { S.reviews.push({ id: Date.now()+1, calId: parseInt(id), title: cal.title, platform: 'douyin', views: dyV, completion: dyC, interact: dyI, followers: dyF, search: dyS, date: dt }); }
  if (xhsV > 0) { S.reviews.push({ id: Date.now()+2, calId: parseInt(id), title: cal.title, platform: 'xiaohongshu', views: xhsV, completion: xhsC, interact: xhsI, followers: xhsF, search: xhsS, date: dt }); }
  cal.views = (dyV||0) + (xhsV||0);
  await saveAll({ reviews: S.reviews, calendar: S.calendar }); ro(); rr(); rc2();
  ['qe-dy-v','qe-dy-c','qe-dy-i','qe-dy-f','qe-dy-s','qe-xhs-v','qe-xhs-c','qe-xhs-i','qe-xhs-f','qe-xhs-s'].forEach(id => $(id).value = '');
  TOAST(`📊已保存·抖音${dyV.toLocaleString()}+小红书${xhsV.toLocaleString()}`);
}
function rr() {
  var metricsEl = $('rv-metrics');
  var tiktokEl = $('rv-tiktok-list');
  var douyinEl = $('rv-douyin-list');
  var all = S.reviews || [];
  if (!all.length) {
    metricsEl.innerHTML = '<div class="glass-panel rounded-xl p-5 col-span-full lg:col-span-6"><div class="em"><span class="material-symbols-outlined text-outline" style="font-size:32px;display:block;margin-bottom:8px">analytics</span><p class="text-on-surface-variant">No review data yet — record some performance data to see metrics.</p></div></div>';
    tiktokEl.innerHTML = '<div class="em"><span class="material-symbols-outlined text-outline" style="font-size:24px;display:block;margin-bottom:4px">smart_display</span><p class="text-on-surface-variant">No TikTok data</p></div>';
    douyinEl.innerHTML = '<div class="em"><span class="material-symbols-outlined text-outline" style="font-size:24px;display:block;margin-bottom:4px">smart_display</span><p class="text-on-surface-variant">No Douyin data</p></div>';
    return;
  }

  // --- Compute 6 metrics ---
  var totalViews = all.reduce(function(s, r) { return s + (r.views || 0); }, 0);
  var avgEngage = all.reduce(function(s, r) { return s + (r.interact || 0); }, 0) / all.length;
  var avgCompletion = all.reduce(function(s, r) { return s + (r.completion || 0); }, 0) / all.length;
  var totalFollowers = all.reduce(function(s, r) { return s + (r.followers || 0); }, 0);
  var dyCount = all.filter(function(r) { return r.platform === 'douyin' || r.platform === 'tiktok'; }).length;
  var xhsCount = all.filter(function(r) { return r.platform === 'xiaohongshu'; }).length;
  var topRegion = dyCount >= xhsCount ? 'TikTok' : 'Xiaohongshu';
  var regionPct = Math.max(dyCount, xhsCount) / Math.max(all.length, 1) * 100;
  var revenue = totalViews * 0.0034; // ~$0.34 CPM

  // Week-over-week comparison (last 7 days vs previous 7)
  var now = T();
  var sevenAgo = new Date(); sevenAgo.setDate(sevenAgo.getDate() - 7); var s7 = sevenAgo.toISOString().slice(0,10);
  var fourteenAgo = new Date(); fourteenAgo.setDate(fourteenAgo.getDate() - 14); var f14 = fourteenAgo.toISOString().slice(0,10);
  var recentViews = all.filter(function(r) { return r.date >= s7; }).reduce(function(s, r) { return s + (r.views || 0); }, 0);
  var prevViews = all.filter(function(r) { return r.date >= f14 && r.date < s7; }).reduce(function(s, r) { return s + (r.views || 0); }, 0);
  var viewChange = prevViews > 0 ? ((recentViews - prevViews) / prevViews * 100) : 0;
  var viewTrend = viewChange > 0 ? 'up' : (viewChange < 0 ? 'down' : 'flat');

  metricsEl.innerHTML =
    '<div class="glass-panel rounded-xl p-5 flex flex-col justify-between hover:-translate-y-1 transition-transform duration-300 relative overflow-hidden group">' +
      '<div class="relative z-10 flex justify-between items-start mb-4"><span class="font-label-sm text-on-surface-variant uppercase tracking-wider">Total Est. Views</span><span class="material-symbols-outlined text-outline">visibility</span></div>' +
      '<div class="relative z-10"><div class="font-metric-xl text-on-surface mb-1">' + fmt(totalViews) + '</div>' +
      '<div class="font-label-sm text-' + (viewChange >= 0 ? 'primary' : 'error') + ' flex items-center gap-1"><span class="material-symbols-outlined text-[14px]">' + (viewChange >= 0 ? 'trending_up' : 'trending_down') + '</span>' +
      (viewChange >= 0 ? '+' : '') + viewChange.toFixed(1) + '% vs prev. week</div></div></div>' +

    '<div class="glass-panel rounded-xl p-5 flex flex-col justify-between hover:-translate-y-1 transition-transform duration-300 relative overflow-hidden group">' +
      '<div class="relative z-10 flex justify-between items-start mb-4"><span class="font-label-sm text-on-surface-variant uppercase tracking-wider">Avg. Engagement</span><span class="material-symbols-outlined text-outline">favorite</span></div>' +
      '<div class="relative z-10"><div class="font-metric-xl text-on-surface mb-1">' + avgEngage.toFixed(1) + '%</div>' +
      '<div class="font-label-sm text-primary flex items-center gap-1"><span class="material-symbols-outlined text-[14px]">trending_up</span>+2.1% baseline</div></div></div>' +

    '<div class="glass-panel rounded-xl p-5 flex flex-col justify-between hover:-translate-y-1 transition-transform duration-300 relative overflow-hidden group">' +
      '<div class="relative z-10 flex justify-between items-start mb-4"><span class="font-label-sm text-on-surface-variant uppercase tracking-wider">Completion &gt; 30s</span><span class="material-symbols-outlined text-outline">timer</span></div>' +
      '<div class="relative z-10"><div class="font-metric-xl text-on-surface mb-1">' + avgCompletion.toFixed(1) + '%</div>' +
      '<div class="font-label-sm text-primary flex items-center gap-1"><span class="material-symbols-outlined text-[14px]">trending_up</span>Stable rate</div></div></div>' +

    '<div class="glass-panel rounded-xl p-5 flex flex-col justify-between hover:-translate-y-1 transition-transform duration-300 relative overflow-hidden group">' +
      '<div class="relative z-10 flex justify-between items-start mb-4"><span class="font-label-sm text-on-surface-variant uppercase tracking-wider">Follower Conv.</span><span class="material-symbols-outlined text-outline">group_add</span></div>' +
      '<div class="relative z-10"><div class="font-metric-xl text-on-surface mb-1">' + (totalViews > 0 ? (totalFollowers / totalViews * 100).toFixed(1) : '0.0') + '%</div>' +
      '<div class="font-label-sm text-primary flex items-center gap-1"><span class="material-symbols-outlined text-[14px]">trending_up</span>Stable growth</div></div></div>' +

    '<div class="glass-panel rounded-xl p-5 flex flex-col justify-between hover:-translate-y-1 transition-transform duration-300 relative overflow-hidden group">' +
      '<div class="relative z-10 flex justify-between items-start mb-4"><span class="font-label-sm text-on-surface-variant uppercase tracking-wider">Top Region</span><span class="material-symbols-outlined text-outline">public</span></div>' +
      '<div class="relative z-10"><div class="font-metric-xl text-on-surface mb-1 text-[32px] truncate">' + topRegion + '</div>' +
      '<div class="font-label-sm text-on-surface-variant flex items-center gap-1">' + regionPct.toFixed(0) + '% total distribution</div></div></div>' +

    '<div class="glass-panel rounded-xl p-5 flex flex-col justify-between hover:-translate-y-1 transition-transform duration-300 relative overflow-hidden group bg-gradient-to-br from-surface-container-lowest/80 to-primary-container/20 border-primary-fixed/30">' +
      '<div class="relative z-10 flex justify-between items-start mb-4"><span class="font-label-sm text-on-surface-variant uppercase tracking-wider">Est. Revenue</span><span class="material-symbols-outlined text-primary">payments</span></div>' +
      '<div class="relative z-10"><div class="font-metric-xl text-on-surface mb-1">$' + (revenue > 1000 ? (revenue / 1000).toFixed(1) + 'K' : revenue.toFixed(0)) + '</div>' +
      '<div class="font-label-sm text-primary flex items-center gap-1"><span class="material-symbols-outlined text-[14px]">check_circle</span>Target tracking</div></div></div>';

  // --- TikTok / Douyin Rankings ---
  var dyReviews = all.filter(function(r) { return r.platform === 'douyin' || r.platform === 'tiktok'; }).sort(function(a, b) { return b.views - a.views; }).slice(0, 5);
  var xhsReviews = all.filter(function(r) { return r.platform === 'xiaohongshu'; }).sort(function(a, b) { return b.views - a.views; }).slice(0, 5);

  function renderRanking(items, emptyMsg) {
    if (!items.length) return '<div class="em"><span class="material-symbols-outlined text-outline" style="font-size:24px;display:block;margin-bottom:4px">smart_display</span><p class="text-on-surface-variant">' + emptyMsg + '</p></div>';
    return items.map(function(r, i) {
      var medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '';
      var trendIcon = (r.interact || 0) >= 10 ? 'trending_up' : ((r.interact || 0) >= 5 ? 'trending_flat' : 'trending_down');
      var trendColor = (r.interact || 0) >= 10 ? 'text-primary' : ((r.interact || 0) >= 5 ? 'text-on-surface-variant' : 'text-error');
      return '<div class="group relative flex items-center gap-4 p-3 rounded-xl hover:bg-surface-container-lowest/80 transition-colors border border-transparent hover:border-outline-variant/30">' +
        '<div class="w-7 font-label-sm text-on-surface-variant font-bold text-center">' + (i + 1) + '</div>' +
        '<div class="w-14 h-20 rounded-lg overflow-hidden bg-surface-container shrink-0 flex items-center justify-center"><span class="material-symbols-outlined text-outline-variant text-3xl">play_circle</span></div>' +
        '<div class="flex-1 min-w-0"><h3 class="text-sm font-bold text-on-surface truncate mb-1">' + escHtml(r.title) + '</h3>' +
        '<div class="flex items-center gap-3 font-label-sm text-on-surface-variant"><span class="flex items-center gap-1"><span class="material-symbols-outlined text-[14px]">visibility</span> ' + fmt(r.views || 0) + '</span>' +
        '<span class="flex items-center gap-1 ' + trendColor + '"><span class="material-symbols-outlined text-[14px]">favorite</span> ' + (r.interact || 0) + '%</span></div></div>' +
        '<div class="font-label-sm text-on-surface-variant opacity-50 group-hover:opacity-100 transition-opacity">' + r.date + '</div></div>';
    }).join('');
  }

  tiktokEl.innerHTML = renderRanking(dyReviews, 'No TikTok data');
  douyinEl.innerHTML = renderRanking(xhsReviews, 'No Douyin data');
}

// === Search Words ===
async function asw() { const w = $('sw').value.trim(), c = parseInt($('swc').value)||0; if (!w) return; S.searchWords.push({word:w,count:c,date:T()}); await saveAll({searchWords:S.searchWords}); rsr(); $('sw').value=''; $('swc').value=''; }
function rsr() { var el = $('sw-box'); var r = S.searchWords.slice(-20).reverse(); if (!r.length) { el.innerHTML = '<div class="em py-6"><span class="material-symbols-outlined text-outline" style="font-size:24px;display:block;margin-bottom:4px">search</span><p class="text-on-surface-variant">No keywords tracked yet.</p></div>'; return; } el.innerHTML = r.map(function(s) { return '<div class="flex justify-between items-center p-3 rounded-lg bg-surface-container-lowest/50 border border-outline-variant/30"><div class="flex flex-col"><span class="text-sm font-bold text-on-surface">' + escHtml(s.word) + '</span><span class="font-label-sm text-on-surface-variant">' + s.date + '</span></div><div class="flex items-center gap-1 text-primary font-label-sm bg-primary-fixed/20 px-2 py-1 rounded"><span class="material-symbols-outlined text-[14px]">arrow_upward</span>' + (s.count || 0) + '</div></div>'; }).join(''); }

// === Weekly Notes ===
async function sn() { const t = $('wn').value.trim(); if (!t) return; const w = T(); S.weeklyNotes.push({note:t,date:w,week:WR(w).ms}); await saveAll({weeklyNotes:S.weeklyNotes}); rnotes(); $('wn').value=''; TOAST('💡 Saved'); }
function rnotes() { var el = $('notes-box'); var r = S.weeklyNotes.slice(-10).reverse(); if (!r.length) { el.innerHTML = '<div class="em"><span class="material-symbols-outlined text-outline" style="font-size:24px;display:block;margin-bottom:4px">sticky_note_2</span><p class="text-on-surface-variant">No notes yet — click Add Note to start.</p></div>'; return; } el.innerHTML = r.map(function(n) { return '<div class="p-4 rounded-xl bg-surface-container-low border border-outline-variant/30"><div class="flex items-center gap-2 mb-2"><span class="font-label-sm text-on-surface-variant">' + n.date + '</span><span class="flex-1"></span><span class="material-symbols-outlined text-on-surface-variant opacity-50" style="font-size:14px">sticky_note_2</span></div><div class="text-sm text-on-surface leading-relaxed">' + escHtml(n.note) + '</div></div>'; }).join(''); }

// === Project Assets Panel ===
async function loadProjects() {
  try {
    const r = await fetch("/api/projects");
    const d = await r.json();
    const el = $("proj-box");
    if (!d.projects || !d.projects.length) { el.innerHTML = EMPTY("暂无项目"); return; }
    const order = { completed: 0, video_ready: 1, in_progress: 2 };
    const sorted = d.projects.sort((a, b) => (order[a.status] || 9) - (order[b.status] || 9));
    const statusStyle = { completed:"color:#34D399;font-weight:700", video_ready:"color:#A78BFA;font-weight:600", in_progress:"color:#F59E0B;font-weight:600" };
    el.innerHTML = `<div style="display:flex;flex-direction:column;gap:0">` +
      sorted.map(p => {
        const icon = p.status === "completed" ? "check_circle" : p.status === "video_ready" ? "movie" : "pending";
    const iconColor = p.status === "completed" ? "var(--primary-fixed)" : p.status === "video_ready" ? "var(--blueL)" : "var(--on-surface-variant)";
    const st = statusStyle[p.status] || "color:#636366";
    const videoBadge = p.videoCount > 0 ? '<span class="tag t-b" style="font-size:10px;padding:2px 8px;margin-right:4px"><span class="material-symbols-outlined" style="font-size:10px;vertical-align:middle">movie</span> ' + p.videoCount + '</span>' : '<span class="tag t-gray" style="font-size:10px;padding:2px 8px;margin-right:4px"><span class="material-symbols-outlined" style="font-size:10px;vertical-align:middle">videocam_off</span> 0</span>';
    const coverBadge = p.hasCover ? '<span class="tag t-g" style="font-size:10px;padding:2px 8px;margin-right:4px"><span class="material-symbols-outlined" style="font-size:10px;vertical-align:middle">wallpaper</span> Ready</span>' : '<span class="tag t-gray" style="font-size:10px;padding:2px 8px;margin-right:4px"><span class="material-symbols-outlined" style="font-size:10px;vertical-align:middle">broken_image</span> Missing</span>';
    const copyBadge = p.hasCopy ? '<span class="tag t-g" style="font-size:10px;padding:2px 8px"><span class="material-symbols-outlined" style="font-size:10px;vertical-align:middle">description</span> Ready</span>' : '<span class="tag t-gray" style="font-size:10px;padding:2px 8px"><span class="material-symbols-outlined" style="font-size:10px;vertical-align:middle">description</span> Missing</span>';
    const hs = p.hasScript, hc = p.hasCover, hv = p.videoCount > 0;
    const needScript = !hs; const needRender = hs && !hv; const needCover = hv && !hc;
    let sb = hs ? '<button class="btn btn-xs btn-g" onclick="generateScript(\'' + p.name + '\')"><span class="material-symbols-outlined" style="font-size:10px;vertical-align:middle">visibility</span> View Script</button><button class="btn btn-xs btn-g" onclick="generateScript(\'' + p.name + '\')"><span class="material-symbols-outlined" style="font-size:10px;vertical-align:middle">refresh</span> Rewrite</button>' : '<button class="btn btn-xs btn-p" onclick="generateScript(\'' + p.name + '\')"><span class="material-symbols-outlined" style="font-size:10px;vertical-align:middle">auto_awesome</span> Generate Script</button>';
    let cb = hc ? '<button class="btn btn-xs btn-g" onclick="openCoverEditor(\'' + p.name + '\')"><span class="material-symbols-outlined" style="font-size:10px;vertical-align:middle">visibility</span> View Cover</button><button class="btn btn-xs btn-g" onclick="openCoverEditor(\'' + p.name + '\')"><span class="material-symbols-outlined" style="font-size:10px;vertical-align:middle">refresh</span> Redo</button>' : '<button class="btn btn-xs btn-p" onclick="openCoverEditor(\'' + p.name + '\')"><span class="material-symbols-outlined" style="font-size:10px;vertical-align:middle">palette</span> Generate Cover</button>';
    let rb;
    if (hv) { rb = '<button class="btn btn-xs btn-g" id="render-btn-' + p.name + '" onclick="startRender(\'' + p.name + '\')"><span class="material-symbols-outlined" style="font-size:10px;vertical-align:middle">refresh</span> Re-render</button>'; }
    else if (hs) { rb = '<button class="btn btn-xs btn-p" id="render-btn-' + p.name + '" onclick="startRender(\'' + p.name + '\')"><span class="material-symbols-outlined" style="font-size:10px;vertical-align:middle">movie</span> Start Render</button>'; }
    else { rb = '<button class="btn btn-xs btn-g" id="render-btn-' + p.name + '" disabled><span class="material-symbols-outlined" style="font-size:10px;vertical-align:middle">movie</span> Start Render</button>'; }
        if (needScript) { cb = cb.replace(/btn btn-xs btn-p/g,"btn btn-xs btn-g"); rb = rb.replace(/btn btn-xs btn-p/g,"btn btn-xs btn-g"); }
        else if (needRender) { sb = sb.replace(/btn btn-xs btn-p/g,"btn btn-xs btn-g"); cb = cb.replace(/btn btn-xs btn-p/g,"btn btn-xs btn-g"); }
        else if (needCover) { sb = sb.replace(/btn btn-xs btn-p/g,"btn btn-xs btn-g"); rb = rb.replace(/btn btn-xs btn-p/g,"btn btn-xs btn-g"); }
        else { sb = sb.replace(/btn btn-xs btn-p/g,"btn btn-xs btn-g"); cb = cb.replace(/btn btn-xs btn-p/g,"btn btn-xs btn-g"); rb = rb.replace(/btn btn-xs btn-p/g,"btn btn-xs btn-g"); }
        const fb = '<button class="btn btn-xs btn-g" onclick="openFolder(\'' + p.name + '\')"><span class="material-symbols-outlined" style="font-size:10px;vertical-align:middle">folder_open</span> Open Folder</button>';
        const canArchive = hv && hc;
        const archiveBtn = canArchive ? '<button class="btn btn-xs btn-g" onclick="archiveProject(\'' + p.name + '\')"><span class="material-symbols-outlined" style="font-size:10px;vertical-align:middle">archive</span> Archive</button>' : '';
        return `<div class="hi" style="padding:12px 0"><div class="hr rn" style="font-size:16px">${icon}</div><div class="hb"><div class="ht" style="font-size:14px;font-weight:600" id="status-${p.name}">${p.name}</div><div class="hm" style="margin-top:4px"><span id="label-${p.name}" style="${st};font-size:13px">${p.statusLabel}</span><span style="margin-left:8px">${videoBadge}${coverBadge}${copyBadge}</span></div><div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;align-items:center">${sb}${cb}${rb}${fb}${archiveBtn}</div></div></div>`;
      }).join('') + `</div>`;
  } catch(e) { $('proj-box').innerHTML = EMPTY('Load failed'); }
}

// === Asset Board Kanban ===
function ra() {
  const projects = S.projects || [];
  const colIP = $('ac-col-ip'), colVR = $('ac-col-vr'), colCO = $('ac-col-co');
  const st = (id, v) => { const e = $(id); if (e) e.textContent = v; };
  const emptyCol = '<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:48px 0;color:var(--on-surface-variant);opacity:0.4"><span class="material-symbols-outlined" style="font-size:32px">layers_clear</span><span style="font-size:11px;font-family:var(--font-label)">No videos in this state</span></div>';
  if (!projects.length) {
    ['ac-col-ip','ac-col-vr','ac-col-co'].forEach(id => { const el = $(id); if (el) el.innerHTML = emptyCol; });
    st('ac-ip-count','0'); st('ac-vr-count','0'); st('ac-co-count','0');
    return;
  }
  const ip = projects.filter(p => p.status === 'in_progress');
  const vr = projects.filter(p => p.status === 'video_ready');
  const co = projects.filter(p => p.status === 'completed');
  st('ac-ip-count', ip.length); st('ac-vr-count', vr.length); st('ac-co-count', co.length);
  if (colIP) colIP.innerHTML = ip.length ? ip.map(p => renderAssetCard(p, 'in_progress')).join('') : emptyCol;
  if (colVR) colVR.innerHTML = vr.length ? vr.map(p => renderAssetCard(p, 'video_ready')).join('') : emptyCol;
  if (colCO) colCO.innerHTML = co.length ? co.map(p => renderAssetCard(p, 'completed')).join('') : emptyCol;
}
function renderAssetCard(p, status) {
  const isHigh = p.hasScript && p.videoCount === 0 && status === 'in_progress';
  const isComp = status === 'completed';
  const coverUrl = `/项目/${p.path}/03-成品/cover.svg`;
  const hpBadge = isHigh ? `<div class="asset-hp-badge"><span class="material-symbols-outlined" style="font-size:12px">priority_high</span> HIGH PRIORITY</div>` : '';
  let actions = '';
  if (status === 'in_progress') {
    actions = `<button class="asset-btn asset-btn-ghost" onclick="startRender('${p.name}')"><span class="material-symbols-outlined" style="font-size:16px">refresh</span> Redo</button><button class="asset-btn asset-btn-primary" onclick="generateScript('${p.name}')"><span class="material-symbols-outlined" style="font-size:16px">visibility</span> View</button>`;
  } else if (status === 'video_ready') {
    actions = `<button class="asset-btn asset-btn-ghost" onclick="openCoverEditor('${p.name}')"><span class="material-symbols-outlined" style="font-size:16px">edit</span> Edit</button><button class="asset-btn asset-btn-primary" onclick="openFolder('${p.name}')"><span class="material-symbols-outlined" style="font-size:16px">play_arrow</span> Review</button>`;
  } else {
    actions = `<button class="asset-btn asset-btn-border asset-btn-full" onclick="openFolder('${p.name}')"><span class="material-symbols-outlined" style="font-size:16px">download</span> Download Assets</button>`;
  }
  const readyBadge = status === 'video_ready' ? `<span class="asset-ready-badge">READY</span>` : '';
  return `<div class="asset-card${isComp ? ' completed' : ''}">${hpBadge}<div class="asset-thumb"><img src="${coverUrl}" alt="${p.name}" loading="lazy" onerror="this.style.display='none'"><div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:28px;pointer-events:none"><span class="material-symbols-outlined" style="font-size:28px;color:var(--on-surface-variant)">movie</span></div></div><div><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:4px"><h4 style="font-size:13px;font-weight:600;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.name}</h4>${readyBadge}</div><p style="margin:4px 0 0;font-size:11px;color:var(--on-surface-variant);display:flex;align-items:center;gap:4px"><span class="material-symbols-outlined" style="font-size:14px">movie</span> 1920x1080 • 30fps • ${p.statusLabel}</p></div><div style="display:flex;gap:8px;width:100%;margin-top:4px">${actions}</div></div>`;
}
// Overview mini project list (last 3)
function loadProjectsMini() {
  const projects = S.projects || [];
  const el = $('proj-box-mini');
  if (!el) return;
  if (!projects.length) { el.innerHTML = '<div class="em"><span class="material-symbols-outlined eic" style="font-size:20px;display:block;margin-bottom:6px">folder_off</span><p>No projects</p></div>'; return; }
  const recent = projects.slice(0, 4);
  el.innerHTML = recent.map(function(p) {
    var icon = p.status === 'completed' ? 'check_circle' : (p.status === 'video_ready' ? 'movie' : 'pending');
    var iconColor = p.status === 'completed' ? 'var(--primary-fixed)' : (p.status === 'video_ready' ? 'var(--blueL)' : 'var(--on-surface-variant)');
    return '<div class="flex items-center gap-3 p-2 rounded-lg hover:bg-surface-container-lowest transition-colors" style="border-bottom:1px solid var(--outline-variant)"><span class="material-symbols-outlined" style="font-size:16px;color:' + iconColor + '">' + icon + '</span><div class="flex-1 min-w-0"><div style="font-size:12px;font-weight:500;color:var(--on-surface)">' + escHtml(p.name) + '</div><div style="font-size:10px;color:var(--on-surface-variant)">' + (p.statusLabel || '') + '</div></div></div>';
  }).join('');
}
// Asset board filter
function filterAssets(status) {
  const btns = document.querySelectorAll('#p-assets .capsule-btn');
  btns.forEach(b => b.classList.remove('active'));
  btns.forEach(b => { if (b.textContent.toLowerCase() === status || (status === 'all' && b.textContent === 'All')) b.classList.add('active'); });
  const cols = document.querySelectorAll('#p-assets .kanban-col');
  const map = { in_progress:0, video_ready:1, completed:2 };
  cols.forEach((col, i) => { col.style.display = (status === 'all' || map[status] === i) ? '' : 'none'; });
}

// === Cover Editor Modal ===
function openCoverEditor(slug) {
  const overlay = document.createElement('div');
  overlay.id = 'cover-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center';
  overlay.innerHTML = `<div style="background:#1C1C1E;border:1px solid #38383A;border-radius:16px;padding:28px 32px;width:600px;max-width:90vw">
    <div style="font-size:16px;font-weight:600;margin-bottom:16px">✏️ 编辑封面 — ${slug}</div>
    <div class="fg"><label class="fl">标题1</label><input class="fi" id="ce-tl1" value=""></div>
    <div class="fg"><label class="fl">标题2</label><input class="fi" id="ce-tl2" value=""></div>
    <div class="fg"><label class="fl">副标题</label><input class="fi" id="ce-sub" value=""></div>
    <div class="fg"><label class="fl">特性1</label><input class="fi" id="ce-f1" value=""></div>
    <div class="fg"><label class="fl">特性2</label><input class="fi" id="ce-f2" value=""></div>
    <div class="fg"><label class="fl">特性3</label><input class="fi" id="ce-f3" value=""></div>
    <div class="bg"><button class="btn btn-s btn-p" onclick="saveCover('${slug}')">保存</button><button class="btn btn-s btn-g" onclick="document.getElementById('cover-overlay').remove()">取消</button></div>
  </div>`;
  document.body.appendChild(overlay);
}

async function saveCover(slug) {
  const fields = {
    TITLE_LINE_1: document.getElementById('ce-tl1').value,
    TITLE_LINE_2: document.getElementById('ce-tl2').value,
    SUBTITLE: document.getElementById('ce-sub').value,
    FEATURE_1: document.getElementById('ce-f1').value,
    FEATURE_2: document.getElementById('ce-f2').value,
    FEATURE_3: document.getElementById('ce-f3').value,
  };
  try {
    const r = await fetch('/api/projects/update-cover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, fields }),
    });
    const d = await r.json();
    if (d.ok) { TOAST('✅ 封面已更新'); loadProjects(); } else { TOAST('❌ 更新失败'); }
  } catch(e) { TOAST('❌ Network Error'); }
  document.getElementById('cover-overlay').remove();
}

// === Script Generator Modal ===
async function generateScript(slug) {
  const overlay = document.createElement('div');
  overlay.id = 'script-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center';
  overlay.innerHTML = `<div style="background:#1C1C1E;border:1px solid #38383A;border-radius:16px;padding:24px 28px;width:860px;max-width:90vw;max-height:90vh;display:flex;flex-direction:column">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <div style="font-size:16px;font-weight:600">📜 双重审查中心 — ${slug}</div>
      <span id="script-status" style="font-size:12px;color:#FF9F0A">⏳ 生成中…</span>
    </div>
    
    <div style="display:flex;gap:4px;margin-bottom:12px">
      <button class="btn btn-xs btn-p" id="tab-code" onclick="switchTab('code')">🎬 视频脚本代码</button>
      <button class="btn btn-xs btn-g" id="tab-copy" onclick="switchTab('copy')">✍️ 社交宣发文案</button>
    </div>
    
    <div id="panel-code">
      <textarea id="script-editor" style="width:100%;min-height:400px;padding:16px;border-radius:12px;background:#0A0A0A;border:1px solid #2C2C2E;color:#F5F5F7;font-family:'SF Mono','JetBrains Mono',monospace;font-size:11px;line-height:1.6;resize:vertical;outline:none" wrap="off" placeholder="正在生成…"></textarea>
      <div class="bg" style="margin-top:12px">
        <button class="btn btn-s btn-p" id="script-save-btn" onclick="saveScript('${slug}')">🚀 确认并写入磁盘</button>
      </div>
    </div>
    
    <div id="panel-copy" style="display:none;flex:1;overflow-y:auto">
      <div style="margin-bottom:16px">
        <div style="font-size:13px;font-weight:600;color:#FF375F;margin-bottom:8px">📕 小红书爆款文案</div>
        <div style="background:#0A0A0A;border:1px solid #2C2C2E;border-radius:12px;padding:16px;font-size:13px;line-height:1.6;color:#F5F5F7;white-space:pre-wrap;margin-bottom:8px" id="copy-xiaohongshu"></div>
        <button class="btn btn-xs btn-p" onclick="copyToClip('copy-xiaohongshu')">📋 点击复制</button>
      </div>
      <div style="border-top:1px solid #2C2C2E;padding-top:16px">
        <div style="font-size:13px;font-weight:600;color:#FF9F0A;margin-bottom:8px">🎵 抖音/B站宣传语</div>
        <div style="background:#0A0A0A;border:1px solid #2C2C2E;border-radius:12px;padding:16px;font-size:13px;line-height:1.6;color:#F5F5F7;white-space:pre-wrap;margin-bottom:8px" id="copy-douyin"></div>
        <button class="btn btn-xs btn-p" onclick="copyToClip('copy-douyin')">📋 点击复制</button>
      </div>
    </div>
    <div class="bg" style="margin-top:12px">
      <button class="btn btn-s btn-g" onclick="document.getElementById('script-overlay').remove()">关闭</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);

  try {
    const r = await fetch('/api/projects/generate-blueprint', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, topic: slug }),
    });
    const d = await r.json();
    if (d.ok && d.html) {
      document.getElementById('script-editor').value = d.html;
      // 填充文案
      if (d.copy) {
        const x = d.copy.xiaohongshu;
        document.getElementById('copy-xiaohongshu').textContent =
          `【标题】${x.title}\n\n${x.body}\n\n${x.tags}`;
        const y = d.copy.douyin;
        document.getElementById('copy-douyin').textContent =
          `【标题】${y.title}\n\n${y.body}\n\n${y.tags}`;
      }
      document.getElementById('script-status').textContent = '✅ Generated';
    } else {
      document.getElementById('script-status').textContent = '❌ Failed';
      document.getElementById('script-editor').value = '// Generation failed, retry';
    }
  } catch(e) {
    document.getElementById('script-status').textContent = '❌ 网络错误';
    document.getElementById('script-editor').value = '// Network error:' + e.message;
  }
}

async function saveScript(slug) {
  const btn = document.getElementById('script-save-btn');
  const html_content = document.getElementById('script-editor').value;
  // 从文案 tab 收集已编辑的文案内容
  const copyContent = [];
  const xhsEl = document.getElementById('copy-xiaohongshu');
  const dyEl = document.getElementById('copy-douyin');
  if (xhsEl && dyEl) {
    copyContent.push('## Xiaohongshu\n');
    copyContent.push(xhsEl.textContent + '\n');
    copyContent.push('---\n');
    copyContent.push('## Douyin\n');
    copyContent.push(dyEl.textContent + '\n');
  }
  btn.textContent = '保存中…'; btn.disabled = true;
  try {
    const r = await fetch('/api/projects/save-script', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, html_content, copy_content: copyContent.join('\n') }),
    });
    const d = await r.json();
    if (d.ok) { TOAST('✅ 剧本已写入磁盘'); document.getElementById('script-overlay').remove(); loadProjects(); }
    else { TOAST('❌ 保存失败: ' + (d.error || '未知错误')); }
  } catch(e) { TOAST('❌ 网络错误'); }
  btn.textContent = '🚀 Confirm & Save'; btn.disabled = false;
}

// === Tab Switching ===
function switchTab(tab) {
  document.getElementById('panel-code').style.display = tab === 'code' ? 'block' : 'none';
  document.getElementById('panel-copy').style.display = tab === 'copy' ? 'block' : 'none';
  document.getElementById('tab-code').className = 'btn btn-xs ' + (tab === 'code' ? 'btn-p' : 'btn-g');
  document.getElementById('tab-copy').className = 'btn btn-xs ' + (tab === 'copy' ? 'btn-p' : 'btn-g');
}

// === Copy To Clipboard ===
function copyToClip(elementId) {
  const el = document.getElementById(elementId);
  if (!el) return;
  navigator.clipboard.writeText(el.textContent).then(() => {
    TOAST('📋 已复制到剪贴板');
  }).catch(() => {
    // 降级方案
    const ta = document.createElement('textarea');
    ta.value = el.textContent;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    TOAST('📋 已复制到剪贴板');
  });
}

// === Phase 4.2: 渲染自动化 ===
async function startRender(slug) {
  const btn = $(`render-btn-${slug}`);
  if (!btn) return;
  btn.textContent = '💿 渲染中…'; btn.disabled = true;
  try {
    const r = await fetch('/api/projects/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug }),
    });
    const d = await r.json();
    if (d.ok && d.status === 'rendering') {
      TOAST(`🎬 渲染已启动: ${slug}`);
      // 开始轮询渲染状态
      const pollTimer = setInterval(async () => {
        try {
          const pr = await fetch(`/api/projects/render-status/${slug}`);
          const pd = await pr.json();
          if (pd.status === 'completed') {
            clearInterval(pollTimer);
            const statusLabel = $(`label-${slug}`);
            if (statusLabel) statusLabel.textContent = '✅ Complete';
            btn.textContent = '🎬 Start Render';
            btn.disabled = false;
            TOAST(`✅ 渲染完成! ${pd.output || ''}`);
            loadProjects(); // 刷新列表
          } else if (pd.status === 'failed') {
            clearInterval(pollTimer);
            btn.textContent = '🎬 开始渲染';
            btn.disabled = false;
            TOAST('❌ 渲染失败: ' + (pd.error || '未知错误'));
          }
        } catch(e) { /* 继续轮询 */ }
      }, 3000);
    } else {
      TOAST('❌ 启动渲染失败');
      btn.textContent = '🎬 开始渲染'; btn.disabled = false;
    }
  } catch(e) {
    TOAST('❌ 网络错误'); btn.textContent = '🎬 开始渲染'; btn.disabled = false;
  }
}

// === Phase 4.3: 一键打开文件夹 ===
async function openFolder(slug) {
  try {
    await fetch('/api/projects/open-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, sub: '03-成品' }),
    });
  } catch(e) { /* 静默失败 */ }
}


// === Phase 6.1: 一键归档 ===
async function archiveProject(slug) {
  if (!confirm('Archive project ' + slug + '? This will move files to 03-Finished/ and generate records.')) return;
  const btn=document.querySelector(`[onclick*="archiveProject('${slug}')"]`);
  if(btn){btn.textContent='📦 归档中…';btn.disabled=true;}
  try {
    const r=await fetch('/api/projects/archive',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({slug})
    });
    const d=await r.json();
    if(d.ok){TOAST('✅ 归档完成: '+slug);loadProjects();}
    else{TOAST('❌ 归档失败');}
  }catch(e){TOAST('❌ 网络错误');}
  if(btn){btn.textContent='📦 Archive';btn.disabled=false;}
}
// === Init ===
$('td').textContent = T(); css(); refresh();
 + Number(creatorVal).toLocaleString();
async function ch() { const t = T(); S.hotTopics = S.hotTopics.filter(h => h.date !== t); S.autoTopics = S.autoTopics.filter(h => h.date !== t); await saveAll({ hotTopics: S.hotTopics }); rh(); TOAST('已清空今日热点'); }
async function tf() {
  const btn = $('ft-btn'); btn.textContent = '抓取中…'; btn.disabled = true;
  try {
    const r = await fetch('/api/trigger-fetch', { method: 'POST' });
    if (!r.ok) { TOAST('❌服务器 ' + r.status); btn.textContent = '立即抓取'; btn.disabled = false; return; }
    const d = await r.json();
    if (d.ok) { TOAST(`✅抓到 ${d.fetched} 条，正在刷新…`); refresh(); }
    else { TOAST('❌返回异常'); }
  } catch(e) { TOAST('❌网络错误'); }
  btn.textContent = '立即抓取'; btn.disabled = false;
}
async function gb() {
  const r = await fetch('/api/brief/generate', { method: 'POST' }); const d = await r.json();
  if (!d.brief) { alert('暂无热点'); return; }
  const b = d.brief;
  $('brief-body').innerHTML = `<div style="font-size:11px;color:var(--text2);margin-bottom:10px">基于${b.hotCount}条热点</div>${b.suggestions.map(s => `<div class="bi"><div class="bt">${s.title}</div><div class="bd2">热度${s.hot}/5</div><div class="fr" style="margin-top:6px"><button class="btn btn-xs btn-p" onclick="pb('${s.title.replace(/'/g,"\\'")}',${s.hot},3,3,3,'${s.type}','both')">以此选题</button></div></div>`).join('')}`;
  $('brief-box').style.display = 'block';
}

// === Recommendations ===
window._rl = false;
async function loadRecs() {
  window._rl = true;
  try {
    const r = await fetch('/api/today/recommend', { method: 'POST' }); const d = await r.json();
    if (!d.recommendations || !d.recommendations.length) { $('rc-box').innerHTML = EMPTY('暂无推荐'); $('hrc-box').innerHTML = EMPTY('暂无推荐'); return; }
    $('rc-ct').textContent = `${d.total}条·P0:${d.groups.p0} P1:${d.groups.p1}`; $('hrc-ct').textContent = `${d.total}条·P0:${d.groups.p0} P1:${d.groups.p1}`;
    const html = mkRecs(d.recommendations); $('rc-box').innerHTML = html; $('hrc-box').innerHTML = html;
  } catch(e) { $('rc-box').innerHTML = EMPTY('分析失败'); $('hrc-box').innerHTML = EMPTY('分析失败'); }
}
function mkRecs(r) {
  const fn = {'remotion-demo':'R演示','remotion-compare':'R对比','hyperframes-text':'HF文','hyperframes-narrate':'HF配'}, sn = {github:'GitHub',hackernews:'HN',toutiao:'头条'}, pf2 = {douyin:'🎵抖音',xiaohongshu:'📕小红书',both:'🎵📕'};
  const p0 = r.filter(x => x.pri === 'P0'), p1 = r.filter(x => x.pri === 'P1'), rs = r.filter(x => x.pri !== 'P0' && x.pri !== 'P1');
  let h = '';
  if (p0.length) { h += `<div style="margin-bottom:8px">${TAG('P0·Today','r')}<span style="font-size:10px;color:var(--text3);margin-left:6px">${p0.length}个</span></div>` + p0.map(x => rc(x, fn, sn, pf2)).join(''); }
  if (p1.length) { h += `<div style="margin:12px 0 8px">${TAG('P1·This Week','o')}<span style="font-size:10px;color:var(--text3);margin-left:6px">${p1.length}个</span></div>` + p1.map(x => rc(x, fn, sn, pf2)).join(''); }
  if (rs.length) { h += `<div style="margin:10px 0 4px"><span style="font-size:10px;color:var(--text3)">其余</span></div>` + rs.slice(0,3).map(x => `<div class="hi" style="opacity:.45"><div class="hb"><div class="ht" style="font-size:11px">${x.title}</div><div class="hm"><span>${x.score}分·${x.pri}</span><span>${x.reason}</span></div></div></div>`).join(''); }
  return h;
}
function rc(x, fn, sn, pf2) {
  const ua = x.url ? `href="${x.url}" target="_blank"` : '';
  return `<div class="bi"><div style="display:flex;align-items:flex-start;gap:10px"><div style="flex:1;min-width:0"><div class="bt">${ua?`<a ${ua} style="color:inherit;text-decoration:none" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">${x.title}</a>`:x.title}</div><div class="bd2" style="margin-top:2px">${TAG(sn[x.source]||x.source,x.source==='github'?'b':'o')} ${TAG(pf2[x.platform]||'双平台',x.platform==='douyin'?'p':x.platform==='xiaohongshu'?'o':'gray')} ${x.trend?x.trend.slice(0,30):''}</div></div><div style="text-align:center;flex-shrink:0"><div class="sn ${SC(x.score)}">${x.score}</div><div>${TAG(x.pri,x.pri==='P0'?'r':'o')}</div></div></div><div style="display:flex;gap:6px;margin:4px 0 2px;font-size:9px;color:var(--text3)">🔥${x.hotScore}🧱${x.wallScore}⏳${x.durScore}💰${x.moneyScore}</div><div style="font-size:10px;color:var(--text2);line-height:1.4">${x.reason}</div><div class="fr" style="margin-top:5px">${TAG(fn[x.format]||x.format,'gray')}<button class="btn btn-xs btn-p" onclick="pb('${x.title.replace(/'/g,"\\'")} 教程',${x.hotScore},${x.wallScore},${x.durScore},${x.moneyScore},'${x.format}','${x.platform||'both'}')">以此选题</button><button class="btn btn-xs btn-g" onclick="pb('${x.title.replace(/'/g,"\\'")} 解读',${x.hotScore},${x.wallScore},${x.durScore},${x.moneyScore},'hyperframes-text','${x.platform||'both'}')">解读</button></div></div>`;
}

// === Topic Matrix ===
async function loadProjects() {
  try {
    const r = await fetch("/api/projects");
    const d = await r.json();
    const el = $("proj-box");
    if (!d.projects || !d.projects.length) { el.innerHTML = EMPTY("暂无项目"); return; }
    const order = { completed: 0, video_ready: 1, in_progress: 2 };
    const sorted = d.projects.sort((a, b) => (order[a.status] || 9) - (order[b.status] || 9));
    const statusStyle = { completed:"color:#34D399;font-weight:700", video_ready:"color:#A78BFA;font-weight:600", in_progress:"color:#F59E0B;font-weight:600" };
    el.innerHTML = `<div style="display:flex;flex-direction:column;gap:0">` +
      sorted.map(p => {
        const icon = p.status === "completed" ? "check_circle" : p.status === "video_ready" ? "movie" : "pending";
    const iconColor = p.status === "completed" ? "var(--primary-fixed)" : p.status === "video_ready" ? "var(--blueL)" : "var(--on-surface-variant)";
    const st = statusStyle[p.status] || "color:#636366";
    const videoBadge = p.videoCount > 0 ? '<span class="tag t-b" style="font-size:10px;padding:2px 8px;margin-right:4px"><span class="material-symbols-outlined" style="font-size:10px;vertical-align:middle">movie</span> ' + p.videoCount + '</span>' : '<span class="tag t-gray" style="font-size:10px;padding:2px 8px;margin-right:4px"><span class="material-symbols-outlined" style="font-size:10px;vertical-align:middle">videocam_off</span> 0</span>';
    const coverBadge = p.hasCover ? '<span class="tag t-g" style="font-size:10px;padding:2px 8px;margin-right:4px"><span class="material-symbols-outlined" style="font-size:10px;vertical-align:middle">wallpaper</span> Ready</span>' : '<span class="tag t-gray" style="font-size:10px;padding:2px 8px;margin-right:4px"><span class="material-symbols-outlined" style="font-size:10px;vertical-align:middle">broken_image</span> Missing</span>';
    const copyBadge = p.hasCopy ? '<span class="tag t-g" style="font-size:10px;padding:2px 8px"><span class="material-symbols-outlined" style="font-size:10px;vertical-align:middle">description</span> Ready</span>' : '<span class="tag t-gray" style="font-size:10px;padding:2px 8px"><span class="material-symbols-outlined" style="font-size:10px;vertical-align:middle">description</span> Missing</span>';
    const hs = p.hasScript, hc = p.hasCover, hv = p.videoCount > 0;
    const needScript = !hs; const needRender = hs && !hv; const needCover = hv && !hc;
    let sb = hs ? '<button class="btn btn-xs btn-g" onclick="generateScript(\'' + p.name + '\')"><span class="material-symbols-outlined" style="font-size:10px;vertical-align:middle">visibility</span> View Script</button><button class="btn btn-xs btn-g" onclick="generateScript(\'' + p.name + '\')"><span class="material-symbols-outlined" style="font-size:10px;vertical-align:middle">refresh</span> Rewrite</button>' : '<button class="btn btn-xs btn-p" onclick="generateScript(\'' + p.name + '\')"><span class="material-symbols-outlined" style="font-size:10px;vertical-align:middle">auto_awesome</span> Generate Script</button>';
    let cb = hc ? '<button class="btn btn-xs btn-g" onclick="openCoverEditor(\'' + p.name + '\')"><span class="material-symbols-outlined" style="font-size:10px;vertical-align:middle">visibility</span> View Cover</button><button class="btn btn-xs btn-g" onclick="openCoverEditor(\'' + p.name + '\')"><span class="material-symbols-outlined" style="font-size:10px;vertical-align:middle">refresh</span> Redo</button>' : '<button class="btn btn-xs btn-p" onclick="openCoverEditor(\'' + p.name + '\')"><span class="material-symbols-outlined" style="font-size:10px;vertical-align:middle">palette</span> Generate Cover</button>';
    let rb;
    if (hv) { rb = '<button class="btn btn-xs btn-g" id="render-btn-' + p.name + '" onclick="startRender(\'' + p.name + '\')"><span class="material-symbols-outlined" style="font-size:10px;vertical-align:middle">refresh</span> Re-render</button>'; }
    else if (hs) { rb = '<button class="btn btn-xs btn-p" id="render-btn-' + p.name + '" onclick="startRender(\'' + p.name + '\')"><span class="material-symbols-outlined" style="font-size:10px;vertical-align:middle">movie</span> Start Render</button>'; }
    else { rb = '<button class="btn btn-xs btn-g" id="render-btn-' + p.name + '" disabled><span class="material-symbols-outlined" style="font-size:10px;vertical-align:middle">movie</span> Start Render</button>'; }
        if (needScript) { cb = cb.replace(/btn btn-xs btn-p/g,"btn btn-xs btn-g"); rb = rb.replace(/btn btn-xs btn-p/g,"btn btn-xs btn-g"); }
        else if (needRender) { sb = sb.replace(/btn btn-xs btn-p/g,"btn btn-xs btn-g"); cb = cb.replace(/btn btn-xs btn-p/g,"btn btn-xs btn-g"); }
        else if (needCover) { sb = sb.replace(/btn btn-xs btn-p/g,"btn btn-xs btn-g"); rb = rb.replace(/btn btn-xs btn-p/g,"btn btn-xs btn-g"); }
        else { sb = sb.replace(/btn btn-xs btn-p/g,"btn btn-xs btn-g"); cb = cb.replace(/btn btn-xs btn-p/g,"btn btn-xs btn-g"); rb = rb.replace(/btn btn-xs btn-p/g,"btn btn-xs btn-g"); }
        const fb = '<button class="btn btn-xs btn-g" onclick="openFolder(\'' + p.name + '\')"><span class="material-symbols-outlined" style="font-size:10px;vertical-align:middle">folder_open</span> Open Folder</button>';
        const canArchive = hv && hc;
        const archiveBtn = canArchive ? '<button class="btn btn-xs btn-g" onclick="archiveProject(\'' + p.name + '\')"><span class="material-symbols-outlined" style="font-size:10px;vertical-align:middle">archive</span> Archive</button>' : '';
        return `<div class="hi" style="padding:12px 0"><div class="hr rn" style="font-size:16px">${icon}</div><div class="hb"><div class="ht" style="font-size:14px;font-weight:600" id="status-${p.name}">${p.name}</div><div class="hm" style="margin-top:4px"><span id="label-${p.name}" style="${st};font-size:13px">${p.statusLabel}</span><span style="margin-left:8px">${videoBadge}${coverBadge}${copyBadge}</span></div><div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;align-items:center">${sb}${cb}${rb}${fb}${archiveBtn}</div></div></div>`;
      }).join('') + `</div>`;
  } catch(e) { $('proj-box').innerHTML = EMPTY('加载失败'); }
}

// === Cover Editor Modal ===
function openCoverEditor(slug) {
  const overlay = document.createElement('div');
  overlay.id = 'cover-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center';
  overlay.innerHTML = `<div style="background:#1C1C1E;border:1px solid #38383A;border-radius:16px;padding:28px 32px;width:600px;max-width:90vw">
    <div style="font-size:16px;font-weight:600;margin-bottom:16px">✏️ 编辑封面 — ${slug}</div>
    <div class="fg"><label class="fl">标题1</label><input class="fi" id="ce-tl1" value=""></div>
    <div class="fg"><label class="fl">标题2</label><input class="fi" id="ce-tl2" value=""></div>
    <div class="fg"><label class="fl">副标题</label><input class="fi" id="ce-sub" value=""></div>
    <div class="fg"><label class="fl">特性1</label><input class="fi" id="ce-f1" value=""></div>
    <div class="fg"><label class="fl">特性2</label><input class="fi" id="ce-f2" value=""></div>
    <div class="fg"><label class="fl">特性3</label><input class="fi" id="ce-f3" value=""></div>
    <div class="bg"><button class="btn btn-s btn-p" onclick="saveCover('${slug}')">保存</button><button class="btn btn-s btn-g" onclick="document.getElementById('cover-overlay').remove()">取消</button></div>
  </div>`;
  document.body.appendChild(overlay);
}

async function saveCover(slug) {
  const fields = {
    TITLE_LINE_1: document.getElementById('ce-tl1').value,
    TITLE_LINE_2: document.getElementById('ce-tl2').value,
    SUBTITLE: document.getElementById('ce-sub').value,
    FEATURE_1: document.getElementById('ce-f1').value,
    FEATURE_2: document.getElementById('ce-f2').value,
    FEATURE_3: document.getElementById('ce-f3').value,
  };
  try {
    const r = await fetch('/api/projects/update-cover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, fields }),
    });
    const d = await r.json();
    if (d.ok) { TOAST('✅ 封面已更新'); loadProjects(); } else { TOAST('❌ 更新失败'); }
  } catch(e) { TOAST('❌ 网络错误'); }
  document.getElementById('cover-overlay').remove();
}

// === Script Generator Modal ===
async function generateScript(slug) {
  const overlay = document.createElement('div');
  overlay.id = 'script-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center';
  overlay.innerHTML = `<div style="background:#1C1C1E;border:1px solid #38383A;border-radius:16px;padding:24px 28px;width:860px;max-width:90vw;max-height:90vh;display:flex;flex-direction:column">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <div style="font-size:16px;font-weight:600">📜 双重审查中心 — ${slug}</div>
      <span id="script-status" style="font-size:12px;color:#FF9F0A">⏳ 生成中…</span>
    </div>
    
    <div style="display:flex;gap:4px;margin-bottom:12px">
      <button class="btn btn-xs btn-p" id="tab-code" onclick="switchTab('code')">🎬 视频脚本代码</button>
      <button class="btn btn-xs btn-g" id="tab-copy" onclick="switchTab('copy')">✍️ 社交宣发文案</button>
    </div>
    
    <div id="panel-code">
      <textarea id="script-editor" style="width:100%;min-height:400px;padding:16px;border-radius:12px;background:#0A0A0A;border:1px solid #2C2C2E;color:#F5F5F7;font-family:'SF Mono','JetBrains Mono',monospace;font-size:11px;line-height:1.6;resize:vertical;outline:none" wrap="off" placeholder="正在生成…"></textarea>
      <div class="bg" style="margin-top:12px">
        <button class="btn btn-s btn-p" id="script-save-btn" onclick="saveScript('${slug}')">🚀 确认并写入磁盘</button>
      </div>
    </div>
    
    <div id="panel-copy" style="display:none;flex:1;overflow-y:auto">
      <div style="margin-bottom:16px">
        <div style="font-size:13px;font-weight:600;color:#FF375F;margin-bottom:8px">📕 小红书爆款文案</div>
        <div style="background:#0A0A0A;border:1px solid #2C2C2E;border-radius:12px;padding:16px;font-size:13px;line-height:1.6;color:#F5F5F7;white-space:pre-wrap;margin-bottom:8px" id="copy-xiaohongshu"></div>
        <button class="btn btn-xs btn-p" onclick="copyToClip('copy-xiaohongshu')">📋 点击复制</button>
      </div>
      <div style="border-top:1px solid #2C2C2E;padding-top:16px">
        <div style="font-size:13px;font-weight:600;color:#FF9F0A;margin-bottom:8px">🎵 抖音/B站宣传语</div>
        <div style="background:#0A0A0A;border:1px solid #2C2C2E;border-radius:12px;padding:16px;font-size:13px;line-height:1.6;color:#F5F5F7;white-space:pre-wrap;margin-bottom:8px" id="copy-douyin"></div>
        <button class="btn btn-xs btn-p" onclick="copyToClip('copy-douyin')">📋 点击复制</button>
      </div>
    </div>
    <div class="bg" style="margin-top:12px">
      <button class="btn btn-s btn-g" onclick="document.getElementById('script-overlay').remove()">关闭</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);

  try {
    const r = await fetch('/api/projects/generate-blueprint', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, topic: slug }),
    });
    const d = await r.json();
    if (d.ok && d.html) {
      document.getElementById('script-editor').value = d.html;
      // 填充文案
      if (d.copy) {
        const x = d.copy.xiaohongshu;
        document.getElementById('copy-xiaohongshu').textContent =
          `【标题】${x.title}\n\n${x.body}\n\n${x.tags}`;
        const y = d.copy.douyin;
        document.getElementById('copy-douyin').textContent =
          `【标题】${y.title}\n\n${y.body}\n\n${y.tags}`;
      }
      document.getElementById('script-status').textContent = '✅ 已生成';
    } else {
      document.getElementById('script-status').textContent = '❌ 生成失败';
      document.getElementById('script-editor').value = '// 生成失败，请重试';
    }
  } catch(e) {
    document.getElementById('script-status').textContent = '❌ 网络错误';
    document.getElementById('script-editor').value = '// 网络错误：' + e.message;
  }
}

async function saveScript(slug) {
  const btn = document.getElementById('script-save-btn');
  const html_content = document.getElementById('script-editor').value;
  // 从文案 tab 收集已编辑的文案内容
  const copyContent = [];
  const xhsEl = document.getElementById('copy-xiaohongshu');
  const dyEl = document.getElementById('copy-douyin');
  if (xhsEl && dyEl) {
    copyContent.push('## 小红书版\n');
    copyContent.push(xhsEl.textContent + '\n');
    copyContent.push('---\n');
    copyContent.push('## 抖音版\n');
    copyContent.push(dyEl.textContent + '\n');
  }
  btn.textContent = '保存中…'; btn.disabled = true;
  try {
    const r = await fetch('/api/projects/save-script', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, html_content, copy_content: copyContent.join('\n') }),
    });
    const d = await r.json();
    if (d.ok) { TOAST('✅ 剧本已写入磁盘'); document.getElementById('script-overlay').remove(); loadProjects(); }
    else { TOAST('❌ 保存失败: ' + (d.error || '未知错误')); }
  } catch(e) { TOAST('❌ 网络错误'); }
  btn.textContent = '🚀 确认并写入磁盘'; btn.disabled = false;
}

// === Tab Switching ===
function switchTab(tab) {
  document.getElementById('panel-code').style.display = tab === 'code' ? 'block' : 'none';
  document.getElementById('panel-copy').style.display = tab === 'copy' ? 'block' : 'none';
  document.getElementById('tab-code').className = 'btn btn-xs ' + (tab === 'code' ? 'btn-p' : 'btn-g');
  document.getElementById('tab-copy').className = 'btn btn-xs ' + (tab === 'copy' ? 'btn-p' : 'btn-g');
}

// === Copy To Clipboard ===
function copyToClip(elementId) {
  const el = document.getElementById(elementId);
  if (!el) return;
  navigator.clipboard.writeText(el.textContent).then(() => {
    TOAST('📋 已复制到剪贴板');
  }).catch(() => {
    // 降级方案
    const ta = document.createElement('textarea');
    ta.value = el.textContent;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    TOAST('📋 已复制到剪贴板');
  });
}

// === Phase 4.2: 渲染自动化 ===
async function startRender(slug) {
  const btn = $(`render-btn-${slug}`);
  if (!btn) return;
  btn.textContent = '💿 渲染中…'; btn.disabled = true;
  try {
    const r = await fetch('/api/projects/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug }),
    });
    const d = await r.json();
    if (d.ok && d.status === 'rendering') {
      TOAST(`🎬 渲染已启动: ${slug}`);
      // 开始轮询渲染状态
      const pollTimer = setInterval(async () => {
        try {
          const pr = await fetch(`/api/projects/render-status/${slug}`);
          const pd = await pr.json();
          if (pd.status === 'completed') {
            clearInterval(pollTimer);
            const statusLabel = $(`label-${slug}`);
            if (statusLabel) statusLabel.textContent = '✅ 已完成';
            btn.textContent = '🎬 开始渲染';
            btn.disabled = false;
            TOAST(`✅ 渲染完成! ${pd.output || ''}`);
            loadProjects(); // 刷新列表
          } else if (pd.status === 'failed') {
            clearInterval(pollTimer);
            btn.textContent = '🎬 开始渲染';
            btn.disabled = false;
            TOAST('❌ 渲染失败: ' + (pd.error || '未知错误'));
          }
        } catch(e) { /* 继续轮询 */ }
      }, 3000);
    } else {
      TOAST('❌ 启动渲染失败');
      btn.textContent = '🎬 开始渲染'; btn.disabled = false;
    }
  } catch(e) {
    TOAST('❌ 网络错误'); btn.textContent = '🎬 开始渲染'; btn.disabled = false;
  }
}

// === Phase 4.3: 一键打开文件夹 ===
async function openFolder(slug) {
  try {
    await fetch('/api/projects/open-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, sub: '03-成品' }),
    });
  } catch(e) { /* 静默失败 */ }
}


// === Phase 6.1: 一键归档 ===
async function archiveProject(slug) {
  if (!confirm('Archive project ' + slug + '? This will move files to 03-Finished/ and generate records.')) return;
  const btn=document.querySelector(`[onclick*="archiveProject('${slug}')"]`);
  if(btn){btn.textContent='📦 归档中…';btn.disabled=true;}
  try {
    const r=await fetch('/api/projects/archive',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({slug})
    });
    const d=await r.json();
    if(d.ok){TOAST('✅ 归档完成: '+slug);loadProjects();}
    else{TOAST('❌ 归档失败');}
  }catch(e){TOAST('❌ 网络错误');}
  if(btn){btn.textContent='📦 一键归档';btn.disabled=false;}
}
// === Init ===
$('td').textContent = T(); css(); refresh();



function buildPipeline(id) { TOAST('🔧 Pipeline builder - coming soon'); }
