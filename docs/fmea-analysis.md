# FMEA 故障分析 — AI 视频生产流水线

> 失效模式与影响分析（Failure Mode and Effects Analysis）
> 更新：2026-06-13 | 共 8 个案例

---

## 故障案例 1：万能文案幽灵

### 触发条件

在看板上对任一新项目调用 `POST /api/projects/generate-blueprint`，返回的 `copy` 对象中始终包含"上手简单，零门槛"等文案，即使该项目已有完整的 `video-plan.md`。

### 分析过程

1. 怀疑 HTML 生成部分未读取 plan → 检查发现 HTML 部分已在 Phase 5 正确从 `video-plan.md` 动态生成 ✅
2. 继续往下读代码 → 发现 `generate-blueprint` 函数末尾的 `copy` 对象中写死了 6 处字符串：

```javascript
// server.js:592 — 问题代码（Phase 3.2 残留）
const copy = {
  xiaohongshu: {
    title: `🔥 ${cleanTitle || '最新发现'}！你一定要知道`,
    body: `最近发现了这个真的太惊喜了 🎉\n\n📌 ${cleanTitle}\n\n简单说几个重点 👇\n\n① 上手简单，零门槛\n② 效果惊艳，专业级质感\n③ 值得一试\n\n链接在评论区，去试试！\n\n${tag} #推荐`,
  },
  douyin: { /* 同理，也是硬编码 */ },
};
```

3. 原因：Phase 3.2 只替换了 `html` 生成逻辑，`copy` 对象被遗漏。

### 最终修复代码段

```javascript
// === 基于 context 动态生成社交文案（从 plan 中提取内容） ===
const planLines = context.split('\n').filter(l => l.trim());
const realSentences = planLines.filter(l => !l.trim().startsWith('#') && !l.trim().startsWith('>')
  && !l.trim().match(/^[\|\-\s]+$/) && l.trim().length > 5 && l.trim().length < 100);
const cleanLines = realSentences.filter(l => !l.trim().match(/^[\|\-:\s]+$/)
  && !l.trim().match(/^\|.+?\|.+?\|/));

// 提取表格中的口播文案列
const tableLines = planLines.filter(l => l.trim().startsWith('|')).slice(2);
const speechLines = tableLines.map(l => {
  var cols = l.split('|').filter(function(c){return c.trim();});
  return cols[2] ? cols[2].trim().replace(/\*\*/g, '') : null;
}).filter(function(s){return s && s.length > 5 && s.length < 100;});

const featureSource = speechLines.length >= 3 ? speechLines : cleanLines;
const features = featureSource.slice(0, 5).map(s => s.replace(/^[-•·\s\|\*]+/, '')
  .replace(/\|.*/, '').replace(/\*\*/g, '').trim()).filter(s => s.length > 4);
const f1 = features[0] ? features[0].slice(0, 25) : '详情点击查看';
const f2 = features[1] ? features[1].slice(0, 25) : '快速上手';
const f3 = features[2] ? features[2].slice(0, 25) : '值得一试';
```

### 经验教训

- 重构时只关注"改的地方"是不够的，必须检查函数返回的 **所有字段**
- 每改 `generate-blueprint` 后执行一次检测：
  ```bash
  curl -s http://localhost:3456/api/projects/generate-blueprint \
    -H 'Content-Type: application/json' \
    -d '{"slug":"whv-2026"}' | jq '.copy.xiaohongshu.body'
  ```

---

## 故障案例 2：旧进程残留导致新路由不生效

### 触发条件

修改 `server.js` 新增或修改 API 路由后，重启服务（Ctrl+C → 重新 node），但浏览器访问新路由时返回 `404 Cannot POST`。

### 分析过程

1. 确认代码已写对：`grep -n "apiRouter" server.js | tail` 显示路由存在 ✅
2. `netstat -ano | grep :3456` 发现端口被旧 PID 占用，新进程根本没起
3. 原因：Windows 上 Ctrl+C 不总是释放端口，旧进程在后台残留

### 最终修复命令

```bash
# 精确 kill 占用端口的进程
netstat -ano | grep :3456 | awk '{print $5}' | xargs taskkill //F //PID
```

### 经验教训

- 不要只按 Ctrl+C，必须确认端口已释放再启动
- 排查 404 的第一步是 `netstat -ano | grep :3456` 看 PID 是否变了
- 第二步 `grep -n "apiRouter" server.js | tail` 确认路由已注册

---

## 故障案例 3：`scanProjects()` 变量名冲突

### 触发条件

启动服务器后，`GET /api/projects` 返回空数组，但 `项目/` 目录下有多个项目。

### 分析过程

1. `scanProjects()` 中 `const status = []` 声明数组
2. 同一函数内又有字符串变量 `let status`（用于保存项目状态如 `'completed'`）
3. JavaScript 不允许同一作用域内重复 `const` 声明 → 静默失败

### 最终修复代码段

```javascript
// 修复前
const status = [];           // 数组
// ...（中间逻辑）
const status = 'completed';  // SyntaxError: 重复声明

