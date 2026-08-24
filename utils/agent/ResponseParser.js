const WorkspaceService = require('../WorkspaceService');

const PLACEHOLDER_PATH = /^(folder|name\.ext|folder\/name\.ext|\.\.\.|path|example|ten-thu-muc)(\/|$)/i;
const ACTIONS = new Set([
    'list_files', 'read_file', 'search_code', 'find_symbol', 'find_references',
    'create_file', 'edit_file', 'delete_file', 'mkdir',
    'run_command', 'run_test', 'run_build', 'run_start', 'run_stop',
    'git_status', 'git_diff', 'git_log',
    'retrieve', 'browser_open', 'screenshot',
]);

function sanitizeJsonText(text) {
    let out = '';
    let inStr = false;
    let escape = false;
    for (const ch of String(text || '')) {
        if (inStr) {
            if (escape) {
                out += ch;
                escape = false;
                continue;
            }
            if (ch === '\\') {
                out += ch;
                escape = true;
                continue;
            }
            if (ch === '"') {
                inStr = false;
                out += ch;
                continue;
            }
            if (ch === '\n') {
                out += '\\n';
                continue;
            }
            if (ch === '\r') continue;
            if (ch === '\t') {
                out += '\\t';
                continue;
            }
            out += ch;
            continue;
        }
        if (ch === '"') inStr = true;
        out += ch;
    }
    return out;
}

function tryParse(chunk) {
    try {
        return JSON.parse(String(chunk || '').trim());
    } catch {
        return null;
    }
}

function repairJson(chunk) {
    let text = String(chunk || '').trim()
        .replace(/,\s*([}\]])/g, '$1')
        .replace(/```(?:json)?/g, '')
        .replace(/```/g, '');
    const parsed = tryParse(text);
    if (parsed) return parsed;

    text = sanitizeJsonText(text);
    let openCurly = 0;
    let openSquare = 0;
    let inStr = false;
    let escape = false;
    for (const ch of text) {
        if (inStr) {
            if (escape) escape = false;
            else if (ch === '\\') escape = true;
            else if (ch === '"') inStr = false;
            continue;
        }
        if (ch === '"') inStr = true;
        else if (ch === '{') openCurly += 1;
        else if (ch === '}') openCurly -= 1;
        else if (ch === '[') openSquare += 1;
        else if (ch === ']') openSquare -= 1;
    }
    if (inStr) text += '"';
    text += ']'.repeat(Math.max(0, openSquare));
    text += '}'.repeat(Math.max(0, openCurly));
    return tryParse(text);
}

function sliceBalanced(text, start) {
    let depth = 0;
    let inStr = false;
    let escape = false;
    for (let i = start; i < text.length; i += 1) {
        const ch = text[i];
        if (inStr) {
            if (escape) escape = false;
            else if (ch === '\\') escape = true;
            else if (ch === '"') inStr = false;
            continue;
        }
        if (ch === '"') inStr = true;
        else if (ch === '{') depth += 1;
        else if (ch === '}') {
            depth -= 1;
            if (depth === 0) return text.slice(start, i + 1);
        }
    }
    return text.slice(start);
}

function extractBalancedObjects(text) {
    const found = [];
    for (let i = 0; i < text.length; i += 1) {
        if (text[i] !== '{') continue;
        const slice = sliceBalanced(text, i);
        const parsed = tryParse(slice);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Object.keys(parsed).length) {
            found.push(parsed);
            i += Math.max(0, slice.length - 1);
        }
    }
    return found;
}

function extractBalanced(text, key, openCh, closeCh) {
    const needle = `"${key}"`;
    let from = 0;
    while (from < text.length) {
        const idx = text.indexOf(needle, from);
        if (idx === -1) return null;
        const start = text.indexOf(openCh, idx + needle.length);
        if (start === -1) return null;
        let depth = 0;
        let inStr = false;
        let escape = false;
        for (let i = start; i < text.length; i += 1) {
            const ch = text[i];
            if (inStr) {
                if (escape) escape = false;
                else if (ch === '\\') escape = true;
                else if (ch === '"') inStr = false;
                continue;
            }
            if (ch === '"') inStr = true;
            else if (ch === openCh) depth += 1;
            else if (ch === closeCh) {
                depth -= 1;
                if (depth === 0) {
                    const parsed = tryParse(text.slice(start, i + 1));
                    if (parsed) return parsed;
                    break;
                }
            }
        }
        from = idx + needle.length;
    }
    return null;
}

function tag(text, name) {
    const re = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i');
    const match = String(text || '').match(re);
    return match ? match[1].trim() : '';
}

