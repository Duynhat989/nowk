const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');

const SKIP_NAMES = new Set([
    '.git',
    '.DS_Store',
    '.user_data',
    '.electron-cache',
    '.nowk',
]);

const TEXT_EXTENSIONS = new Set([
    '.js', '.cjs', '.mjs', '.ts', '.tsx', '.jsx', '.vue', '.json', '.css', '.scss',
    '.html', '.htm', '.md', '.txt', '.py', '.go', '.rs', '.java', '.c', '.cc', '.cpp',
    '.h', '.hpp', '.sh', '.zsh', '.bash', '.yml', '.yaml', '.xml', '.svg', '.env',
    '.gitignore', '.npmrc', '.editorconfig', '.log', '.csv', '.sql', '.toml',
    '.ini', '.conf', '.cfg', '.php', '.rb', '.kt', '.swift', '.dart',
]);

const MAX_READ_BYTES = 2 * 1024 * 1024;
const MAX_MEDIA_BYTES = 16 * 1024 * 1024;
const MEDIA_TYPES = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.avif': 'image/avif',
    '.bmp': 'image/bmp',
    '.ico': 'image/x-icon',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.ogg': 'video/ogg',
    '.ogv': 'video/ogg',
    '.mov': 'video/quicktime',
    '.m4v': 'video/mp4',
};

