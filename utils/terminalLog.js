'use strict';

function stripAnsi(text) {
    return String(text || '')
        .replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')
        .replace(/\r/g, '');
}

function stripPromptTail(text) {
    let out = stripAnsi(text);
    out = out.replace(/(?:\n[ \t]*)+$/g, '');
    out = out.replace(/\n(?:[^\n]*@+[^\n]*)?[%$#❯][ \t]*$/g, '');
    out = out.replace(/\n[^\n]*%[ \t]*$/g, '');
    return out.trimEnd();
}

const FAIL_RE = /internal server error|failed to compile|failed to (resolve|load)|cannot find module|module not found|syntaxerror|typeerror|referenceerror|uncaught|traceback \(most recent|plugin:\s*vite:vue|error when starting|tags with side effect|unexpected token|\[exit\s+[1-9]|\bexit(?:ed)?(?:\s+code)?\s*[1-9]|ELIFECYCLE|npm ERR!|error during|✖|×\s+\d+\s+error|build failed|\[vite\].*error|Error:|unclosed|mismatch/i;
const OK_RE = /hmr update|page reload|\[vite\].*connected|ready in\b|compiled successfully|dev server running|listening on|✓ built|built in \d|watching for file changes|0 error|\[exit\s+0\]/i;

function lastIndexOfRe(text, re) {
    const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`;
    const copy = new RegExp(re.source, flags);
    let last = -1;
    let match = copy.exec(text);
    while (match) {
        last = match.index;
        match = copy.exec(text);
    }
    return last;
}

function lastTimeSlice(log) {
    const text = String(log || '');
    const re = /(\d{1,2}:\d{2}:\d{2}(?:\s*[AP]M)?)/gi;
    const hits = [];
    let match = re.exec(text);
    while (match) {
        hits.push({ stamp: match[1].replace(/\s+/g, ' ').trim(), at: match.index });
        match = re.exec(text);
    }
    if (!hits.length) return { stamp: '', slice: text };
    const last = hits[hits.length - 1];
    return { stamp: last.stamp, slice: text.slice(last.at) };
}

function sliceLooksFailed(slice) {
    return FAIL_RE.test(String(slice || ''));
}

function sliceLooksHealthy(slice) {
    return OK_RE.test(String(slice || ''));
}

function terminalProblems(text) {
    const raw = stripAnsi(text);
    if (!String(raw || '').trim()) {
        return { empty: true, ok: true, text: '', stamp: '' };
    }
    const clean = stripPromptTail(raw);
    const tail = (clean || raw).slice(-12000);
    const { stamp, slice } = lastTimeSlice(tail);
    const body = stripPromptTail(sliceLooksHealthy(slice) || sliceLooksFailed(slice) ? slice : tail) || tail;
    const errAt = lastIndexOfRe(body, FAIL_RE);
    const okAt = lastIndexOfRe(body, OK_RE);
    const ok = okAt >= 0 && (errAt < 0 || okAt > errAt);
    return {
        empty: false,
        ok,
        stamp,
        text: body.slice(-4000),
    };
}

function extractLocalUrl(text) {
    const raw = stripAnsi(text);
    const labeled = raw.match(/Local:\s+(https?:\/\/[^\s]+)/i)
        || raw.match(/(?:listening on|running (?:at|on)|started (?:server )?at)\s+(https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)[^\s]*)/i);
    const blob = labeled ? labeled[1] : raw;
    const match = String(blob).match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/[^\s"'<>]*)?/i);
    if (!match) {
        const port = raw.match(/\b(?:localhost|127\.0\.0\.1):(\d{2,5})\b/i);
        return port ? `http://localhost:${port[1]}` : '';
    }
    return match[0]
        .replace(/0\.0\.0\.0/i, 'localhost')
        .replace(/\[::1\]/i, 'localhost')
        .replace(/\/$/, '');
}

async function fetchLocalPage(url, ms = 5000) {
    const href = String(url || '').trim();
    if (!href) return { ok: true, text: '', status: 0 };
    try {
        const res = await fetch(href, { signal: AbortSignal.timeout(ms) });
        const body = await res.text();
        const snippet = body.slice(0, 2500);
        const failed = !res.ok
            || /vite-error-overlay|failed to compile|internal server error|plugin:vite/i.test(body);
        return {
            ok: !failed,
            status: res.status,
            text: failed ? `HTTP ${res.status}\n${snippet}` : '',
        };
    } catch (err) {
        return { ok: false, status: 0, text: String(err?.message || err) };
    }
}

function logLooksBad(text) {
    const body = stripPromptTail(text);
    if (!body.trim()) return false;
    const report = terminalProblems(body);
    if (report.empty) return false;
    return !report.ok && sliceLooksFailed(body);
}

module.exports = {
    stripAnsi,
    stripPromptTail,
    lastTimeSlice,
    sliceLooksFailed,
    sliceLooksHealthy,
    terminalProblems,
    extractLocalUrl,
    fetchLocalPage,
    logLooksBad,
    FAIL_RE,
    OK_RE,
};
