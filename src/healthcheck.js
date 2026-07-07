import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRssFeed, findAudioUrl } from './rss.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

const sources = JSON.parse(await fs.readFile(path.join(rootDir, 'sources.json'), 'utf8'));
const target = process.argv[2];
const list = target ? sources.filter((s) => s.id === target || s.name === target) : sources;

console.log(`检查 ${list.length} 个 RSS 源的连通性与结构...\n`);

let ok = 0;
let failed = 0;

for (const source of list) {
  try {
    const items = await parseRssFeed(source.rssUrl);
    const withAudio = items.filter((i) => findAudioUrl(i)).length;
    const latest = items[0];
    console.log(`✓ ${source.name}`);
    console.log(`  条目 ${items.length}，含音频 ${withAudio}`);
    if (latest) console.log(`  最新：${latest.title} (${latest.publishedAt || '无日期'})`);
    ok += 1;
  } catch (error) {
    console.log(`× ${source.name}: ${error.message}`);
    failed += 1;
  }
  console.log('');
}

console.log(`完成：${ok} 个可用，${failed} 个失败。`);
if (!process.env.OPENAI_API_KEY) {
  console.log('提示：未检测到 OPENAI_API_KEY，转写与摘要功能需要在 .env 中配置后才能运行。');
}
