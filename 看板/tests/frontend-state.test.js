'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function detail(slug, version = `${slug}-version`) {
  return {
    version,
    content: { title: slug, plan: `${slug} plan`, copy: '', storyboard: { title: slug, theme: 'midnight', aspect: '9:16', scenes: [{ title: slug, body: '', duration: 5 }] } },
    coverFields: { TITLE_LINE_1: `${slug} cover` },
    files: { video: `/${slug}.mp4`, cover: `/${slug}.svg`, copy: `/${slug}.md`, preview: `/${slug}.html` },
    project: { title: slug }, job: null
  };
}

// Exercise the actual app functions with controllable network promises, while
// replacing rendering and automatic startup. No server data or browser state is used.
function harness() {
  const elements = new Map(), calls = [], effects = [];
  const ui = { scenes: [], cover: [] };
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      value: '', textContent: '', hidden: false,
      closest() { return { open: false }; },
      scrollIntoView() { effects.push(['scroll', id]); }
    });
    return elements.get(id);
  };
  let refreshHook = async () => {};
  const bridge = {
    ui, effects,
    request(url, options = {}) {
      const pending = deferred();
      calls.push({ url, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : undefined, ...pending });
      return pending.promise;
    },
    refresh() { return refreshHook(); }
  };
  const context = vm.createContext({
    bridge, console, confirm: () => true,
    document: {
      addEventListener() {}, getElementById: element,
      querySelectorAll(selector) { return selector === '.cover-field' ? ui.cover : []; }
    },
    window: { addEventListener() {}, scrollTo() {} },
    history: { replaceState(...args) { effects.push(['route', args[2]]); } }
  });
  vm.runInContext(source.replace(/^init\(\)\.catch\(showError\);\s*$/m, ''), context);
  vm.runInContext(`
    api = (url, options) => bridge.request(url, options);
    refresh = () => bridge.refresh();
    renderStudio = () => bridge.effects.push(['renderStudio', studio.slug]);
    renderStudioMedia = () => bridge.effects.push(['renderMedia', studio.slug]);
    renderJobLists = () => bridge.effects.push(['renderJobs']);
    renderScenes = scenes => { bridge.ui.scenes = scenes; bridge.effects.push(['renderScenes', studio.slug]); };
    readScenes = () => bridge.ui.scenes;
    toast = message => bridge.effects.push(['toast', message]);
  `, context);
  const run = text => vm.runInContext(text, context);
  function activate(slug, options = {}) {
    bridge.next = { slug, detail: detail(slug), dirty: false, coverDirty: false, tab: 'content', ...options };
    run('studio = bridge.next');
    Object.entries({ 'studio-title': slug, 'studio-plan': `${slug} plan`, 'studio-copy': '', 'studio-theme': 'midnight', 'studio-aspect': '9:16' }).forEach(([id, value]) => { element(id).value = value; });
    ui.scenes = [{ title: slug, body: '', duration: 5 }];
    ui.cover = [{ dataset: { field: 'TITLE_LINE_1' }, value: `${slug} cover` }];
    return bridge.next;
  }
  async function waitForCalls(count) {
    for (let i = 0; i < 20 && calls.length < count; i++) await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.length, count);
  }
  return { run, activate, calls, effects, ui, element, waitForCalls, refreshWith(fn) { refreshHook = fn; } };
}

test('cover save started on A never fetches B or applies A fields after switching', async () => {
  const h = harness(); h.activate('a', { coverDirty: true });
  const saving = h.run('saveCover()');
  assert.equal(h.calls[0].url, '/api/projects/update-cover');
  assert.equal(h.calls[0].body.slug, 'a');
  const b = h.activate('b'); const before = JSON.stringify(b);
  h.calls[0].resolve({ version: 'a-new', fields: { TITLE_LINE_1: 'A saved' } });
  assert.equal(await saving, false);
  assert.equal(h.calls.length, 1);
  assert.equal(JSON.stringify(b), before);
  assert.deepEqual(h.effects, []);
});

test('cover detail GET stays on A and ignores a replacement editor with the same slug', async () => {
  const h = harness(); h.activate('a');
  const saving = h.run('saveCover()');
  h.calls[0].resolve({ version: 'a-new', fields: { TITLE_LINE_1: 'A saved' } });
  await h.waitForCalls(2);
  assert.equal(h.calls[1].url, '/api/projects/a');
  const reopened = h.activate('a', { dirty: true }); const before = JSON.stringify(reopened);
  h.calls[1].resolve(detail('a', 'a-new'));
  assert.equal(await saving, false);
  assert.equal(JSON.stringify(reopened), before);
  assert.deepEqual(h.effects, []);
});