// 修复后
const statusList = [];       // 数组 → 重命名
// ...（中间逻辑）
status = 'completed';        // 复用已有变量
```

> 类似的还有 `const cPath` 重复声明和 `const topic` 与函数参数 `topic` 冲突，一并修复。

---

## 故障案例 4：`hasScript` 漏检旧项目

### 触发条件

`hyperframes-intro` 等旧项目已有 `index.html`（在 `hyperframes/` 子目录中），但看板显示缺剧本。

### 分析过程

1. `scanProjects()` 中只检查了 `path.join(projectPath, 'index.html')`
2. 早期项目用的是 HyperFrames init 创建的结构，`index.html` 在 `hyperframes/` 子目录下
3. `fs.existsSync()` 返回 `false` → `hasScript = false` → 蓝键错位为"生成剧本"

### 最终修复代码段

```javascript
// 修复前
let hasScript = fs.existsSync(path.resolve(projectPath, 'index.html'));

// 修复后
let hasScript = fs.existsSync(path.resolve(projectPath, 'index.html'));
if (!hasScript) {
  hasScript = fs.existsSync(path.resolve(projectPath, 'hyperframes', 'index.html'));
}
```

---

## 故障案例 5：Windows open-folder 路径编码

### 触发条件

在看板中点击"打开文件夹"，控制台报错，Windows 资源管理器未弹出。问题仅出现在路径含中文或空格的时刻。

### 分析过程

1. 初始方案 `exec('explorer.exe ' + target)` → 中文路径乱码 ❌
2. `execFile('explorer.exe', [target])` → 同样问题 ❌
3. 写 `.bat` 文件执行 → 临时文件残留 ❌
4. `mshta` javascript 方案 → 闪烁黑窗口 ❌
5. 最终找到稳定方案：

### 最终修复代码段

```javascript
// 最终方案
require('child_process').exec('cmd.exe /c start "" "' + target + '"', function(err) {
  if (err) return res.status(500).json({ ok: false, error: err.message });
  res.json({ ok: true });
});
```

> 注意：双引号包裹路径是必须的，`cmd.exe /c start ""` 中第一个空引号是窗口标题参数。

---

## 故障案例 6：正则解析 `01- opener (~8s)` 失败

### 触发条件

某个项目的 `video-plan.md` 使用 `## 01-opener (~8s)` 格式的子标题，`parsePlanForCover()` 提取特性时返回包含 `#` 字符的脏数据。

### 分析过程

1. `cleanFeature()` 函数使用正则 `/^\d+[-.、．\s]+/` 去除数字编号
2. 该正则不匹配 `01-`（数字后有空格再跟连字符），因为 `01-` 中间有空格
3. 残留的 `#` 触发红线规则，但降级后的正文句也不准确

### 最终修复代码段

```javascript
// 修复前
var cleaned = s.replace(/^##\s*/, '').replace(/^\d+[-.、．\s]+/, '');

// 修复后
var cleaned = s.replace(/^##\s*/, '').replace(/^\s*\d+\s*[-.、．\s]+/, '')
  .replace(/\s*\([^)]*\)/g, '').replace(/\s*~?\d+\s*[s秒]+\s*$/g, '');
```

