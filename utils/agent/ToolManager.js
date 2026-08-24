const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const TerminalService = require('../TerminalService');
const { toDiffLines, fileAddedLines } = require('./diffHunk');
const { formatRead } = require('./ProjectContext');
const { materializeAction } = require('./fileText');
const { resolveWritePath, retargetPackageEntry, alignPackageJsonText } = require('./moduleCompat');
const { pythonCommand, quoteForShell } = require('../runtimePlatform');

const DANGEROUS = /\brm\s+(-[a-zA-Z]*rf|--no-preserve-root)|mkfs\b|dd\s+if=|shutdown\b|reboot\b/i;
const SHELL_WRITE = /\btee\b|\b(cat|printf|echo)\b[\s\S]{0,500}(>|>>)\s*[\w./'"-]+|\b(writeFileSync|fs\.writeFile)\b/i;
const MAX_READ_LINES = 80;
const MAX_AROUND = 24;
const MAX_OUT = 6000;
const SMALL_FILE = 400;

function uniqueVariants(old) {
    const text = String(old ?? '');
    const list = [
        text,
        text.replace(/\r\n/g, '\n'),
        text.replace(/\n/g, '\r\n'),
        text.replace(/\t/g, '    '),
        text.replace(/\t/g, '  '),
        text.replace(/[ \t]+$/gm, ''),
    ];
    return list.filter((item, idx) => item && list.indexOf(item) === idx);
}

function looksFullRewrite(relPath, neu) {
    const text = String(neu || '').trim();
    if (text.length < 40) return false;
    if (/\.vue$/i.test(relPath)) {
        return /<template[\s>]/.test(text)
            && /<\/template>/.test(text)
            && (/<style[\s>]/.test(text) || /<script[\s>]/.test(text));
    }
    if (/\.html?$/i.test(relPath)) {
        return /<\/html>/i.test(text) || (/<body[\s>]/i.test(text) && /<\/body>/i.test(text));
    }
    if (/\.css$/i.test(relPath)) return (text.match(/\{/g) || []).length >= 3;
    return false;
}

class ToolManager {
    constructor(workspaceService, root, terminalService = null, extras = {}) {
        this.workspace = workspaceService;
        this.root = root;
        this.terminal = terminalService;
        this.retriever = extras.retriever || null;
        this.controller = extras.controller || null;
        this.siteIndex = extras.siteIndex || null;
        this.indexer = extras.indexer || null;
        this.hooks = extras.hooks || null;
    }

    async run(action) {
        const type = action.type;
        if (action?.path) {
            action.path = this.workspace.normalizeRel(action.path, this.root);
        }
        if (type === 'create_file' || type === 'edit_file') {
            action = materializeAction(action);
        }
        try {
            if (type === 'list_files') return this.listFiles(action.path || '');
            if (type === 'read_file') return this.readFile(action);
            if (type === 'search_code' || type === 'find_symbol' || type === 'find_references' || type === 'grep') {
                return this.searchCode(action.query || action.path, action.path || '');
            }
            if (type === 'retrieve') return this.retrieve(action);
            if (type === 'browser_open') return this.browserOpen(action);
            if (type === 'screenshot') return this.screenshot(action);
            if (type === 'mkdir') return this.mkdir(action.path);
            if (type === 'edit_file') return this.editOrCreate(action);
            if (type === 'create_file') return this.writeFile(action);
            if (type === 'delete_file') return this.deleteFile(action.path);
            if (type === 'run_command' || type === 'run_terminal') {
                if (TerminalService.isStartCommand(action.command)) return this.runStart(action.command);
                return this.runCommand(action.command, { background: action.background });
            }
            if (type === 'run_start') return this.runStart(action.command);
            if (type === 'run_stop') return this.runStop();
            if (type === 'run_test') return this.runTest(action.command);
            if (type === 'run_build') return this.runBuild(action.command);
            if (type === 'git_status') return this.gitStatus();
            if (type === 'git_diff') return this.gitDiff();
            if (type === 'git_log') return this.gitLog();
            return { ok: false, type, error: `Unknown tool: ${type}` };
        } catch (error) {
            return { ok: false, type, path: action.path, error: error.message };
        }
    }

    async listFiles(relPath) {
        const nodes = await this.workspace.listDir(this.root, relPath || '');
        return {
            ok: true,
            type: 'list_files',
            path: relPath || '.',
            result: nodes.map((n) => `${n.type === 'dir' ? 'dir' : 'file'} ${n.path}`).join('\n') || '(empty)',
        };
    }

    formatSlice(relPath, lines, from, to, total) {
        const start = Math.max(1, from);
        const end = Math.min(total, to);
        const body = lines.slice(start - 1, end)
            .map((line, idx) => `${String(start + idx).padStart(4, ' ')}| ${line}`)
            .join('\n');
        const more = end < total || start > 1
            ? `\n... ${total} lines total. Use start/end or query to read another slice.`
            : '';
        return `${relPath}:${start}-${end}/${total}\n${body}${more}`;
    }

    async readFile(action) {
        const relPath = action.path || action;
        if (!relPath || typeof relPath !== 'string') {
            return { ok: false, type: 'read_file', error: 'Missing path' };
        }
        const { content } = await this.workspace.readFile(this.root, relPath);
        const query = String(action.query || '').trim();
        const rangeFromQuery = query.match(/^(?:lines?\s+)?(\d+)\s*(?:to|-|–|:)\s*(\d+)$/i);
        if (!action.start && !action.end && rangeFromQuery) {
            action.start = Number(rangeFromQuery[1]);
            action.end = Number(rangeFromQuery[2]);
        }
        if (action.start || action.end) {
            const text = String(content || '');
            const lines = text.split('\n');
            const start = Math.max(1, Number(action.start) || 1);
            const end = Number(action.end) || start + (Number(action.lines) || 80) - 1;
            return {
                ok: true,
                type: 'read_file',
                path: relPath,
                result: this.formatSlice(relPath, lines, start, end, lines.length),
            };
        }
        return {
            ok: true,
            type: 'read_file',
            path: relPath,
            result: formatRead(relPath, content, query),
        };
    }

    async searchCode(query, relPath) {
        if (!query) return { ok: false, type: 'search_code', error: 'Missing query' };
        const hits = await this.workspace.searchCode(this.root, query, relPath || '');
        return {
            ok: true,
            type: 'search_code',
            query,
            result: hits.length
                ? hits.slice(0, 20).map((h) => `${h.path}:${h.line}: ${String(h.text || '').slice(0, 140)}`).join('\n')
                : 'No matches',
        };
    }

    async mkdir(relPath) {
        if (!relPath) return { ok: false, type: 'mkdir', error: 'Missing path' };
        await this.workspace.ensureDir(this.root, relPath);
        return { ok: true, type: 'mkdir', path: relPath, changed: true, result: `created dir ${relPath}` };
    }

    countOcc(hay, needle) {
        if (!needle) return 0;
        let n = 0;
        let i = 0;
        while (i < hay.length) {
            const at = hay.indexOf(needle, i);
            if (at === -1) break;
            n += 1;
            i = at + Math.max(1, needle.length);
        }
        return n;
    }

    locateOld(text, old) {
        const variants = uniqueVariants(old);
        for (const needle of variants) {
            const hits = this.countOcc(text, needle);
            if (hits) return { needle, hits };
        }
        return this.locateFlexible(text, old);
    }

    locateFlexible(text, old) {
        const wanted = String(old ?? '').replace(/\r\n/g, '\n').split('\n');
        while (wanted.length && !wanted[0].trim()) wanted.shift();
        while (wanted.length && !wanted[wanted.length - 1].trim()) wanted.pop();
        if (!wanted.length) return null;
        const hay = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
        const modes = [
            (a, b) => a.trimEnd() === b.trimEnd(),
            (a, b) => a.trim() === b.trim(),
        ];
        for (const same of modes) {
            const at = [];
            for (let i = 0; i <= hay.length - wanted.length; i += 1) {
                let ok = true;
                for (let j = 0; j < wanted.length; j += 1) {
                    if (!same(hay[i + j], wanted[j])) {
                        ok = false;
                        break;
                    }
                }
                if (ok) at.push(i);
            }
            if (!at.length) continue;
            const start = at[0];
            return {
                needle: hay.slice(start, start + wanted.length).join('\n'),
                hits: at.length,
            };
        }
        return null;
    }

    similarSlice(text, old) {
        const line = String(old || '').split('\n').map((item) => item.trim()).find((item) => item.length > 10);
        const lines = String(text || '').split('\n');
        if (!line) {
            return lines.slice(0, 18).map((item, idx) => `${idx + 1}| ${item}`).join('\n');
        }
        const key = line.slice(0, 48);
        const at = lines.findIndex((item) => item.includes(key) || item.trim() === line);
        const from = Math.max(0, (at < 0 ? 0 : at) - 4);
        const to = Math.min(lines.length, from + 20);
        return lines.slice(from, to).map((item, idx) => `${from + idx + 1}| ${item}`).join('\n');
    }

    hunkProblem(relPath, old, neu) {
        if (neu === old) return 'old và new giống nhau — không có thay đổi thật.';
        if (/\\n|\\t/.test(neu) && !/\\n|\\t/.test(old)) {
            return 'new chứa \\n hoặc \\t literal (escape JSON sai). Dùng newline thật trong chuỗi JSON.';
        }
        if (/\\"/.test(neu) && /\.(css|scss|vue|html)$/i.test(relPath)) {
            return 'new còn \\" — đừng ghi escape JSON vào CSS/HTML.';
        }
        const bal = (s) => ({
            c: (s.match(/\{/g) || []).length - (s.match(/\}/g) || []).length,
            r: (s.match(/\(/g) || []).length - (s.match(/\)/g) || []).length,
            s: (s.match(/\[/g) || []).length - (s.match(/\]/g) || []).length,
        });
        const a = bal(old);
        const b = bal(neu);
        if (a.c === 0 && a.r === 0 && a.s === 0 && (b.c || b.r || b.s)) {
            return `new lệch ngoặc so với old ({} ${b.c}, () ${b.r}, [] ${b.s}). Thiếu/thừa ký tự.`;
        }
        return null;
    }

    previewAround(text, needle) {
        const at = text.indexOf(needle);
        if (at < 0) return String(text).slice(0, 400);
        const from = Math.max(0, at - 120);
        const to = Math.min(text.length, at + needle.length + 160);
        return text.slice(from, to);
    }

    collectPatches(action) {
        if (Array.isArray(action.patches) && action.patches.length) {
            return action.patches
                .map((item) => ({ old: String(item.old ?? ''), new: String(item.new ?? '') }))
                .filter((item) => item.old);
        }
        if (action.old != null) {
            return [{ old: String(action.old), new: String(action.new ?? '') }];
        }
        return [];
    }

    pathExists(relPath) {
        try {
            const abs = this.workspace.resolveSafe(this.root, relPath);
            return fs.existsSync(abs);
        } catch {
            return false;
        }
    }

    async editOrCreate(action) {
        const relPath = action.path;
        if (!relPath) return { ok: false, type: 'edit_file', error: 'Missing path' };
        if (!this.pathExists(relPath)) {
            const content = action.content != null ? action.content : action.new;
            if (content != null && String(content).trim()) {
                return this.writeFile({
                    type: 'create_file',
                    path: relPath,
                    content: String(content),
                });
            }
            return {
                ok: false,
                type: 'edit_file',
                path: relPath,
                error: `Không tìm thấy file: ${relPath}. Dùng create_file với content đầy đủ — đừng dừng.`,
            };
        }
        return this.patchFile(action);
    }

    async patchFile(action) {
        let relPath = action.path;
        if (!relPath) return { ok: false, type: 'edit_file', error: 'Missing path' };
        const patches = this.collectPatches(action);
        if (!patches.length) {
            return {
                ok: false,
                type: 'edit_file',
                path: relPath,
                error: 'edit_file cần old + new (chỉ đoạn cần sửa). Không gửi cả file.',
            };
        }
        const current = await this.workspace.readFile(this.root, relPath);
        let text = String(current.content || '');
        const notes = [];
        let lastNew = '';
        const diff = [];
        for (const patch of patches) {
            const bad = this.hunkProblem(relPath, patch.old, patch.new);
            if (bad) {
                return { ok: false, type: 'edit_file', path: relPath, error: bad };
            }
            let found = this.locateOld(text, patch.old);
            if (!found && patches.length === 1 && looksFullRewrite(relPath, patch.new)) {
                const prev = text;
                text = String(patch.new);
                lastNew = patch.new;
                notes.push('full rewrite');
                diff.push(...toDiffLines(prev.slice(0, 4000), patch.new));
                continue;
            }
            if (!found) {
                return {
                    ok: false,
                    type: 'edit_file',
                    path: relPath,
                    error: `old không khớp trong ${relPath}. Đừng dùng old từ lượt trước. Disk hiện tại:\n${this.similarSlice(text, patch.old)}`,
                };
            }
            if (found.hits > 1 && !action.replace_all) {
                return {
                    ok: false,
                    type: 'edit_file',
                    path: relPath,
                    error: `old khớp ${found.hits} chỗ. Thu hẹp old cho độc nhất, hoặc replace_all:true.`,
                };
            }
            text = action.replace_all
                ? text.split(found.needle).join(patch.new)
                : text.replace(found.needle, patch.new);
            lastNew = patch.new;
            notes.push(`${found.hits} hunk`);
            diff.push(...toDiffLines(found.needle, patch.new));
        }
        const parent = relPath.split('/').slice(0, -1).join('/');
        if (parent) await this.workspace.ensureDir(this.root, parent);
        const aligned = await resolveWritePath(this.workspace, this.root, relPath, text);
        const dest = aligned.path;
        await this.workspace.writeFile(this.root, dest, text);
        if (aligned.from && aligned.from !== dest) {
            await retargetPackageEntry(this.workspace, this.root, aligned.from, dest);
            const oldAbs = this.workspace.resolveSafe(this.root, aligned.from);
            const newAbs = this.workspace.resolveSafe(this.root, dest);
            if (fs.existsSync(oldAbs) && oldAbs !== newAbs) {
                try { await this.workspace.remove(this.root, aligned.from); } catch { /* ignore */ }
            }
            relPath = dest;
        }
        const disk = await this.workspace.readFile(this.root, relPath);
        const onDisk = String(disk.content || '');
        if (lastNew && !onDisk.includes(lastNew)) {
            return {
                ok: false,
                type: 'edit_file',
                path: relPath,
                error: `Đã ghi ${relPath} nhưng đọc lại không thấy đoạn new. Sửa lại hunk.`,
            };
        }
        const preview = this.previewAround(onDisk, lastNew);
        return {
            ok: true,
            type: 'edit_file',
            path: relPath,
            changed: true,
            diff,
            result: `patched ${relPath} (${notes.join(', ')})\n--- disk preview ---\n${preview}`,
        };
    }

    async writeFile(action) {
        const relPath = action.path;
        if (!relPath) return { ok: false, type: action.type, error: 'Missing path' };
        if (!this.pathExists(relPath) && (action.content != null || action.new != null)) {
            action = { ...action, content: action.content != null ? action.content : action.new };
        } else if (String(action.old || '') && this.pathExists(relPath)) {
            return this.patchFile(action);
        }
        let content = action.content;
        if (content == null) return { ok: false, type: action.type, path: relPath, error: 'Missing content' };
        if (String(content).trim() === '[object Object]') {
            return {
                ok: false,
                type: action.type,
                path: relPath,
                error: 'content bị [object Object]. Dùng edit_file old/new.',
            };
        }
        if (/\\n|\\t|\\"/.test(String(content)) && /\.(css|scss|vue|html)$/i.test(relPath)) {
            return {
                ok: false,
                type: action.type,
                path: relPath,
                error: 'content còn \\n \\t \\" — escape JSON bị ghi ra file. Gửi nội dung thật.',
            };
        }
        const aligned = await resolveWritePath(this.workspace, this.root, relPath, content);
        const dest = aligned.path;
        const parent = dest.split('/').slice(0, -1).join('/');
        if (parent) await this.workspace.ensureDir(this.root, parent);
        if (/\.json$/i.test(dest) && dest.endsWith('package.json')) {
            const have = [];
            if (aligned.from) have.push(dest);
            content = alignPackageJsonText(String(content), have);
        }
        const abs = this.workspace.resolveSafe(this.root, dest);
        if (fs.existsSync(abs) && fs.statSync(abs).size > SMALL_FILE) {
            return {
                ok: false,
                type: 'create_file',
                path: dest,
                error: 'File đã tồn tại. Dùng edit_file với old/new, không ghi đè cả file.',
            };
        }
        await this.workspace.writeFile(this.root, dest, content);
        const notes = [...(aligned.notes || [])];
        if (aligned.from && aligned.from !== dest) {
            const extra = await retargetPackageEntry(this.workspace, this.root, aligned.from, dest);
            if (extra) notes.push(extra);
            const oldAbs = this.workspace.resolveSafe(this.root, aligned.from);
            if (fs.existsSync(oldAbs) && oldAbs !== abs) {
                try { await this.workspace.remove(this.root, aligned.from); } catch { /* keep old if busy */ }
            }
        }
        const body = String(content);
        const disk = await this.workspace.readFile(this.root, dest);
        if (!String(disk.content || '').length && body.trim()) {
            return {
                ok: false,
                type: action.type,
                path: dest,
                error: `Đã create ${dest} nhưng đọc lại file trống.`,
            };
        }
        return {
            ok: true,
            type: action.type,
            path: dest,
            changed: true,
            diff: fileAddedLines(body),
            result: `created ${dest} (${body.length} chars)${notes.length ? `\n${notes.join('\n')}` : ''}\n--- disk preview ---\n${body.slice(0, 500)}`,
        };
    }

    async deleteFile(relPath) {
        if (!relPath) return { ok: false, type: 'delete_file', error: 'Missing path' };
        await this.workspace.remove(this.root, relPath);
        return { ok: true, type: 'delete_file', path: relPath, changed: true, result: `deleted ${relPath}` };
    }

    pythonBin() {
        return pythonCommand(this.root);
    }

    readScripts() {
        try {
            const pkg = JSON.parse(fs.readFileSync(path.join(this.root, 'package.json'), 'utf8'));
            return pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
        } catch {
            return {};
        }
    }

    quote(relPath) {
        return quoteForShell(relPath);
    }

    suggestStartCommand() {
        const scripts = this.readScripts();
        if (scripts.dev) return 'npm run dev';
        if (scripts.start) return 'npm start';
        if (scripts.serve) return 'npm run serve';
        const py = this.pythonBin();
        if (fs.existsSync(path.join(this.root, 'app', 'main.py'))) {
            return `${py} -m uvicorn app.main:app --reload`;
        }
        if (fs.existsSync(path.join(this.root, 'manage.py'))) {
            return `${py} manage.py runserver`;
        }
        if (fs.existsSync(path.join(this.root, 'main.py'))) {
            return `${py} main.py`;
        }
        return '';
    }

    suggestCheckCommand(changedFiles = [], { allowFallback = false } = {}) {
        const files = (changedFiles || []).map((item) => String(item || ''));
        const pyFiles = files.filter((item) => item.endsWith('.py'));
        if (pyFiles.length) {
            return `${this.pythonBin()} -m py_compile ${pyFiles.map((item) => this.quote(item)).join(' ')}`;
        }
        const jsFiles = files.filter((item) => /\.(js|mjs|cjs)$/.test(item));
        if (jsFiles.length) {
            return jsFiles.map((item) => `node --check ${this.quote(item)}`).join(' && ');
        }
        if (!allowFallback) return '';
        const scripts = this.readScripts();
        if (scripts.build) return 'npm run build';
        if (scripts.lint) return 'npm run lint';
        if (scripts.test) return 'npm test';
        if (fs.existsSync(path.join(this.root, 'pytest.ini'))
            || fs.existsSync(path.join(this.root, 'tests'))) {
            return `${this.pythonBin()} -m pytest`;
        }
        return this.suggestStartCommand() || '';
    }

    suggestVerifyAction(task, changedFiles = []) {
        const text = String(task || '');
        const wantsStart = /chạy|khởi chạy|khởi động|run (the )?(app|server)|start|serve|dev server/i.test(text);
        const wantsCheck = /test|kiểm tra|verify|lint|build|fix|lỗi|error|bug|sửa/i.test(text);
        const codeFiles = (changedFiles || []).filter((item) => /\.(py|js|mjs|cjs|ts|tsx|jsx)$/i.test(item));
        if (wantsStart) {
            const command = this.suggestStartCommand() || this.suggestCheckCommand(changedFiles, { allowFallback: true });
            if (command) return { type: 'run_start', command };
        }
        if (wantsCheck || codeFiles.length) {
            const command = this.suggestCheckCommand(wantsCheck ? changedFiles : codeFiles, { allowFallback: wantsCheck });
            if (command) {
                const type = /test|pytest|npm test/i.test(command) ? 'run_test' : 'run_command';
                return { type, command };
            }
        }
        return null;
    }

    runCommand(command, { background } = {}) {
        const cmd = String(command || '').trim();
        if (!cmd) return Promise.resolve({ ok: false, type: 'run_command', error: 'Missing command' });
        const gated = this.hooks?.gateAction?.({ type: 'run_command', command: cmd })
            || this.hooks?.gateAction?.({ type: 'run_command', command: cmd });
        if (gated && gated.ok === false) {
            return Promise.resolve({ ok: false, type: 'run_command', command: cmd, error: gated.reason || 'Command blocked by AG Kit hook' });
        }
        if (DANGEROUS.test(cmd)) {
            return Promise.resolve({ ok: false, type: 'run_command', error: 'Command blocked' });
        }
        if (SHELL_WRITE.test(cmd)) {
            return Promise.resolve({
                ok: false,
                type: 'run_command',
                command: cmd,
                error: 'Không ghi file bằng terminal. File mới: create_file. File đã có: edit_file với old/new (chỉ đoạn cần sửa).',
            });
        }
        if (this.terminal) {
            return this.terminal.run({
                cwd: this.root,
                command: cmd,
                source: 'agent',
                ...(background === true ? { background: true } : {}),
            });
        }
        return new Promise((resolve) => {
            exec(cmd, {
                cwd: this.root,
                timeout: 90000,
                maxBuffer: 1024 * 1024,
                env: process.env,
            }, (err, stdout, stderr) => {
                const output = `${stdout || ''}${stderr ? `\n${stderr}` : ''}`.trim();
                resolve({
                    ok: !err,
                    type: 'run_command',
                    command: cmd,
                    result: (output || err?.message || '').slice(0, MAX_OUT),
                });
            });
        });
    }

    runStart(command) {
        const cmd = String(command || '').trim() || this.suggestStartCommand();
        if (!cmd) return Promise.resolve({ ok: false, type: 'run_start', error: 'No start command detected' });
        return this.runCommand(cmd, { background: true }).then((result) => ({
            ...result,
            type: 'run_start',
        }));
    }

    runStop() {
        if (!this.terminal) return Promise.resolve({ ok: false, type: 'run_stop', error: 'No terminal' });
        this.terminal.kill('bg');
        return Promise.resolve({ ok: true, type: 'run_stop', result: 'stopped background process' });
    }

    async runTest(command) {
        if (command) return this.runCommand(command);
        const detected = this.suggestCheckCommand();
        if (detected && /test|pytest/i.test(detected)) return this.runCommand(detected);
        if (fs.existsSync(path.join(this.root, 'package.json'))) return this.runCommand('npm test');
        if (fs.existsSync(path.join(this.root, 'pytest.ini'))
            || fs.existsSync(path.join(this.root, 'tests'))) {
            return this.runCommand(`${this.pythonBin()} -m pytest`);
        }
        return { ok: false, type: 'run_test', error: 'No test command detected' };
    }

    async runBuild(command) {
        if (command) return this.runCommand(command);
        if (fs.existsSync(path.join(this.root, 'package.json'))) return this.runCommand('npm run build');
        return { ok: false, type: 'run_build', error: 'No build command detected' };
    }

    async gitStatus() {
        const map = await this.workspace.gitStatus(this.root);
        const lines = Object.entries(map).map(([file, status]) => `${status} ${file}`);
        return { ok: true, type: 'git_status', result: lines.join('\n') || '(clean)' };
    }

    async gitDiff() {
        const diff = await this.workspace.gitDiff(this.root);
        return { ok: true, type: 'git_diff', result: String(diff || '(no diff)').slice(0, MAX_OUT) };
    }

    async gitLog() {
        const log = await this.workspace.gitLog(this.root);
        return { ok: true, type: 'git_log', result: String(log || '(no log)').slice(0, MAX_OUT) };
    }

    async retrieve(action) {
        const query = String(action.query || action.path || '').trim();
        if (!query) return { ok: false, type: 'retrieve', error: 'Missing query' };
        if (!this.retriever) return { ok: false, type: 'retrieve', error: 'Index chưa sẵn sàng' };
        const found = this.retriever.retrieve(query, { k: 8 });
        return {
            ok: true,
            type: 'retrieve',
            query,
            result: found.digest || '(no hits)',
        };
    }

    async browserOpen(action) {
        const url = String(action.url || action.path || action.query || '').trim();
        if (!url) return { ok: false, type: 'browser_open', error: 'Missing url' };
        if (!this.siteIndex || !this.controller) {
            return { ok: false, type: 'browser_open', error: 'Chrome chưa mở — không crawl được website.' };
        }
        const captured = await this.siteIndex.capture(this.controller, url);
        if (!captured.ok) return { ok: false, type: 'browser_open', error: captured.error };
        return {
            ok: true,
            type: 'browser_open',
            path: captured.path,
            result: captured.digest,
        };
    }

    async screenshot(action) {
        const url = String(action.url || action.path || '').trim();
        if (!this.siteIndex || !this.controller) {
            return { ok: false, type: 'screenshot', error: 'Chrome chưa mở.' };
        }
        const shot = await this.siteIndex.screenshot(this.controller, url);
        return { ...shot, type: 'screenshot' };
    }
}

module.exports = ToolManager;
