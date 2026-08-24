const VIDEO_EXT = new Set(['mp4', 'webm', 'ogg', 'ogv', 'mov', 'm4v']);
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp', 'ico']);

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function extOf(url) {
  const clean = String(url || '').split('?')[0].split('#')[0];
  const m = clean.match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : '';
}

function isHttp(url) {
  return /^https?:\/\//i.test(String(url || '').trim());
}

function youtubeId(url) {
  const raw = String(url || '').trim();
  const m = raw.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/i,
  );
  return m ? m[1] : '';
}

function vimeoId(url) {
  const m = String(url || '').trim().match(/vimeo\.com\/(?:video\/)?(\d+)/i);
  return m ? m[1] : '';
}

function safeHref(url) {
  const u = String(url || '').trim();
  if (!u || /^(javascript|vbscript|data):/i.test(u)) return '';
  return u;
}

export function isMarkdownFile(name) {
  const ext = String(name || '').split('.').pop()?.toLowerCase();
  return ext === 'md' || ext === 'markdown';
}

function mediaKind(url) {
  const idYt = youtubeId(url);
  if (idYt) return { type: 'youtube', id: idYt };
  const idVm = vimeoId(url);
  if (idVm) return { type: 'vimeo', id: idVm };
  const ext = extOf(url);
  if (VIDEO_EXT.has(ext)) return { type: 'video' };
  if (IMAGE_EXT.has(ext)) return { type: 'image' };
  return { type: 'link' };
}

function mediaTag(url, alt) {
  const href = safeHref(url);
  if (!href) return escapeHtml(alt || '');
  const kind = mediaKind(href);
  const label = escapeHtml(alt || '');
  if (kind.type === 'youtube') {
    return `<div class="md-embed"><iframe src="https://www.youtube-nocookie.com/embed/${kind.id}" title="${label || 'YouTube'}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe></div>`;
  }
  if (kind.type === 'vimeo') {
    return `<div class="md-embed"><iframe src="https://player.vimeo.com/video/${kind.id}" title="${label || 'Vimeo'}" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen loading="lazy"></iframe></div>`;
  }
  const remote = isHttp(href);
  if (kind.type === 'video') {
    const src = remote ? ` src="${escapeHtml(href)}"` : ` data-md-src="${escapeHtml(href)}"`;
    return `<video class="md-video" controls playsinline${src}></video>`;
  }
  const src = remote ? ` src="${escapeHtml(href)}"` : ` data-md-src="${escapeHtml(href)}"`;
  return `<img class="md-img" alt="${label}"${src}>`;
}

function linkTag(url, text) {
  const href = safeHref(url);
  if (!href) return escapeHtml(text);
  const kind = isHttp(href) || href.startsWith('mailto:') ? 'url' : 'file';
  const yt = youtubeId(href);
  if (yt && !text) return mediaTag(href, text);
  return `<a class="md-link" href="${escapeHtml(href)}" data-kind="${kind}">${text}</a>`;
}