> 添加了 `\s*` 处理空格变体，同时新增了去时间标注 `(~8s)` 和去时长 `~12s` 的逻辑。

---

## 故障案例 7：SSE 连接卡在"连接中"

### 触发条件

看板页面加载后，右上角状态一直显示"连接中"，即使服务端已有新的数据推送。

### 分析过程

1. `EventSource.onerror` 事件触发后自动重连
2. 每次重连创建一个新的 `EventSource` 实例，但旧连接未关闭
3. 多个连接叠加 → 浏览器限制同源最大连接数 → 后续连接全部排队 → 看起来"卡住"
4. 由于 `onerror` 在连接失败时立即触发，形成递归重连风暴

### 最终修复代码段

```javascript
// 前端修复：增加 connected 标记 + 先 close 再重连
let connected = false;
let eventSource = new EventSource('/api/sse');

eventSource.onopen = function() { connected = true; };
eventSource.onerror = function() {
  connected = false;
  eventSource.close();    // 先关闭旧连接
  setTimeout(function() {
    eventSource = new EventSource('/api/sse');  // 再建新连接
  }, 3000);               // 3 秒延迟，避免风暴
};
```

---

## 故障案例 8：归档 API 就地搬运漏洞

### 触发条件

早期项目（如 `gorden-ppt-skill`）的 mp4 和封面文件已在 `03-成品/` 中，但 `renders/` 和 `02-制作文件/` 目录为空。点击"一键归档"后，文件没有搬运，README 中视频列为"无"。

### 分析过程

1. 归档 API 仅从 `renders/` 搬运 mp4，仅从 `02-制作文件/` 搬运封面
2. 早期项目是通过手动 `cp` 或 HyperFrames 直接渲染到 `03-成品/` 的，`renders/` 不存在
3. 没有兜底检测逻辑 → 跳过搬运 → `videoFile = null` → README 显示"无"

### 最终修复代码段

```javascript
// 1. 搬运 mp4（renders/ → 03-成品/；若无 renders，直接检查 03-成品/）
let videoFile = null;
if (fs.existsSync(rendersDir)) {
  const mp4s = fs.readdirSync(rendersDir).filter(f => f.endsWith('.mp4'));
  if (mp4s.length) { videoFile = mp4s.sort().pop(); fs.copyFileSync(...); }
}
// 兜底：renders 不存在或为空，但 03-成品 已有 mp4
if (!videoFile && fs.existsSync(deliverablesDir)) {
  const existingMp4s = fs.readdirSync(deliverablesDir).filter(f => f.endsWith('.mp4'));
  if (existingMp4s.length) { videoFile = existingMp4s.sort().pop(); }
}

// 同理：封面也加兜底检测
let coverCopied = false;
if (fs.existsSync(coverDesignDir)) { /* 从 02-制作文件 搬运 */ }
if (!coverCopied && fs.existsSync(deliverablesDir)) {
  const existingSvgs = fs.readdirSync(deliverablesDir).filter(f => f.endsWith('.svg'));
  if (existingSvgs.length) coverCopied = true;
}
```

---

## 故障模式汇总表

| 编号 | 类型 | 根因 | 影响 | 修复复杂度 |
|------|------|------|------|-----------|
| 1 | 数据 | 重构遗漏硬编码文案 | 封面/文案内容虚假 | 低 |
| 2 | 运维 | Windows 进程残留 | 路由 404 | 低 |
| 3 | 代码 | 变量名作用域冲突 | 项目扫描返回空 | 中 |
| 4 | 逻辑 | 路径扫描不完整 | 状态机蓝键错位 | 低 |
| 5 | 兼容 | Windows 路径编码 | open-folder 不可用 | 中（5 次尝试） |
| 6 | 逻辑 | 正则不兼容多种格式 | 封面特性提取脏数据 | 低 |
| 7 | 前端 | SSE 递归重连 | 看板实时更新失效 | 中 |
| 8 | 逻辑 | API 未兜底检测 | 早期项目无法归档 | 低 |
