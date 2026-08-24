const path = require('path');

const ALIASES = [
    { re: /bàn|ban\b|\btable/i, queries: ['table', 'tables', 'bàn', 'TableList', 'danhSachBan'] },
    { re: /đơn hàng|order|giỏ|cart/i, queries: ['order', 'orders', 'cart', 'currentOrder'] },
    { re: /thanh toán|payment|pay\b|checkout/i, queries: ['payment', 'pay', 'checkout', 'Payment'] },
    { re: /popup|modal|dialog/i, queries: ['modal', 'popup', 'dialog'] },
    { re: /menu|món|product/i, queries: ['menu', 'product', 'item'] },
    { re: /devtools|dev tools|openDevTools/i, queries: ['openDevTools', 'devtools', 'ipcMain', 'preload', 'contextBridge'] },
    { re: /button|nút|electron|ipc|preload/i, queries: ['ipcMain', 'ipcRenderer', 'contextBridge', 'preload', 'BrowserWindow'] },
];

function unique(list) {
    const out = [];
    for (const item of list || []) {
        if (item && !out.includes(item)) out.push(item);
    }
    return out;
}

function entityQueries(task) {
    const text = String(task || '');
    const queries = [];
    for (const item of ALIASES) {
        if (item.re.test(text)) queries.push(...item.queries);
    }
    return unique(queries);
}

