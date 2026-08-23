function looksEscapedSource(text) {
    const src = String(text ?? '');
    const escapedNewlines = (src.match(/\\n/g) || []).length;
    const realNewlines = (src.match(/\n/g) || []).length;
    const escapedQuotes = (src.match(/\\"/g) || []).length;
    if (/^\s*[{\[]\\n/.test(src)) return true;
    if (escapedNewlines >= 2 && escapedNewlines > realNewlines) return true;
    if (escapedQuotes >= 3 && /^\s*[{\[]/.test(src) && realNewlines < 2) return true;
    return false;
}

function unescapeJsonString(text) {
    const src = String(text ?? '');
    let out = '';
    for (let i = 0; i < src.length; i += 1) {
        const ch = src[i];
        if (ch !== '\\' || i + 1 >= src.length) {
            out += ch;
            continue;
        }
        const next = src[i + 1];
        if (next === 'u' && /^[0-9a-fA-F]{4}/.test(src.slice(i + 2, i + 6))) {
            out += String.fromCharCode(parseInt(src.slice(i + 2, i + 6), 16));
            i += 5;
            continue;
        }
        const mapped = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '"': '"', "'": "'", '\\': '\\', '/': '/' }[next];
        if (mapped != null) {
            out += mapped;
            i += 1;
            continue;
        }
        out += ch;
    }
    return out;
}

function tryPrettyJson(text) {
    let value = String(text ?? '').trim();
    if (!value) return null;
    for (let i = 0; i < 3; i += 1) {
        try {
            const parsed = JSON.parse(value);
            if (typeof parsed === 'string') {
                value = parsed;
                continue;
            }
            if (parsed && typeof parsed === 'object') {
                return `${JSON.stringify(parsed, null, 2)}\n`;
            }
            return null;
        } catch {
            if (i === 0 && looksEscapedSource(value)) {
                value = unescapeJsonString(value);
                continue;
            }
            return null;
        }
    }
    return null;
}

function materializeFileText(text, relPath = '', { pretty = true } = {}) {
    let out = String(text ?? '');
    if (typeof text === 'object' && text != null) {
        try {
            return `${JSON.stringify(text, null, 2)}\n`;
        } catch {
            out = String(text);
        }
    }
    if (looksEscapedSource(out)) {
        out = unescapeJsonString(out);
        if (looksEscapedSource(out)) out = unescapeJsonString(out);
    }
    if (pretty && /\.json$/i.test(relPath || '')) {
        const formatted = tryPrettyJson(out);
        if (formatted != null) return formatted;
    }
    return out;
}

function materializeAction(action) {
    if (!action || typeof action !== 'object') return action;
    const next = { ...action };
    if (next.content != null) next.content = materializeFileText(next.content, next.path);
    if (next.new != null) next.new = materializeFileText(next.new, next.path);
    if (next.old != null) next.old = materializeFileText(next.old, next.path, { pretty: false });
    if (Array.isArray(next.patches)) {
        next.patches = next.patches.map((item) => ({
            old: materializeFileText(item.old, next.path, { pretty: false }),
            new: materializeFileText(item.new, next.path),
        }));
    }
    return next;
}

module.exports = {
    looksEscapedSource,
    unescapeJsonString,
    tryPrettyJson,
    materializeFileText,
    materializeAction,
};
