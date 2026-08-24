const path = require('path');
const crypto = require('crypto');
const { chunkFile } = require('./CodeChunker');
const VectorStore = require('./VectorStore');

const SKIP = new Set([
    'node_modules', '.git', '.venv', 'venv', '__pycache__', 'dist', 'dist-ui',
    '.user_data', '.electron-cache', '.idea', '.vscode', '.nowk', 'site-packages',
    '.mypy_cache', '.pytest_cache', 'coverage', 'build',
]);

const CODE_EXT = /\.(js|mjs|cjs|ts|tsx|jsx|vue|py|css|scss|less|html|json|md)$/i;
const MAX_FILES = 600;

class ProjectIndexer {
    constructor(workspace) {
        this.workspace = workspace;
        this.store = new VectorStore();
        this.root = '';
        this.meta = { files: {}, hashed: '' };
        this.ready = false;
    }

    indexPath(root) {
        return path.join(root, '.nowk', 'index.json');
    }

    async ensure(root, onProgress) {
        const abs = path.resolve(root);
        if (this.root !== abs) {
            this.root = abs;
            this.store.clear();
            this.meta = { files: {}, hashed: '' };
            this.ready = false;
            const loaded = this.store.load(this.indexPath(abs));
            if (loaded?.meta?.files) this.meta = loaded.meta;
        }
        await this.reindex(abs, onProgress);
        this.ready = true;
        return this.store;
    }

    async reindex(root, onProgress) {
        const files = await this.listCodeFiles(root);
        let changed = 0;
        let scanned = 0;
        const live = new Set(files.map((item) => item.path));
        for (const rel of Object.keys(this.meta.files || {})) {
            if (!live.has(rel)) this.store.removePath(rel);
        }
        const nextMeta = { files: {} };
        for (const file of files) {
            scanned += 1;
            if (onProgress && scanned % 25 === 0) {
                onProgress(`Đang index ${scanned}/${files.length} file…`);
            }
            const stamp = `${file.size}:${file.mtime}`;
            nextMeta.files[file.path] = stamp;
            if (this.meta.files?.[file.path] === stamp && this.store.chunks.some((item) => item.path === file.path)) {
                continue;
            }
            try {
                const { content } = await this.workspace.readFile(root, file.path);
                this.store.upsert(chunkFile(file.path, content));
                changed += 1;
            } catch {
                // skip
            }
        }
        this.meta = nextMeta;
        if (changed || !this.ready) {
            try { this.store.dump(this.indexPath(root), this.meta); } catch { /* ignore */ }
        }
        return { files: files.length, chunks: this.store.chunks.length, changed };
    }

    async updateFile(root, relPath) {
        const rel = this.workspace.normalizeRel(relPath, root);
        if (!rel || !CODE_EXT.test(rel) || rel.split('/').some((part) => SKIP.has(part))) return;
        try {
            const { content } = await this.workspace.readFile(root, rel);
            this.store.upsert(chunkFile(rel, content));
            this.meta.files[rel] = String(Date.now());
        } catch {
            this.store.removePath(rel);
            delete this.meta.files[rel];
        }
    }

    async listCodeFiles(root) {
        const out = [];
        const walk = async (rel, depth) => {
            if (out.length >= MAX_FILES || depth > 8) return;
            const nodes = await this.workspace.listDir(root, rel);
            for (const node of nodes) {
                if (SKIP.has(node.name) || node.name.startsWith('.')) continue;
                if (node.type === 'dir') {
                    await walk(node.path, depth + 1);
                    continue;
                }
                if (!node.text || !CODE_EXT.test(node.path)) continue;
                let size = 0;
                let mtime = 0;
                try {
                    const abs = this.workspace.resolveSafe(root, node.path);
                    const fs = require('fs');
                    const st = fs.statSync(abs);
                    size = st.size;
                    mtime = Math.round(st.mtimeMs);
                } catch {
                    size = 0;
                }
                if (size > 400000) continue;
                out.push({ path: node.path, size, mtime });
            }
        };
        await walk('', 0);
        return out;
    }

    search(query, opts) {
        return this.store.search(query, opts);
    }
}

function projectKey(root) {
    return crypto.createHash('sha1').update(String(root || '')).digest('hex').slice(0, 12);
}

module.exports = ProjectIndexer;
module.exports.projectKey = projectKey;
