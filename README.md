# Silicon Valley Info Radar

一个面向硅谷一手采访/播客的 RSS 信息搜集系统 MVP：

- 从精选 RSS 源抓取最新访谈、播客和发现型平台内容
- 对音频内容调用 API 转写（whisper-1）
- 生成不过度压缩、保留原汁原味的中文摘要与要点
- 用本地 JSON 文件存储处理状态和结果（零原生依赖，冷启动瞬时）
- 提供网页阅读界面，后续可平滑迁移到小程序形态

> 📖 **本地 Agent 请先读 [`AGENTS.md`](AGENTS.md)**（项目结构与改动指南）；
> 上线流程见 [`DEPLOY.md`](DEPLOY.md)。

## 快速开始

```bash
cd info-radar
npm install
cp .env.example .env
# 编辑 .env，填入 OPENAI_API_KEY
npm run check        # 检查各 RSS 源连通性
npm run ingest:dry   # 只抓取 RSS 元数据，不下载/转写（免 API）
npm run ingest       # 处理最新高分音频：下载→转写→生成中文摘要
npm run dev          # 打开网页阅读界面
```

## 数据流

```
sources.json (信息源清单)
   → src/ingest.js  抓 RSS → 打质量分 → 高分音频转写 → LLM 出摘要
   → data/store.json 存储
   → src/server.js + public/  网页阅读
```

## 关键文件

- `sources.json`：信息源清单，改这个文件即可增删源
- `src/scoring.js`：质量打分规则，决定哪些内容值得花钱转写
- `src/ai.js`：转写与摘要的 prompt（已强调"保留原味、不过度压缩"）
- `src/ingest.js`：采集主流程，支持 `--limit=N --min-score=N --dry-run`

## 每日自动化

两种方式，按部署形态选一个：

**方式一：系统 cron（推荐，最省心）** — 每天跑一次采集脚本：

```bash
0 9 * * *  cd /path/to/info-radar && npm run ingest >> data/ingest.log 2>&1
```

**方式二：服务内置调度** — 让常驻的网页服务自己每天定时采集。设置环境变量后启动 `npm run dev`：

```bash
DAILY_INGEST=on          # 开启内置调度
DAILY_INGEST_HOUR=9      # 每天几点（配合 TZ_OFFSET_MINUTES，默认北京时间 480）
DAILY_LIMIT=5            # 每天最多成稿几条
```

> 注意：内置调度只在服务持续运行时有效。若部署在会被回收的预览环境，请用方式一的系统 cron。

## 今日推送视图

- 网页顶部「今日 N」实时显示当天成稿数量
- 「今日新增」标签页只看当天推送的新文稿，带推送横幅
- 接口：`GET /api/today` 返回当天成稿列表（供小程序端每日拉取推送）

## 设计原则

- 不整篇堆积转写稿，只保留足够上下文的摘要、原句摘录、人物/公司/话题标签
- 优先跟踪 RSS，可扩展到 YouTube、Newsletter、发现型目录
- 先做网页阅读，后续再封装小程序（阅读界面已是纯 API 驱动，套壳即可复用）
