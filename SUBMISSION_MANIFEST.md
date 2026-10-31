# 知澜智慧校园提交清单

生成日期：2026-10-31

## 包内内容

- 完整 React + TypeScript 前端源码。
- Node.js REST API、SQLite 数据层、认证与 AI 适配器。
- 可重复执行的种子脚本和演示账号。
- 生产构建后的 `dist`。
- API 自动化测试、全站 Playwright E2E、登录注册与双浏览器实时专项测试。
- `playwright-core` 开发依赖与系统 Microsoft Edge 测试运行说明。
- 19 张全站、7 张登录注册和 2 张实时推送验收截图。
- 项目 README、环境变量模板、技术架构、部署说明、团队分工、比赛提交稿和视频脚本。
- 19 页 PDF 技术文档，覆盖项目概述、需求分析、系统架构、AI 方案、核心实现、测试部署、创新点和展望。

提交包不包含：

- `node_modules`
- 测试数据库与演示数据库
- `data/backup`、运行日志和临时文件
- `.env`、API Key 或任何真实账号凭据
- 旧版提交 ZIP 和临时解压目录

## 已验证结果

- `pnpm build`：通过。
- `pnpm test:api`：8 项全部通过，含登录限流 5 秒后自动恢复。
- `pnpm test:all`：完整的 API、E2E、认证与实时测试链通过，退出码为 0。
- `pnpm test:e2e`：通过，19 张截图。
- `pnpm test:auth`：学生注册、教师邀请码注册、重复账号校验与重新登录全部通过，7 张截图。
- `pnpm test:realtime`：教师发布作业后学生端自动更新，学生签到后教师名单自动更新，2 张截图。
- `pnpm dev`：一条命令同时启动 Vite 与 API，经 Vite 代理访问健康检查返回 200。
- `pnpm audit --prod`：无已知漏洞。
- 按钮静态审计：所有按钮都有提交或点击行为。
- 浏览器控制台：除认证测试刻意触发的预期状态码外无错误。
- 技术文档：19 页 A4，PDF 文字提取、页数和逐页渲染检查通过。

## 启动

```powershell
pnpm install
Copy-Item .env.example .env
pnpm seed
pnpm dev
```

开发地址为 `http://127.0.0.1:5174`，前端与 API 会由同一条命令启动。

生产演示模式：

```powershell
pnpm build
pnpm start
```

访问 `http://127.0.0.1:5175`。

## 技术文档

- 文件：`artifacts/submission/知澜智慧校园-技术文档.pdf`
- 页数：19 页，不超过比赛要求的 30 页。
- SHA-256：`A276BEC9F1A954FB929FFA5A1D01D015EE0E555CE9D10D40614D6F5F2BA1F8D0`
- 校验：已完成文字提取、乱码检查、页数检查和逐页视觉检查。
- 生成脚本：`scripts/build-technical-document.py`，可重复构建。

## 演示账号

- 学生：`2024001 / Campus@2026`
- 教师：`T1001 / Teacher@2026`

## 提交前必须由参赛者补充

- 公网 HTTPS 演示地址。
- 长期有效的网盘链接和提取码。
- 作品讲解视频公开链接。
- 评审期可用的 `AI_API_KEY`、`AI_BASE_URL` 和 `AI_MODEL`。
- 报名组别、团队成员实名、学校和指导教师信息，以及实际发表/获奖情况。
- GitHub 或 Gitee 公开仓库地址，并推送本地 Git 历史。

所有外部链接和个人信息必须按实际情况填写，不得编造。
