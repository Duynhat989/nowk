const { spawn } = require('child_process');
const path = require('path');
const {
    isWin,
    defaultShell,
    interactiveShellArgs,
    shellRunArgs,
    killProcessTree,
} = require('./runtimePlatform');

const DANGEROUS = /\brm\s+(-[a-zA-Z]*rf|--no-preserve-root)|mkfs\b|dd\s+if=|shutdown\b|reboot\b/i;
const MAX_AGENT = 8000;
const MAX_STORE = 200000;
const WAIT_TIMEOUT_MS = 120000;
const START_SETTLE_MS = 5000;

const START_RE = /\b(npm(\s+run)?\s+(dev|start|serve|preview|watch)|yarn(\s+run)?\s+(dev|start|serve|preview|watch)|pnpm(\s+run)?\s+(dev|start|serve|preview|watch)|bun(\s+run)?\s+(dev|start|serve|preview|watch)|npx\s+(vite|next|nuxt|astro|remix|webpack|http-server|live-server|serve)\b|uvicorn|gunicorn|fastapi(\s+dev)?|flask run|php artisan serve|cargo run|go run|nodemon|vite(\s+preview)?|next(\s+(dev|start|preview))?|nuxt(\s+dev)?|astro(\s+dev)?|ng serve|webpack serve|http-server|live-server|remix-serve)\b/i;
const START_SCRIPT_RE = /\b(python|python3|py)\s+[^\n]*\b(main|app|manage|server|run)\.py\b|\b(node|deno)\s+[^\n]*\b(server|index|app|main)\.(js|mjs|cjs|ts)\b/i;
const CHECK_RE = /\b(py_compile|compileall|pytest|unittest|node --check|eslint|tsc)\b/i;
const READY_RE = /localhost:\d+|127\.0\.0\.1:\d+|0\.0\.0\.0:\d+|ready in\b|compiled successfully|watching for|local:\s*https?:\/\/|dev server running|listening on|started server|vite preview|application startup complete/i;

function isStartCommand(command) {
    const cmd = String(command || '').trim();
    if (CHECK_RE.test(cmd)) return false;
    return START_RE.test(cmd) || START_SCRIPT_RE.test(cmd);
}

function shellEnv(cols, rows) {
    return {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        COLUMNS: String(cols || 80),
        LINES: String(rows || 24),
    };
}

function spawnInteractive(cwd, cols, rows) {
    const env = shellEnv(cols, rows);
    const shell = defaultShell();
    try {
        const pty = require('node-pty');
        return {
            kind: 'pty',
            proc: pty.spawn(shell, interactiveShellArgs(), {
                name: 'xterm-256color',
                cols: cols || 80,
                rows: rows || 24,
                cwd,
                env,
                useConpty: isWin,
            }),
        };
    } catch {
        return {
            kind: 'pipe',
            proc: spawn(shell, isWin ? [] : ['-i'], {
                cwd,
                env,
                windowsHide: true,
                stdio: ['pipe', 'pipe', 'pipe'],
            }),
        };
    }
}

function shellTitle() {
    const name = path.basename(defaultShell());
    return name.replace(/\.exe$/i, '') || (isWin ? 'cmd' : 'bash');
}

function jobTitle(command) {
    return String(command || '').replace(/\s+/g, ' ').trim().slice(0, 28) || 'Agent';
}

function stripAnsi(text) {
    return String(text || '')
        .replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')
        .replace(/\r/g, '');
}

