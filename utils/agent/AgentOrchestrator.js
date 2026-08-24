const AgentState = require('./AgentState');
const ProjectContext = require('./ProjectContext');
const ToolManager = require('./ToolManager');
const GeminiWebAdapter = require('./GeminiWebAdapter');
const { parseResponse, looksTruncated, looksLikeRefusal } = require('./ResponseParser');
const { compressState } = require('./ContextCompressor');
const { verifyChanges, formatReport, auditAction } = require('./ChangeVerifier');
const { extractUrls } = require('./web/SiteIndex');
const { checkWiring, formatWiring } = require('./WiringCheck');
const { checkBehavior, formatBehavior, wantsControl } = require('./BehaviorCheck');
const { splitRequirements, parseAiPlan, planPrompt, formatRequirements, kindProgress, formatKindBlock, kindMeta } = require('./Requirements');
const { toDiffLines, fileAddedLines } = require('./diffHunk');

const MAX_ITERS = 20;
const WRITE_TOOLS = new Set(['mkdir', 'create_file', 'edit_file', 'delete_file', 'run_command', 'run_test', 'run_build', 'run_start', 'run_stop']);
const READ_TOOLS = new Set(['list_files', 'read_file', 'search_code', 'find_symbol', 'find_references', 'git_status', 'git_diff', 'git_log', 'retrieve', 'browser_open', 'screenshot']);
const RUN_TOOLS = new Set(['run_command', 'run_test', 'run_build', 'run_start']);

const PROTOCOL = `You are NowK, a coding agent (Cursor-style). NowK already indexed the repo into a vector store and retrieved the relevant slices below.
You call tools by returning ONE JSON object. NowK executes it on the real project.

{"analysis":"one short sentence","plan":["file — change"],"actions":[{"type":"read_file","path":"src/App.vue","start":1,"end":80}],"done":false}

actions items MUST have "type".

Tools:
retrieve {query} | read_file {path, start?, end?} | search_code {query} | grep {query}
edit_file {path, old, new} | create_file {path, content} | delete_file {path} | mkdir {path}
run_command {command} | run_start {command} | run_test {command}
browser_open {url} | screenshot {url?}

Loop: split ALL user requirements → classify each (feature/bugfix/update/...) → follow THAT kind's playbook → next requirement → done only after the last.
- Count every ask. Do not drop any. Do not treat them all the same.
- FEATURE: survey RELATION TREE first (who owns state, who renders, who writes), then implement on that tree. Never duplicate state.
- BUGFIX: locate + name the root cause, read callers, THEN fix the cause. No blind patches.
- UPDATE: find the current implementation, patch in place, sync connected surfaces.
- done=true ONLY when every requirement's playbook is finished. Never stop after the first ask.
- Use RETRIEVED CONTEXT first. Do not list the whole project.
- A button/menu/control is NOT done until it works. Never add a dead label.
- Electron: copy existing ipcMain.handle + contextBridge.exposeInMainWorld. Renderer @click must invoke a channel. Dev Tools = webContents.openDevTools() in main, not just a <button>.
- A popup/page is incomplete if the main UI still uses a different array/ref/store. NEVER duplicate state.
- If CONNECTED SURFACES lists several files, read them and wire them together before done=true.
- Do not edit package.json/README to mark done. No fake finalize steps.
- If a tool returns an error (missing file, old mismatch, audit fail): FIX it now. create_file if the path does not exist. Never done=true while errors remain.
- STYLE/restyle of "all UI": edit every Vue/CSS in RELATION TREE. One extra theme file is not enough.
- edit_file: copy old EXACTLY from numbered lines. Do not redeclare the same identifier.
- When the request actually works (UI + behavior + shared data): actions=[] done=true.
- Never say you lack tools.`;

const TURN = `Return only that JSON. Escape quotes as \\".`;

const STOP_NEEDLE = new Set([
    'please', 'this', 'that', 'with', 'from', 'file', 'code', 'project', 'build',
    'chạy', 'chương', 'trình', 'giúp', 'dùng', 'thử', 'thêm', 'sửa', 'tạo',
    'cho', 'tôi', 'các', 'một', 'này', 'làm', 'được', 'muốn', 'phần', 'hoạt',
]);

function wantsFileWork(message) {
    return /tạo|xóa|sửa|thêm|file|thư mục|folder|mkdir|write|delete|fix|refactor|implement|viết|nội dung|giao diện|thay đổi|đổi/i.test(message);
}

function isBroadChange(message) {
    return /nội dung|content|toàn bộ|triệt để|giống|theo dự án|clone|copy web|giao diện|website|trang web|i18n|dịch|đổi hết|thay đổi web|theo mẫu|project khác|toàn project|mọi trang|cả site|refactor|restyle/i.test(message)
        || (wantsFileWork(message) && /web|ui|trang|component|css|style|copy/i.test(message));
}

function wantsVerify(message) {
    return /khởi chạy|khởi động|npm (run|test|start)|run[_ ]?(dev|test|start|build)|chạy (lại )?(app|dev|test|preview|server|project)|serve|lint|build (lại|project|app)|start (dev|server|app)/i.test(message);
}

function hasRun(state) {
    return (state.toolLog || []).some((item) => RUN_TOOLS.has(item.type));
}

function planFiles(item) {
    return String(item?.task || '').match(/[A-Za-z0-9._/-]+\.(vue|css|scss|js|ts|jsx|tsx|html|json)/g) || [];
}

function uncoveredPlan(state) {
    return (state.plan || []).filter((item) => {
        if (item.status === 'completed') return false;
        if (state.isFillerPlan?.(item) || state.isRunPlan?.(item)) return false;
        if (state.isReadOnlyPlan?.(item)) return false;
        const files = planFiles(item);
        if (!files.length) return false;
        return !files.some((file) => (state.filesChanged || []).some((rel) => (
            rel === file || rel.endsWith(`/${file}`) || rel.endsWith(file)
        )));
    });
}

function packageEditAllowed(task, action) {
    if (/package\.json|dependenc|devDependenc|npm install|\bnpm i\b|thêm thư viện|cài package/i.test(task)) {
        return true;
    }
    const old = String(action.old || '');
    const neu = String(action.new || action.content || '');
    const stripMeta = (text) => String(text).replace(
        /"(name|description|author|homepage|version|productName)"\s*:\s*("[^"]*"|[^,}\n]+)/g,
        '',
    );
    if (old && stripMeta(old) !== stripMeta(neu)) {
        return /"(dependencies|devDependencies|scripts|main|exports|bin)"/.test(neu);
    }
    return false;
}

function skipWriteReason(task, action) {
    const rel = String(action.path || '');
    if (!rel) return '';
    if (/(^|\/)README(\.\w+)?$/i.test(rel) && !/readme|docs|hướng dẫn|tài liệu|changelog/i.test(task)) {
        return `SKIP ${rel}: task không yêu cầu sửa tài liệu. Không dùng README để đánh dấu xong.`;
    }
    if (/(^|\/)LICENSE$/i.test(rel) && !/license/i.test(task)) {
        return `SKIP ${rel}: task không yêu cầu sửa license.`;
    }
    if (/(^|\/)package\.json$/i.test(rel) && !packageEditAllowed(task, action)) {
        return 'SKIP package.json: không sửa name/description/author/homepage để đánh dấu xong.';
    }
    return '';
}

function relatedSurfaces(state) {
    return (state.relevantFiles || []).filter((rel) => /\.(vue|jsx|tsx|js|ts|html)$/i.test(rel));
}

