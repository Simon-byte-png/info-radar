import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
const dbPath = path.join(dataDir, 'store.json');

// 轻量 JSON 文件存储：数据量小（数十~数百条），零原生依赖，冷启动瞬时。
let state = { sources: {}, episodes: {} };
let loaded = false;

export function initDb() {
  if (loaded) return;
  fs.mkdirSync(dataDir, { recursive: true });
  if (fs.existsSync(dbPath)) {
    try {
      state = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
      state.sources ||= {};
      state.episodes ||= {};
    } catch {
      state = { sources: {}, episodes: {} };
    }
  }
  loaded = true;
}

function persist() {
  const tmp = `${dbPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, dbPath);
}

export function upsertSource(source) {
  initDb();
  state.sources[source.id] = {
    id: source.id,
    name: source.name,
    type: source.type,
    rss_url: source.rssUrl,
    language: source.language,
    priority: source.priority,
    themes: source.themes || [],
    why: source.why
  };
  persist();
}

export function upsertEpisode(episode) {
  initDb();
  const existing = state.episodes[episode.id] || {};
  state.episodes[episode.id] = {
    ...existing,
    id: episode.id,
    source_id: episode.sourceId,
    guid: episode.guid,
    title: episode.title,
    link: episode.link,
    audio_url: episode.audioUrl,
    published_at: episode.publishedAt,
    description: episode.description,
    status: existing.status && existing.status !== 'discovered' ? existing.status : (episode.status || 'discovered'),
    quality_score: episode.qualityScore ?? existing.quality_score ?? 0,
    score_reasons: episode.scoreReasons || existing.score_reasons || [],
    transcript: existing.transcript || null,
    digest: existing.digest || null,
    error: existing.error || null,
    created_at: existing.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  persist();
}

export function markEpisodeProcessed(id, { transcript, digest, kind, provider }) {
  initDb();
  const ep = state.episodes[id];
  if (!ep) return;
  ep.status = 'processed';
  ep.transcript = transcript || null;
  ep.digest = digest;
  ep.kind = kind || 'transcript';
  ep.provider = provider || null;
  ep.error = null;
  ep.processed_at = new Date().toISOString();
  ep.updated_at = new Date().toISOString();
  persist();
}

export function markEpisodeError(id, error) {
  initDb();
  const ep = state.episodes[id];
  if (!ep) return;
  ep.status = 'error';
  ep.error = String(error).slice(0, 2000);
  ep.updated_at = new Date().toISOString();
  persist();
}

function withSource(ep) {
  const source = state.sources[ep.source_id] || {};
  return {
    ...ep,
    source_name: source.name || ep.source_id,
    source_type: source.type || '',
    source_themes: source.themes || []
  };
}

function sortKey(ep) {
  return ep.published_at || ep.created_at || '';
}

export function listEpisodes({ limit = 50 } = {}) {
  initDb();
  return Object.values(state.episodes)
    .sort((a, b) => (sortKey(b) > sortKey(a) ? 1 : sortKey(b) < sortKey(a) ? -1 : (b.quality_score || 0) - (a.quality_score || 0)))
    .slice(0, limit)
    .map(withSource);
}

export function getEpisode(id) {
  initDb();
  const ep = state.episodes[id];
  return ep ? withSource(ep) : null;
}

export function getNextProcessableEpisodes({ limit = 3, minScore = 70 } = {}) {
  initDb();
  return Object.values(state.episodes)
    .filter((e) => e.status === 'discovered' && e.audio_url && (e.quality_score || 0) >= minScore)
    .sort((a, b) => (b.quality_score || 0) - (a.quality_score || 0) || (sortKey(b) > sortKey(a) ? 1 : -1))
    .slice(0, limit)
    .map(withSource);
}

// 所有待处理内容（音频或文本），按分数排序，供采集流程分派。
// 含 error 状态：瞬时失败的条目在下次运行时自动重试。
export function getDiscovered({ minScore = 70 } = {}) {
  initDb();
  return Object.values(state.episodes)
    .filter((e) => (e.status === 'discovered' || e.status === 'error') && (e.quality_score || 0) >= minScore)
    .sort((a, b) => (b.quality_score || 0) - (a.quality_score || 0) || (sortKey(b) > sortKey(a) ? 1 : -1))
    .map(withSource);
}

// 今日推送：今天处理成稿的内容（按处理时间的本地日期）。
export function getTodayDigest({ tzOffsetMinutes = 480 } = {}) {
  initDb();
  const todayKey = localDateKey(new Date().toISOString(), tzOffsetMinutes);
  return Object.values(state.episodes)
    .filter((e) => e.status === 'processed' && e.processed_at && localDateKey(e.processed_at, tzOffsetMinutes) === todayKey)
    .sort((a, b) => (b.processed_at > a.processed_at ? 1 : -1))
    .map(withSource);
}

function localDateKey(iso, tzOffsetMinutes) {
  const d = new Date(new Date(iso).getTime() + tzOffsetMinutes * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

export function stats() {
  initDb();
  const counts = {};
  for (const e of Object.values(state.episodes)) {
    counts[e.status] = (counts[e.status] || 0) + 1;
  }
  return Object.entries(counts).map(([status, count]) => ({ status, count }));
}
