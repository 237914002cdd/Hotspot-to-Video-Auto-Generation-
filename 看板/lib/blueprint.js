'use strict';

const THEMES = ['midnight', 'paper', 'lime'];
const ASPECTS = { '9:16': [720, 1280], '16:9': [1280, 720], '1:1': [900, 900] };
function invalid(message) { const error = new Error(message); error.status = 400; return error; }
function text(value, max, label, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw invalid(`${label}需要${required ? '非空' : ''}文本，最多 ${max} 字`);
  return value.trim();
}
function validateStoryboard(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid('分镜必须是对象');
  const title = text(input.title, 120, '视频标题', true);
  const aspect = input.aspect || '9:16', theme = input.theme || 'midnight';
  if (!Object.hasOwn(ASPECTS, aspect) || !THEMES.includes(theme)) throw invalid('不支持的画幅或主题');
  if (!Array.isArray(input.scenes) || input.scenes.length < 1 || input.scenes.length > 12) throw invalid('需要 1–12 个分镜');
  const scenes = input.scenes.map((s, i) => {
    if (!s || typeof s !== 'object') throw invalid(`分镜 ${i + 1} 格式错误`);
    if (typeof s.duration !== 'number' || !Number.isFinite(s.duration) || s.duration < 2 || s.duration > 15) throw invalid(`分镜 ${i + 1} 时长需为 2–15 秒`);
    const title = text(s.title, 80, `分镜 ${i + 1} 标题`, true).replace(/\s+/g, ' ');
    const body = text(s.body || '', 260, `分镜 ${i + 1} 正文`).replace(/\r\n?/g, '\n');
    if (body.split('\n').length > 6) throw invalid(`分镜 ${i + 1} 正文最多 6 行，请拆分镜头`);
    return { title, body, duration: Math.round(s.duration * 10) / 10 };
  });
  if (scenes.reduce((n, s) => n + s.duration, 0) > 120) throw invalid('视频总时长不得超过 120 秒');
  return { version: 1, title, aspect, theme, scenes };
}
function cleanLine(s) { return s.replace(/^\s*(?:#{1,6}\s+|[-*>]\s+|\d+[.、]\s*)/, '').replace(/\*\*/g, '').trim(); }
function makeBlueprint({ title, plan = '', storyboard }) {
  title = text(title, 120, '标题', true);
  plan = text(plan, 50000, '内容方案');
  const lines = plan.split(/\r?\n/).map(cleanLine).filter(s => s && !/^---$|^```/.test(s) && s !== title);
  const chunks = [];
  for (const line of lines) {
    for (let i = 0; i < line.length; i += 240) chunks.push(line.slice(i, i + 240));
  }
  if (!storyboard && chunks.length > (title.length > 80 ? 11 : 12)) throw invalid('方案超出单条视频的 12 镜头容量，请精简方案或分成多个项目；原文已保留。');
  const scenes = [{ title: title.slice(0, 80), body: title.length > 80 ? title.slice(80) : (chunks.shift() || ''), duration: 5 }];
  for (const chunk of chunks) scenes.push({ title: `内容 ${scenes.length + 1}`, body: chunk, duration: 6 });
  const board = validateStoryboard(storyboard || { title, aspect: '9:16', theme: 'midnight', scenes });
  const body = board.scenes.map(s => [s.title, s.body].filter(Boolean).join('\n')).join('\n\n');
  return {
    mode: 'template', needsReview: true, storyboard: board,
    html_content: renderHtml(board),
    copy_content: `# ${title}\n\n## 抖音发布文案（待审核）\n\n${body}\n\n## 小红书发布文案（待审核）\n\n${body}\n\n<!-- 模板根据你提供的内容排版，未进行事实核验或调用语言模型。 -->\n`,
  };
}
function escape(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function renderHtml(input) {
  const board = validateStoryboard(input), [width, height] = ASPECTS[board.aspect];
  const duration = board.scenes.reduce((n, s) => n + s.duration, 0);
  const data = JSON.stringify(board).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const landscape = board.aspect === '16:9';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(board.title)}</title><style>
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#111510;font-family:"Microsoft YaHei","Noto Sans CJK SC",system-ui,sans-serif}#stage{position:absolute;width:${width}px;height:${height}px;transform-origin:top left;overflow:hidden;background:var(--bg);color:var(--fg);--bg:#101610;--fg:#f7faef;--muted:#b1bca6;--accent:#c8f252;--panel:#1f281b}#stage.paper{--bg:#f4f1e9;--fg:#20271d;--muted:#67705d;--accent:#658b1e;--panel:#e5e7dc}#stage.lime{--bg:#c8f252;--fg:#172310;--muted:#435429;--accent:#172310;--panel:#b7df45}.orb{position:absolute;right:-160px;top:-150px;width:640px;height:640px;border-radius:50%;border:1px solid var(--accent);opacity:.18}.orb.two{width:790px;height:790px;right:-240px;top:-220px}.header{position:absolute;top:6%;left:8%;right:8%;font-size:18px;letter-spacing:3px;display:flex;justify-content:space-between;color:var(--muted)}.dot{display:inline-block;width:10px;height:10px;background:var(--accent);border-radius:50%;margin-right:10px}.content{position:absolute;left:8%;right:8%;top:${landscape ? '22' : '26'}%;}.eyebrow{font-size:20px;color:var(--accent);letter-spacing:4px;margin-bottom:32px}.title{font-size:${landscape ? '64' : '62'}px;line-height:1.24;letter-spacing:-1px;font-weight:800;overflow-wrap:anywhere;white-space:pre-line}.body{margin-top:32px;padding-top:28px;border-top:1px solid var(--muted);font-size:${landscape ? '28' : '32'}px;line-height:1.7;color:var(--muted);white-space:pre-line;overflow-wrap:anywhere}.footer{position:absolute;left:8%;right:8%;bottom:7%;display:flex;align-items:center;gap:22px;font-size:16px;color:var(--muted)}.bar{flex:1;height:3px;background:var(--panel)}.fill{height:100%;background:var(--accent);width:0}.number{font-size:14px;letter-spacing:2px}
</style></head><body><div id="stage" class="${board.theme}"><div class="orb"></div><div class="orb two"></div><header class="header"><span><i class="dot"></i>PIPELINE STUDIO</span><span id="count"></span></header><main class="content" id="content"><div class="eyebrow" id="chapter"></div><div class="title" id="title"></div><div class="body" id="body"></div></main><footer class="footer"><span class="number" id="time"></span><div class="bar"><div class="fill" id="fill"></div></div><span>${escape(board.aspect)}</span></footer></div><script>
const board=${data}, total=${duration}, stage=document.getElementById('stage');
function resize(){const scale=Math.min(innerWidth/${width},innerHeight/${height});stage.style.transform='scale('+scale+')';stage.style.left=((innerWidth-${width}*scale)/2)+'px';stage.style.top=((innerHeight-${height}*scale)/2)+'px'}
window.seek=function(t){t=Math.max(0,Math.min(Number(t)||0,total-.001));let offset=0,index=0;for(let i=0;i<board.scenes.length;i++){index=i;if(t<offset+board.scenes[i].duration)break;offset+=board.scenes[i].duration}const s=board.scenes[index],local=t-offset;document.getElementById('count').textContent=String(index+1).padStart(2,'0')+' / '+String(board.scenes.length).padStart(2,'0');document.getElementById('chapter').textContent='CHAPTER '+String(index+1).padStart(2,'0');document.getElementById('title').textContent=s.title;document.getElementById('body').textContent=s.body;document.getElementById('body').style.display=s.body?'':'none';const content=document.getElementById('content');let titleSize=${landscape ? '64' : '62'},bodySize=${landscape ? '28' : '32'};document.getElementById('title').style.fontSize=titleSize+'px';document.getElementById('body').style.fontSize=bodySize+'px';while(content.offsetHeight>${height * (landscape ? .6 : .59)}&&(bodySize>16||titleSize>28)){titleSize=Math.max(28,titleSize-2);bodySize=Math.max(16,bodySize-1);document.getElementById('title').style.fontSize=titleSize+'px';document.getElementById('body').style.fontSize=bodySize+'px'}const enter=Math.min(1,local/.4),exit=Math.min(1,(s.duration-local)/.25);content.style.opacity=String(.15+.85*Math.min(enter,exit));content.style.transform='translateY('+((1-enter)*24)+'px)';document.getElementById('fill').style.width=(t/total*100)+'%';document.getElementById('time').textContent=Math.floor(t).toString().padStart(2,'0')+' / '+Math.ceil(total)+'s';};
resize();addEventListener('resize',resize);window.seek(0);let start;function animate(now){if(!window.__RENDER_MODE__){start??=now;window.seek(((now-start)/1000)%total)}requestAnimationFrame(animate)}requestAnimationFrame(animate);
</script></body></html>`;
}
function subtitles(input) {
  const board = validateStoryboard(input); let offset = 0;
  const stamp = t => { const n = Math.round(t * 1000); return `${String(Math.floor(n/3600000)).padStart(2,'0')}:${String(Math.floor(n/60000)%60).padStart(2,'0')}:${String(Math.floor(n/1000)%60).padStart(2,'0')},${String(n%1000).padStart(3,'0')}`; };
  return board.scenes.map((s,i) => { const from=offset; offset+=s.duration; return `${i+1}\n${stamp(from)} --> ${stamp(offset)}\n${[s.title,s.body].filter(Boolean).join('\n')}\n`; }).join('\n');
}
module.exports = { makeBlueprint, validateStoryboard, renderHtml, subtitles, ASPECTS };
