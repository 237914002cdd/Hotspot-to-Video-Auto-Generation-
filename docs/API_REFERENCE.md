# API 接口参考

> 基础地址：`http://localhost:3456`
> 所有 POST/PUT 请求体均为 JSON，需设置 `Content-Type: application/json`。

---

## 数据集合（通用 CRUD）

| 接口地址 | 方法 | 核心功能 | 参数说明 |
|---------|------|---------|---------|
| `/api/sse` | GET | 建立 SSE 实时连接 | 无参数。返回 `event-stream`，推送 `data-update` / `auto-fetch` / `connected` 事件 |
| `/api/data` | GET | 获取全部数据 | 无参数。返回 `hotTopics` / `autoTopics` / `ideas` / `calendar` / `reviews` / `searchWords` / `weeklyNotes` / `settings` / `projects`（项目扫描结果） |
| `/api/data` | POST | 保存数据（增量更新） | 请求体可选字段：`hotTopics` / `autoTopics` / `ideas` / `settings` 等。`ideas` 新增条目会自动创建项目文件夹 |
| `/api/data/:collection` | PUT | 替换指定集合 | URL 参数 `collection`：集合名；请求体为完整数据 |

---

## 热点与推荐

| 接口地址 | 方法 | 核心功能 | 参数说明 |
|---------|------|---------|---------|
| `/api/trigger-fetch` | POST | 手动触发热点抓取 | 无参数。返回 `{ fetched: N, total: N }` |
| `/api/brief/generate` | POST | 生成每日简报 | 无参数。返回 `{ date, hotCount, topHot: [], suggestions: [] }` |
| `/api/today/recommend` | POST | AI 推荐选题分析 | 无参数。返回 `{ recommendations: [], groups: { p0, p1, p2, skip } }`。四维评分：热度(30%) + 壁垒(25%) + 长尾(25%) + 变现(20%) |

---

## 项目资产

| 接口地址 | 方法 | 核心功能 | 参数说明 |
|---------|------|---------|---------|
| `/api/projects` | GET | 获取所有项目状态 | 无参数。返回 `{ projects: [{ name, videoCount, hasCover, hasCopy, hasScript, status, statusLabel }] }`。三级状态：`in_progress` / `video_ready` / `completed` |

---

## 封面生成

| 接口地址 | 方法 | 核心功能 | 参数说明 |
|---------|------|---------|---------|
| `/api/projects/generate-cover-svg` | POST | 智能封面生成 | 请求体：`{ slug: string }`。从 `video-plan.md` 动态提取 12 个字段，注入 SVG 模板 |
| `/api/projects/update-cover` | POST | 封面文字微调 | 请求体：`{ slug, fields: { BADGE, TITLE_LINE_1, ... } }`。仅替换指定占位符 |

---

## 剧本与文案

| 接口地址 | 方法 | 核心功能 | 参数说明 |
|---------|------|---------|---------|
| `/api/projects/generate-blueprint` | POST | AI 生成剧本 + 社交文案 | 请求体：`{ slug, topic? }`。读取 `video-plan.md` → 生成 HTML + 双平台（小红书/抖音）文案 |
| `/api/projects/save-script` | POST | 保存剧本到磁盘 | 请求体：`{ slug, html_content, copy_content? }`。写入 `index.html` + `01-内容方案/short-video-copy.md`。自动记录 `executionStartedAt` |

---

## 渲染与本地操作

| 接口地址 | 方法 | 核心功能 | 参数说明 |
|---------|------|---------|---------|
| `/api/projects/render` | POST | 启动后台渲染 | 请求体：`{ slug }`。非阻塞执行 `npx hyperframes render`，超时 10 分钟 |
| `/api/projects/render-status/:slug` | GET | 轮询渲染状态 | URL 参数 `slug`。返回：`{ status: 'idle' }` / `{ status: 'rendering', startedAt }` / `{ status: 'completed', output }` / `{ status: 'failed', error }` |
| `/api/projects/open-folder` | POST | 在资源管理器中打开项目文件夹 | 请求体：`{ slug, sub? }`。`sub` 可选：`01-内容方案` / `03-成品` 等 |

---

## 归档

| 接口地址 | 方法 | 核心功能 | 参数说明 |
|---------|------|---------|---------|
| `/api/projects/archive` | POST | 一键归档 | 请求体：`{ slug }`。自动完成 7 步：搬运 mp4 + 搬运封面 + 计算双时间线 + 写两个 README + 同步 Obsidian |

---

## 调用示例

```bash
# 获取全部数据
curl http://localhost:3456/api/data

# 生成封面
curl -X POST http://localhost:3456/api/projects/generate-cover-svg \
  -H 'Content-Type: application/json' \
  -d '{"slug":"whv-2026"}'

# 启动渲染
curl -X POST http://localhost:3456/api/projects/render \
  -H 'Content-Type: application/json' \
  -d '{"slug":"whv-2026"}'

# 查询渲染状态
curl http://localhost:3456/api/projects/render-status/whv-2026

# 一键归档
curl -X POST http://localhost:3456/api/projects/archive \
  -H 'Content-Type: application/json' \
  -d '{"slug":"hyperframes-intro"}'
```

---

## SSE 事件类型

| 事件名 | 触发时机 | payload |
|--------|---------|---------|
| `connected` | 连接成功 | `{ ok: true }` |
| `data-update` | 数据变更 | `{ collection: string }` 或 `{ updated: string[] }` |
| `auto-fetch` | 自动抓取完成 | `{ count: number, total: number }` |
