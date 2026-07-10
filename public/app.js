const listEl = document.getElementById('episode-list');
const readerEl = document.getElementById('reader');
const statsEl = document.getElementById('stats');
const filterButtons = document.querySelectorAll('.filter');
const searchEl = document.getElementById('search');
const sourceFilterEl = document.getElementById('source-filter');

let allEpisodes = [];
let currentFilter = 'today';
let selectedId = null;
let todayCount = 0;
let searchQuery = '';
let sourceFilter = '';
let visibleItems = [];
let lastStats = [];

init();

async function init() {
  filterButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      filterButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      renderList();
    });
  });
  searchEl.addEventListener('input', (e) => { searchQuery = e.target.value.trim().toLowerCase(); renderList(); });
  sourceFilterEl.addEventListener('change', (e) => { sourceFilter = e.target.value; renderList(); });
  document.addEventListener('keydown', onKeydown);
  await loadEpisodes();
}

async function loadEpisodes() {
  try {
    const res = await fetch('api/episodes');
    const data = await res.json();
    allEpisodes = data.episodes || [];
    todayCount = data.today_count || 0;
    populateSourceFilter();
    renderStats(data.stats || []);
    renderList();
  } catch (err) {
    listEl.innerHTML = `<li class="pending-box">加载失败：${escapeHtml(err.message)}</li>`;
  }
}

function populateSourceFilter() {
  const names = [...new Set(allEpisodes.map((e) => e.source_name))].sort();
  const current = sourceFilter;
  sourceFilterEl.innerHTML = '<option value="">全部来源</option>' +
    names.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
  sourceFilterEl.value = current;
}

