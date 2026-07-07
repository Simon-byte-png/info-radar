import { Readable } from 'node:stream';
import FeedParser from 'feedparser';
import sanitizeHtml from 'sanitize-html';

export async function parseRssFeed(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'SiliconValleyInfoRadar/0.1 (+personal research bot)'
    }
  });

  if (!response.ok) {
    throw new Error(`RSS 请求失败 ${response.status} ${response.statusText}: ${url}`);
  }

  const xml = await response.text();
  return parseXml(xml);
}

function parseXml(xml) {
  return new Promise((resolve, reject) => {
    const items = [];
    const feedparser = new FeedParser({ normalize: true });

    feedparser.on('error', reject);
    feedparser.on('readable', function onReadable() {
      let item;
      while ((item = this.read())) {
        items.push({
          title: item.title || 'Untitled',
          guid: item.guid || item.id || item.link,
          link: item.link,
          publishedAt: toIso(item.pubdate || item.date),
          description: cleanText(item.description || item.summary || ''),
          summary: cleanText(item.summary || item.description || ''),
          enclosures: normalizeEnclosures(item.enclosures || item.enclosure)
        });
      }
    });
    feedparser.on('end', () => resolve(items));

    Readable.from([xml]).pipe(feedparser);
  });
}

function normalizeEnclosures(enclosures) {
  const list = Array.isArray(enclosures) ? enclosures : enclosures ? [enclosures] : [];
  return list.map((e) => ({
    url: e.url || e.href,
    type: e.type || '',
    length: e.length
  })).filter((e) => e.url);
}

export function findAudioUrl(item) {
  const audio = item.enclosures?.find((e) => `${e.type || ''}`.startsWith('audio/'));
  return audio?.url || null;
}

function cleanText(html) {
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 6000);
}

function toIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
