# 比赛提交核验表

## 自动核验

- [x] `pnpm build` 构建成功。
- [x] `pnpm test:api` API 回归通过。
- [x] `pnpm test:e2e` 浏览器流程与截图回归通过。
- [x] `pnpm test:auth` 双角色认证回归通过。
- [x] `pnpm test:realtime` 双浏览器实时更新回归通过。
- [x] 已检查桌面端和移动端关键页面。
- [x] 已确认所有可见业务操作连接真实状态或接口。

## 材料核验

- [x] README 包含项目介绍、技术架构、安装运行、团队信息和环境变量。
- [x] `.env.example` 包含完整配置模板。
- [x] `package.json` 与 `pnpm-lock.yaml` 提供可复现依赖。
- [x] 技术文档 PDF 不超过 30 页，包含要求章节。
- [x] 技术文档重点说明 AI 选型、集成与优化。
- [x] 技术文档明确列出技术创新点和应用创新点。
- [x] 28 张功能验收截图已归档。
- [x] 源码、数据、日志和密钥具备 `.gitignore` 边界。

## 参赛者实名与外部平台信息

- [ ] 在 `docs/TEAM.md` 填写真实成员、学校和指导教师。
- [ ] 创建 GitHub 或 Gitee 公开仓库并推送完整 Git 历史。
- [ ] 在 README 填写最终公开仓库地址。
- [ ] 部署公网 HTTPS 演示环境，并确认持久磁盘可用。
- [ ] 配置评审期可用的 AI Key，或明确采用本地教学引擎。
- [ ] 更换生产教师邀请码和演示密码。
- [ ] 按实际部署地址更新报名表、作品说明和演示视频链接。

## 核验命令

```bash
git log --oneline --graph
pnpm build
pnpm test:all
```

最终公开仓库不得包含 `.env`、`data/*.db`、`data/test-runs/`、`data/runtime-logs/`、`work/`、`node_modules/` 或 API Key。
