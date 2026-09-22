'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { makeBlueprint, validateStoryboard, renderHtml, subtitles } = require('../lib/blueprint');
const { createRenderer } = require('../lib/renderer');
const { chromium } = require('playwright');
const crypto = require('node:crypto');
const board = { title: '真实成片验收', aspect: '9:16', theme: 'midnight', scenes: [{ title: '热点到成片', body: '从选题开始，保存自己的内容。', duration: 2 }, { title: '每一步都可验证', body: '编辑分镜 · 预览 · 导出 MP4', duration: 2 }] };
test('分镜拒绝非法时长、主题、过长内容与超长总时长', () => {
  for (const input of [{...board,aspect:'prototype'}, {...board,scenes:[]}, {...board,scenes:[{title:'x',body:'',duration:NaN}]}, {...board,scenes:Array(9).fill({title:'x',body:'',duration:15})}]) assert.throws(()=>validateStoryboard(input));
  assert.equal(validateStoryboard(board).scenes.length,2);
});
test('模板内容明确标记、HTML拒绝脚本注入，字幕时间与分镜一致', () => {
  const content = makeBlueprint({title:'<script>alert(1)</script>',plan:'真实提供的正文'});
  assert.equal(content.mode,'template');
  assert.ok(!content.html_content.includes('<script>alert(1)</script>'));
  assert.ok(content.html_content.includes('\\u003cscript>'));
  assert.match(subtitles(board), /00:00:02,000 --> 00:00:04,000/);
  assert.ok(makeBlueprint({title:'长方案',plan:'长'.repeat(800)}).storyboard.scenes.length>1);
  const source=Array.from({length:800},(_,i)=>String.fromCodePoint(0x4e00+i)).join('');
  const draft=makeBlueprint({title:'完整性',plan:source});assert.equal(draft.storyboard.scenes.map(s=>s.body).join(''),source);
  assert.throws(()=>makeBlueprint({title:'超长方案',plan:'长'.repeat(6000)}),/容量/);
  assert.throws(()=>validateStoryboard({...board,scenes:[{title:'字',body:('行\n').repeat(100),duration:3}]}),/最多 6 行/);
});
test('真实渲染、ffprobe校验、任务幂等与重启恢复', { timeout: 180000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'pipeline-render-'));
  const dataDir=path.join(root,'data'), projectsDir=path.join(root,'projects'), dir=path.join(projectsDir,'render-test');
  fs.mkdirSync(dir,{recursive:true}); fs.writeFileSync(path.join(dir,'storyboard.json'),JSON.stringify(board));
  const renderer=createRenderer({dataDir,projectsDir});
  t.after(async()=>{await renderer.close();fs.rmSync(root,{recursive:true,force:true});});
  if(!renderer.capabilities().available) { t.skip('需 npm run setup:browser 与 FFmpeg/ffprobe'); return; }
  const first=renderer.start('render-test'); assert.equal(renderer.start('render-test').id,first.id);
  let result;
  const end=Date.now()+150000;
  while(Date.now()<end){result=renderer.get('render-test');if(['completed','failed','cancelled'].includes(result.status))break;await new Promise(r=>setTimeout(r,150));}
  assert.equal(result.status,'completed',result.error); assert.equal(result.metadata.width,720); assert.equal(result.metadata.height,1280); assert.ok(Math.abs(result.metadata.duration-4)<.1); assert.equal(result.progress,100);
  const deliverable=path.join(dir,'03-成品','versions',first.id,'video.mp4');
  assert.ok(fs.statSync(deliverable).size>1000);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'03-成品','current-video.json'))).id,first.id);
  const dest=path.resolve(__dirname,'..','data','qa'); fs.mkdirSync(dest,{recursive:true});
  fs.copyFileSync(deliverable,path.join(dest,'verified-render.mp4')); fs.writeFileSync(path.join(dest,'render-evidence.json'),JSON.stringify(result,null,2));
  const next=renderer.start('render-test'); renderer.cancel('render-test'); assert.equal(renderer.get('render-test').status,'cancelled'); assert.notEqual(next.id,first.id);
  const failureDir=path.join(projectsDir,'failed-publish');fs.mkdirSync(path.join(failureDir,'03-成品'),{recursive:true});
  fs.writeFileSync(path.join(failureDir,'storyboard.json'),JSON.stringify(board));
  const oldVideo=path.join(failureDir,'03-成品','video.mp4');fs.copyFileSync(deliverable,oldVideo);
  const digest=()=>crypto.createHash('sha256').update(fs.readFileSync(oldVideo)).digest('hex'),before=digest();
  // A blocked pointer simulates a filesystem failure after successful encoding.
  fs.mkdirSync(path.join(failureDir,'03-成品','current-video.json'));
  renderer.start('failed-publish');
  for(let i=0;i<500 && !['failed','completed'].includes(renderer.get('failed-publish').status);i++)await new Promise(r=>setTimeout(r,100));
  assert.equal(renderer.get('failed-publish').status,'failed');assert.equal(digest(),before,'发布失败不得替换已有视频');
  renderer.start('render-test');
  for(let i=0;i<100&&renderer.get('render-test').status==='queued';i++)await new Promise(r=>setTimeout(r,20));
  renderer.cancel('render-test');
  for(let i=0;i<100&&renderer.get('render-test').status==='rendering';i++)await new Promise(r=>setTimeout(r,50));
  assert.equal(renderer.get('render-test').status,'cancelled','运行中取消必须落到终态');
  await renderer.close();
  const restored=createRenderer({dataDir,projectsDir}); assert.equal(restored.get('render-test').status,'cancelled'); await restored.close();
  const jobs=JSON.parse(fs.readFileSync(path.join(dataDir,'render-jobs.json'))); jobs.find(j=>j.slug==='render-test').status='rendering';fs.writeFileSync(path.join(dataDir,'render-jobs.json'),JSON.stringify(jobs));
  const restarted=createRenderer({dataDir,projectsDir}); assert.equal(restarted.get('render-test').status,'failed'); assert.match(restarted.get('render-test').error,/中断/); await restarted.close();
});
test('三种画幅下最大文本量不会覆盖页脚或超出画面',async t=>{
  if(!fs.existsSync(chromium.executablePath())){t.skip('需要Chromium');return;}
  const browser=await chromium.launch();t.after(()=>browser.close());
  for(const [aspect,[width,height]] of Object.entries(require('../lib/blueprint').ASPECTS)){
    const page=await browser.newPage({viewport:{width,height}});
    await page.setContent(renderHtml({title:'排版边界',aspect,theme:'paper',scenes:[{title:'字'.repeat(80),body:Array(6).fill('内容'.repeat(20)).join('\n'),duration:3}]}));
    await page.evaluate(()=>{window.__RENDER_MODE__=true;window.seek(1);});
    const fit=await page.evaluate(()=>({bottom:document.querySelector('.content').getBoundingClientRect().bottom,footer:document.querySelector('.footer').getBoundingClientRect().top,width:document.querySelector('.content').scrollWidth,box:document.querySelector('.content').clientWidth}));
    assert.ok(fit.bottom+12<fit.footer,`${aspect} 文本区域侵入页脚: ${JSON.stringify(fit)}`);assert.ok(fit.width<=fit.box+1);await page.close();
  }
});
