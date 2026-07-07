import 'dotenv/config';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const OPENAI_KEY = process.env.OPENAI_API_KEY;
const ANTHROPIC_BASE = process.env.ANTHROPIC_BASE_URL;
const ANTHROPIC_TOKEN = process.env.ANTHROPIC_AUTH_TOKEN;
const SUMMARY_MODEL = process.env.SUMMARY_MODEL; // 可选覆盖（需与所用后端匹配）

// 按后端选模型，避免把某家的模型名发给另一家（会触发 "No available accounts"）。
function openaiModel() {
  return SUMMARY_MODEL && /^(gpt|o\d)/i.test(SUMMARY_MODEL) ? SUMMARY_MODEL : 'gpt-4o-mini';
}
function anthropicModel() {
  return SUMMARY_MODEL && /^claude/i.test(SUMMARY_MODEL) ? SUMMARY_MODEL : 'claude-sonnet-5';
}

// 摘要用哪个后端：优先 OpenAI（若配了 key），否则用平台的 Anthropic 端点。
export function summarizerProvider() {
  if (OPENAI_KEY) return 'openai';
  if (ANTHROPIC_BASE && ANTHROPIC_TOKEN) return 'anthropic';
  return null;
}

export function canTranscribe() {
  return Boolean(OPENAI_KEY);
}

const SYSTEM_PROMPT = [
  '你是一个帮助用户跟踪硅谷一手信息的研究助理。',
  '任务不是写营销式总结，而是保留采访/播客/文章的原汁原味：谁说了什么、为什么重要、有哪些具体判断和细节。',
  '用简体中文输出，但保留重要英文术语、人名、公司名和关键原句。',
  '不要过度压缩；如果信息密度高，可以写得稍长。绝不编造原文里没有的信息。',
  '只返回一个合法 JSON 对象，不要包含 markdown 代码块标记或额外说明。'
].join('\n');

function buildUserPayload({ episode, text, kind }) {
  return JSON.stringify({
    content_kind: kind, // 'transcript' | 'article'
    title: episode.title,
    source: episode.source_name,
    published_at: episode.published_at,
    link: episode.link,
    body: text.slice(0, 120_000),
    required_schema: {
      title_cn: '中文标题',
      one_sentence: '一句话说明这条为什么值得读',
      original_context: '保留语境的 2-4 段介绍，不要标题党',
      key_points: ['6-12 条要点，每条保留具体人物、观点、例子或数字'],
      notable_quotes: ['3-8 条英文原句或接近原句的短摘录，可附中文解释；若原文信息不足则给较少条'],
      people_and_orgs: ['提到的重要人物/公司/机构'],
      topics: ['主题标签'],
      why_it_matters: ['对创业者/投资人/AI 从业者的启发'],
      follow_up_questions: ['后续值得追踪的问题']
    }
  });
}

export async function createDigest({ episode, text, kind = 'transcript' }) {
  const provider = summarizerProvider();
  if (!provider) {
    throw new Error('未配置任何可用的摘要后端（缺 OPENAI_API_KEY 或 Anthropic 端点）。');
  }
  const userPayload = buildUserPayload({ episode, text, kind });
  const raw = provider === 'openai'
    ? await callOpenAI(userPayload)
    : await callAnthropic(userPayload);
  return parseJsonLoose(raw);
}

async function callOpenAI(userPayload) {
  const { default: OpenAI } = await import('openai');
  const openai = new OpenAI({ apiKey: OPENAI_KEY });
  const response = await openai.chat.completions.create({
    model: openaiModel(),
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPayload }
    ]
  });
  return response.choices[0]?.message?.content || '{}';
}

async function callAnthropic(userPayload) {
  const data = await withRetry('Anthropic 摘要', async () => {
    const response = await fetch(`${ANTHROPIC_BASE}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': ANTHROPIC_TOKEN,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: anthropicModel(),
        max_tokens: 8000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPayload }]
      }),
      signal: AbortSignal.timeout(120000)
    });
    if (!response.ok) {
      const body = (await response.text()).slice(0, 300);
      const err = new Error(`${response.status}: ${body}`);
      err.retryable = [429, 500, 502, 503, 529].includes(response.status);
      throw err;
    }
    return response.json();
  });
  return data.content?.map((c) => c.text || '').join('') || '{}';
}

async function withRetry(label, fn, { attempts = 4, baseDelayMs = 1500 } = {}) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!error.retryable || i === attempts - 1) break;
      const delay = baseDelayMs * Math.pow(2, i);
      console.log(`  ${label} 第 ${i + 1} 次失败(${error.message.slice(0, 60)})，${delay}ms 后重试...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error(`${label}请求失败 ${lastError.message}`);
}

function parseJsonLoose(raw) {
  const trimmed = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error(`摘要返回的不是合法 JSON：${trimmed.slice(0, 200)}`);
  }
}

// ---- 音频转写（仅 OpenAI Whisper）----

export async function transcribeAudioUrl(audioUrl) {
  if (!OPENAI_KEY) {
    throw new Error('缺少 OPENAI_API_KEY，无法调用音频转写。');
  }
  const { default: OpenAI } = await import('openai');
  const openai = new OpenAI({ apiKey: OPENAI_KEY });
  const tmpFile = await downloadToTemp(audioUrl);
  try {
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tmpFile),
      model: 'whisper-1',
      response_format: 'text'
    });
    return typeof transcription === 'string' ? transcription : transcription.text;
  } finally {
    fs.promises.rm(tmpFile, { force: true }).catch(() => {});
  }
}

async function downloadToTemp(url) {
  const response = await fetch(url, {
    headers: { 'user-agent': 'SiliconValleyInfoRadar/0.1 (+personal research bot)' }
  });
  if (!response.ok || !response.body) {
    throw new Error(`音频下载失败 ${response.status} ${response.statusText}`);
  }
  const extension = extensionFromUrl(url) || '.mp3';
  const tmpFile = path.join(os.tmpdir(), `info-radar-${process.pid}-${Math.round(process.hrtime()[1])}${extension}`);
  const fileStream = fs.createWriteStream(tmpFile);
  await new Promise((resolve, reject) => {
    response.body.pipe(fileStream);
    response.body.on('error', reject);
    fileStream.on('finish', resolve);
    fileStream.on('error', reject);
  });
  return tmpFile;
}

function extensionFromUrl(url) {
  try {
    const ext = path.extname(new URL(url).pathname).toLowerCase();
    return ext && ext.length <= 6 ? ext : '';
  } catch {
    return '';
  }
}