function normalizeRelPath(relPath, root = '') {
    let s = String(relPath ?? '').replace(/\\/g, '/');
    s = s.replace(/[\u0000-\u001F\u007F\u200B-\u200D\uFEFF\uFFFD]/g, '');
    s = s.trim();

    if (root) {
        const rootAbs = path.resolve(root).replace(/\\/g, '/').replace(/\/+$/, '');
        if (s === rootAbs) s = '';
        else if (s.startsWith(`${rootAbs}/`)) s = s.slice(rootAbs.length + 1);
    }

    s = s.replace(/^file:\/\//i, '');
    s = s.replace(/^["'`*_~]+/, '').replace(/["'`*_~]+$/, '').trim();

    for (let i = 0; i < 6; i += 1) {
        const next = s
            .replace(/^\d+[\.)]\s*/, '')
            .replace(/^(?:file|path|folder|dir)\s*[:\-]\s*/i, '')
            .replace(/^(?:\[(?:file|dir|folder|d|f)\]|[📁📄📂📃📝📦])\uFE0F?\s*/u, '')
            .replace(/^[•●○◦▪▸►▶·–—*-]\s+/, '');
        if (next === s) break;
        s = next.trim();
    }

    s = s.replace(/^\.\//, '').replace(/^\/+/, '');
    s = s.replace(/:\d+(?:-\d+)?(?::\d+)?$/, '');
    s = s.replace(/#L\d+(?:-L?\d+)?$/i, '');
    s = s.replace(/\/+$/, '').trim();

    if (!s) return '';
    if (/\s|[📁📄\uFFFD]/.test(s)) {
        const match = s.match(/((?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+(?:\.[A-Za-z0-9]+)?)/);
        if (match) s = match[1];
    }
    return s;
}

class WorkspaceService {
    constructor({ onChange } = {}) {
        this.onChange = onChange;
    }

    changed(root, action, relPath) {
        this.onChange?.({ root, action, path: relPath || '' });
    }

    normalizeRel(relPath, root = '') {
        return normalizeRelPath(relPath, root);
    }

    resolveSafe(root, relPath = '') {
        const rootAbs = path.resolve(root);
        const cleaned = normalizeRelPath(relPath, rootAbs);
        const target = path.resolve(rootAbs, cleaned || '.');
        const rel = path.relative(rootAbs, target);
        if (rel.startsWith('..') || path.isAbsolute(rel)) {
            throw new Error('Đường dẫn không hợp lệ');
        }
        return target;
    }

    isTextFile(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        const base = path.basename(filePath);
        if (base === 'Dockerfile' || base === 'Makefile' || base.startsWith('.')) return true;
        return TEXT_EXTENSIONS.has(ext);
    }

    async listDir(root, relPath = '') {
        const dir = this.resolveSafe(root, relPath);
        let entries = [];
        try {
            entries = await fsp.readdir(dir, { withFileTypes: true });
        } catch {
            return [];
        }

        const nodes = [];
        for (const entry of entries) {
            if (SKIP_NAMES.has(entry.name)) continue;
            const childRel = relPath ? `${relPath}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                nodes.push({
                    name: entry.name,
                    path: childRel,
                    type: 'dir',
                });
            } else if (entry.isFile()) {
                nodes.push({
                    name: entry.name,
                    path: childRel,
                    type: 'file',
                    text: this.isTextFile(path.join(dir, entry.name)),
                });
            }
        }

        nodes.sort((a, b) => {
            if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
            return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        });
        return nodes;
    }

    async listSummary(root, relPath = '', depth = 0, acc = []) {
        if (depth > 4 || acc.length > 180) return acc;
        const nodes = await this.listDir(root, relPath);
        const skipDeep = new Set([
            'node_modules', 'dist', 'dist-ui', '.user_data', '.electron-cache',
            '.venv', 'venv', '__pycache__', '.mypy_cache', '.pytest_cache',
            'site-packages', '.idea', '.vscode', '.nowk',
        ]);
        for (const node of nodes) {
            if (skipDeep.has(node.name)) continue;
            acc.push(node.type === 'dir' ? `${node.path}/` : node.path);
            if (node.type === 'dir' && acc.length < 180) {
                await this.listSummary(root, node.path, depth + 1, acc);
            }
        }
        return acc;
    }

    async searchCode(root, query, relPath = '') {
        const needle = String(query || '').trim();
        if (!needle) return [];
        const hits = [];
        const skip = new Set([
            'node_modules', 'dist', 'dist-ui', '.user_data', '.electron-cache',
            '.venv', 'venv', '__pycache__', '.mypy_cache', '.pytest_cache',
            'site-packages', '.idea', '.vscode', '.git', '.nowk',
        ]);
        const walk = async (rel, depth) => {
            if (hits.length >= 40 || depth > 6) return;
            const nodes = await this.listDir(root, rel);
            for (const node of nodes) {
                if (hits.length >= 40) return;
                if (skip.has(node.name)) continue;
                if (node.type === 'dir') {
                    await walk(node.path, depth + 1);
                    continue;
                }
                if (!node.text) continue;
                try {
                    const { content } = await this.readFile(root, node.path);
                    const lines = String(content || '').split('\n');
                    lines.forEach((line, idx) => {
                        if (hits.length >= 40) return;
                        if (line.toLowerCase().includes(needle.toLowerCase())) {
                            hits.push({
                                path: node.path,
                                line: idx + 1,
                                text: line.trim().slice(0, 200),
                            });
                        }
                    });
                } catch {
                    // skip unreadable
                }
            }
        };
        await walk(relPath, 0);
        return hits;
    }

    gitDiff(root) {
        return new Promise((resolve) => {
            execFile('git', ['diff', '--', '.'], {
                cwd: root,
                timeout: 8000,
                maxBuffer: 1024 * 1024,
                windowsHide: true,
            }, (err, stdout) => {
                resolve(err ? '' : String(stdout || ''));
            });
        });
    }

    gitLog(root) {
        return new Promise((resolve) => {
            execFile('git', ['log', '-8', '--oneline'], {
                cwd: root,
                timeout: 8000,
                maxBuffer: 256 * 1024,
                windowsHide: true,
            }, (err, stdout) => {
                resolve(err ? '' : String(stdout || ''));
            });
        });
    }

    gitStatus(root) {
        return new Promise((resolve) => {
            execFile('git', ['status', '--porcelain', '-uall'], {
                cwd: root,
                timeout: 8000,
                maxBuffer: 2 * 1024 * 1024,
                windowsHide: true,
            }, (err, stdout) => {
                if (err) {
                    resolve({});
                    return;
                }
                const map = {};
                for (const raw of String(stdout || '').split('\n')) {
                    if (raw.length < 4) continue;
                    const code = raw.slice(0, 2);
                    let file = raw.slice(3).trim();
                    if (file.includes(' -> ')) file = file.split(' -> ').pop();
                    file = file.replace(/^"/, '').replace(/"$/, '').replace(/\\/g, '/');
                    let status = '';
                    if (code.includes('?')) status = 'U';
                    else if (code.includes('A')) status = 'A';
                    else if (code.includes('D')) status = 'D';
                    else if (code.includes('M') || code.includes('R')) status = 'M';
                    if (status && file) map[file] = status;
                }
                resolve(map);
            });
        });
    }

    async readFile(root, relPath) {
        const filePath = this.resolveSafe(root, relPath);
        let stat;
        try {
            stat = await fsp.stat(filePath);
        } catch (error) {
            if (error && error.code === 'ENOENT') {
                const clean = normalizeRelPath(relPath, root) || relPath;
                throw new Error(`Không tìm thấy file: ${clean}`);
            }
            throw error;
        }
        if (!stat.isFile()) throw new Error('Không phải file');
        if (stat.size > MAX_READ_BYTES) throw new Error('File quá lớn để mở trong IDE');
        if (!this.isTextFile(filePath)) throw new Error('Không thể mở file nhị phân');
        const content = await fsp.readFile(filePath, 'utf8');
        return { content, size: stat.size };
    }

    async readMedia(root, relPath) {
        const filePath = this.resolveSafe(root, relPath);
        const ext = path.extname(filePath).toLowerCase();
        const mime = MEDIA_TYPES[ext];
        if (!mime) throw new Error('Không phải ảnh hoặc video');
        const stat = await fsp.stat(filePath);
        if (!stat.isFile()) throw new Error('Không phải file');
        if (stat.size > MAX_MEDIA_BYTES) throw new Error('File media quá lớn');
        const buf = await fsp.readFile(filePath);
        return {
            mime,
            size: stat.size,
            dataUrl: `data:${mime};base64,${buf.toString('base64')}`,
        };
    }

    async writeFile(root, relPath, content) {
        const filePath = this.resolveSafe(root, relPath);
        await fsp.mkdir(path.dirname(filePath), { recursive: true });
        await fsp.writeFile(filePath, content ?? '', 'utf8');
        this.changed(root, 'write', relPath);
        return { success: true };
    }

    async ensureDir(root, relPath = '') {
        const target = relPath
            ? this.resolveSafe(root, relPath)
            : path.resolve(root);
        await fsp.mkdir(target, { recursive: true });
        if (relPath) this.changed(root, 'create', relPath);
        return { success: true, path: relPath || '.' };
    }

    async create(root, relPath, type = 'file') {
        const target = this.resolveSafe(root, relPath);
        if (type === 'dir') {
            await fsp.mkdir(target, { recursive: true });
            this.changed(root, 'create', relPath);
            return { success: true, path: relPath };
        }
        if (fs.existsSync(target)) throw new Error('Đã tồn tại');
        await fsp.mkdir(path.dirname(target), { recursive: true });
        await fsp.writeFile(target, '', 'utf8');
        this.changed(root, 'create', relPath);
        return { success: true, path: relPath };
    }

    async remove(root, relPath) {
        const target = this.resolveSafe(root, relPath);
        await fsp.rm(target, { recursive: true, force: true });
        this.changed(root, 'delete', relPath);
        return { success: true };
    }

    async rename(root, fromRel, toRel) {
        const from = this.resolveSafe(root, fromRel);
        const to = this.resolveSafe(root, toRel);
        if (fs.existsSync(to)) throw new Error('Tên mới đã tồn tại');
        await fsp.mkdir(path.dirname(to), { recursive: true });
        await fsp.rename(from, to);
        this.changed(root, 'rename', toRel);
        return { success: true };
    }
}

WorkspaceService.normalizeRel = normalizeRelPath;

module.exports = WorkspaceService;