function isToday(iso) {
  if (!iso) return false;
  const now = new Date();
  const d = new Date(iso);
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

function renderStats(stats) {
  lastStats = stats;
  const map = Object.fromEntries(stats.map((s) => [s.status, s.count]));
  const total = stats.reduce((sum, s) => sum + s.count, 0);
  const unread = allEpisodes.filter((e) => e.status === 'processed' && !e.read).length;
  const starred = allEpisodes.filter((e) => e.starred).length;
  statsEl.innerHTML = `
    <span class="stat-chip today">今日 <b>${todayCount}</b></span>
    <span class="stat-chip">未读 <b>${unread}</b></span>
    <span class="stat-chip">收藏 <b>${starred}</b></span>
    <span class="stat-chip">共 <b>${total}</b></span>
  `;
}

function computeItems() {
  let items;
  if (currentFilter === 'today') {
    items = allEpisodes.filter((e) => e.status === 'processed' && isToday(e.processed_at));
  } else if (currentFilter === 'unread') {
    items = allEpisodes.filter((e) => e.status === 'processed' && !e.read);
  } else if (currentFilter === 'starred') {
    items = allEpisodes.filter((e) => e.starred);
  } else if (currentFilter === 'all') {
    items = allEpisodes.slice();
  } else {
    items = allEpisodes.filter((e) => e.status === currentFilter);
  }

  if (sourceFilter) items = items.filter((e) => e.source_name === sourceFilter);

  if (searchQuery) {
    items = items.filter((e) => {
      const hay = [e.digest_title, e.title, e.one_sentence, (e.topics || []).join(' '), e.source_name]
        .filter(Boolean).join(' ').toLowerCase();
      return hay.includes(searchQuery);
    });
  }
  return items;
}

function renderList() {
  const items = computeItems();
  visibleItems = items;

  const banner = currentFilter === 'today' && !searchQuery && !sourceFilter
    ? `<li class="today-banner">📮 今日为你推送 <b>${items.length}</b> 篇新文稿</li>`
    : '';

  if (items.length === 0) {
    const empty = searchQuery || sourceFilter
      ? '没有匹配的内容，换个关键词或来源试试。'
      : currentFilter === 'starred' ? '还没有收藏。阅读时点右上角 ☆ 收藏。'
      : currentFilter === 'unread' ? '没有未读文稿，全部读完了 🎉'
      : currentFilter === 'today' ? '今天还没有新文稿。运行 <code>npm run ingest</code> 采集。'
      : '暂无内容。运行 <code>npm run ingest</code> 抓取并生成文稿。';
    listEl.innerHTML = banner + `<li class="pending-box">${empty}</li>`;
    return;
  }

  listEl.innerHTML = banner + items.map((e) => `
    <li class="episode-card ${e.id === selectedId ? 'selected' : ''} ${e.read ? 'read' : ''}" data-id="${e.id}">
      <div class="card-meta">
        <span class="source-tag">${escapeHtml(e.source_name)}</span>
        <button class="star-btn ${e.starred ? 'on' : ''}" data-star="${e.id}" title="收藏">${e.starred ? '★' : '☆'}</button>
        <span class="date">${formatDate(e.published_at)}</span>
      </div>
      <p class="card-title">${!e.read && e.status === 'processed' ? '<span class="unread-dot"></span>' : ''}${escapeHtml(e.digest_title || e.title)}</p>
      ${e.one_sentence ? `<p class="card-sentence">${escapeHtml(e.one_sentence)}</p>` : ''}
      <div class="card-meta" style="margin-top:8px;">
        <span class="badge ${e.status}">${statusLabel(e.status)}</span>
        ${e.kind ? `<span class="kind-tag">${e.kind === 'article' ? '文章' : '播客'}</span>` : ''}
        <span class="score">质量分 ${e.quality_score}</span>
        ${sourceLinks(e)}
      </div>
    </li>
  `).join('');

  listEl.querySelectorAll('.episode-card').forEach((card) => {
    card.addEventListener('click', () => openEpisode(card.dataset.id));
  });
  listEl.querySelectorAll('.star-btn').forEach((btn) => {
    btn.addEventListener('click', (ev) => { ev.stopPropagation(); toggleStar(btn.dataset.star); });
  });
}

async function setState(id, patch) {
  try {
    await fetch(`api/episodes/${id}/state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch)
    });
  } catch { /* 离线也不阻塞 UI */ }
}

function toggleStar(id) {
  const ep = allEpisodes.find((e) => e.id === id);
  if (!ep) return;
  ep.starred = !ep.starred;
  setState(id, { starred: ep.starred });
  renderStats(lastStats);
  renderList();
}

function markRead(id) {
  const ep = allEpisodes.find((e) => e.id === id);
  if (!ep || ep.read) return;
  ep.read = true;
  setState(id, { read: true });
  renderStats(lastStats);
}

async function openEpisode(id) {
  selectedId = id;
  markRead(id);
  renderList();
  readerEl.innerHTML = `<div class="reader-empty"><p>加载中…</p></div>`;
  try {
    const res = await fetch(`api/episodes/${id}`);
    const e = await res.json();
    renderReader(e);
    readerEl.scrollTop = 0;
  } catch (err) {
    readerEl.innerHTML = `<div class="reader-empty"><p>加载失败：${escapeHtml(err.message)}</p></div>`;
  }
}

function onKeydown(ev) {
  if (ev.target === searchEl || ev.target === sourceFilterEl) return;
  if (ev.key !== 'j' && ev.key !== 'k') return;
  if (visibleItems.length === 0) return;
  ev.preventDefault();
  let idx = visibleItems.findIndex((e) => e.id === selectedId);
  if (ev.key === 'j') idx = idx < 0 ? 0 : Math.min(idx + 1, visibleItems.length - 1);
  else idx = idx < 0 ? 0 : Math.max(idx - 1, 0);
  const next = visibleItems[idx];
  if (next) {
    openEpisode(next.id);
    const card = listEl.querySelector(`[data-id="${next.id}"]`);
    if (card) card.scrollIntoView({ block: 'nearest' });
  }
}

function renderReader(e) {
  const d = e.digest;
  const starBtn = `<button class="reader-star ${e.starred ? 'on' : ''}" id="reader-star">${e.starred ? '★ 已收藏' : '☆ 收藏'}</button>`;

  if (!d) {
    readerEl.innerHTML = `
      <article class="article">
        <div class="reader-topbar">${starBtn}</div>
        <h1>${escapeHtml(e.title)}</h1>
        <div class="article-meta">
          <span>${escapeHtml(e.source_name)}</span>
          <span>${formatDate(e.published_at)}</span>
          <span class="badge ${e.status}">${statusLabel(e.status)}</span>
          ${sourceLinks(e, { big: true })}
        </div>
        <div class="pending-box">
          ${e.status === 'error'
            ? `处理出错：${escapeHtml(e.error || '未知错误')}`
            : '这条内容尚未生成文稿。运行 <code>npm run ingest</code> 后会自动转写并生成中文摘要。'}
          ${e.description ? `<p style="margin-top:14px;color:var(--muted)">${escapeHtml(e.description.slice(0, 600))}…</p>` : ''}
        </div>
      </article>`;
    bindReaderStar(e);
    return;
  }

  readerEl.innerHTML = `
    <article class="article">
      <div class="reader-topbar">${starBtn}</div>
      <h1>${escapeHtml(d.title_cn || e.title)}</h1>
      ${d.one_sentence ? `<p class="subtitle">${escapeHtml(d.one_sentence)}</p>` : ''}
      <div class="article-meta">
        <span>${escapeHtml(e.source_name)}</span>
        <span>${formatDate(e.published_at)}</span>
        <span class="score">质量分 ${e.quality_score}</span>
        ${sourceLinks(e, { big: true })}
      </div>

      ${section('语境', d.original_context ? paragraphs(d.original_context) : '')}
      ${listSection('要点', d.key_points, (p) => `<li>${escapeHtml(p)}</li>`, 'points')}
      ${quotesSection(d.notable_quotes)}
      ${listSection('为什么重要', d.why_it_matters, (p) => `<li>${escapeHtml(p)}</li>`, 'points')}
      ${chipsSection('人物 / 机构', d.people_and_orgs)}
      ${chipsSection('主题', d.topics)}
      ${listSection('值得追踪', d.follow_up_questions, (p) => `<li>${escapeHtml(p)}</li>`, 'points')}
    </article>`;
  bindReaderStar(e);
}

function bindReaderStar(e) {
  const btn = document.getElementById('reader-star');
  if (!btn) return;
  btn.addEventListener('click', () => {
    toggleStar(e.id);
    const ep = allEpisodes.find((x) => x.id === e.id);
    btn.classList.toggle('on', ep.starred);
    btn.textContent = ep.starred ? '★ 已收藏' : '☆ 收藏';
  });
}

function section(title, html) {
  if (!html) return '';
  return `<div class="section"><h3>${title}</h3>${html}</div>`;
}

function paragraphs(text) {
  const parts = Array.isArray(text) ? text : String(text).split(/\n{2,}/);
  return parts.map((p) => `<p>${escapeHtml(p)}</p>`).join('');
}

function listSection(title, items, render, cls) {
  if (!Array.isArray(items) || items.length === 0) return '';
  return `<div class="section"><h3>${title}</h3><ul class="${cls}">${items.map(render).join('')}</ul></div>`;
}

function quotesSection(quotes) {
  if (!Array.isArray(quotes) || quotes.length === 0) return '';
  const html = quotes.map((q) => {
    if (typeof q === 'string') return `<blockquote class="quote"><div class="en">${escapeHtml(q)}</div></blockquote>`;
    return `<blockquote class="quote">
      <div class="en">${escapeHtml(q.quote || q.en || q.text || '')}</div>
      ${q.note || q.cn ? `<div class="cn">${escapeHtml(q.note || q.cn)}</div>` : ''}
    </blockquote>`;
  }).join('');
  return `<div class="section"><h3>原句摘录</h3>${html}</div>`;
}

function chipsSection(title, items) {
  if (!Array.isArray(items) || items.length === 0) return '';
  return `<div class="section"><h3>${title}</h3><div class="chips">${items.map((i) => `<span class="chip">${escapeHtml(i)}</span>`).join('')}</div></div>`;
}

function statusLabel(status) {
  return { processed: '已成稿', discovered: '待处理', error: '出错' }[status] || status;
}

// 判断原始链接的类型，给出对应图标与文案（原视频 / 播客 / 原文）。
function linkMeta(e) {
  const url = e.link || '';
  const isVideo = /youtube\.com|youtu\.be|vimeo\.com/i.test(url);
  if (isVideo) return { icon: '▶', label: '原视频' };
  if (e.kind === 'transcript' || e.audio_url) return { icon: '🎧', label: '原节目' };
  return { icon: '📄', label: '原文' };
}

function safeUrl(url) {
  try {
    const u = new URL(url, window.location.href);
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : null;
  } catch {
    return null;
  }
}

function sourceLinks(e, { big = false } = {}) {
  const parts = [];
  const link = safeUrl(e.link);
  if (link) {
    const m = linkMeta(e);
    parts.push(`<a class="src-link${big ? ' big' : ''}" href="${escapeHtml(link)}" target="_blank" rel="noopener">${m.icon} ${m.label} ↗</a>`);
  }
  const audio = big ? safeUrl(e.audio_url) : null;
  if (audio) {
    parts.push(`<a class="src-link big audio" href="${escapeHtml(audio)}" target="_blank" rel="noopener">▶ 收听音频</a>`);
  }
  return parts.join('');
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
