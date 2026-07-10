# AGENTS.md — 给本地 AI Agent 的项目说明

> 这是一个「硅谷一手信息搜集系统」。目标：订阅硅谷优质采访/播客的 RSS 源，
> 自动抽取值得读的内容，音频转写成文字，生成**保留原味、不过度压缩**的中文摘要要点，
> 每天推送到阅读界面。最终形态是微信小程序，当前是网页阅读界面（纯 API 驱动，便于套小程序壳）。

## 技术栈

- 运行时：Node.js ≥ 18（用到内置 `fetch`、ESM）
- 后端：Express（`src/server.js`）
- 存储：**纯 JSON 文件**（`data/store.json`），无数据库、无原生依赖，冷启动瞬时
- 前端：原生 HTML/CSS/JS（`public/`），无构建步骤
- AI：音频转写走 OpenAI Whisper；摘要走 OpenAI 或 Anthropic（二选一，见下）

> ⚠️ 不要引入 better-sqlite3 或其它原生模块——最初用过，在网络文件系统上编译产物不稳定、
> 冷启动找不到 binding。JSON 存储对这个数据量（数十~数百条）完全够用。

## 目录结构

```
info-radar/
├── sources.json          # 【改这里增删信息源】RSS 源清单
├── src/
│   ├── server.js         # Express 服务 + 每日内置调度器；提供网页和 API
│   ├── ingest-core.js    # 采集主逻辑（抓RSS→打分→转写/摘要→入库），可被 CLI 和调度器复用
│   ├── ingest.js         # CLI 包装：node src/ingest.js --limit=N --min-score=N --dry-run
│   ├── rss.js            # RSS 抓取与解析（feedparser），提取音频 enclosure
│   ├── scoring.js        # 质量打分规则（决定哪些内容值得花钱处理）
│   ├── ai.js             # 转写 + 摘要，按后端自动选 OpenAI/Anthropic，含重试
│   ├── db.js             # JSON 文件存储的读写 API
│   └── healthcheck.js    # 检查各 RSS 源连通性：node src/healthcheck.js
├── public/               # 网页阅读界面（index.html / styles.css / app.js）
├── data/store.json       # 运行时数据（.gitignore 排除；data/store.sample.json 是脱敏示例）
└── .env                  # 密钥与配置（.gitignore 排除；从 .env.example 复制）
```

## 数据流

```
sources.json
  → ingest-core.js: parseRssFeed → scoreEpisode(打分) → 分派：
        音频源 → transcribeAudioUrl(Whisper) → createDigest
        文本源 → 直接用正文 → createDigest
  → db.js: 写入 data/store.json（状态 discovered → processed / error）
  → server.js + public/: 网页阅读；GET /api/today 供小程序拉每日推送
```

## 一条数据（episode）的关键字段

`status`：`discovered`（已发现待处理）→ `processed`（已成稿）/ `error`（失败，下次自动重试）
`kind`：`article`（文本源，无需转写）/ `transcript`（音频转写）
`quality_score`：0-100，`ingest` 默认只处理 ≥70 分的
`digest`：摘要对象（title_cn / one_sentence / key_points / notable_quotes / people_and_orgs / topics / why_it_matters / follow_up_questions）

## 本地起步

```bash
npm install
cp .env.example .env      # 按需填 OPENAI_API_KEY（音频转写需要）
npm run check             # 检查 RSS 源连通性
npm run ingest:dry        # 只抓 RSS 不花钱，验证源可用
npm run ingest            # 真处理：转写 + 摘要
npm run dev               # 打开阅读界面 http://localhost:3000
```

## 摘要后端的选择（重要）

`src/ai.js` 里 `summarizerProvider()` 逻辑：
- 配了 `OPENAI_API_KEY` → 用 OpenAI（默认 `gpt-4o-mini`）
- 否则若有 `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` → 用 Anthropic（默认 `claude-sonnet-5`）

> ⚠️ `SUMMARY_MODEL` 必须与后端匹配：给 OpenAI 填 `gpt-*`、给 Anthropic 填 `claude-*`。
> 填错前缀会被忽略并回退默认，避免把模型名发错家（曾导致 `No available accounts` 报错）。

音频转写仅支持 OpenAI Whisper；没有 `OPENAI_API_KEY` 时会自动跳过音频源、只处理文本源。

## 改动指南（常见任务）

- **加/删信息源** → 只改 `sources.json`，跑 `npm run check` 验证
- **调整"什么算优质内容"** → 改 `src/scoring.js` 的信号权重
- **调整摘要风格** → 改 `src/ai.js` 的 `SYSTEM_PROMPT` 和 `buildUserPayload` 的 schema
- **改前端** → `public/`，无构建，直接刷新

上线流程见 `DEPLOY.md`。

## HTTP 接口

| 接口 | 说明 |
|------|------|
| `GET /api/today` | 当天成稿列表（每日推送用） |
| `GET /api/episodes` | 全部内容卡片 + stats + today_count |
| `GET /api/episodes/:id` | 单篇完整摘要（含 read/starred） |
| `POST /api/episodes/:id/state` | 更新阅读状态，body `{read?:bool, starred?:bool}` |
| `GET /health` | 健康检查 |

## 阅读器功能（前端）

- 标签页：今日新增 / 未读 / 收藏 / 已成稿 / 全部 / 待处理
- 搜索框：跨标题/摘要/话题/来源检索；来源下拉筛选
- 打开文稿自动标记已读；卡片和阅读器可星标收藏（`POST .../state` 持久化到 store.json）
- 键盘 `j` / `k` 上下浏览

