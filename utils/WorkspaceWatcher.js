const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const IGNORE_NAMES = new Set([
    'node_modules', '.git', '.venv', 'venv', '__pycache__', '.mypy_cache',
    '.pytest_cache', 'dist', 'dist-ui', '.user_data', '.electron-cache',
    '.idea', '.vscode', 'site-packages',
]);

function ignored(relPath) {
    return String(relPath || '').split(/[/\\]/).some((part) => IGNORE_NAMES.has(part));
}

class WorkspaceWatcher {
    constructor({ onChange } = {}) {
        this.onChange = onChange;
        this.root = '';
        this.watcher = null;
        this.pollTimer = null;
        this.debounceTimer = null;
        this.pending = null;
        this.signature = '';
    }

    start(root) {
        this.stop();
        const folder = String(root || '').trim();
        if (!folder || !fs.existsSync(folder)) return;
        this.root = folder;
        try {
            this.watcher = fs.watch(folder, { recursive: true }, (_event, filename) => {
                const rel = String(filename || '').replace(/\\/g, '/');
                if (ignored(rel)) return;
                this.schedule('watch', rel);
            });
        } catch {
            // poll covers platforms without recursive watch
        }
        this.poll();
        this.pollTimer = setInterval(() => this.poll(), 2000);
    }

    async poll() {
        if (!this.root) return;
        try {
            const next = await this.snapshot(this.root);
            if (this.signature && next !== this.signature) {
                this.schedule('poll', '');
            }
            this.signature = next;
        } catch {
            // ignore unreadable folders
        }
    }

    async snapshot(root) {
        const parts = [];
        const walk = async (rel, depth) => {
            if (depth > 2) return;
            let entries = [];
            try {
                entries = await fsp.readdir(rel ? path.join(root, rel) : root, { withFileTypes: true });
            } catch {
                return;
            }
            entries.sort((a, b) => a.name.localeCompare(b.name));
            for (const entry of entries) {
                if (IGNORE_NAMES.has(entry.name)) continue;
                const child = rel ? `${rel}/${entry.name}` : entry.name;
                let stamp = 0;
                try {
                    stamp = (await fsp.stat(path.join(root, child))).mtimeMs;
                } catch {
                    stamp = 0;
                }
                parts.push(`${child}:${entry.isDirectory() ? 'd' : 'f'}:${stamp}`);
                if (entry.isDirectory()) await walk(child, depth + 1);
            }
        };
        await walk('', 0);
        return parts.join('|');
    }

    schedule(action, relPath) {
        const rel = String(relPath || '').replace(/\\/g, '/');
        if (!this.pending) this.pending = { action, paths: new Set() };
        this.pending.action = action;
        if (rel) this.pending.paths.add(rel);
        clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
            const batch = this.pending;
            this.pending = null;
            const paths = [...(batch?.paths || [])];
            this.onChange?.({
                root: this.root,
                action: batch?.action || action,
                path: paths[paths.length - 1] || rel,
                paths,
            });
        }, 180);
    }

    notify(root, action, relPath) {
        if (!this.root) return;
        if (root && path.resolve(root) !== path.resolve(this.root)) return;
        this.schedule(action, relPath);
    }

    stop() {
        try { this.watcher?.close(); } catch { /* ignore */ }
        this.watcher = null;
        clearInterval(this.pollTimer);
        clearTimeout(this.debounceTimer);
        this.pollTimer = null;
        this.debounceTimer = null;
        this.pending = null;
        this.signature = '';
        this.root = '';
    }
}

module.exports = WorkspaceWatcher;
