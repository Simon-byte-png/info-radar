# DEPLOY.md — 上线流程

本文档带你把 info-radar 从本地推到 GitHub，并部署上线。

---

## 一、准备（本地）

```bash
cd info-radar
npm install
cp .env.example .env      # 填入你的密钥，见下方「环境变量」
npm run check             # 确认 RSS 源可达
npm run ingest            # 先跑一轮，确认能成稿
npm run dev               # 本地预览 http://localhost:3000
```

### 环境变量（.env）

| 变量 | 必填 | 说明 |
|------|------|------|
| `OPENAI_API_KEY` | 音频转写必填 | 没有则跳过播客音频、只处理文本源 |
| `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` | 二选一 | 无 OpenAI key 时用它做摘要 |
| `SUMMARY_MODEL` | 否 | 覆盖模型，须与后端匹配（gpt-* 或 claude-*） |
| `LOOKBACK_DAYS` | 否 | 只处理最近 N 天内容，默认 14 |
| `DAILY_INGEST` | 否 | `on` 开启服务内置每日调度 |
| `DAILY_INGEST_HOUR` | 否 | 每日采集的小时（配合 TZ_OFFSET_MINUTES） |
| `PORT` / `HOST` | 否 | 服务监听地址，部署平台通常自动注入 |

---

## 二、推送到 GitHub

```bash
# 1. 初始化仓库
git init
git add .
git commit -m "feat: 硅谷一手信息搜集系统 MVP（RSS 采集 + 摘要 + 阅读界面）"

# 2. 在 GitHub 新建一个空仓库（例如 info-radar），然后：
git branch -M main
git remote add origin git@github.com:<你的用户名>/info-radar.git
git push -u origin main
```

> `.gitignore` 已排除 `node_modules/`、`.env`、`data/store.json`。
> **确认 `.env` 没被提交**（`git status` 里不应出现它），密钥绝不上传。

---

## 三、部署上线（任选一种）

### 方式 A：任意 Node 主机 / VPS

```bash
git clone <你的仓库>
cd info-radar
npm install --omit=dev
cp .env.example .env && vi .env      # 填密钥
# 用 pm2 常驻
npm i -g pm2
pm2 start src/server.js --name info-radar
pm2 save
```

每日采集二选一：
- **服务内置调度**：`.env` 里设 `DAILY_INGEST=on`，服务会自己每天跑
- **系统 cron**：`0 9 * * * cd /path/to/info-radar && npm run ingest >> data/ingest.log 2>&1`

### 方式 B：Railway / Render / Fly.io 等 PaaS

- Start command：`node src/server.js`
- 在平台面板配置环境变量（同上表）
- 平台会注入 `PORT`，代码已读取
- 每日采集用平台的 Cron / Scheduled Job 跑 `npm run ingest`
- 注意：这类平台文件系统可能非持久，`data/store.json` 会丢。生产建议把存储换成
  平台提供的持久卷，或替换 `src/db.js` 为托管数据库（见下）

### 方式 C：Docker

项目无原生依赖，Dockerfile 很简单：

```dockerfile
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
EXPOSE 3000
CMD ["node", "src/server.js"]
```

```bash
docker build -t info-radar .
docker run -d -p 3000:3000 --env-file .env -v $(pwd)/data:/app/data info-radar
```

（`-v` 挂载 data 目录保证数据持久）

---

## 四、生产化建议（按需）

1. **持久存储**：`data/store.json` 适合单机。多实例或无持久盘时，把 `src/db.js`
   换成 Postgres/SQLite/托管 KV——`db.js` 已是清晰的读写 API 层，替换不影响其它模块。
2. **音频转写成本**：一集 1.5h 播客 Whisper 约 $0.5。用 `scoring.js` 的阈值和
   `ingest --limit` 控制每天处理量。
3. **接入小程序**：小程序端每天调 `GET /api/today` 拉当天推送；单篇详情 `GET /api/episodes/:id`。
   接口已是纯 JSON，套壳即可。
4. **源可达性**：某些托管（Substack/Libsyn）在部分网络下不可达，换正常出网环境即可；
   用 `npm run check` 随时体检。

---

## 五、接口速查（给小程序 / 前端）

| 接口 | 说明 |
|------|------|
| `GET /api/today` | 当天成稿列表（每日推送用） |
| `GET /api/episodes` | 全部内容卡片 + 统计 + today_count |
| `GET /api/episodes/:id` | 单篇完整摘要 |
| `GET /health` | 健康检查 |