function resolveImport(fromPath, spec) {
    const raw = String(spec || '').split('?')[0].split('#')[0];
    if (!raw || raw.startsWith('http')) return '';
    let rel = raw.replace(/^@\/?/, '').replace(/^~\//, '');
    if (raw.startsWith('.')) {
        const dir = path.posix.dirname(String(fromPath || '.').replace(/\\/g, '/'));
        rel = path.posix.normalize(`${dir}/${raw}`);
    }
    return rel.replace(/^\.\//, '').replace(/\\/g, '/');
}

function indexedPaths(indexer) {
    return [...new Set((indexer?.store?.chunks || []).map((item) => item.path).filter(Boolean))];
}

function matchPath(paths, resolved) {
    if (!resolved) return '';
    const base = resolved.replace(/\.(vue|jsx|tsx|js|ts|mjs)$/i, '');
    const want = [
        resolved,
        `${resolved}.vue`, `${resolved}.js`, `${resolved}.ts`,
        `${resolved}.jsx`, `${resolved}.tsx`,
        `${resolved}/index.js`, `${resolved}/index.ts`, `${resolved}/index.vue`,
        base, `${base}.vue`, `${base}.js`,
    ];
    for (const item of want) {
        if (paths.includes(item)) return item;
        const hit = paths.find((p) => p === item || p.endsWith(`/${item}`));
        if (hit) return hit;
    }
    const name = base.split('/').pop();
    if (!name) return '';
    return paths.find((p) => p.split('/').pop()?.replace(/\.[^.]+$/, '') === name) || '';
}

function importsOf(indexer, relPath) {
    const blobs = (indexer?.store?.chunks || [])
        .filter((item) => item.path === relPath)
        .map((item) => `${item.preview || ''} ${(item.words || []).join(' ')}`);
    const text = blobs.join('\n');
    const specs = [...text.matchAll(/from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]/g)]
        .map((m) => m[1] || m[2]);
    const paths = indexedPaths(indexer);
    return unique(specs.map((spec) => matchPath(paths, resolveImport(relPath, spec))).filter(Boolean));
}

function formatHits(hits) {
    return (hits || []).map((hit) => {
        const where = hit.start && hit.end ? `:${hit.start}-${hit.end}` : '';
        return `[${hit.kind}] ${hit.path}${where}  ${hit.name}\n${String(hit.preview || '').slice(0, 360)}`;
    }).join('\n\n');
}

class Retriever {
    constructor(indexer) {
        this.indexer = indexer;
    }

    retrieve(task, { openFile, k = 14, extra = [] } = {}) {
        const query = String(task || '').trim();
        const hits = this.indexer.search(query, { k: Math.max(k, 10) });
        const extraHits = [];
        for (const blob of extra || []) {
            extraHits.push(...this.indexer.search(blob, { k: 4 }));
        }
        if (openFile?.path) {
            extraHits.push(...this.indexer.search(openFile.path, { k: 4 }));
        }
        for (const term of entityQueries(task)) {
            extraHits.push(...this.indexer.search(term, { k: 5 }));
        }
        if (/electron|devtools|dev tools|button|nút|ipc|preload/i.test(query)) {
            for (const term of ['ipcMain.handle', 'contextBridge', 'preload', 'openDevTools']) {
                extraHits.push(...this.indexer.search(term, { k: 4 }));
            }
            for (const rel of indexedPaths(this.indexer)) {
                if (/preload\.(js|ts)$|(^|\/)(main|index)\.(js|ts)$/i.test(rel)) {
                    extraHits.push(...this.indexer.search(rel, { k: 2 }));
                }
            }
        }

        const merged = this.merge(hits, extraHits);
        const seedFiles = unique(merged.map((item) => item.path)).slice(0, 8);
        for (const rel of seedFiles) {
            for (const linked of importsOf(this.indexer, rel)) {
                extraHits.push(...this.indexer.search(linked, { k: 3 }));
            }
            extraHits.push(...this.indexer.search(rel, { k: 2 }));
        }

        const top = this.merge(merged, extraHits).slice(0, k);
        let files = unique(top.map((item) => item.path)).slice(0, 10);
        const treeInfo = this.relationTree(files);
        for (const extraPath of treeInfo.linked) {
            if (!files.includes(extraPath)) files.push(extraPath);
        }
        files = files.slice(0, 12);
        return {
            files,
            chunks: top,
            tree: treeInfo.text,
            digest: this.digest(top, files, task, treeInfo.text),
        };
    }

    relationTree(files) {
        const seeds = (files || []).filter(Boolean).slice(0, 8);
        const paths = indexedPaths(this.indexer);
        const cache = new Map();
        const imps = (rel) => {
            if (!cache.has(rel)) cache.set(rel, importsOf(this.indexer, rel));
            return cache.get(rel);
        };
        const reverse = {};
        for (const seed of seeds) reverse[seed] = [];
        const seedSet = new Set(seeds);
        for (const rel of paths) {
            const found = imps(rel);
            for (const target of found) {
                if (seedSet.has(target) && rel !== target) {
                    reverse[target].push(rel);
                }
            }
        }
        const linked = [];
        const lines = [];
        for (const rel of seeds) {
            const down = imps(rel).slice(0, 6);
            const up = unique(reverse[rel] || []).slice(0, 6);
            lines.push(rel);
            for (const item of down) {
                lines.push(`  → ${item}`);
                linked.push(item);
            }
            for (const item of up) {
                lines.push(`  ← ${item}`);
                linked.push(item);
            }
            if (!down.length && !up.length) lines.push('  (no local imports found)');
        }
        return {
            text: lines.join('\n') || '(no related files)',
            linked: unique(linked).filter((rel) => !seeds.includes(rel)).slice(0, 6),
        };
    }

    merge(...lists) {
        const out = [];
        const seen = new Set();
        for (const list of lists) {
            for (const hit of list || []) {
                const key = `${hit.path}:${hit.kind}:${hit.start}`;
                if (seen.has(key)) continue;
                seen.add(key);
                out.push(hit);
            }
        }
        out.sort((a, b) => (b.score || 0) - (a.score || 0));
        return out;
    }

    digest(chunks, files, task, tree = '') {
        const fileList = (files || []).join(', ') || '(none)';
        const body = formatHits(chunks).slice(0, 5200);
        const entities = entityQueries(task);
        const share = entities.length
            ? `\nSOURCE OF TRUTH: existing UI for [${entities.slice(0, 6).join(', ')}] must share ONE state. Do not create a second list/store. Wire popup/modal into the same array/ref/store the main view already uses.`
            : '';
        const behavior = /button|nút|devtools|electron|ipc/i.test(String(task || ''))
            ? '\nBEHAVIOR: a control is incomplete until it works. For Electron: renderer @click → preload expose → ipcMain → real API (e.g. openDevTools). Copy existing ipc in this repo.'
            : '';
        const treeBlock = tree ? `\nRELATION TREE (→ imports, ← imported-by):\n${tree}` : '';
        return `RETRIEVED CONTEXT (connected slices, not the whole repo)
Likely files: ${fileList}
CONNECTED SURFACES (keep in sync): ${fileList}${treeBlock}${share}${behavior}

${body || '(no chunks)'}`;
    }
}

module.exports = Retriever;
module.exports.formatHits = formatHits;
module.exports.entityQueries = entityQueries;
