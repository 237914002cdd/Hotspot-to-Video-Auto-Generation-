# Pipeline Studio 工作交接

- 实际源码：D:\codex\hotspot-video-platform；分支 codex/creator-platform；远程为用户指定 Hotspot-to-Video-Auto-Generation- 仓库。任务原绑定目录与仓库不同，所有操作显式使用实际目录。
- 用户确认：个人创作者/小团队，保留现有视觉；先完成本地制作流程，AI 服务之后接入。用户要求前端可见并继续工作。
- 本次实现：真实热点及来源状态、选题项目关联、内容和分镜编辑、三画幅文字动效 MP4/SRT、封面编辑、可靠任务状态和取消、成片版本与过期检测、人工日历/发布/复盘、JSON 导出、持久化/备份/保存冲突及本机安全边界；删除假指标和假 AI 成功提示。字体与 CSS 已本地化。
- 最新验证：2026-09-23 01:13–01:14，npm test 37/37 无跳过；npm run test:ui 完整流程通过；构建通过；npm audit 0 已知漏洞。独立复核确认跨项目异步污染修复。具体证据、边界和命令见 docs/ACCEPTANCE.md。
- 真实热点：GitHub10 + HN6 + 头条10，共26条成功。
- 可见前端：http://127.0.0.1:3456；服务使用本仓库 看板/server.js，AUTO_FETCH=1，已通过原启动会话正常重启；当前 exec 会话 19954。不要无差别停止 node 进程。
- 演示项目：项目\20260923-topic-14716609；明确标记演示，17秒720×1280 MP4已完成并在独立Chromium播放至结尾。目录通过本地 .git/info/exclude 排除，运行数据也不提交。
- 浏览器：Codex 内置浏览器的恢复后前端页已保留；原页面点击原生播放控件曾崩溃，根因未定位；不可称内置浏览器播放已验收。独立Chromium端到端及完整17秒播放均通过。
- 文档：README.md、docs/USER_GUIDE.md、docs/API_REFERENCE.md、docs/CREATOR_PLATFORM_STRATEGY.md、docs/ACCEPTANCE.md。商业研究用 OpusClip 客户案例、Descript 和 Buffer 官方资料，方案是推论，不虚构营收。
- 后续：模型与声音、素材剪辑、平台账号连接、多租户及支付需要另行实现和实测。当前工作区不提供公网多人能力。
- 提交交付：准备提交当前实现与验证报告，创建可审阅草稿 PR；不合并主分支。