function inline(src) {
  let s = String(src ?? '');
  const slots = [];
  const hold = (html) => {
    const key = `\u0000${slots.length}\u0000`;
    slots.push(html);
    return key;
  };

  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, alt, url) => hold(mediaTag(url, alt)));
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, text, url) => hold(linkTag(url, inline(text))));
  s = s.replace(/`([^`]+)`/g, (_, code) => hold(`<code>${escapeHtml(code)}</code>`));
  s = s.replace(/\*\*([^*]+)\*\*/g, (_, t) => hold(`<strong>${inline(t)}</strong>`));
  s = s.replace(/__([^_]+)__/g, (_, t) => hold(`<strong>${inline(t)}</strong>`));
  s = s.replace(/(^|[^\w*])\*([^*\n]+)\*(?!\*)/g, (_, p, t) => `${p}${hold(`<em>${inline(t)}</em>`)}`);
  s = s.replace(/(^|[^\w_])_([^_\n]+)_(?!_)/g, (_, p, t) => `${p}${hold(`<em>${inline(t)}</em>`)}`);
  s = s.replace(/~~([^~]+)~~/g, (_, t) => hold(`<del>${inline(t)}</del>`));
  s = s.replace(/(https?:\/\/[^\s<]+)/g, (url) => {
    const trimmed = url.replace(/[),.;!?]+$/, '');
    const rest = url.slice(trimmed.length);
    const kind = mediaKind(trimmed);
    if (kind.type === 'youtube' || kind.type === 'vimeo') return hold(mediaTag(trimmed, '')) + rest;
    return hold(linkTag(trimmed, escapeHtml(trimmed))) + rest;
  });

  let out = escapeHtml(s).replace(/\u0000(\d+)\u0000/g, (_, i) => slots[Number(i)] || '');
  return out;
}

function splitFence(source) {
  const lines = String(source || '').replace(/\r\n/g, '\n').split('\n');
  const parts = [];
  let i = 0;
  while (i < lines.length) {
    const fence = lines[i].match(/^(`{3,}|~{3,})(.*)$/);
    if (fence) {
      const mark = fence[1][0];
      const lang = fence[2].trim().split(/\s+/)[0];
      const buf = [];
      i += 1;
      while (i < lines.length && !new RegExp(`^${mark}{3,}\\s*$`).test(lines[i])) {
        buf.push(lines[i]);
        i += 1;
      }
      parts.push({ type: 'code', lang, text: buf.join('\n') });
      if (i < lines.length) i += 1;
      continue;
    }
    const start = i;
    while (i < lines.length && !/^(`{3,}|~{3,})/.test(lines[i])) i += 1;
    parts.push({ type: 'md', text: lines.slice(start, i).join('\n') });
  }
  return parts;
}

function closeLists(stack) {
  let html = '';
  while (stack.length) {
    const item = stack.pop();
    html += item === 'ul' ? '</ul>' : '</ol>';
  }
  return html;
}

function renderMdBlock(text) {
  const lines = String(text || '').split('\n');
  let html = '';
  const list = [];
  let para = [];
  let quote = [];

  const flushPara = () => {
    if (!para.length) return;
    html += `<p>${inline(para.join('\n'))}</p>`;
    para = [];
  };
  const flushQuote = () => {
    if (!quote.length) return;
    html += `<blockquote>${renderMdBlock(quote.join('\n'))}</blockquote>`;
    quote = [];
  };

  const flush = () => {
    flushPara();
    flushQuote();
    html += closeLists(list);
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) {
      flush();
      continue;
    }
    if (/^ {0,3}(---|\*\*\*|___)\s*$/.test(line)) {
      flush();
      html += '<hr>';
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flush();
      const n = heading[1].length;
      html += `<h${n}>${inline(heading[2])}</h${n}>`;
      continue;
    }
    if (/^ {0,3}>/.test(line)) {
      flushPara();
      html += closeLists(list);
      quote.push(line.replace(/^ {0,3}>\s?/, ''));
      continue;
    }
    if (quote.length) flushQuote();

    if (/^\s*\|.+\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) {
      flush();
      const rows = [line];
      i += 1;
      while (i + 1 < lines.length && /^\s*\|/.test(lines[i + 1])) {
        i += 1;
        rows.push(lines[i]);
      }
      const cells = (row) => row.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
      const head = cells(rows[0]);
      const body = rows.slice(1).map(cells);
      html += '<table><thead><tr>';
      head.forEach((c) => { html += `<th>${inline(c)}</th>`; });
      html += '</tr></thead><tbody>';
      body.forEach((row) => {
        html += '<tr>';
        row.forEach((c) => { html += `<td>${inline(c)}</td>`; });
        html += '</tr>';
      });
      html += '</tbody></table>';
      continue;
    }

    const ul = line.match(/^ {0,3}[-*+]\s+(.+)$/);
    const ol = line.match(/^ {0,3}(\d+)[.)]\s+(.+)$/);
    if (ul || ol) {
      flushPara();
      const want = ul ? 'ul' : 'ol';
      if (!list.length || list[list.length - 1] !== want) {
        html += closeLists(list);
        list.push(want);
        html += want === 'ul' ? '<ul>' : '<ol>';
      }
      html += `<li>${inline((ul || ol)[ul ? 1 : 2])}</li>`;
      continue;
    }
    if (list.length) html += closeLists(list);

    para.push(line);
  }
  flush();
  return html;
}

export function renderMarkdown(source) {
  return splitFence(source).map((part) => {
    if (part.type === 'code') {
      const lang = part.lang ? ` class="language-${escapeHtml(part.lang)}"` : '';
      return `<pre><code${lang}>${escapeHtml(part.text)}</code></pre>`;
    }
    return renderMdBlock(part.text);
  }).join('');
}

export { isHttp, safeHref };
