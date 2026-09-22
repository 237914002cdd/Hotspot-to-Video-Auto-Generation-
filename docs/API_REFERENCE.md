# 本地平台 API（v2）

默认地址 `http://127.0.0.1:3456`，JSON 请求设置 `Content-Type: application/json`。服务仅接受本机 Host 和同源浏览器请求。没有公网用户鉴权和多租户隔离。

## 工作区与数据

| 接口 | 行为 |
|---|---|
| GET /api/health | 版本、本地模式、Chromium/FFmpeg/ffprobe 可用性、热点状态 |
| GET /api/data | 各业务集合、项目摘要、集合 versions、fetchStatus |
| POST /api/data | 保存所给集合；附 `versions: {集合名: hash}` 实现乐观锁 |
| PUT /api/data/:collection | `{data, version}`，兼容旧数组请求 |
| GET /api/export | JSON 工作区备份，包含方案和分镜，不含二进制媒体 |
| GET /api/sse | connected、data-update、auto-fetch、fetch-status、render-update |

集合白名单：hotTopics、autoTopics、ideas、calendar、reviews、searchWords、weeklyNotes、settings。数据保存在 data/workspace.json，上一版本保存为 workspace.backup.json。旧独立 JSON 集合首次写入时迁移，原文件保留。损坏数据返回 503，不用空数据覆盖。

推荐客户端必须发送读到的版本；409 表示内容已变化，应保留本地编辑并重新读取合并。旧无版本 API 为兼容保留，不提供并发保护。一个数据目录只由一个服务进程使用。

发布记录日期为 YYYY-MM-DD，平台包括 douyin、xiaohongshu、both。复盘必须关联已发布记录，平台和日期必须相容。同一内容、平台、采集日期唯一。未采集指标可为 null；净增关注可为负整数。

## 热点

| 接口 | 行为 |
|---|---|
| POST /api/trigger-fetch | GitHub/Hacker News/头条抓取；返回每个来源的 success/error 和数量 |
| POST /api/brief/generate | 当日热点规则整理；无内容返回 brief:null |
| POST /api/today/recommend | 基于来源和关键词的规则评分，使用 settings.weights |

没有语言模型调用。源失败会显示错误并保留最近内容；全部失败返回 502。后台默认启动后抓取并每 30 分钟更新，AUTO_FETCH=0 关闭后台抓取。

## 项目与内容

| 接口 | 请求/返回 |
|---|---|
| GET /api/projects | projects 摘要；包含真实状态、videoMeta、staleVideo |
| GET /api/projects/:slug | project、content、coverFields、files、job、version |
| PUT /api/projects/:slug/content | `{title?, plan?, copy?, storyboard?, version?}` |
| POST /api/projects/generate-blueprint | `{slug}`；返回 mode:template、storyboard、html_content、copy_content；不自动保存 |
| POST /api/projects/save-script | `{slug, storyboard, copy_content?, version?}`；拒绝仅提交任意 HTML |
| POST /api/projects/generate-cover-svg | `{slug, version?}`；重新生成模板封面 |
| POST /api/projects/update-cover | `{slug, fields, version?}`；从字段重新渲染，支持重复编辑 |
| GET /api/projects/:slug/files/:kind | kind: video、cover、copy、plan、preview、subtitles；?download=1 下载 |

新选题会建立唯一项目目录；纯中文同日标题不会冲突。旧项目不会因为查看而生成或覆盖脚本。已有旧 HTML 的浏览器预览在严格 sandbox/CSP 中运行，远程脚本被禁用；旧 GSAP/CDN 动效需迁移到结构化分镜，不能宣称已渲染验证。

分镜结构：

```json
{
  "title": "视频标题",
  "theme": "midnight",
  "aspect": "9:16",
  "scenes": [
    {"title": "镜头标题", "body": "画面正文", "duration": 5}
  ]
}
```

theme 为 midnight / paper / lime；aspect 为 9:16 / 16:9 / 1:1。1–12 镜头，每镜 2–15 秒，总计至多 120 秒；标题最多 80 字，正文最多 260 字/6 行。视频总标题最多 120 字。超容量内容明确拒绝，不静默丢失正文。

## 任务与交付

| 接口 | 行为 |
|---|---|
| POST /api/projects/render | `{slug}`；排队，重复提交活动任务返回同一任务 |
| GET /api/projects/render-status/:slug | 当前项目最新任务 |
| GET /api/jobs | 持久化任务列表 |
| POST /api/projects/render-cancel | `{slug}`；取消排队/运行中任务 |
| POST /api/projects/archive | `{slug}`；视频 ffprobe 校验、封面、文案齐备且分镜未过期才允许；重复归档幂等 |
| POST /api/projects/open-folder | `{slug, sub?}`；打开该项目本地目录，不是下载/发布 |

状态：queued → rendering → completed / failed / cancelled。重启遇到未完成任务会标记中断失败，需用户重试。默认单任务编码、最大排队 20 条、最长执行 15 分钟。

成片版本保存在 `03-成品/versions/<job-id>/`，含 video.mp4、subtitles.srt、video-meta.json。全部完成后原子更新 current-video.json；失败不覆盖旧版本。编辑分镜后旧成片仍可下载，但标为过期，不能作为新版归档。

输出：H.264 / yuv420p / 24fps / 无音轨。9:16 为 720×1280；16:9 为 1280×720；1:1 为 900×900。以实际返回 metadata 为准。

## 错误

400 输入格式错误；404 未知资源；409 版本冲突、项目繁忙或交付不完整；413 请求/文件过大；429 队列已满；502 热点源失败；503 数据损坏或渲染依赖不具备。响应 `{ok:false,error,code}`，不将失败包装为成功。
