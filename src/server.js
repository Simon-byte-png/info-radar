import 'dotenv/config';
import path from 'node:path';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { initDb, listEpisodes, getEpisode, stats, getTodayDigest, setEpisodeFlag } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

initDb();

const app = express();
const HOST = process.env.HOST || '0.0.0.0';
const PORT = process.env.PORT || process.env.ZAOCODE_PREVIEW_PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(rootDir, 'public')));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'info-radar', stats: stats() });
});

app.get('/api/episodes', (_req, res) => {
  const episodes = listEpisodes({ limit: 100 }).map(toCard);
  const today = getTodayDigest();
  res.json({ episodes, stats: stats(), today_count: today.length });
});

app.get('/api/today', (_req, res) => {
  const episodes = getTodayDigest().map(toCard);
  res.json({ episodes, date: new Date().toISOString().slice(0, 10) });
});

function toCard(e) {
  return {
    id: e.id,
    title: e.title,
    source_name: e.source_name,
    source_type: e.source_type,
    published_at: e.published_at,
    processed_at: e.processed_at || null,
    status: e.status,
    kind: e.kind || null,
    quality_score: e.quality_score,
    link: e.link,
    digest_title: e.digest?.title_cn || null,
    one_sentence: e.digest?.one_sentence || null,
    topics: e.digest?.topics || [],
    read: Boolean(e.read),
    starred: Boolean(e.starred)
  };
}

app.get('/api/episodes/:id', (req, res) => {
  const episode = getEpisode(req.params.id);
  if (!episode) {
    return res.status(404).json({ error: 'not found' });
  }
  res.json({
    id: episode.id,
    title: episode.title,
    source_name: episode.source_name,
    source_type: episode.source_type,
    published_at: episode.published_at,
    status: episode.status,
    quality_score: episode.quality_score,
    score_reasons: episode.score_reasons,
    link: episode.link,
    audio_url: episode.audio_url,
    description: episode.description,
    digest: episode.digest,
    error: episode.error,
    read: Boolean(episode.read),
    starred: Boolean(episode.starred)
  });
});

// 更新阅读状态：{ read?: boolean, starred?: boolean }
app.post('/api/episodes/:id/state', (req, res) => {
  const { read, starred } = req.body || {};
  const updated = setEpisodeFlag(req.params.id, { read, starred });
  if (!updated) return res.status(404).json({ error: 'not found' });
  res.json({ id: updated.id, read: Boolean(updated.read), starred: Boolean(updated.starred) });
});

app.listen(PORT, HOST, () => {
  console.log(`Info Radar 阅读界面运行中： http://${HOST}:${PORT}`);
  maybeStartDailyScheduler();
});

// 可选的内置每日调度：常驻运行时每天自动跑一次采集。
// 由环境变量 DAILY_INGEST=on 开启（预览/部署常驻场景）；一次性预览默认关闭。
function maybeStartDailyScheduler() {
  if (process.env.DAILY_INGEST !== 'on') return;
  const hour = Number(process.env.DAILY_INGEST_HOUR || 9); // 本地时（默认北京时区偏移见 tzOffset）
  const tzOffsetMinutes = Number(process.env.TZ_OFFSET_MINUTES || 480);
  let lastRunKey = null;

  const tick = async () => {
    const now = new Date(Date.now() + tzOffsetMinutes * 60 * 1000);
    const key = now.toISOString().slice(0, 10);
    if (now.getUTCHours() === hour && lastRunKey !== key) {
      lastRunKey = key;
      console.log(`[scheduler] ${key} 触发每日采集`);
      try {
        const { runIngest } = await import('./ingest-core.js');
        const result = await runIngest({ limit: Number(process.env.DAILY_LIMIT || 5) });
        console.log(`[scheduler] 完成，本轮成稿 ${result.processed} 条`);
      } catch (e) {
        console.warn(`[scheduler] 采集失败：${e.message}`);
      }
    }
  };
  setInterval(tick, 60 * 1000);
  console.log(`[scheduler] 已启用每日采集：每天 ${hour}:00（tzOffset ${tzOffsetMinutes}min）`);
}
