const MAX_CHUNK_LINES = 120;
const MAX_FILE_CHARS = 400000;

function stripLine(line) {
    return String(line || '')
        .replace(/\/\/.*$/, '')
        .replace(/#.*$/, '');
}

function braceEnd(lines, start) {
    let depth = 0;
    let started = false;
    for (let i = start; i < lines.length; i += 1) {
        const line = stripLine(lines[i]);
        for (const ch of line) {
            if (ch === '{') {
                depth += 1;
                started = true;
            } else if (ch === '}') {
                depth -= 1;
            }
        }
        if (started && depth <= 0) return i;
        if (i - start >= MAX_CHUNK_LINES) return i;
    }
    return Math.min(lines.length - 1, start + 40);
}

function pyEnd(lines, start) {
    const base = (lines[start].match(/^(\s*)/) || [''])[0].replace(/\t/g, '    ').length;
    let end = start;
    for (let i = start + 1; i < lines.length; i += 1) {
        const line = lines[i];
        if (!line.trim()) {
            end = i;
            continue;
        }
        const indent = (line.match(/^(\s*)/) || [''])[0].replace(/\t/g, '    ').length;
        if (indent <= base && !/^\s*(elif|else|except|finally|except)\b/.test(line)) break;
        end = i;
        if (i - start >= MAX_CHUNK_LINES) break;
    }
    return end;
}

function slice(lines, start, end) {
    return lines.slice(start, end + 1).join('\n');
}

function pushChunk(out, path, kind, name, start, end, lines) {
    const from = Math.max(0, start);
    const to = Math.min(lines.length - 1, end);
    if (to < from) return;
    const text = slice(lines, from, to).trim();
    if (!text) return;
    out.push({
        path,
        kind,
        name: name || path,
        start: from + 1,
        end: to + 1,
        text: text.slice(0, 2400),
    });
}

function parseJsLike(path, content) {
    const lines = String(content || '').split('\n');
    const chunks = [];
    const used = new Set();

    const take = (kind, name, i) => {
        const end = braceEnd(lines, i);
        for (let n = i; n <= end; n += 1) used.add(n);
        pushChunk(chunks, path, kind, name, i, end, lines);
        return end;
    };

    for (let i = 0; i < lines.length; i += 1) {
        if (used.has(i)) continue;
        const line = lines[i];
        const cls = line.match(/^\s*(export\s+)?(default\s+)?class\s+([A-Za-z0-9_$]+)/);
        if (cls) {
            i = take('class', cls[3], i);
            continue;
        }
        const fn = line.match(/^\s*(export\s+)?(async\s+)?function\s+([A-Za-z0-9_$]+)/);
        if (fn) {
            i = take('function', fn[3], i);
            continue;
        }
        const method = line.match(/^\s*(async\s+)?([A-Za-z0-9_$]+)\s*\([^;]*\)\s*\{/);
        if (method && !/^(if|for|while|switch|catch|with)\b/.test(method[2])) {
            i = take('function', method[2], i);
            continue;
        }
        const arrow = line.match(/^\s*(export\s+)?(const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(async\s*)?(\(|function\b)/);
        if (arrow) {
            i = take('function', arrow[3], i);
        }
    }
    return chunks;
}

function parseVue(path, content) {
    const text = String(content || '');
    const lines = text.split('\n');
    const chunks = [];
    const block = (name) => {
        const re = new RegExp(`<${name}\\b[^>]*>`, 'i');
        const start = lines.findIndex((line) => re.test(line));
        if (start < 0) return null;
        const end = lines.findIndex((line, idx) => idx > start && new RegExp(`</${name}>`, 'i').test(line));
        return { start, end: end >= 0 ? end : lines.length - 1 };
    };
    const template = block('template');
    const script = block('script');
    const style = block('style');
    if (template) pushChunk(chunks, path, 'block', 'template', template.start, template.end, lines);
    if (style) pushChunk(chunks, path, 'style', 'style', style.start, style.end, lines);
    if (script) {
        const body = slice(lines, script.start, script.end);
        chunks.push(...parseJsLike(path, body).map((item) => ({
            ...item,
            start: item.start + script.start,
            end: item.end + script.start,
        })));
        pushChunk(chunks, path, 'block', 'script', script.start, Math.min(script.start + 50, script.end), lines);
    }
    return chunks;
}

function parsePython(path, content) {
    const lines = String(content || '').split('\n');
    const chunks = [];
    for (let i = 0; i < lines.length; i += 1) {
        const cls = lines[i].match(/^\s*class\s+([A-Za-z0-9_]+)/);
        if (cls) {
            const end = pyEnd(lines, i);
            pushChunk(chunks, path, 'class', cls[1], i, end, lines);
            i = end;
            continue;
        }
        const fn = lines[i].match(/^\s*(async\s+)?def\s+([A-Za-z0-9_]+)/);
        if (fn) {
            const end = pyEnd(lines, i);
            pushChunk(chunks, path, 'function', fn[2], i, end, lines);
            i = end;
        }
    }
    return chunks;
}

function parseCss(path, content) {
    const lines = String(content || '').split('\n');
    const chunks = [];
    for (let i = 0; i < lines.length; i += 1) {
        if (!/[{]/.test(lines[i]) || /@import/.test(lines[i])) continue;
        const name = lines[i].replace(/\{.*$/, '').trim().slice(0, 80);
        if (!name) continue;
        const end = braceEnd(lines, i);
        pushChunk(chunks, path, 'style', name, i, end, lines);
        i = end;
    }
    return chunks;
}

function fileChunk(path, content) {
    const lines = String(content || '').split('\n');
    const head = lines.slice(0, 50).join('\n');
    return {
        path,
        kind: 'file',
        name: path.split('/').pop(),
        start: 1,
        end: lines.length,
        text: head.slice(0, 1800),
    };
}

function chunkFile(path, content) {
    const rel = String(path || '');
    const text = String(content || '');
    if (!text || text.length > MAX_FILE_CHARS) return [];
    const chunks = [fileChunk(rel, text)];
    if (/\.vue$/i.test(rel)) chunks.push(...parseVue(rel, text));
    else if (/\.(js|mjs|cjs|ts|tsx|jsx)$/i.test(rel)) chunks.push(...parseJsLike(rel, text));
    else if (/\.py$/i.test(rel)) chunks.push(...parsePython(rel, text));
    else if (/\.(css|scss|less)$/i.test(rel)) chunks.push(...parseCss(rel, text));
    const seen = new Set();
    return chunks.filter((item) => {
        const key = `${item.kind}:${item.name}:${item.start}:${item.end}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    }).slice(0, 40);
}

module.exports = { chunkFile };
