const STOP = new Set([
    'the', 'and', 'for', 'with', 'this', 'that', 'from', 'into', 'your',
    'tạo', 'thư', 'mục', 'file', 'nội', 'dung', 'viết', 'thêm', 'sửa',
    'một', 'trong', 'đó', 'với', 'cho', 'của', 'này', 'kia', 'làm',
    'create', 'folder', 'please', 'project', 'code', 'fix', 'add',
]);

function tokens(text) {
    return String(text || '')
        .toLowerCase()
        .split(/[^a-z0-9._-]+/i)
        .map((w) => w.trim())
        .filter((w) => w.length > 2 && !STOP.has(w));
}

function unique(list) {
    const out = [];
    for (const item of list || []) {
        if (item && !out.includes(item)) out.push(item);
    }
    return out;
}

function findBlock(lines, name) {
    const start = lines.findIndex((line) => new RegExp(`<${name}\\b`, 'i').test(line));
    if (start < 0) return null;
    const end = lines.findIndex((line, idx) => idx > start && new RegExp(`</${name}>`, 'i').test(line));
    return { name, start: start + 1, end: end >= 0 ? end + 1 : lines.length };
}

function outlineFile(relPath, content) {
    const lines = String(content || '').split('\n');
    const imports = [];
    const components = [];
    const symbols = [];
    const routes = [];
    lines.forEach((line, idx) => {
        const imp = line.match(/from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]/);
        if (imp) imports.push(imp[1] || imp[2]);
        const tag = line.match(/<([A-Z][A-Za-z0-9]+)\b/);
        if (tag) components.push(tag[1]);
        if (/^\s*(export\s+)?(async\s+)?function\s+\w+|^\s*(export\s+)?const\s+\w+\s*=\s*(async\s*)?\(|^\s*(export\s+default|defineComponent|createRouter|createApp)/.test(line)) {
            symbols.push({ line: idx + 1, text: line.trim().slice(0, 90) });
        }
        const route = line.match(/path:\s*['"]([^'"]+)['"]/);
        if (route) routes.push(route[1]);
    });
    const blocks = ['template', 'script', 'style']
        .map((name) => findBlock(lines, name))
        .filter(Boolean);
    return {
        path: relPath,
        total: lines.length,
        imports: unique(imports).slice(0, 24),
        components: unique(components).slice(0, 20),
        symbols: symbols.slice(0, 18),
        routes: unique(routes).slice(0, 16),
        blocks,
    };
}

function mergeRanges(ranges, total, budget = 200) {
    const sorted = (ranges || [])
        .map(([from, to]) => [Math.max(1, from), Math.min(total, to)])
        .filter(([from, to]) => from <= to)
        .sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const range of sorted) {
        const last = merged[merged.length - 1];
        if (!last || range[0] > last[1] + 6) merged.push(range);
        else last[1] = Math.max(last[1], range[1]);
    }
    const out = [];
    let left = budget;
    for (const range of merged) {
        if (left <= 0) break;
        const size = range[1] - range[0] + 1;
        if (size <= left) {
            out.push(range);
            left -= size;
        } else {
            out.push([range[0], range[0] + left - 1]);
            break;
        }
    }
    return out;
}