test('normal cover save preserves edits entered while saving and updates only its own version', async () => {
  const h = harness(); const a = h.activate('a', { coverDirty: true });
  const saving = h.run('saveCover()');
  h.ui.cover[0].value = 'new typing';
  h.calls[0].resolve({ version: 'a-new', fields: { TITLE_LINE_1: 'a cover' } });
  await h.waitForCalls(2); h.calls[1].resolve(detail('a', 'a-new'));
  assert.equal(await saving, true);
  assert.equal(a.detail.version, 'a-new');
  assert.equal(a.detail.coverFields.TITLE_LINE_1, 'a cover');
  assert.equal(a.coverDirty, true);
  assert.equal(h.ui.cover[0].value, 'new typing');
});

test('content save cannot replace a reloaded editor merely because its slug matches', async () => {
  const h = harness(); h.activate('a');
  const saving = h.run('saveStudio()');
  assert.equal(h.calls[0].url, '/api/projects/a/content');
  assert.equal(h.calls[0].method, 'PUT');
  const reopened = h.activate('a', { dirty: true }); const before = JSON.stringify(reopened);
  h.calls[0].resolve(detail('a', 'old-request-result'));
  assert.equal(await saving, false);
  assert.equal(JSON.stringify(reopened), before);
  assert.deepEqual(h.effects, []);
});

for (const operation of ['generateDraft()', 'renderStudioVideo()', "actions['preview-studio']()"])
  test(`${operation} stops its continuation when the save completes after switching to B`, async () => {
    const h = harness(); h.activate('a');
    const pending = h.run(operation);
    const b = h.activate('b'); const before = JSON.stringify(b);
    h.calls[0].resolve(detail('a', 'a-new'));
    await pending;
    assert.equal(h.calls.length, 1, 'must not request blueprint or render for B');
    assert.equal(JSON.stringify(b), before);
    assert.deepEqual(h.effects, []);
  });

test('switching during post-save list refresh also prevents an unintended render', async () => {
  const h = harness(); h.activate('a'); const refresh = deferred(); h.refreshWith(() => refresh.promise);
  const pending = h.run('renderStudioVideo()'); h.calls[0].resolve(detail('a', 'a-new'));
  await new Promise(resolve => setImmediate(resolve));
  const b = h.activate('b'); const before = JSON.stringify(b); refresh.resolve();
  assert.equal(await pending, false);
  assert.equal(h.calls.length, 1);
  assert.equal(JSON.stringify(b), before);
});

test('delayed blueprint response cannot populate the new project editor', async () => {
  const h = harness(); h.activate('a');
  const pending = h.run('generateDraft()'); h.calls[0].resolve(detail('a', 'a-new'));
  await h.waitForCalls(2);
  assert.equal(h.calls[1].url, '/api/projects/generate-blueprint');
  assert.equal(h.calls[1].body.slug, 'a');
  const b = h.activate('b'); const before = JSON.stringify(b), scenes = h.ui.scenes;
  const effectsBefore = h.effects.length;
  h.calls[1].resolve({ storyboard: detail('a').content.storyboard, copy_content: 'A copy' });
  assert.equal(await pending, false);
  assert.equal(JSON.stringify(b), before);
  assert.equal(h.ui.scenes, scenes);
  assert.equal(h.element('studio-copy').value, '');
  assert.equal(h.effects.length, effectsBefore);
});

test('normal draft generation still saves A and fills its draft', async () => {
  const h = harness(); const a = h.activate('a');
  const pending = h.run('generateDraft()'); h.calls[0].resolve(detail('a', 'a-new'));
  await h.waitForCalls(2);
  const board = { ...detail('a').content.storyboard, theme: 'paper' };
  h.calls[1].resolve({ storyboard: board, copy_content: 'A generated copy' });
  assert.equal(await pending, true);
  assert.equal(a.dirty, true);
  assert.equal(h.element('studio-theme').value, 'paper');
  assert.equal(h.element('studio-copy').value, 'A generated copy');
});

test('normal rendering submits the saved project and refreshes jobs', async () => {
  const h = harness(); h.activate('a');
  const pending = h.run('renderStudioVideo()'); h.calls[0].resolve(detail('a', 'a-new'));
  await h.waitForCalls(2);
  assert.equal(h.calls[1].url, '/api/projects/render'); assert.equal(h.calls[1].body.slug, 'a');
  h.calls[1].resolve({ ok: true }); await h.waitForCalls(3);
  assert.equal(h.calls[2].url, '/api/jobs'); h.calls[2].resolve({ jobs: [] });
  assert.equal(await pending, true);
});