function mapType(type) {
    const key = String(type || '').toLowerCase().replace(/[\s-]+/g, '_');
    return {
        mkdir: 'mkdir',
        write: 'create_file',
        create: 'create_file',
        createfile: 'create_file',
        write_file: 'create_file',
        edit: 'edit_file',
        delete: 'delete_file',
        remove: 'delete_file',
        list: 'list_files',
        list_dir: 'list_files',
        read: 'read_file',
        read_file: 'read_file',
        search: 'search_code',
        grep: 'search_code',
        retrieve: 'retrieve',
        semantic_search: 'retrieve',
        test: 'run_test',
        build: 'run_build',
        command: 'run_command',
        shell: 'run_command',
        run_terminal: 'run_command',
        terminal: 'run_command',
        start: 'run_start',
        run_dev: 'run_start',
        serve: 'run_start',
        stop: 'run_stop',
        browser_open: 'browser_open',
        open_url: 'browser_open',
        screenshot: 'screenshot',
    }[key] || key;
}

function unwrapAction(raw) {
    if (!raw || typeof raw !== 'object') return raw;
    if (raw.type || raw.action) return raw;
    const named = raw.tool || raw.name || raw.function;
    if (named) {
        const args = raw.arguments || raw.input || raw.params || {};
        return typeof args === 'string'
            ? { type: named, path: args }
            : { type: named, ...args };
    }
    const keys = Object.keys(raw);
    for (const key of keys) {
        const mapped = mapType(key);
        if (!ACTIONS.has(mapped)) continue;
        const inner = raw[key];
        if (typeof inner === 'string') return { type: mapped, path: inner };
        if (inner && typeof inner === 'object') return { type: mapped, ...inner };
        return { type: mapped };
    }
    return raw;
}

function normalizeAction(raw) {
    if (!raw || typeof raw !== 'object') return null;
    raw = unwrapAction(raw);
    const type = String(raw.type || raw.action || '').toLowerCase();
    const mapped = mapType(type);

    if (!ACTIONS.has(mapped)) return null;

    const path = WorkspaceService.normalizeRel(raw.path || raw.file || '');
    if (path && (path.includes('..') || PLACEHOLDER_PATH.test(path))) return null;

    const action = { type: mapped };
    if (path) action.path = path;
    if (raw.content != null && mapped !== 'edit_file') {
        action.content = typeof raw.content === 'object'
            ? JSON.stringify(raw.content, null, 2)
            : String(raw.content);
    }
    if (raw.old != null) action.old = String(raw.old);
    if (raw.new != null) action.new = String(raw.new);
    if (raw.query != null) action.query = String(raw.query);
    if (raw.command != null) action.command = String(raw.command);
    if (raw.cmd != null && !action.command) action.command = String(raw.cmd);
    if (raw.url != null) action.url = String(raw.url).trim();
    if (raw.background === true) action.background = true;
    if (raw.replace_all === true || raw.replaceAll === true) action.replace_all = true;
    if (raw.start != null) action.start = Number(raw.start);
    if (raw.end != null) action.end = Number(raw.end);
    if (raw.lines != null) action.lines = Number(raw.lines);
    if (raw.around != null) action.around = Number(raw.around);
    if (Array.isArray(raw.patches)) {
        action.patches = raw.patches
            .filter((item) => item && item.old != null)
            .map((item) => ({ old: String(item.old), new: String(item.new ?? '') }));
    }
    return action;
}

function collectActions(value) {
    if (!value) return [];
    const list = Array.isArray(value) ? value : [value];
    return list.map(normalizeAction).filter(Boolean);
}

function decodeJsonish(value) {
    return String(value || '')
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\r/g, '\r')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
}

function extractQuotedLenient(text, quoteIndex) {
    const start = quoteIndex + 1;
    const first = text[start];
    if (first === '{' || first === '[') {
        const slice = first === '{'
            ? sliceBalanced(text, start)
            : sliceBalancedArray(text, start);
        const parsed = tryParse(slice);
        let value = slice;
        if (parsed != null && typeof parsed === 'object') {
            value = JSON.stringify(parsed, null, 2);
        } else if (parsed != null) {
            value = String(parsed);
        }
        let end = start + slice.length;
        if (text[end] === '"') end += 1;
        return { value, end };
    }
    let i = start;
    while (i < text.length) {
        if (text[i] === '\\' && i + 1 < text.length) {
            i += 2;
            continue;
        }
        if (text[i] === '"') {
            const after = text.slice(i + 1);
            if (/^\s*[,}\]]/.test(after)) {
                return { value: decodeJsonish(text.slice(start, i)), end: i + 1 };
            }
        }
        i += 1;
    }
    return { value: decodeJsonish(text.slice(start)), end: text.length };
}