function connectedRanges(lines, query) {
    const total = lines.length;
    const ranges = [];
    const add = (from, to) => ranges.push([from, to]);

    let importEnd = 0;
    for (let i = 0; i < Math.min(45, total); i += 1) {
        if (/^\s*(import\s|export\s|from |<script\b)/.test(lines[i])) importEnd = i + 1;
        else if (importEnd && !lines[i].trim()) continue;
        else if (importEnd && i > importEnd + 1) break;
    }
    if (importEnd) add(1, Math.min(total, importEnd + 2));

    const template = findBlock(lines, 'template');
    const script = findBlock(lines, 'script');
    const style = findBlock(lines, 'style');
    const needle = String(query || '').trim().toLowerCase().replace(/^[.#/]+/, '');

    if (needle) {
        lines.forEach((line, idx) => {
            if (!line.toLowerCase().includes(needle)) return;
            add(idx - 7, idx + 18);
        });
        if (template) add(template.start, Math.min(template.start + 24, template.end));
        if (script) add(script.start, Math.min(script.start + 20, script.end));
    } else if (template || script) {
        if (script) add(script.start, Math.min(script.end, script.start + 40));
        if (template) add(template.start, Math.min(template.end, template.start + 45));
        if (style) add(style.start, Math.min(style.end, style.start + 18));
    } else {
        add(1, Math.min(total, 90));
    }
    return mergeRanges(ranges, total, 200);
}

function formatSlice(relPath, lines, from, to, total) {
    const start = Math.max(1, from);
    const end = Math.min(total, to);
    const body = lines.slice(start - 1, end)
        .map((line, idx) => `${String(start + idx).padStart(4, ' ')}| ${line}`)
        .join('\n');
    return `${relPath}:${start}-${end}/${total}\n${body}`;
}

function formatRead(relPath, content, query = '') {
    const text = String(content || '');
    const lines = text.split('\n');
    const brief = outlineFile(relPath, text);
    const head = [
        `FILE ${relPath} (${brief.total} lines) — already read whole file`,
        brief.imports.length ? `imports: ${brief.imports.join(', ')}` : '',
        brief.components.length ? `uses components: ${brief.components.join(', ')}` : '',
        brief.routes.length ? `routes: ${brief.routes.join(', ')}` : '',
        brief.blocks.length ? `blocks: ${brief.blocks.map((item) => `${item.name} ${item.start}-${item.end}`).join(', ')}` : '',
        brief.symbols.length
            ? `symbols:\n${brief.symbols.map((item) => `  ${item.line}| ${item.text}`).join('\n')}`
            : '',
    ].filter(Boolean).join('\n');

    if (brief.total <= 450) {
        return `${head}\n\n${formatSlice(relPath, lines, 1, brief.total, brief.total)}`;
    }

    const ranges = connectedRanges(lines, query);
    const slices = ranges.map(([from, to]) => formatSlice(relPath, lines, from, to, brief.total));
    return `${head}\n\n${slices.join('\n\n')}`;
}

class ProjectContext {
    constructor(workspaceService) {
        this.workspace = workspaceService;
    }

    async scan(root) {
        const lines = await this.workspace.listSummary(root);
        return {
            name: require('path').basename(root),
            tree: lines.slice(0, 90),
        };
    }

    pickUiSurfaces(tree) {
        const ui = [];
        for (const line of tree || []) {
            const path = this.workspace.normalizeRel(line);
            if (/\.(vue|jsx|tsx|html|css|scss)$/i.test(path)
                || /(^|\/)(views|pages|components|layouts|locales|i18n|public)(\/|$)/i.test(path)) {
                ui.push(path);
            }
        }
        return ui.slice(0, 40);
    }

    pickRelevant(tree, task, openFile) {
        const words = tokens(task);
        const scored = [];
        for (const line of tree || []) {
            const lower = line.toLowerCase();
            let score = 0;
            for (const word of words) {
                if (lower.includes(word)) score += word.length;
            }
            if (openFile?.path && lower.includes(String(openFile.path).toLowerCase())) score += 20;
            if (/\.(vue|html|css)$/i.test(lower) && /nội dung|content|giao diện|web|trang|css/i.test(task)) {
                score += 4;
            }
            if (score) scored.push({ line, score });
        }
        scored.sort((a, b) => b.score - a.score);
        const picked = scored.slice(0, 24).map((item) => this.workspace.normalizeRel(item.line));
        if (openFile?.path && !picked.includes(openFile.path)) picked.unshift(openFile.path);
        return picked;
    }

    async buildMap(root, paths) {
        const briefs = [];
        const entry = [];
        const routes = [];
        const pages = [];
        const components = [];
        const styles = [];
        const seen = new Set();
        for (const rel of paths || []) {
            const path = this.workspace.normalizeRel(rel);
            if (!path || seen.has(path) || !/\.(vue|js|ts|jsx|tsx|html|css|json)$/i.test(path)) continue;
            seen.add(path);
            if (seen.size > 18) break;
            try {
                const { content } = await this.workspace.readFile(root, path);
                const brief = outlineFile(path, content);
                briefs.push([
                    `${path} (${brief.total}L)`,
                    brief.imports.length ? `  import ${brief.imports.slice(0, 8).join(', ')}` : '',
                    brief.components.length ? `  uses ${brief.components.slice(0, 8).join(', ')}` : '',
                    brief.routes.length ? `  routes ${brief.routes.join(', ')}` : '',
                ].filter(Boolean).join('\n'));
                if (/main\.(js|ts)|App\.(vue|jsx|tsx)|index\.html/i.test(path)) entry.push(path);
                if (brief.routes.length || /router/i.test(path)) {
                    routes.push(brief.routes.length ? `${path}: ${brief.routes.join(', ')}` : path);
                }
                if (/(^|\/)(views|pages)\//i.test(path)) pages.push(path);
                if (/(^|\/)components\//i.test(path)) components.push(path);
                if (/\.(css|scss)$/i.test(path)) styles.push(path);
            } catch {
                // skip unreadable
            }
        }
        const text = [
            'PROJECT MAP (read whole key files, keep the wiring):',
            entry.length ? `entry: ${entry.join(' → ')}` : '',
            routes.length ? `router: ${routes.join(' | ')}` : '',
            pages.length ? `pages: ${pages.join(', ')}` : '',
            components.length ? `components: ${components.join(', ')}` : '',
            styles.length ? `styles: ${styles.join(', ')}` : '',
            '',
            briefs.join('\n'),
        ].filter((line, idx, all) => line || all[idx - 1]).join('\n');
        return { text: text.slice(0, 9000), entry, routes, pages, components };
    }
}

module.exports = ProjectContext;
module.exports.formatRead = formatRead;
module.exports.outlineFile = outlineFile;