test('a delayed render submission remains on A and does not continue into the B editor', async () => {
  const h = harness(); h.activate('a');
  const pending = h.run('renderStudioVideo()'); h.calls[0].resolve(detail('a', 'a-new'));
  await h.waitForCalls(2); assert.equal(h.calls[1].body.slug, 'a');
  const b = h.activate('b'); const before = JSON.stringify(b), effectsBefore = h.effects.length;
  h.calls[1].resolve({ ok: true });
  assert.equal(await pending, false); assert.equal(h.calls.length, 2);
  assert.equal(JSON.stringify(b), before); assert.equal(h.effects.length, effectsBefore);
});

test('late render failure for A is ignored by an unrelated B studio operation', async () => {
  const h = harness(); h.activate('a');
  const pending = h.run('renderStudioVideo()'); h.calls[0].resolve(detail('a', 'a-new'));
  await h.waitForCalls(2); h.activate('b');
  h.calls[1].reject(new Error('A renderer failed'));
  assert.equal(await pending, false);
});

test('job completion loaded for one editor does not fetch a different studio after switching', async () => {
  const h = harness(); h.activate('a'); h.run("jobs = [{slug:'a',status:'running'}]");
  const pending = h.run('loadJobs()'); const b = h.activate('b'); const before = JSON.stringify(b);
  h.calls[0].resolve({ jobs: [{ slug: 'a', status: 'completed' }] });
  await pending;
  assert.equal(h.calls.length, 1); assert.equal(JSON.stringify(b), before);
});

test('manual media refresh stops after loading jobs if the editor was replaced', async () => {
  const h = harness(); h.activate('a');
  const pending = h.run("actions['refresh-studio-media']()");
  const b = h.activate('b'); const before = JSON.stringify(b);
  h.calls[0].resolve({ jobs: [] }); await pending;
  assert.equal(h.calls.length, 1); assert.equal(JSON.stringify(b), before);
});

test('media refresh ignores a replacement instance even for the same project', async () => {
  const h = harness(); h.activate('a'); const pending = h.run('updateStudioMedia()');
  const reopened = h.activate('a'); const before = JSON.stringify(reopened);
  h.calls[0].resolve(detail('a', 'stale-media-response'));
  assert.equal(await pending, false); assert.equal(JSON.stringify(reopened), before);
  assert.deepEqual(h.effects, []);
});

test('archive completion for A never refreshes or mutates B', async () => {
  const h = harness(); h.activate('a'); const pending = h.run('archiveStudio()');
  assert.equal(h.calls[0].body.slug, 'a');
  const b = h.activate('b'); const before = JSON.stringify(b);
  h.calls[0].resolve({ ok: true });
  assert.equal(await pending, false); assert.equal(h.calls.length, 1);
  assert.equal(JSON.stringify(b), before); assert.deepEqual(h.effects, []);
});

test('normal archive refreshes the original project and reports completion', async () => {
  const h = harness(); const a = h.activate('a'); const pending = h.run('archiveStudio()');
  h.calls[0].resolve({ ok: true }); await h.waitForCalls(2);
  assert.equal(h.calls[1].url, '/api/projects/a');
  const archived = detail('a'); archived.project.archivedAt = '2026-09-23'; h.calls[1].resolve(archived);
  assert.equal(await pending, true); assert.equal(a.detail.project.archivedAt, '2026-09-23');
});

test('latest open request wins when responses arrive out of order', async () => {
  const h = harness(); h.activate('initial');
  const first = h.run("openStudio('a')"), second = h.run("openStudio('b')");
  h.calls[1].resolve(detail('b')); assert.equal(await second, true);
  const b = h.run('studio'); const effectsBefore = h.effects.length;
  h.calls[0].resolve(detail('a')); assert.equal(await first, false);
  assert.equal(h.run('studio'), b); assert.equal(h.effects.length, effectsBefore);
});

test('leaving the studio while loading prevents a late response from navigating back', async () => {
  const h = harness(); const a = h.activate('a');
  const pending = h.run("openStudio('b')"); h.run("goPage('assets')");
  const effectsBefore = h.effects.length; h.calls[0].resolve(detail('b'));
  assert.equal(await pending, false); assert.equal(h.run('studio'), a);
  assert.equal(h.run('currentPage'), 'assets'); assert.equal(h.effects.length, effectsBefore);
});

test('superseded open or save failures do not surface as errors in the new project', async () => {
  const h = harness(); h.activate('a'); const saving = h.run('saveCover()');
  h.activate('b'); h.calls[0].reject(new Error('A request failed')); assert.equal(await saving, false);
  const first = h.run("openStudio('a')"), second = h.run("openStudio('b')");
  h.calls[2].resolve(detail('b')); await second;
  h.calls[1].reject(new Error('old load failed')); assert.equal(await first, false);
});