function behaviorLeft(state, task) {
    if (!wantsControl(task)) return false;
    if (state.behaviorFail) return true;
    const changed = state.filesChanged || [];
    if (!changed.length) return true;
    if (changed.every((rel) => /\.(css|scss|less|html)$/i.test(rel))) return true;
    const related = relatedSurfaces(state);
    const bridge = related.filter((rel) => /preload\.(js|ts)$|(^|\/)(main|index)\.(js|ts)$|ipc/i.test(rel));
    if (bridge.length && /electron|devtools|dev tools|ipc/i.test(task)) {
        const touched = changed.some((rel) => (
            bridge.includes(rel) || /preload\.(js|ts)$|(^|\/)(main|index)\.(js|ts)$/i.test(rel)
        ));
        if (!touched) return true;
    }
    return false;
}

function wiringLeft(state, task) {
    if (!wantsFileWork(task)) return false;
    if (state.wiringFail || state.behaviorFail) return true;
    if (behaviorLeft(state, task)) return true;
    const related = relatedSurfaces(state);
    if (related.length < 2) return false;
    const changed = state.filesChanged || [];
    const read = state.filesRead || [];
    if (!changed.length) return true;
    const seen = related.filter((rel) => read.includes(rel) || changed.includes(rel));
    if (seen.length < Math.min(2, related.length)) return true;
    const touchedExisting = changed.some((rel) => related.includes(rel));
    if (!touchedExisting) return true;
    return false;
}

function taskSatisfied(state, task) {
    if ((state.truncated || []).length) return false;
    if ((state.currentErrors || []).length || state.batchFailed) return false;
    if (wantsVerify(task) && !wantsFileWork(task)) return hasRun(state);
    if (wantsFileWork(task) && !(state.filesChanged || []).length) return false;
    if (wiringLeft(state, task) || behaviorLeft(state, task)) return false;
    if ((state.requirements || []).length && state.reqIndex < state.requirements.length) return false;
    if (isBroadChange(task) && (state.filesChanged || []).length <= 1) return false;
    return true;
}

function extractLineRange(text, path) {
    const src = String(text || '');
    const base = String(path || '').split('/').pop();
    if (!base) return null;
    const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const near = new RegExp(
        `(?:${escaped}[^\\n]{0,80})?lines?\\s+(\\d+)\\s*(?:to|-|–)\\s*(\\d+)|lines?\\s+(\\d+)\\s*(?:to|-|–)\\s*(\\d+)[^\\n]{0,80}${escaped}`,
        'i',
    );
    const match = src.match(near);
    if (!match) return null;
    const start = Number(match[1] || match[3]);
    const end = Number(match[2] || match[4]);
    if (!start || !end || end < start) return null;
    return { start, end };
}

function attachReadRanges(actions, parsed) {
    const blob = `${parsed?.analysis || ''}\n${(parsed?.plan || []).join('\n')}`;
    return (actions || []).map((action) => {
        if (action.type !== 'read_file' || action.start || action.end) return action;
        const range = extractLineRange(blob, action.path);
        return range ? { ...action, ...range } : action;
    });
}

function dropDuplicateReads(actions, state) {
    const kept = [];
    const skipped = [];
    const seen = new Set();
    for (const action of actions || []) {
        if (action.type !== 'read_file' || !action.path) {
            kept.push(action);
            continue;
        }
        const already = seen.has(action.path) || (state.filesRead || []).includes(action.path);
        if (already) {
            skipped.push(action.path);
            continue;
        }
        seen.add(action.path);
        kept.push(action);
    }
    return { actions: kept, skipped: [...new Set(skipped)] };
}

function workLeft(state, task) {
    if ((state.truncated || []).length) return true;
    if ((state.currentErrors || []).length || state.batchFailed) return true;
    if ((state.requirements || []).length && state.reqIndex < state.requirements.length) return true;
    if (wantsVerify(task) && !wantsFileWork(task)) return !hasRun(state);
    if (wantsFileWork(task) && !(state.filesChanged || []).length) return true;
    if (wiringLeft(state, task)) return true;
    if (isBroadChange(task) && (state.filesChanged || []).length <= 1) return true;
    if (isBroadChange(task) && (state.uiCount || 0) >= 4 && (state.filesChanged || []).length < 3) return true;
    const progress = kindProgress(state);
    if (!progress.ok && progress.reason === 'implement') return true;
    return false;
}

function looksModelDone(parsed) {
    if (parsed?.done || parsed?.claimedDone) return true;
    return /done\s*=\s*true|all (tasks|actions|compilation|project).{0,60}(complete|verified)|fully complete|no further (actions?|changes)|returning (final json|empty actions)|đã hoàn tất|không còn gì|successfully completed and verified/i
        .test(String(parsed?.analysis || ''));
}

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
    const stamp = hits[hits.length - 1].stamp;
    const start = hits.find((item) => item.stamp.toLowerCase() === stamp.toLowerCase())?.at ?? hits[hits.length - 1].at;
    return { stamp, slice: text.slice(start) };
}

