# 部署与运维说明

## 1. 运行要求

- Node.js `>= 22.13.0`，推荐 Node.js 24 LTS。
- pnpm `10+` 或 `11+`。
- 支持常驻 Node.js 进程和持久化磁盘的 Linux 云主机、Render、Railway 或同类平台。
- 生产入口必须配置 HTTPS 反向代理。

纯静态托管无法执行认证、SQLite、SSE 和业务 API，不能只上传 `dist/`。

## 2. 安装与启动

```bash
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
pnpm seed
pnpm build
pnpm start
```

生产服务默认监听 `5175`，同时提供 `/api/*` 和 `dist/` 静态资源。

当前公网访问入口：`http://weigxh.cn:5555`。

## 3. 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `PORT` | 否 | 服务端口，默认 `5175` |
| `SESSION_IDLE_MINUTES` | 否 | 无操作登录有效期，默认 `20` 分钟，服务端限制为 `1-120` |
| `TEACHER_INVITE_CODE` | 生产必填 | 教师注册邀请码，必须替换默认值 |
| `DATABASE_PATH` | 生产必填 | SQLite 持久化文件路径 |
| `AI_API_KEY` | 否 | OpenAI-compatible 服务密钥，不配置时使用本地教学引擎 |
| `AI_BASE_URL` | 否 | 兼容 Chat Completions 的基础地址 |
| `AI_MODEL` | 否 | 远程模型名称 |
| `SEED_STUDENT_PASSWORD` | 否 | 初始化演示学生密码 |
| `SEED_TEACHER_PASSWORD` | 否 | 初始化演示教师密码 |

生产环境示例：

```dotenv
PORT=5175
SESSION_IDLE_MINUTES=20
TEACHER_INVITE_CODE=replace-with-a-strong-random-value
DATABASE_PATH=/var/lib/zhilan/zhilan.db
AI_API_KEY=
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4o-mini
```

## 4. 反向代理

反向代理必须支持 SSE：

- 对 `/api/events` 关闭响应缓冲。
- 将连接超时设置到大于 20 秒心跳周期。
- 保留 `Last-Event-ID` 和正常 HTTP 流式响应。
- 为站点启用 HTTPS，并确保 Cookie 在安全环境中传输。

## 5. 数据持久化与备份

SQLite 文件需要放在持久化磁盘。备份时同时考虑 `zhilan.db`、`zhilan.db-wal` 和 `zhilan.db-shm`。

建议每日执行：

1. 停止写入或短暂锁定数据库。
2. 复制数据库与 WAL 文件到独立备份目录。
3. 记录备份时间和 SHA-256。
4. 每月执行一次恢复演练。

不得将数据库、`.env`、真实账号、API Key 或运行日志提交到公开仓库。

## 6. 上线核验

```bash
pnpm build
pnpm test:api
pnpm test:e2e
pnpm test:auth
pnpm test:realtime
```

上线后检查：

- `GET /api/health` 返回正常状态。
- 学生与教师注册、登录和退出可用。
- 教师发布作业后学生端实时收到。
- 学生签到后教师名单实时更新。
- AI 页面正确显示远程模型或本地教学引擎。
- HTTPS、持久盘、备份任务和日志轮转已启用。

## 7. 运维边界

当前架构适合单实例比赛演示和中小规模课程试点。多实例部署前应将 SQLite 迁移至 PostgreSQL，将实时事件迁移至 Redis Pub/Sub 或消息队列，并补充集中日志、监控和密钥管理。