function logLooksBad(text) {
    const tail = stripAnsi(text).slice(-5000);
    if (!tail.trim()) return false;
    return /\b(error|failed to (compile|resolve|load)|cannot find module|module not found|syntaxerror|typeerror|referenceerror|traceback \(most recent|internal server error)\b/i
        .test(tail);
}

class TerminalService {
    constructor({ onEvent } = {}) {
        this.onEvent = onEvent;
        this.waitChild = null;
        this.bgChild = null;
        this.sessions = new Map();
        this.jobs = new Map();
        this.activeId = '';
        this.seq = 0;
        this.sessionSeq = 0;
        this.log = '';
        this.agentTermId = '';
    }

    nextSessionId() {
        this.sessionSeq += 1;
        return `term-${this.sessionSeq}`;
    }

    getSession(id) {
        return this.sessions.get(id || this.activeId) || null;
    }

    emit(data) {
        const sessionId = data?.sessionId || this.activeId || '';
        if (data?.chunk) {
            this.log = `${this.log}${data.chunk}`.slice(-MAX_STORE);
            const session = this.sessions.get(sessionId);
            if (session) session.log = `${session.log || ''}${data.chunk}`.slice(-MAX_STORE);
            const job = this.jobs.get(sessionId);
            if (job) job.log = `${job.log || ''}${data.chunk}`.slice(-MAX_STORE);
        }
        this.onEvent?.({ ...data, sessionId });
    }

    recentLog(limit = 8000) {
        const parts = [this.log];
        for (const session of this.sessions.values()) {
            if (session.log) parts.push(session.log);
        }
        const text = parts.join('\n')
            .replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')
            .replace(/\r/g, '');
        return text.trim().slice(-limit);
    }

    isRunning() {
        if (this.waitChild || this.bgChild) return true;
        for (const session of this.sessions.values()) {
            if (session.proc) return true;
        }
        return false;
    }

    stopChild(child, signal = 'SIGTERM') {
        if (!child) return;
        const pid = child.pid;
        if (isWin && pid) {
            killProcessTree(pid, signal);
            try { child.kill(); } catch { /* ignore */ }
            return;
        }
        try { child.kill(signal); } catch { /* ignore */ }
        if (pid) killProcessTree(pid, signal);
    }

    kill(target = 'all', id) {
        if (target === 'int') {
            this.interrupt(id);
            return { success: true };
        }
        if (target !== 'wait') {
            this.stopChild(this.bgChild);
            this.bgChild = null;
        }
        if (target !== 'bg') {
            this.stopChild(this.waitChild);
            this.waitChild = null;
        }
        if (target === 'all') this.stopAllSessions();
        else if (target === 'session') this.stopSession(id);
        return { success: true };
    }

    interrupt(id) {
        const sid = id || this.activeId;
        const job = this.jobs.get(sid);
        if (job?.child) {
            try { job.child.stdin?.write('\x03'); } catch { /* ignore */ }
            this.stopChild(job.child, 'SIGINT');
            return { success: true };
        }
        if (!id && this.waitChild?.stdin?.writable) {
            try { this.waitChild.stdin.write('\x03'); } catch { /* ignore */ }
            this.stopChild(this.waitChild, 'SIGINT');
            return { success: true };
        }
        if (!id && this.bgChild?.stdin?.writable) {
            try { this.bgChild.stdin.write('\x03'); } catch { /* ignore */ }
            this.stopChild(this.bgChild, 'SIGINT');
            return { success: true };
        }
        this.writeToSession('\x03', sid);
        return { success: true };
    }

    startSession({ id, cwd, cols = 80, rows = 24 } = {}) {
        const folder = String(cwd || '').trim();
        if (!folder) return { ok: false, error: 'Chưa mở folder dự án' };
        const sid = String(id || this.nextSessionId());
        const existing = this.sessions.get(sid);
        if (existing?.proc && existing.cwd === folder) {
            this.activeId = sid;
            this.resize(cols, rows, sid);
            return { ok: true, reused: true, id: sid, title: existing.title };
        }
        if (existing) this.stopSession(sid);
        const started = spawnInteractive(folder, cols, rows);
        const session = {
            id: sid,
            ...started,
            cwd: folder,
            cols,
            rows,
            log: '',
            title: shellTitle(),
            stopped: false,
        };
        this.sessions.set(sid, session);
        this.activeId = sid;
        if (started.kind === 'pty') {
            started.proc.onData((chunk) => {
                this.emit({
                    type: 'data',
                    chunk: String(chunk || ''),
                    source: 'session',
                    mode: 'session',
                    sessionId: sid,
                });
            });
            started.proc.onExit(() => {
                const current = this.sessions.get(sid);
                const closed = current?.proc === started.proc;
                const stopped = current?.stopped;
                if (closed) this.sessions.delete(sid);
                if (this.agentTermId === sid && closed) this.agentTermId = '';
                if (this.activeId === sid) {
                    this.activeId = [...this.sessions.keys()].at(-1) || '';
                }
                if (!stopped) this.emit({ type: 'session-exit', source: 'session', sessionId: sid });
            });
        } else {
            this.bindOutput(started.proc, { source: 'session', mode: 'session', sessionId: sid });
            started.proc.on('close', () => {
                const current = this.sessions.get(sid);
                const closed = current?.proc === started.proc;
                const stopped = current?.stopped;
                if (closed) this.sessions.delete(sid);
                if (this.agentTermId === sid && closed) this.agentTermId = '';
                if (this.activeId === sid) {
                    this.activeId = [...this.sessions.keys()].at(-1) || '';
                }
                if (!stopped) this.emit({ type: 'session-exit', source: 'session', sessionId: sid });
            });
        }
        this.emit({ type: 'session-start', cwd: folder, source: 'session', sessionId: sid, title: session.title });
        return { ok: true, id: sid, title: session.title };
    }

    pickTerminal(cwd) {
        if (this.agentTermId) {
            if (this.sessions.get(this.agentTermId)?.proc) {
                return { id: this.agentTermId, via: 'session' };
            }
            if (this.jobs.has(this.agentTermId)) {
                return { id: this.agentTermId, via: 'job' };
            }
            this.agentTermId = '';
        }
        const active = this.getSession(this.activeId);
        if (active?.proc) return { id: active.id, via: 'session' };
        const sessions = [...this.sessions.values()].filter((item) => item.proc);
        const sameCwd = sessions.find((item) => item.cwd === cwd);
        if (sameCwd) return { id: sameCwd.id, via: 'session' };
        if (sessions.length) return { id: sessions[sessions.length - 1].id, via: 'session' };
        const jobs = [...this.jobs.values()];
        if (jobs.length) return { id: jobs[jobs.length - 1].id, via: 'job' };
        return null;
    }

    bindJob(sessionId, { cwd, command, source, mode }) {
        const existing = this.jobs.get(sessionId);
        if (existing) {
            existing.command = command;
            existing.cwd = cwd || existing.cwd;
            existing.source = source || existing.source;
            existing.mode = mode;
            existing.reviewed = false;
            return existing;
        }
        const job = {
            id: sessionId,
            command,
            cwd,
            source,
            mode,
            log: '',
            child: null,
            ready: false,
            reviewed: false,
        };
        this.jobs.set(sessionId, job);
        return job;
    }

    runningStartLog(sessionId) {
        const job = this.jobs.get(sessionId);
        if (job?.child && (job.ready || job.mode === 'start' || isStartCommand(job.command))) {
            return stripAnsi(job.log || this.log).trim().slice(-MAX_AGENT);
        }
        const session = this.sessions.get(sessionId);
        const tail = stripAnsi(session?.log || '').slice(-4000);
        if (session?.proc && READY_RE.test(tail) && !this.looksIdle(tail)) {
            return tail.slice(-MAX_AGENT);
        }
        return '';
    }

    looksIdle(text) {
        const tail = stripAnsi(text).trim().split('\n').slice(-4).join('\n');
        if (READY_RE.test(tail) && !/[$#%>]\s*$/.test(tail)) return false;
        return /[$#%>]\s*$/.test(tail) || !READY_RE.test(tail);
    }

    isIdleSession(session) {
        if (!session?.proc) return false;
        const job = this.jobs.get(session.id);
        if (job?.child) return false;
        return this.looksIdle(session.log || '');
    }

    openJob({ cwd, command, source = 'agent', mode = 'wait' } = {}) {
        const sessionId = `job-${++this.sessionSeq}`;
        const title = jobTitle(command);
        this.jobs.set(sessionId, {
            id: sessionId,
            command,
            cwd,
            source,
            mode,
            log: '',
            child: null,
            ready: false,
            reviewed: false,
        });
        this.activeId = sessionId;
        this.emit({
            type: 'job-open',
            sessionId,
            command,
            title,
            source,
            mode,
            cwd,
        });
        return sessionId;
    }

    watchJob(job, extra = {}) {
        if (!job || job.source !== 'agent' || job.reviewed) return;
        const failed = Boolean(
            extra.closed
            || extra.error
            || (extra.code != null && extra.code !== 0)
            || extra.reason === 'error'
            || logLooksBad(job.log),
        );
        if (!failed) return;
        job.reviewed = true;
        this.emit({
            type: 'agent-watch',
            sessionId: job.id,
            command: job.command,
            title: jobTitle(job.command),
            reason: extra.reason || (extra.closed ? 'close' : extra.code ? 'exit' : 'error'),
            code: extra.code,
            log: stripAnsi(job.log).trim().slice(-5000),
        });
    }

    closeJob(id, reason = 'close') {
        const job = this.jobs.get(id);
        if (!job) return { ok: true, id };
        const running = Boolean(job.child);
        if (job.child) {
            this.stopChild(job.child);
            job.child = null;
        }
        this.emit({ type: 'job-close', sessionId: id, reason, command: job.command });
        if (running || logLooksBad(job.log)) {
            this.watchJob(job, { closed: true, reason });
        }
        this.jobs.delete(id);
        if (this.agentTermId === id) this.agentTermId = '';
        if (this.activeId === id) this.activeId = [...this.sessions.keys()].at(-1) || [...this.jobs.keys()].at(-1) || '';
        return { ok: true, id };
    }

    stopSession(id) {
        const sid = id || this.activeId;
        const session = this.sessions.get(sid);
        if (this.jobs.has(sid) && !session) return this.closeJob(sid, 'close');
        if (this.jobs.has(sid)) this.closeJob(sid, 'close');
        if (!session) return { ok: true, id: sid };
        session.stopped = true;
        try { session.proc?.kill(); } catch { /* ignore */ }
        this.sessions.delete(sid);
        if (this.agentTermId === sid) this.agentTermId = '';
        if (this.activeId === sid) {
            this.activeId = [...this.sessions.keys()].at(-1) || [...this.jobs.keys()].at(-1) || '';
        }
        return { ok: true, id: sid };
    }

    stopAllSessions() {
        for (const sid of [...this.sessions.keys()]) this.stopSession(sid);
        for (const sid of [...this.jobs.keys()]) this.closeJob(sid, 'close');
        return { ok: true };
    }

    writeToSession(text, id) {
        const session = this.getSession(id);
        if (!session?.proc) return false;
        try {
            if (session.kind === 'pty') {
                session.proc.write(text);
                return true;
            }
            if (session.proc.stdin?.writable) {
                session.proc.stdin.write(text);
                return true;
            }
        } catch {
            return false;
        }
        return false;
    }

    write(data, id) {
        const text = String(data ?? '');
        if (!text) return { ok: true };
        const payload = isWin && text === '\r' ? '\r\n' : text;
        const sid = id || this.activeId;
        if (sid) this.activeId = sid;
        try {
            const job = this.jobs.get(sid);
            if (job?.child?.stdin?.writable) {
                job.child.stdin.write(payload);
                return { ok: true };
            }
            if (!id && this.waitChild?.stdin?.writable) {
                this.waitChild.stdin.write(payload);
                return { ok: true };
            }
            if (this.writeToSession(payload, sid)) return { ok: true };
            return { ok: false, error: 'Terminal chưa sẵn sàng' };
        } catch (error) {
            return { ok: false, error: error.message };
        }
    }

    resize(cols, rows, id) {
        if (id) this.activeId = id;
        const session = this.getSession(id);
        if (!session) return { ok: true };
        session.cols = cols;
        session.rows = rows;
        if (session.kind === 'pty' && session.proc?.resize) {
            try { session.proc.resize(cols || 80, rows || 24); } catch { /* ignore */ }
        }
        return { ok: true };
    }

    bindOutput(child, { source, mode, id, sessionId } = {}) {
        const append = (chunk) => {
            const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
            if (!text) return;
            this.emit({ type: 'data', id, chunk: text, source, mode, sessionId: sessionId || this.activeId });
        };
        child.stdout?.setEncoding?.('utf8');
        child.stderr?.setEncoding?.('utf8');
        child.stdout?.on('data', append);
        child.stderr?.on('data', append);
        child.on('error', (error) => append(`${error.message}\n`));
        return append;
    }

    run({ cwd, command, source = 'user', background, settleMs } = {}) {
        const cmd = String(command || '').trim();
        if (!cmd) return Promise.resolve({ ok: false, type: 'run_command', error: 'Missing command' });
        if (DANGEROUS.test(cmd) && source === 'agent') {
            const error = 'Command blocked';
            this.emit({ type: 'error', command: cmd, error, source });
            return Promise.resolve({ ok: false, type: 'run_command', command: cmd, error });
        }
        if (!cwd) {
            return Promise.resolve({ ok: false, type: 'run_command', command: cmd, error: 'Chưa mở folder dự án' });
        }

        const asBackground = background === true || (background !== false && isStartCommand(cmd));
        let sessionId = this.activeId;
        if (source === 'agent') {
            const picked = this.pickTerminal(cwd);
            if (picked) {
                sessionId = picked.id;
            } else {
                sessionId = this.openJob({ cwd, command: cmd, source, mode: asBackground ? 'start' : 'wait' });
            }
            this.agentTermId = sessionId;
            this.activeId = sessionId;
            this.bindJob(sessionId, {
                cwd,
                command: cmd,
                source,
                mode: asBackground ? 'start' : 'wait',
            });

            const already = asBackground ? this.runningStartLog(sessionId) : '';
            if (already) {
                this.emit({ type: 'start', command: cmd, cwd, source, mode: 'start', sessionId });
                this.emit({ type: 'ready', source, mode: 'start', sessionId });
                return Promise.resolve({
                    ok: true,
                    type: 'run_start',
                    command: cmd,
                    running: true,
                    result: `${already}\n(reused IDE terminal — server already running)`.slice(0, MAX_AGENT),
                });
            }

            const session = this.getSession(sessionId);
            if (session?.proc && this.isIdleSession(session)) {
                return this.runInPty({
                    cwd,
                    command: cmd,
                    source,
                    sessionId,
                    asBackground,
                    settleMs,
                });
            }
        }

        if (asBackground) {
            return this.runBackground({ cwd, command: cmd, source, settleMs, sessionId });
        }
        return this.runWait({ cwd, command: cmd, source, sessionId });
    }

    runInPty({ cwd, command: cmd, source, sessionId, asBackground, settleMs = START_SETTLE_MS }) {
        const session = this.getSession(sessionId);
        const job = this.jobs.get(sessionId);
        if (!session?.proc) {
            return asBackground
                ? this.runBackground({ cwd, command: cmd, source, settleMs, sessionId })
                : this.runWait({ cwd, command: cmd, source, sessionId });
        }

        const id = ++this.seq;
        const startLen = (session.log || '').length;
        const startedAt = Date.now();
        this.emit({
            type: 'start',
            id,
            command: cmd,
            cwd,
            source,
            mode: asBackground ? 'start' : 'wait',
            sessionId,
        });
        const payload = isWin ? `${cmd}\r\n` : `${cmd}\n`;
        if (!this.writeToSession(payload, sessionId)) {
            return asBackground
                ? this.runBackground({ cwd, command: cmd, source, settleMs, sessionId })
                : this.runWait({ cwd, command: cmd, source, sessionId });
        }

        return new Promise((resolve) => {
            let finished = false;
            let lastLen = startLen;
            let lastChange = Date.now();
            const outputOf = () => stripAnsi((session.log || '').slice(startLen));

            const finish = (payload) => {
                if (finished) return;
                finished = true;
                clearInterval(timer);
                resolve(payload);
            };

            const markReady = () => {
                if (job) job.ready = true;
                this.emit({ type: 'ready', id, source, mode: 'start', sessionId });
                finish({
                    ok: true,
                    type: 'run_start',
                    command: cmd,
                    running: true,
                    result: `${(outputOf().trim() || '(no output yet)')}\n(server still running in IDE terminal)`.slice(0, MAX_AGENT),
                });
            };

            const timer = setInterval(() => {
                const nowLen = (session.log || '').length;
                if (nowLen !== lastLen) {
                    lastLen = nowLen;
                    lastChange = Date.now();
                    const output = outputOf();
                    if (job) job.log = output.slice(-MAX_STORE);
                    if (asBackground && READY_RE.test(output)) {
                        setTimeout(markReady, 350);
                    }
                    if (job?.ready && logLooksBad(output.slice(-800))) {
                        this.watchJob(job, { reason: 'error' });
                    }
                }
                const output = outputOf();
                if (!asBackground && output.trim() && Date.now() - lastChange > 1400 && Date.now() - startedAt > 500) {
                    const bad = logLooksBad(output);
                    this.emit({
                        type: 'exit',
                        id,
                        code: bad ? 1 : 0,
                        ok: !bad,
                        source,
                        mode: 'wait',
                        sessionId,
                    });
                    finish({
                        ok: !bad,
                        type: 'run_command',
                        command: cmd,
                        running: false,
                        result: (output.trim() || '(no output)').slice(0, MAX_AGENT),
                    });
                }
            }, 160);

            if (asBackground) {
                setTimeout(() => {
                    if (!finished) markReady();
                }, settleMs);
            } else {
                setTimeout(() => {
                    if (finished) return;
                    const output = outputOf();
                    this.emit({
                        type: 'exit',
                        id,
                        code: 0,
                        ok: true,
                        source,
                        mode: 'wait',
                        sessionId,
                    });
                    finish({
                        ok: !logLooksBad(output),
                        type: 'run_command',
                        command: cmd,
                        running: false,
                        result: (output.trim() || '(timeout)').slice(0, MAX_AGENT),
                    });
                }, WAIT_TIMEOUT_MS);
            }
        });
    }

    spawnShell(cwd, cmd) {
        return spawn(defaultShell(), shellRunArgs(cmd), {
            cwd,
            env: shellEnv(80, 24),
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'pipe'],
        });
    }

    runWait({ cwd, command: cmd, source, sessionId: givenId }) {
        const asJob = source === 'agent';
        if (!asJob && this.waitChild) {
            return Promise.resolve({
                ok: false,
                type: 'run_command',
                command: cmd,
                error: 'Terminal đang chạy lệnh khác. Dừng rồi chạy lại.',
            });
        }

        const id = ++this.seq;
        const sessionId = givenId || this.activeId;
        const job = this.jobs.get(sessionId);
        return new Promise((resolve) => {
            let output = '';
            let finished = false;
            this.emit({ type: 'start', id, command: cmd, cwd, source, mode: 'wait', sessionId });
            const child = this.spawnShell(cwd, cmd);
            if (asJob && job) job.child = child;
            else this.waitChild = child;
            this.bindOutput(child, { source, mode: 'wait', id, sessionId });

            const finish = (payload) => {
                if (finished) return;
                finished = true;
                resolve(payload);
            };

            const promote = () => {
                if (finished) return;
                if (!asJob && this.waitChild !== child) return;
                if (!asJob) this.waitChild = null;
                if (!asJob && this.bgChild && this.bgChild !== child) this.stopChild(this.bgChild);
                if (!asJob) this.bgChild = child;
                if (job) job.ready = true;
                this.emit({ type: 'ready', id, source, mode: 'start', sessionId });
                finish({
                    ok: true,
                    type: 'run_start',
                    command: cmd,
                    running: true,
                    result: `${(output.trim() || '(still running)')}\n(server still running in IDE terminal)`.slice(0, MAX_AGENT),
                });
            };

            const store = (chunk) => {
                const text = typeof chunk === 'string' ? chunk : String(chunk || '');
                output = (output + text).slice(-MAX_STORE);
                if (job) job.log = (job.log + text).slice(-MAX_STORE);
                if (READY_RE.test(output)) setTimeout(promote, 350);
                if (job?.ready && logLooksBad(text)) this.watchJob(job, { reason: 'error' });
            };
            child.stdout?.on('data', store);
            child.stderr?.on('data', store);

            child.on('close', (code) => {
                const wasWait = this.waitChild === child;
                const wasBg = this.bgChild === child;
                if (wasWait) this.waitChild = null;
                if (wasBg) this.bgChild = null;
                if (job) job.child = null;
                if (wasWait || wasBg || asJob) {
                    this.emit({ type: 'exit', id, code: code ?? 1, ok: code === 0, source, mode: wasBg || job?.ready ? 'start' : 'wait', sessionId });
                }
                if (asJob && job) this.watchJob(job, { code: code ?? 1, reason: 'exit' });
                finish({
                    ok: code === 0,
                    type: 'run_command',
                    command: cmd,
                    running: false,
                    result: (output.trim() || `(exit ${code ?? 1})`).slice(0, MAX_AGENT),
                });
            });

            setTimeout(() => {
                if (!finished && (asJob ? job?.child === child : this.waitChild === child) && output.trim()) promote();
            }, START_SETTLE_MS + 3000);

            setTimeout(() => {
                if (!asJob && this.waitChild === child) this.stopChild(child);
            }, WAIT_TIMEOUT_MS);
        });
    }

    runBackground({ cwd, command: cmd, source, settleMs = START_SETTLE_MS, sessionId: givenId }) {
        const asJob = source === 'agent';
        if (!asJob && this.bgChild) {
            this.stopChild(this.bgChild);
            this.bgChild = null;
        }

        const id = ++this.seq;
        const sessionId = givenId || this.activeId;
        const job = this.jobs.get(sessionId);
        return new Promise((resolve) => {
            let output = '';
            let settled = false;
            this.emit({ type: 'start', id, command: cmd, cwd, source, mode: 'start', sessionId });
            const child = this.spawnShell(cwd, cmd);
            if (asJob && job) job.child = child;
            else this.bgChild = child;
            this.bindOutput(child, { source, mode: 'start', id, sessionId });
            const finish = (payload) => {
                if (settled) return;
                settled = true;
                resolve(payload);
            };

            const markReady = () => {
                if (settled) return;
                if (!asJob && this.bgChild !== child) return;
                if (job) job.ready = true;
                this.emit({ type: 'ready', id, source, mode: 'start', sessionId });
                finish({
                    ok: true,
                    type: 'run_start',
                    command: cmd,
                    running: true,
                    result: `${(output.trim() || '(no output yet)')}\n(server still running in IDE terminal)`.slice(0, MAX_AGENT),
                });
            };

            const store = (chunk) => {
                const text = String(chunk || '');
                output = (output + text).slice(-MAX_STORE);
                if (job) job.log = (job.log + text).slice(-MAX_STORE);
                if (READY_RE.test(output)) setTimeout(markReady, 350);
                if (job?.ready && logLooksBad(text)) this.watchJob(job, { reason: 'error' });
            };
            child.stdout?.on('data', store);
            child.stderr?.on('data', store);

            child.on('close', (code) => {
                const current = this.bgChild === child;
                if (current) this.bgChild = null;
                if (job) job.child = null;
                if (current || asJob) {
                    this.emit({ type: 'exit', id, code: code ?? 1, ok: code === 0, source, mode: 'start', sessionId });
                }
                if (asJob && job) this.watchJob(job, { code: code ?? 1, reason: 'exit' });
                finish({
                    ok: code === 0,
                    type: 'run_start',
                    command: cmd,
                    running: false,
                    result: (output.trim() || `(exit ${code ?? 1})`).slice(0, MAX_AGENT),
                });
            });

            setTimeout(markReady, settleMs);
        });
    }
}

TerminalService.isStartCommand = isStartCommand;

module.exports = TerminalService;