function sliceLooksFailed(slice) {
    return /internal server error|failed to compile|failed to (resolve|load)|cannot find module|module not found|syntaxerror|typeerror|referenceerror|uncaught|traceback \(most recent|plugin:\s*vite:vue|error when starting|tags with side effect|unexpected token/i
        .test(slice);
}

function sliceLooksHealthy(slice) {
    return /hmr update|page reload|\[vite\].*connected|ready in\b|compiled successfully|dev server running|listening on|✓ built|watching for file changes|0 error/i
        .test(slice);
}

function terminalProblems(text) {
    const clean = String(text || '').replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').trim();
    if (!clean) return { empty: true, ok: true, text: '', stamp: '' };
    const tail = clean.slice(-8000);
    const { stamp, slice } = lastTimeSlice(tail);
    if (stamp) {
        const failed = sliceLooksFailed(slice);
        const healthy = sliceLooksHealthy(slice);
        return {
            empty: false,
            ok: healthy && !failed,
            stamp,
            text: slice.slice(0, 2500),
        };
    }
    const errAt = Math.max(
        lastIndexOfRe(tail, /internal server error/i),
        lastIndexOfRe(tail, /failed to (compile|resolve|load)/i),
        lastIndexOfRe(tail, /cannot find module|module not found/i),
        lastIndexOfRe(tail, /syntaxerror|typeerror|referenceerror/i),
        lastIndexOfRe(tail, /traceback \(most recent/i),
        lastIndexOfRe(tail, /tags with side effect/i),
    );
    const okAt = Math.max(
        lastIndexOfRe(tail, /compiled successfully/i),
        lastIndexOfRe(tail, /ready in\b/i),
        lastIndexOfRe(tail, /listening on/i),
        lastIndexOfRe(tail, /dev server running/i),
        lastIndexOfRe(tail, /✓ built/i),
        lastIndexOfRe(tail, /hmr update/i),
        lastIndexOfRe(tail, /0 error/i),
    );
    return { empty: false, ok: errAt < 0 || errAt < okAt, stamp: '', text: tail };
}

function inferSimple(message) {
    const text = String(message || '').trim();
    const actions = [];
    const dir = text.match(/thư\s*mục\s+([A-Za-z0-9._-]+)/i)
        || text.match(/(?:folder|mkdir)\s+([A-Za-z0-9._/-]+)/i);
    const file = text.match(/file\s+([A-Za-z0-9._-]+\.[A-Za-z0-9]+)/i);
    const content = text.match(/nội\s*dung\s+([\s\S]+)$/i)
        || text.match(/content\s*[:=]\s*([\s\S]+)$/i);
    if (dir) actions.push({ type: 'mkdir', path: dir[1] });
    if (file) {
        actions.push({
            type: 'create_file',
            path: dir ? `${dir[1]}/${file[1]}` : file[1],
            content: content ? content[1].trim() : '',
        });
    }
    return actions;
}

function planTooThin(state, task) {
    if (!wantsFileWork(task)) return false;
    if (state.projectBrief && state.plan.length >= 3) return false;
    return state.plan.length < 3;
}

function hasDiscovery(state) {
    return (state.toolLog || []).some((item) => /search_code|list_files|read_file/.test(item.type));
}

function discoveryCount(state) {
    return (state.toolLog || []).filter((item) => /search_code|list_files|read_file|git_status/.test(item.type)).length;
}

function surveyEnough(state, task) {
    const n = discoveryCount(state);
    if (isBroadChange(task) || (state.uiCount || 0) >= 8) return n >= 8;
    if (wantsFileWork(task)) return n >= 5;
    return n >= 3;
}

function formatToolResults(results, limit = 7000) {
    const blocks = (results || []).map((item) => {
        const head = `${item.type}${item.path ? ` ${item.path}` : ''}${item.command ? ` ${item.command}` : ''}`;
        const body = item.error || item.result || '';
        return `### ${head}\n${body}`;
    }).join('\n\n');
    if (blocks.length <= limit) return blocks || '(no tool output)';
    return `${blocks.slice(0, limit)}\n... (truncated)`;
}

function parseListedPaths(results) {
    const paths = [];
    for (const item of results || []) {
        for (const line of String(item.result || '').split('\n')) {
            const match = line.match(/^(?:file|dir)\s+(\S+)/);
            if (match && !paths.includes(match[1])) paths.push(match[1]);
        }
    }
    return paths;
}

const PRIORITY_FILES = [
    'package.json', 'index.html', 'pyproject.toml', 'requirements.txt',
    'src/App.vue', 'src/App.jsx', 'src/App.tsx', 'src/main.js', 'src/main.ts',
    'src/main.py', 'src/index.css', 'src/style.css', 'src/App.css',
    'src/router/index.js', 'src/router/index.ts',
    'vite.config.js', 'vite.config.ts', 'app.py', 'main.py',
];

const PRIORITY_DIRS = [
    'src/components', 'src/views', 'src/pages', 'src/layouts',
    'src/locales', 'src/i18n', 'src/router', 'src/store', 'public',
];

function buildSurveyReads(listed, task, relevant, uiSurfaces) {
    const have = new Set(listed || []);
    const resolve = (want) => {
        if (have.has(want)) return want;
        return [...have].find((name) => name === want || name.endsWith(`/${want}`)) || '';
    };
    const actions = [];
    const seen = new Set();
    const add = (action) => {
        const key = `${action.type}:${action.query || action.path || ''}`;
        if (seen.has(key)) return;
        seen.add(key);
        actions.push(action);
    };
    for (const dir of PRIORITY_DIRS) {
        const path = resolve(dir);
        if (path) add({ type: 'list_files', path });
    }
    for (const file of PRIORITY_FILES) {
        if (/^README/i.test(file) && !/readme|docs|hướng dẫn|tài liệu/i.test(task)) continue;
        const path = resolve(file);
        if (path) add({ type: 'read_file', path });
    }
    const surfaceLimit = isBroadChange(task) ? 8 : 3;
    for (const path of (uiSurfaces || []).slice(0, surfaceLimit)) {
        if (/\.(vue|html|css|js|ts|json)$/i.test(path)) add({ type: 'read_file', path });
    }
    for (const path of (relevant || []).slice(0, 5)) {
        if (/\.(vue|js|ts|css|html|json)$/i.test(path)) add({ type: 'read_file', path });
    }
    const needles = String(task || '')
        .split(/[^A-Za-z0-9À-ỹ_-]+/)
        .map((word) => word.trim())
        .filter((word) => word.length >= 5 && !STOP_NEEDLE.has(word.toLowerCase()))
        .slice(0, 4);
    for (const query of needles) add({ type: 'search_code', query });
    if (isBroadChange(task)) {
        add({ type: 'search_code', query: 'title' });
        add({ type: 'search_code', query: 'router' });
    }
    return actions.slice(0, 16);
}

function previewLines(action) {
    if (!action) return [];
    if (Array.isArray(action.patches) && action.patches.length) {
        return action.patches.flatMap((item) => toDiffLines(item.old, item.new));
    }
    const added = action.content != null ? action.content : action.new;
    if (action.type === 'create_file' && added != null) return fileAddedLines(added);
    if (action.type === 'edit_file') return toDiffLines(action.old, action.new);
    if (action.type === 'delete_file' && action.old != null) {
        return toDiffLines(action.old, '');
    }
    return [];
}

class AgentOrchestrator {
    constructor({ workspaceService, gemini, terminalService, onProgress, indexer, retriever, siteIndex }) {
        this.workspace = workspaceService;
        this.context = new ProjectContext(workspaceService);
        this.gemini = gemini;
        this.llmName = 'Gemini';
        this.terminalService = terminalService;
        this.onProgress = onProgress;
        this.indexer = indexer || null;
        this.retriever = retriever || null;
        this.siteIndex = siteIndex || null;
        this.aborted = false;
    }

    abort() {
        this.aborted = true;
        this.gemini?.cancel?.();
    }

    throwIfAborted() {
        if (!this.aborted) return;
        const error = new Error('Đã dừng');
        error.aborted = true;
        throw error;
    }

    emit(type, message, extra = {}) {
        this.onProgress?.({ type, message, ...extra });
    }

    pump() {
        return new Promise((resolve) => setImmediate(resolve));
    }

    emitWorking(action, message = '') {
        this.emit('working', message, {
            tool: action?.type || action?.tool || 'think',
            path: action?.path || '',
            command: action?.command || '',
            query: action?.query || '',
        });
        return this.pump();
    }

    emitPlan(state) {
        if (state.requirements?.length) {
            this.emit('plan', '', {
                plan: state.requirements.map((item, idx) => ({
                    task: item.text,
                    kind: item.kind || 'feature',
                    kindLabel: kindMeta(item.kind).label,
                    status: idx < state.reqIndex
                        ? 'completed'
                        : idx === state.reqIndex
                            ? 'in_progress'
                            : 'pending',
                })),
            });
            return;
        }
        if (!state.plan?.length) return;
        this.emit('plan', '', {
            plan: state.plan.map((item) => ({ task: item.task, status: item.status || 'pending' })),
        });
    }

    rememberWork(state, parsed, task) {
        const fromActions = (parsed.actions || [])
            .filter((item) => item.path && /create_file|mkdir/.test(item.type))
            .map((item) => item.path);
        state.rememberMentioned(fromActions);
        if (parsed.plan?.length) state.mergePlan(parsed.plan);
    }

    filterActions(actions, phase) {
        const list = actions || [];
        if (phase === 'plan') return list.filter((item) => READ_TOOLS.has(item.type));
        return list;
    }

    injectVerify(tools, state, task, parsed) {
        if (parsed.actions.length || hasRun(state)) return parsed;
        if (!wantsVerify(task)) return parsed;
        if (wantsFileWork(task) && !state.filesChanged.length) return parsed;
        if (wantsFileWork(task) && !state.proofed) return parsed;
        const suggested = tools.suggestVerifyAction(task, state.filesChanged);
        if (!suggested) return parsed;
        this.emit('step', `Tự chạy terminal: ${suggested.command}`);
        return { ...parsed, actions: [suggested], done: false, claimedDone: false };
    }

    buildNextRequirementPrompt(state, task) {
        const current = state.currentRequirement();
        const n = state.requirements.length;
        const idx = state.reqIndex + 1;
        const meta = kindMeta(current?.kind);
        return `${PROTOCOL}

${state.projectBrief || ''}

FULL TASK (do every requirement, in order):
${task}

${formatRequirements(state.requirements, state.reqIndex)}

${formatKindBlock(state)}

Requirement ${idx}/${n} is a ${meta.labelEn} (${meta.label}). Follow the playbook above. Start with survey/diagnose — do not edit yet if PHASE NOW is survey or diagnose.
done=false until ${n}/${n} is [done].
${TURN}`;
    }

    buildKindPlaybookPrompt(state, task, progress) {
        return `${PROTOCOL}

TASK:
${task}

${formatKindBlock(state)}

You skipped the playbook. PHASE is ${progress?.phase || 'survey'}.
${progress?.hint || 'Survey/diagnose first.'}
${progress?.reason === 'survey' || progress?.reason === 'diagnose'
        ? 'Emit read_file / search_code / retrieve on RELATION TREE files now. Do not emit edit_file yet.'
        : 'Emit the edit_file that follows the playbook on the files you already read.'}
done=false.
${TURN}`;
    }

    applyRetrieved(state, retrieved) {
        state.relevantFiles = retrieved?.files || [];
        state.uiCount = retrieved?.files?.length || 0;
        state.projectBrief = retrieved?.digest || '';
        state.relationTree = retrieved?.tree || '';
        if (retrieved?.tree) {
            this.emit('step', `Cây liên hệ:\n${String(retrieved.tree).slice(0, 800)}`);
        }
    }

    shouldAdvanceRequirement(state, parsed, task, empty) {
        if (!state.requirements?.length) return false;
        if (state.reqIndex >= state.requirements.length) return false;
        if (state.wiringFail || state.behaviorFail) return false;
        if ((state.currentErrors || []).length || state.batchFailed) return false;
        const req = state.currentRequirement();
        if (req?.kind === 'run' && !hasRun(state)) return false;
        const progress = kindProgress(state);
        const modelDone = looksModelDone(parsed);
        if (!progress.ok && (progress.reason === 'survey' || progress.reason === 'diagnose')) return false;
        if (!progress.ok && (progress.reason === 'implement' || progress.reason === 'fix')) {
            if (!(modelDone && empty >= 2)) return false;
        }
        const progressed = (state.filesChanged || []).length > state.reqMark;
        const runOnly = req?.kind === 'run' || (wantsVerify(task) && !wantsFileWork(task) && hasRun(state));
        if (progress.ok && (modelDone || empty >= 1)) return true;
        if (progressed && (modelDone || empty >= 1)) return true;
        if (runOnly && (modelDone || empty >= 1 || hasRun(state))) return true;
        if (modelDone && empty >= 2 && state.requirements.length > 1 && progress.ok) return true;
        return false;
    }

    refreshRetrieved(state, query, openFile) {
        if (!this.retriever) return;
        const retrieved = this.retriever.retrieve(query, {
            openFile,
            k: 10,
            extra: [state.surveyDigest],
        });
        this.applyRetrieved(state, retrieved);
    }

    remainingPlanText(state) {
        if (state.requirements?.length) {
            return formatRequirements(state.requirements, state.reqIndex);
        }
        const pending = state.pendingPlan().filter((item) => (
            !state.isFillerPlan?.(item) && !state.isRunPlan?.(item) && !state.isReadOnlyPlan?.(item)
        ));
        if (!pending.length) return '';
        return pending.map((item, idx) => `${idx + 1}. ${item.task}`).join('\n');
    }

    appendSurvey(state, results) {
        const chunk = formatToolResults(results, 5000);
        state.surveyDigest = `${state.surveyDigest || ''}\n${chunk}`.trim().slice(-14000);
    }

    async bootstrapSurvey(tools, state, task, relevant, uiSurfaces) {
        const runOnly = wantsVerify(task) && !wantsFileWork(task);
        await this.emitWorking({ type: 'list_files' }, runOnly
            ? 'Đang xem cách chạy dự án...'
            : 'Đang đọc dự án để nắm hiện trạng...');
        this.emit('status', runOnly ? 'Đang xem cách chạy dự án...' : 'Đang đọc dự án để nắm hiện trạng...');
        state.markPhase('survey');
        const first = [
            { type: 'list_files', path: '' },
            ...(runOnly ? [] : [{ type: 'list_files', path: 'src' }]),
            { type: 'git_status' },
        ];
        const listed = await this.executeActions(tools, first, state, { quiet: true });
        this.appendSurvey(state, listed.results);
        const more = runOnly
            ? buildSurveyReads(parseListedPaths(listed.results), task, [], [])
                .filter((item) => item.type === 'read_file' && /package\.json$/i.test(item.path))
                .slice(0, 1)
            : buildSurveyReads(parseListedPaths(listed.results), task, relevant, uiSurfaces);
        if (more.length) {
            await this.emitWorking({ type: 'read_file' }, `Đang đọc ${more.length} file then chốt...`);
            this.emit('status', `Đang đọc ${more.length} file then chốt...`);
            const extra = await this.executeActions(tools, more, state, { quiet: true });
            this.appendSurvey(state, extra.results);
        }
        const map = await this.context.buildMap(tools.root, [
            ...parseListedPaths(listed.results),
            ...relevant,
            ...uiSurfaces,
        ]);
        state.projectBrief = map.text;
        state.surveyDigest = `${map.text}\n\n${state.surveyDigest || ''}`.slice(-16000);
        this.emit('status', `Đã hiểu dự án: ${(map.pages || []).length} pages, ${(map.components || []).length} components`);
    }

    buildSurveyPrompt({ task, scan, relevant, openFile, uiSurfaces, findings }) {
        const open = openFile?.path
            ? `\nFocused file: ${openFile.path}${openFile.lines ? ` (${openFile.lines} lines)` : ''}.`
            : '';
        const ui = (uiSurfaces || []).length
            ? `\nUI surfaces:\n${uiSurfaces.slice(0, 36).join('\n')}`
            : '';
        return `${PROTOCOL}

TASK:
${task}

Project: ${scan.name}
File tree (vendor skipped):
${scan.tree.join('\n') || '(empty)'}

PROJECT MAP + file briefs (whole files already read):
${findings || '(none)'}

Likely relevant:
${relevant.join('\n') || '(none yet)'}
${ui}
${open}

SURVEY FIRST. Do not write the final plan yet.
In analysis explain the wiring (entry → layout → router → pages → shared components) then what THIS task still needs.
Only request unread files.
${TURN}`;
    }

    buildSurveyFollowUp(state, results) {
        return `${PROTOCOL}

More survey results:
${formatToolResults(results)}

TASK:
${state.task}

If a key file is still missing from the map, read it now.
If you already understand the wiring vs the task, return actions=[] — the plan comes next.
${TURN}`;
    }

    buildPlanFromSurveyPrompt(state, task) {
        return `${PROTOCOL}

TASK:
${task}

PROJECT MAP:
${state.projectBrief || state.surveyDigest || '(see prior tool results)'}

Your last analysis:
${state.lastAnalysis || '(none)'}

Write a CONNECTED plan from this map:
- Start analysis with the wiring, then the gap for THIS task
- Steps must follow imports/routes (parent then child), not a scattered file list
${TURN}`;
    }

    buildContinuePlanPrompt(state, task, memory) {
        const history = (memory?.turns || []).slice(-8)
            .map((item) => `${item.role}: ${String(item.text || '').slice(0, 400)}`)
            .join('\n');
        const changed = (memory?.filesChanged || []).slice(-20).join(', ') || '(none)';
        return `${PROTOCOL}

This is a FOLLOW-UP in the SAME chat session.
You already have the PROJECT MAP. Do NOT re-survey.
Only read_file if THIS task needs a file not in the map.

PROJECT MAP:
${state.projectBrief || state.surveyDigest || '(from earlier in this session)'}

Files already changed earlier in this session:
${changed}

Recent turns:
${history || '(none)'}

NEW TASK:
${task}

Write a CONNECTED plan for THIS task from the map (parent → child).
${TURN}`;
    }

    sessionMemory(state, root, prev) {
        return {
            root,
            surveyed: Boolean(state.surveyDigest || prev?.surveyDigest),
            surveyDigest: state.surveyDigest || prev?.surveyDigest || '',
            projectBrief: state.projectBrief || prev?.projectBrief || '',
            lastAnalysis: state.lastAnalysis || prev?.lastAnalysis || '',
            filesChanged: [...new Set([...(prev?.filesChanged || []), ...state.filesChanged])].slice(-40),
            relevantFiles: state.relevantFiles?.length ? state.relevantFiles : (prev?.relevantFiles || []),
            uiCount: state.uiCount || prev?.uiCount || 0,
        };
    }

    buildPlanExpandPrompt(state, task) {
        const have = state.plan.length
            ? state.plan.map((item, idx) => `${idx + 1}. ${item.task}`).join('\n')
            : '(empty — too thin)';
        return `${PROTOCOL}

TASK:
${task}

Current plan is TOO THIN:
${have}

Cover leftover files that THIS task still needs. Do not add README/package.json finalize steps.
Also emit more search_code / list_files / read_file now if a step is still ungrounded. done=false.
${TURN}`;
    }

    buildRefusalNudge(task) {
        return `${PROTOCOL}

NowK ALREADY has mkdir, create_file, edit_file, delete_file, run_command, run_start.
Your last reply was wrong: you refused because you thought tools were missing. They are not missing.
Do not explain. Do not say giả lập. Emit the next JSON actions for this TASK now.

TASK:
${task}

${TURN}`;
    }

    buildExecutePrompt(state, task) {
        const plan = state.plan.length
            ? state.plan.map((item, idx) => `${idx + 1}. [${item.status}] ${item.task}`).join('\n')
            : '(no numbered plan — infer steps from the task)';
        return `${PROTOCOL}

PLAN is approved. Write/run tools are ON. Emit JSON. NowK executes it for real.

TASK:
${task}

Keep this wiring while editing:
${String(state.projectBrief || '').slice(0, 2500) || '(see earlier map)'}

PLAN (execute along the chain, parent then child):
${plan}

Emit the edit_file / create_file this TASK still needs in this JSON. Do not touch unrelated files.
${TURN}`;
    }

    buildNudge(task, parsed, state) {
        const mentioned = (parsed.mentioned || []).filter((p) => !state.filesChanged.includes(p));
        const leftover = this.remainingPlanText(state);
        const hint = leftover
            ? `Pending plan steps — do them now (several actions in one JSON):\n${leftover}`
            : (mentioned.length
                ? `Files still needed: ${mentioned.join(', ')}.`
                : 'Continue remaining edits. Batch multiple edit_file in one JSON.');
        return `${PROTOCOL}

Continue TASK:
${task}

${hint}
JSON only. Copy old from disk. If the request is already done, actions=[] done=true. Do not edit unrelated files.`;
    }

    ingest(state, raw) {
        const parsed = parseResponse(raw);
        parsed.refusal = looksLikeRefusal(raw) || looksLikeRefusal(parsed.analysis);
        if (parsed.refusal) {
            parsed.done = false;
            parsed.claimedDone = false;
            this.emit('step', 'Model tưởng chưa có tool — nhắc NowK sẽ chạy JSON thật');
        } else if (parsed.analysis && parsed.analysis !== state.lastAnalysis) {
            state.lastAnalysis = parsed.analysis;
            if (parsed.actions?.some((item) => WRITE_TOOLS.has(item.type))) {
                this.emit('step', parsed.analysis.slice(0, 180));
            }
        }
        this.rememberWork(state, parsed, state.task);
        this.emitPlan(state);
        return parsed;
    }

    isComplete(parsed, state, task) {
        if (parsed.refusal) return false;
        if (state.currentPhase === 'survey' || state.currentPhase === 'index') return false;
        if (state.currentPhase === 'plan' && !looksModelDone(parsed)) return false;
        if (parsed.actions.length) return false;
        if (state.awaitingFollowUp) return false;
        if (workLeft(state, task)) return false;
        if (looksModelDone(parsed)) return true;
        if (!parsed.actions.length && !workLeft(state, task)) return true;
        if (wantsFileWork(task) && !state.filesChanged.length) return false;
        if (wantsVerify(task) && !hasRun(state)) return false;
        if (isBroadChange(task) && (state.uiCount || 0) >= 3 && state.filesChanged.length < 2) return false;
        return false;
    }

    buildTerminalFixPrompt(state, task, log) {
        return `${PROTOCOL}

Edits for this task are claimed done. NowK just read the IDE terminal.

TERMINAL:
${log || '(empty)'}

TASK:
${task}

If the log has real compile/runtime errors, emit edit_file / create_file to fix them now. done=false.
If it is only warnings or the app compiled/ready, return {"analysis":"Terminal sạch.","actions":[],"done":true}.
Do not repeat "already complete" without addressing an error that is still in the log.
${TURN}`;
    }

    buildKeepWorkingPrompt(state, task) {
        const leftover = uncoveredPlan(state).map((item, idx) => `${idx + 1}. ${item.task}`).join('\n');
        const changed = (state.filesChanged || []).join(', ') || '(none)';
        const current = state.currentRequirement();
        const reqHint = state.requirements.length && current
            ? `\n${formatKindBlock(state)}\nYou are on requirement ${state.reqIndex + 1}/${state.requirements.length} [${kindMeta(current.kind).label}]: ${current.text}\n`
            : '';
        return `${PROTOCOL}

TASK:
${task}
${reqHint}
You only changed: ${changed}
That is not enough. These plan steps still have untouched files:
${leftover || this.remainingPlanText(state) || '(more views/components still old)'}

Emit the remaining edit_file / create_file NOW for THIS task only.
Do not rewrite the plan. Do not edit package.json/README to mark done. done=false.
Do not emit read_file for files already in context.
${TURN}`;
    }

    buildFixErrorsPrompt(state, task) {
        const errors = (state.currentErrors || []).slice(-6).map((item, idx) => `${idx + 1}. ${item}`).join('\n');
        return `${PROTOCOL}

TASK:
${task}

${formatKindBlock(state)}

A tool just FAILED. Do not mark the requirement done. Do not stop.

ERRORS:
${errors || '(see last tool result)'}

Fix the error: if the file is missing, emit create_file with FULL content. If old did not match, read_file then edit_file with exact old.
Then continue remaining files on RELATION TREE. done=false.
${TURN}`;
    }

    async afterEditsCheck(tools, state, task, send, parsed) {
        if (workLeft(state, task)) {
            this.emit('status', 'Còn file trong kế hoạch — tiếp tục sửa...');
            const raw = await send(this.buildKeepWorkingPrompt(state, task));
            const next = this.ingest(state, raw);
            next.done = false;
            next.claimedDone = false;
            return next;
        }
        if (state.terminalChecks >= 2) return { ...parsed, actions: [], done: true, claimedDone: true };
        state.terminalChecks += 1;
        this.emit('status', 'Đang đọc Terminal để bắt lỗi...');

        let log = this.terminalService?.recentLog?.(8000) || '';
        let report = terminalProblems(log);

        if (report.empty && state.filesChanged.length) {
            const check = tools.suggestCheckCommand(state.filesChanged, { allowFallback: true })
                || tools.suggestStartCommand();
            if (check) {
                const type = /dev|start|serve|preview|watch/i.test(check) ? 'run_start' : 'run_command';
                this.emit('step', `Chạy kiểm tra terminal: ${check}`);
                const result = await tools.run({ type, command: check });
                state.recordTool(result.type, check);
                log = result.result || this.terminalService?.recentLog?.(8000) || '';
                report = terminalProblems(log);
            }
        }

        if (report.ok) {
            this.emit('step', report.stamp
                ? `Terminal mốc cuối ${report.stamp} không lỗi — dừng.`
                : 'Terminal không báo lỗi — dừng.');
            return { ...parsed, actions: [], done: true, claimedDone: true };
        }

        this.emit('status', report.stamp
            ? `Terminal mốc cuối ${report.stamp} có lỗi — sửa ngay...`
            : 'Terminal có lỗi — sửa ngay...');
        const raw = await send(this.buildTerminalFixPrompt(state, task, report.text));
        const next = this.ingest(state, raw);
        next.refusal = false;
        if (looksModelDone(next) && !next.actions.length) {
            return { ...next, actions: [], done: true, claimedDone: true };
        }
        return next;
    }

    markFinished(state, task) {
        if (!workLeft(state, task) && state.pendingPlan().length) {
            state.finishPlan();
            this.emitPlan(state);
        }
        this.emit('status', 'Hoàn tất.');
    }

    buildFollowUp(state, results, compressed) {
        const blocks = results.map((item) => {
            const head = `${item.type}${item.path ? ` ${item.path}` : ''}${item.command ? ` ${item.command}` : ''}`;
            const body = item.error || item.result || '';
            return `### ${head}\n${body}`;
        }).join('\n\n');

        const prefix = compressed
            ? `${compressState(state)}\n\nThis is a compressed recap. Continue the same task.\n\n`
            : '';

        const missing = state.missingFiles();
        const failedRuns = results.filter((item) => RUN_TOOLS.has(item.type) && !item.ok);
        const leftover = this.remainingPlanText(state);
        let extra = leftover
            ? `\nStill missing for THIS task. Edit only these:\n${leftover}\ndone=false.`
            : '\nIf THIS user request is done, return actions=[] done=true. Do not patch extra files or package.json/README.';
        if (missing.length) {
            extra = `\nNOT FINISHED. For new files use create_file. For existing files use edit_file old/new:\n${missing.join('\n')}\ndone=false.`;
        } else if (failedRuns.length) {
            extra = '\nCOMMAND FAILED. Read the terminal output, fix files, then run_command / run_test / run_start again. done=false.';
        } else if (wantsVerify(state.task) && !hasRun(state)) {
            extra = '\nYou have not used the IDE terminal yet. Emit run_command, run_test, or run_start now to verify or launch. done=false.';
        }

        return `${prefix}${PROTOCOL}

TOOL RESULTS (iteration ${state.iteration}):
${blocks || '(no tool output)'}
${extra}
${TURN}`;
    }

    async executeActions(tools, actions, state, { quiet = false } = {}) {
        const results = [];
        const applied = [];
        const readPaths = [];
        for (const action of actions) {
            this.throwIfAborted();
            await this.emitWorking(action);
            await this.pump();
            const skip = /create_file|edit_file|delete_file/.test(action.type)
                ? skipWriteReason(state.task, action)
                : '';
            if (skip) {
                results.push({
                    ok: false,
                    type: action.type,
                    path: action.path,
                    changed: false,
                    error: skip,
                    result: skip,
                });
                state.recordTool(action.type, action.path || '');
                this.emit('tool', action.path || action.type, {
                    tool: action.type,
                    path: action.path || '',
                    ok: false,
                    error: skip,
                    lines: [],
                });
                this.emit('audit', skip, { ok: false, path: action.path || '', tool: action.type });
                continue;
            }
            let result = await tools.run(action);
            if (!result.ok && action.type === 'edit_file' && /Không tìm thấy file/i.test(String(result.error || ''))) {
                const content = action.content != null ? action.content : action.new;
                if (content != null && String(content).trim()) {
                    this.emit('step', `File chưa có — tạo ${action.path}`);
                    result = await tools.run({
                        type: 'create_file',
                        path: action.path,
                        content: String(content),
                    });
                }
            }
            if (!result.ok && action.type === 'edit_file' && /old không khớp/i.test(String(result.error || ''))) {
                try {
                    const snap = await tools.run({ type: 'read_file', path: action.path });
                    if (snap?.ok && snap.result) {
                        result = {
                            ...result,
                            error: `${result.error}\n\n--- read_file ${action.path} (copy old từ đây) ---\n${String(snap.result).slice(0, 3500)}`,
                        };
                    }
                } catch { /* keep original error */ }
            }
            if (result.ok && /create_file|edit_file|mkdir|delete_file/.test(result.type || action.type)) {
                const audit = await auditAction(this.workspace, tools.root, action, result);
                if (!audit.ok) {
                    result = { ...result, ok: false, changed: false, error: audit.error };
                    this.emit('audit', audit.error, {
                        ok: false,
                        path: action.path || '',
                        tool: action.type,
                    });
                } else {
                    if (audit.note) {
                        result = { ...result, result: `${result.result || ''}\n${audit.note}` };
                    }
                    this.emit('audit', audit.note || `AUDIT PASS: ${action.type} ${action.path || ''}`, {
                        ok: true,
                        path: action.path || '',
                        tool: action.type,
                    });
                }
            }
            results.push(result);
            const wrote = Boolean(result.ok && result.changed && /create_file|edit_file|mkdir|delete_file/.test(result.type || action.type));
            this.emit('tool', action.path || action.command || action.query || action.type, {
                tool: action.type,
                path: result.path || action.path || '',
                command: action.command || '',
                query: action.query || '',
                start: action.start || action.from || '',
                end: action.end || action.to || '',
                ok: result.ok !== false,
                error: result.ok ? '' : (result.error || ''),
                old: wrote && action.old != null ? String(action.old).slice(0, 8000) : '',
                new: wrote ? String(action.new ?? action.content ?? '').slice(0, 8000) : '',
                lines: wrote ? (result.diff || previewLines(action)) : [],
            });
            if (wrote && result.diff?.length) {
                this.emit('diff', result.path, {
                    path: result.path,
                    lines: result.diff,
                    old: action.old != null ? String(action.old).slice(0, 8000) : '',
                    new: action.new != null ? String(action.new).slice(0, 8000) : '',
                });
            }
            state.recordTool(action.type, action.path || action.command || action.query || '');
            if (result.ok && action.type === 'read_file' && action.path && !quiet) {
                readPaths.push(action.path);
            }
            if (!result.ok) state.recordError(result.error || `${action.type} failed`);
            if (result.ok && RUN_TOOLS.has(action.type)) {
                state.markRunProgress();
                this.emitPlan(state);
            }
            if (result.changed && result.path) {
                state.recordChange(result.path);
                try { await this.indexer?.updateFile(tools.root, result.path); } catch { /* ignore */ }
                if (action.type === 'create_file' && looksTruncated(action.content, action.path)) {
                    state.markTruncated(action.path);
                    this.emit('step', `File mới bị cắt: ${action.path} — gửi lại create_file đủ`);
                }
                applied.push({
                    action: action.type === 'mkdir' ? 'mkdir' : action.type === 'delete_file' ? 'delete' : 'write',
                    path: result.path,
                });
            }
        }
        if (applied.length) {
            state.markPlanProgress(applied.map((item) => item.path));
            this.emitPlan(state);
        }
        if (readPaths.length) {
            state.markReadProgress(readPaths);
            this.emitPlan(state);
        }
        if (results.some((item) => /search_code|list_files|read_file/.test(item.type))) {
            state.markDiscoverDone();
            this.emitPlan(state);
        }
        if (applied.length) {
            const report = await verifyChanges(this.workspace, tools.root, state.task, state.filesChanged);
            state.proofed = report.ok;
            state.sweepOk = true;
            state.lastProof = formatReport(report);
            results.push({
                ok: true,
                type: 'verify',
                result: state.lastProof,
            });
            const wiring = await checkWiring(this.workspace, tools.root, state.task, state.filesChanged);
            state.wiringFail = !wiring.ok;
            state.lastWiring = formatWiring(wiring);
            if (wiring.notes?.length) {
                results.push({
                    ok: false,
                    type: 'wiring',
                    result: state.lastWiring,
                });
                this.emit('verify', state.lastWiring, { ok: false });
            }
            const behavior = await checkBehavior(
                this.workspace,
                tools.root,
                state.task,
                state.filesChanged,
                state.relevantFiles,
            );
            state.behaviorFail = !behavior.ok;
            state.lastBehavior = formatBehavior(behavior);
            if (behavior.notes?.length) {
                results.push({
                    ok: false,
                    type: 'behavior',
                    result: state.lastBehavior,
                });
                this.emit('verify', state.lastBehavior, { ok: false });
            }
            this.emit('verify', state.lastProof, {
                ok: report.ok,
                checked: report.checked || [],
                missing: report.missing || [],
            });
        }
        state.batchFailed = results.some((item) => (
            item && item.ok === false && !/^(wiring|behavior|verify)$/.test(item.type)
        ));
        if (state.batchFailed) {
            this.emit('status', 'Có lỗi — sửa tiếp, không dừng');
        } else {
            state.clearErrors();
        }
        return { results, applied };
    }

    async run({ root, message, openFile, page, memory, controller }) {
        this.aborted = false;
        const task = String(message || '').trim();
        const state = new AgentState(task);
        const tools = new ToolManager(this.workspace, root, this.terminalService, {
            retriever: this.retriever,
            controller,
            siteIndex: this.siteIndex,
            indexer: this.indexer,
        });
        const adapter = new GeminiWebAdapter(this.gemini);
        const appliedAll = [];

        const finishAbort = () => {
            state.status = 'aborted';
            this.emit('status', 'Đã dừng');
            return {
                success: false,
                aborted: true,
                error: 'Đã dừng.',
                applied: appliedAll,
                state: state.snapshot(),
                memory: this.sessionMemory(state, root, memory),
            };
        };

        const send = async (prompt) => {
            this.throwIfAborted();
            const raw = await adapter.send(page, prompt);
            this.throwIfAborted();
            return raw;
        };

        const firstPrompt = () => `${PROTOCOL}

${state.projectBrief || '(no retrieved context)'}

TASK:
${task}
${openFile?.path ? `\nFocused file: ${openFile.path}` : ''}

${formatRequirements(state.requirements, state.reqIndex)}

${formatKindBlock(state)}

${wantsVerify(task) && !wantsFileWork(task) && state.requirements.length <= 1
        ? 'This task is only to run the app. Emit run_start or run_command now, then done=true. Do not edit files.'
        : 'Follow the KIND playbook for requirement 1. Survey/diagnose RELATION TREE first. done=false until every requirement is done.'} ${TURN}`;

        const resultPrompt = (results) => {
            const onlyReads = (results || []).every((item) => READ_TOOLS.has(item.type) || item.type === 'already_read');
            const blocks = (results || []).map((item) => {
                const head = `${item.type}${item.path ? ` ${item.path}` : ''}${item.command ? ` ${item.command}` : ''}`;
                return `### ${head}\n${item.error || item.result || ''}`;
            }).join('\n\n');
            let extra = '';
            const failed = (results || []).filter((item) => item && item.ok === false);
            if (failed.length) {
                extra = `\nTOOLS FAILED — do not stop, do not done=true. Fix them now:\n${failed.map((item) => `- ${item.type} ${item.path || ''}: ${item.error || item.result || 'failed'}`).join('\n')}\nIf the path does not exist, emit create_file with full content. Then continue the KIND playbook.`;
            } else if ((results || []).some((item) => /^SKIP /.test(String(item.result || '')))) {
                extra = '\nSome writes were skipped because they are unrelated to the TASK. Do not retry them. If the user request is done, return actions=[] done=true.';
            } else if (state.behaviorFail) {
                extra = `\n${state.lastBehavior}\nImplement the real behavior now (handler + ipc/main if Electron). done=false.`;
            } else if (state.wiringFail) {
                extra = `\n${state.lastWiring}\nUnify state now: pass the existing list as props or move it to a shared store. done=false.`;
            } else if (state.requirementsLeft() > 0) {
                extra = `\n${formatKindBlock(state)}\n${formatRequirements(state.requirements, state.reqIndex)}\nFollow the KIND playbook. done=false until all ${state.requirements.length} are done.`;
            } else if (wiringLeft(state, task)) {
                extra = `\nFeature still disconnected. Read/edit remaining connected files so they share one source of truth:\n${relatedSurfaces(state).map((item) => `- ${item}`).join('\n')}\ndone=false.`;
            } else if (taskSatisfied(state, task)) {
                extra = '\nIf THIS user request is already done AND related screens share data, return {"analysis":"...","actions":[],"done":true}. Do not edit package.json/README.';
            } else if (onlyReads || (results || []).some((item) => item.type === 'already_read')) {
                extra = '\nThose files are already in context. Emit the edit_file that wires them to the same state. If already wired, done=true.';
            } else if (workLeft(state, task)) {
                extra = '\nEmit the remaining edit_file / run for THIS task only. done=false. Do not touch unrelated files.';
            }
            return `${PROTOCOL}

TOOL RESULTS:
${blocks || '(none)'}
${extra}

Continue the same TASK. Do not edit a file just because you read it. If the request is done, actions=[] done=true.
${TURN}`;
        };

        try {
        this.emit('status', 'AI đang đọc nội dung để lập kế hoạch…');
        await this.emitWorking({ type: 'think' }, 'Đang lập kế hoạch từ yêu cầu…');
        let planned = [];
        try {
            const rawPlan = await send(planPrompt(task));
            planned = parseAiPlan(rawPlan);
        } catch {
            planned = [];
        }
        state.setRequirements(planned.length ? planned : splitRequirements(task));
        this.emitPlan(state);
        if (state.requirements.length) {
            const summary = state.requirements
                .map((item, idx) => `${idx + 1}. [${kindMeta(item.kind).label}] ${item.text}`)
                .join('\n');
            this.emit('status', `${state.requirements.length} việc — AI đã gom từ nội dung`);
            this.emit('step', `Kế hoạch:\n${summary}`);
        }
        await this.emitWorking({ type: 'think' }, 'Đang index source…');
        this.emit('status', 'Đang quét source, chia chunk, ghi vector DB…');
        state.markPhase('index');
        if (this.indexer) {
            const stats = await this.indexer.ensure(root, (msg) => this.emit('status', msg));
            this.emit('status', `Index ${stats.chunks} chunks / ${stats.files} files`);
        }

        const urls = extractUrls(task);
        if (urls.length && this.siteIndex && controller) {
            await this.emitWorking({ type: 'browser_open', path: urls[0] }, `Đang đọc website ${urls[0]}…`);
            this.emit('status', `Đang crawl ${urls[0]}…`);
            const site = await this.siteIndex.capture(controller, urls[0]);
            if (site.ok) {
                state.surveyDigest = site.digest;
                this.emit('step', `Đã nạp giao diện ${site.title || urls[0]} vào vector DB`);
            }
        }

        await this.emitWorking({ type: 'retrieve', query: task.slice(0, 48) }, 'Đang retrieve context…');
        this.emit('status', 'Đang tìm file/đoạn code liên quan…');
        const retrieved = this.retriever
            ? this.retriever.retrieve(
                state.currentRequirement()?.text
                    ? `${state.currentRequirement().text}\n${task}`
                    : task,
                { openFile, k: 10, extra: [state.surveyDigest] },
            )
            : { files: [], digest: '', tree: '' };
        this.applyRetrieved(state, retrieved);
        state.markPhase('execute');
        await this.emitWorking({ type: 'think' }, `${this.llmName} đang lập kế hoạch…`);
        this.emit('status', `${this.llmName} đang chạy…`);
        let raw = await send(firstPrompt());
        let parsed = this.ingest(state, raw);
        let empty = 0;
        let readStreak = 0;
        const maxIters = Math.min(36, Math.max(MAX_ITERS, 8 * Math.max(1, state.requirements.length)));

        for (let i = 1; i <= maxIters; i += 1) {
            this.throwIfAborted();
            state.iteration = i;

            if (parsed.refusal && !parsed.actions.length) {
                raw = await send(this.buildRefusalNudge(task));
                parsed = this.ingest(state, raw);
            }

            parsed.actions = attachReadRanges(parsed.actions, parsed);
            const deduped = dropDuplicateReads(parsed.actions, state);
            parsed.actions = deduped.actions;
            const gate = kindProgress(state);
            if (!gate.ok && (gate.reason === 'survey' || gate.reason === 'diagnose')) {
                const blocked = parsed.actions.filter((item) => WRITE_TOOLS.has(item.type));
                if (blocked.length) {
                    parsed.actions = parsed.actions.filter((item) => !WRITE_TOOLS.has(item.type));
                    this.emit('step', `Chặn sửa — ${gate.hint || 'khảo sát / tìm nguyên nhân trước'}`);
                }
            }
            if (deduped.skipped.length && !parsed.actions.length && readStreak < 2) {
                readStreak += 1;
                const unread = (state.relevantFiles || []).filter((rel) => !(state.filesRead || []).includes(rel));
                if (!gate.ok && (gate.reason === 'survey' || gate.reason === 'diagnose')) {
                    this.emit('status', gate.reason === 'diagnose' ? 'Đang tìm nguyên nhân…' : 'Đang khảo sát cây liên hệ…');
                    raw = await send(this.buildKindPlaybookPrompt(state, task, {
                        ...gate,
                        hint: unread.length
                            ? `File đã đọc. Đọc tiếp RELATION TREE:\n${unread.slice(0, 8).join('\n')}`
                            : gate.hint,
                    }));
                } else {
                    this.emit('status', 'File đã đọc — chuyển sang sửa…');
                    raw = await send(`${PROTOCOL}

TASK:
${task}

${formatKindBlock(state)}

ALREADY READ (do not read again):
${deduped.skipped.join('\n')}

You already have the numbered lines. Emit the edit_file this KIND playbook still needs, or done=true if THIS requirement is already done.
${TURN}`);
                }
                parsed = this.ingest(state, raw);
                parsed.done = false;
                parsed.claimedDone = false;
                continue;
            }

            if (!parsed.actions.length) {
                if (this.shouldAdvanceRequirement(state, parsed, task, empty)) {
                    state.advanceRequirement();
                    this.emitPlan(state);
                    if (state.reqIndex < state.requirements.length) {
                        const next = state.currentRequirement();
                        const idx = state.reqIndex + 1;
                        const n = state.requirements.length;
                        const label = kindMeta(next?.kind).label;
                        empty = 0;
                        this.emit('status', `Yêu cầu ${idx}/${n} · ${label}`);
                        this.emit('step', `${label}: ${(next?.text || '').slice(0, 100)}`);
                        this.refreshRetrieved(state, `${next?.text || ''} ${task}`, openFile);
                        raw = await send(this.buildNextRequirementPrompt(state, task));
                        parsed = this.ingest(state, raw);
                        parsed.done = false;
                        parsed.claimedDone = false;
                        continue;
                    }
                    this.emit('step', `Đã xong ${state.requirements.length} yêu cầu`);
                }
                if (workLeft(state, task) && empty < 8) {
                    empty += 1;
                    const progress = kindProgress(state);
                    const hasErrors = Boolean(state.batchFailed || (state.currentErrors || []).length);
                    this.emit('status', hasErrors
                        ? 'Có lỗi — sửa tiếp, không dừng'
                        : progress.reason === 'diagnose'
                            ? 'Đang tìm nguyên nhân lỗi…'
                            : progress.reason === 'survey'
                                ? 'Đang khảo sát cây liên hệ…'
                                : state.requirements.length > 1
                                    ? `Còn yêu cầu ${state.reqIndex + 1}/${state.requirements.length} — tiếp tục…`
                                    : 'Còn việc — tiếp tục…');
                    raw = await send(
                        hasErrors
                            ? this.buildFixErrorsPrompt(state, task)
                            : !progress.ok && (progress.reason === 'survey' || progress.reason === 'diagnose')
                                ? this.buildKindPlaybookPrompt(state, task, progress)
                                : this.buildKeepWorkingPrompt(state, task),
                    );
                    parsed = this.ingest(state, raw);
                    parsed.done = false;
                    parsed.claimedDone = false;
                    continue;
                }
                if (!workLeft(state, task) && state.filesChanged.length && state.terminalChecks < 1) {
                    parsed = await this.afterEditsCheck(tools, state, task, send, parsed);
                    if (parsed.actions.length) continue;
                }
                if (workLeft(state, task)) {
                    this.emit('status', 'Agent không ra tool đúng định dạng.');
                    break;
                }
                this.markFinished(state, task);
                break;
            }

            empty = 0;
            if (parsed.actions.some((item) => WRITE_TOOLS.has(item.type))) readStreak = 0;
            else if (parsed.actions.every((item) => READ_TOOLS.has(item.type))) readStreak += 1;
            const quiet = parsed.actions.every((item) => READ_TOOLS.has(item.type));
            const phase = kindProgress(state);
            this.emit('status', quiet
                ? (phase.reason === 'diagnose' ? 'Đang tìm nguyên nhân…' : 'Đang khảo sát…')
                : `Đang sửa (${parsed.actions.filter((item) => WRITE_TOOLS.has(item.type)).length})…`);
            const { results, applied } = await this.executeActions(tools, parsed.actions, state);
            appliedAll.push(...applied);
            if (i === maxIters) break;
            const skippedAll = results.length
                && !applied.length
                && results.every((item) => /^SKIP /.test(String(item.result || '')) || READ_TOOLS.has(item.type));
            if (skippedAll && taskSatisfied(state, task) && results.some((item) => /^SKIP /.test(String(item.result || '')))) {
                this.markFinished(state, task);
                break;
            }
            raw = await send(resultPrompt(results));
            parsed = this.ingest(state, raw);
        }

        const changed = [...new Set(appliedAll.map((item) => item.path).filter(Boolean))];
        let reply = state.lastAnalysis || 'Xong.';
        if (looksLikeRefusal(reply)) {
            reply = 'NowK đã nhắc model xuất tool JSON. Gửi lại yêu cầu nếu chưa thấy thay đổi.';
        } else if (changed.length && /cấu trúc|liên kết|kế hoạch|plan rules|wiring/i.test(reply)) {
            reply = `Đã sửa ${changed.length} file: ${changed.join(', ')}.`;
        }
        state.status = 'completed';
        this.emit('status', 'Hoàn tất.');
        this.emit('done', reply, { applied: appliedAll, state: state.snapshot() });
        return {
            success: true,
            reply,
            applied: appliedAll,
            state: state.snapshot(),
            memory: this.sessionMemory(state, root, memory),
        };
        } catch (error) {
            if (this.aborted || error.aborted) return finishAbort();
            throw error;
        }
    }
}

module.exports = AgentOrchestrator;