function sliceBalancedArray(text, start) {
    let depth = 0;
    let inStr = false;
    let escape = false;
    for (let i = start; i < text.length; i += 1) {
        const ch = text[i];
        if (inStr) {
            if (escape) escape = false;
            else if (ch === '\\') escape = true;
            else if (ch === '"') inStr = false;
            continue;
        }
        if (ch === '"') inStr = true;
        else if (ch === '[') depth += 1;
        else if (ch === ']') {
            depth -= 1;
            if (depth === 0) return text.slice(start, i + 1);
        }
    }
    return text.slice(start);
}

function salvageActions(text) {
    const actions = [];
    const re = /"type"\s*:\s*"(create_file|edit_file|mkdir|delete_file|write|read_file|list_files|search_code|run_command|run_test|run_start|run_stop|run_build|git_status)"/gi;
    let match = re.exec(text);
    while (match) {
        const slice = text.slice(match.index, match.index + 250000);
        const type = match[1];
        const pathM = /"path"\s*:\s*"((?:\\.|[^"\\])*)"/.exec(slice);
        const cmdM = /"command"\s*:\s*"((?:\\.|[^"\\])*)"/.exec(slice);
        const queryM = /"query"\s*:\s*"((?:\\.|[^"\\])*)"/.exec(slice);
        let content;
        const objKey = slice.search(/"content"\s*:\s*[\{\[]/);
        const strKey = slice.search(/"content"\s*:\s*"/);
        if (objKey !== -1 && (strKey === -1 || objKey < strKey)) {
            const start = objKey + slice.slice(objKey).search(/[\{\[]/);
            const raw = slice[start] === '['
                ? sliceBalancedArray(slice, start)
                : sliceBalanced(slice, start);
            const parsed = tryParse(raw);
            content = parsed != null && typeof parsed === 'object'
                ? JSON.stringify(parsed, null, 2)
                : raw;
        } else if (strKey !== -1) {
            const colon = slice.indexOf(':', strKey);
            let q = colon + 1;
            while (q < slice.length && /\s/.test(slice[q])) q += 1;
            if (slice[q] === '"') content = extractQuotedLenient(slice, q).value;
        }
        const pullQuoted = (key) => {
            const at = slice.search(new RegExp(`"${key}"\\s*:\\s*"`));
            if (at === -1) return undefined;
            const colon = slice.indexOf(':', at);
            let q = colon + 1;
            while (q < slice.length && /\s/.test(slice[q])) q += 1;
            if (slice[q] === '"') return extractQuotedLenient(slice, q).value;
            return undefined;
        };
        const numField = (key) => {
            const hit = slice.match(new RegExp(`"${key}"\\s*:\\s*(\\d+)`));
            return hit ? Number(hit[1]) : undefined;
        };
        const action = normalizeAction({
            type,
            path: pathM ? decodeJsonish(pathM[1]) : '',
            command: cmdM ? decodeJsonish(cmdM[1]) : undefined,
            query: queryM ? decodeJsonish(queryM[1]) : undefined,
            old: pullQuoted('old'),
            new: pullQuoted('new'),
            content,
            start: numField('start'),
            end: numField('end'),
            lines: numField('lines'),
        });
        if (action && !isExampleAction(action)) actions.push(action);
        match = re.exec(text);
    }
    return actions;
}

function isExampleAction(action) {
    const path = String(action.path || '');
    const content = String(action.content || '').trim();
    return (path === 'src/app.js' && /export default \{\s*\}/.test(content))
        || path === 'folder/index.html'
        || path === 'folder/name.ext';
}

function extractFenceFiles(text) {
    if (!text.includes('```')) return [];
    const actions = [];
    const fence = /```[a-zA-Z0-9]*\n([\s\S]*?)```/g;
    let match = fence.exec(text);
    while (match) {
        const before = text.slice(Math.max(0, match.index - 200), match.index);
        const pathLine = before.split('\n').map((line) => line.trim()).filter(Boolean).pop() || '';
        const pathMatch = pathLine.match(/((?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.[A-Za-z0-9]+)/);
        if (pathMatch) {
            const rel = WorkspaceService.normalizeRel(pathMatch[1]);
            if (rel && !rel.includes('..') && !PLACEHOLDER_PATH.test(rel)) {
                actions.push({ type: 'create_file', path: rel, content: match[1].replace(/\n$/, '') });
            }
        }
        match = fence.exec(text);
    }
    return actions;
}

function mentionedPaths(text) {
    const hits = [];
    const re = /"path"\s*:\s*"((?:\\.|[^"\\])*)"/g;
    let match = re.exec(text);
    while (match) {
        const rel = WorkspaceService.normalizeRel(match[1] || '');
        if (rel && !rel.includes('..') && !PLACEHOLDER_PATH.test(rel) && !hits.includes(rel)) {
            hits.push(rel);
        }
        match = re.exec(text);
    }
    return hits.slice(0, 30);
}

function mergeActions(lists) {
    const map = new Map();
    for (const list of lists) {
        for (const action of list || []) {
            if (!action) continue;
            const key = action.type === 'read_file'
                ? `${action.type}:${action.path || ''}:${action.start || ''}:${action.end || ''}`
                : `${action.type}:${action.path || action.command || action.query || ''}`;
            const prev = map.get(key);
            if (!prev) {
                map.set(key, action);
                continue;
            }
            if (String(action.content || '').length > String(prev.content || '').length) {
                map.set(key, action);
            }
            if (action.type === 'read_file' && (action.start || action.end) && !(prev.start || prev.end)) {
                map.set(key, action);
            }
        }
    }
    return [...map.values()];
}

function looksTruncated(content, path = '') {
    const text = String(content || '');
    if (!text.trim()) return true;
    if (text.trim() === '[object Object]') return true;
    if (/\.json$/i.test(path)) {
        try {
            JSON.parse(text);
            return false;
        } catch {
            return true;
        }
    }
    const curly = (text.match(/\{/g) || []).length - (text.match(/\}/g) || []).length;
    const round = (text.match(/\(/g) || []).length - (text.match(/\)/g) || []).length;
    if (curly !== 0 || round !== 0) return true;
    if (/const\s*\{\s*[\w,\s]*$/.test(text.trim())) return true;
    if (/const\s*\{[^}]*\}\s*$/.test(text.trim())) return true;
    if (/createApp\s*$/.test(text.trim())) return true;
    if (/\bcreateApp\b/.test(text) && !/\.mount\(/.test(text) && text.length < 500) return true;
    const ext = String(path || '').split('.').pop();
    if (ext === 'html' && /<html/i.test(text) && !/<\/html>/i.test(text)) return true;
    return false;
}

function parseResponse(raw) {
    const text = String(raw || '').trim();
    const objects = extractBalancedObjects(text);
    const fenced = [...text.matchAll(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/g)];
    for (const block of fenced) {
        const obj = tryParse(block[1]);
        if (obj) objects.push(obj);
    }

    const fromObjects = [];
    const fromArrays = [];
    for (const obj of objects) {
        fromArrays.push(collectActions(obj.actions || obj.ops));
        const single = normalizeAction(obj);
        if (single) fromObjects.push(single);
    }
    fromArrays.push(collectActions(extractBalanced(text, 'actions', '[', ']')));
    fromArrays.push(collectActions(extractBalanced(text, 'ops', '[', ']')));
    fromArrays.push(fromObjects);
    fromArrays.push(extractFenceFiles(text));
    fromArrays.push(salvageActions(text));

    const actions = mergeActions(fromArrays).filter((item) => !isExampleAction(item));
    const wrapper = objects.find((obj) => obj && (obj.analysis || obj.reply || obj.done != null || obj.actions || obj.ops)) || objects[0] || null;
    const analysis = String(wrapper?.analysis || wrapper?.reply || tag(text, 'analysis') || '').trim();
    const claimedDone = wrapper?.done === true || /<done>\s*true\s*<\/done>/i.test(text);
    const fileActions = actions.filter((item) => /create_file|edit_file|delete_file|mkdir/.test(item.type));
    const plan = extractPlan(wrapper, text, analysis);

    return {
        analysis: analysis.slice(0, 2000),
        plan,
        next: String(wrapper?.next || tag(text, 'next') || '').trim(),
        actions,
        done: claimedDone && !fileActions.length,
        claimedDone,
        mentioned: mentionedPaths(text),
        raw: text,
    };
}

function extractPlan(wrapper, text, analysis) {
    const fromJson = Array.isArray(wrapper?.plan)
        ? wrapper.plan.map((item) => String(item?.task || item || '').trim()).filter(Boolean)
        : [];
    if (fromJson.length) return fromJson.slice(0, 24);
    const tagged = tag(text, 'plan');
    const source = tagged || analysis || '';
    const items = [];
    for (const line of String(source).split('\n')) {
        const match = line.trim().match(/^(?:[-*]|\d+[.)])\s+(.+)/);
        if (match) items.push(match[1].trim());
    }
    return items.slice(0, 24);
}

function looksLikeRefusal(text) {
    return /không thể thực thi|không cung cấp|không có (các )?(ide )?action|giả lập|simulat|cannot execute|do not (have|provide)|lack(s)? (the )?(ide )?actions|no (function|tool) call|i (can't|cannot) (write|create|run|execute|perform)|xuất json[^\n]{0,80}giả lập|would be (a )?simul/i
        .test(String(text || ''));
}

module.exports = {
    parseResponse,
    normalizeAction,
    mentionedPaths,
    looksTruncated,
    looksLikeRefusal,
    repairJson,
};
