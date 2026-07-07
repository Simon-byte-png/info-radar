import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { initDb, upsertSource, upsertEpisode, getDiscovered, markEpisodeProcessed, markEpisodeError, stats } from './db.js';
import { parseRssFeed, findAudioUrl } from './rss.js';
import { scoreEpisode } from './scoring.js';
import { transcribeAudioUrl, createDigest, canTranscribe, summarizerProvider } from './ai.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const MIN_TEXT_LEN = 300;

export async function runIngest({ limit = 3, minScore = 70, dryRun = false, log = console.log } = {}) {
  initDb();
  const lookbackDays = Number(process.env.LOOKBACK_DAYS || 14);
  const sources = JSON.parse(await fs.readFile(path.join(rootDir, 'sources.json'), 'utf8'));
  for (const source of sources) upsertSource(source);

  log(`开始抓取 ${sources.length} 个 RSS 源...`);
  let discovered = 0;

  for (const source of sources) {
    try {
      const items = await parseRssFeed(source.rssUrl);
      const recentItems = items.filter((item) => isRecent(item.publishedAt, lookbackDays)).slice(0, 8);
      for (const item of recentItems) {
        const { score, reasons } = scoreEpisode({ source, item });
        upsertEpisode({
          id: episodeId(source.id, item.guid || item.link || item.title),
          sourceId: source.id,
          guid: item.guid || item.link || item.title,
          title: item.title,
          link: item.link,
          audioUrl: findAudioUrl(item),
          publishedAt: item.publishedAt,
          description: item.description,
          qualityScore: score,
          scoreReasons: reasons
        });
        discovered += 1;
      }
      log(`✓ ${source.name}: ${recentItems.length}/${items.length} 条近期内容`);
    } catch (error) {
      log(`× ${source.name}: ${error.message}`);
    }
  }
  log(`RSS 抓取完成，发现/更新 ${discovered} 条内容。`);

  if (dryRun) {
    log('dry-run 模式：已跳过音频下载、转写和摘要生成。');
    return { discovered, processed: 0, skippedAudio: 0, stats: stats() };
  }

  const provider = summarizerProvider();
  if (!provider) {
    log('未配置摘要后端（缺 OPENAI_API_KEY 或 Anthropic 端点），跳过成稿。');
    return { discovered, processed: 0, skippedAudio: 0, stats: stats() };
  }
  log(`摘要后端：${provider}${canTranscribe() ? '（含音频转写）' : '（无音频转写，仅处理文本源）'}`);

  const all = getDiscovered({ minScore });
  let processed = 0;
  let skippedAudio = 0;

  for (const episode of all) {
    if (processed >= limit) break;
    const isAudio = Boolean(episode.audio_url);
    const hasText = (episode.description || '').length >= MIN_TEXT_LEN;
    if (isAudio && !canTranscribe()) { skippedAudio += 1; continue; }
    if (!isAudio && !hasText) continue;

    log(`\n处理：${episode.source_name} · ${episode.title}`);
    try {
      let text;
      let kind;
      if (isAudio) {
        log('  下载并转写音频...');
        text = await transcribeAudioUrl(episode.audio_url);
        kind = 'transcript';
      } else {
        text = episode.description;
        kind = 'article';
      }
      const digest = await createDigest({ episode, text, kind });
      markEpisodeProcessed(episode.id, { transcript: isAudio ? text : null, digest, kind, provider });
      processed += 1;
      log(`✓ 已生成摘要（${kind}）：${digest.title_cn || episode.title}`);
    } catch (error) {
      markEpisodeError(episode.id, error);
      log(`× 处理失败：${error.message}`);
    }
  }

  log(`\n本轮成稿 ${processed} 条${skippedAudio ? `，跳过 ${skippedAudio} 条音频（当前环境无转写能力）` : ''}。`);
  return { discovered, processed, skippedAudio, stats: stats() };
}

function isRecent(iso, days) {
  if (!iso) return true;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return true;
  return date.getTime() >= Date.now() - days * 24 * 60 * 60 * 1000;
}

function episodeId(sourceId, guid) {
  return `${sourceId}-${crypto.createHash('sha1').update(String(guid)).digest('hex').slice(0, 16)}`;
}
