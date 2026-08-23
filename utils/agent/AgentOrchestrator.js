const AgentState = require('./AgentState');
const ProjectContext = require('./ProjectContext');
const ToolManager = require('./ToolManager');
const GeminiWebAdapter = require('./GeminiWebAdapter');
const { parseResponse, looksTruncated, looksLikeRefusal } = require('./ResponseParser');
const { compressState } = require('./ContextCompressor');
const { verifyChanges, formatReport, auditAction, collectNeedles, sweepLeftovers, formatSweep } = require('./ChangeVerifier');

const MAX_ITERS = 20;
const WRITE_TOOLS = new Set(['mkdir', 'create_file', 'edit_file', 'delete_file', 'run_command', 'run_test', 'run_build', 'run_start', 'run_stop']);
const READ_TOOLS = new Set(['list_files', 'read_file', 'search_code', 'find_symbol', 'find_references', 'git_status', 'git_diff', 'git_log']);
const RUN_TOOLS = new Set(['run_command', 'run_test', 'run_build', 'run_start']);

const PROTOCOL = `You are NowK, a coding agent inside the user's IDE (same job as Cursor Agent).
You call tools by returning ONE JSON object. NowK executes it on the real project. This is not a simulation.

{"analysis":"one short sentence","plan":["file — change"],"actions":[{"type":"read_file","path":"src/App.vue"},{"type":"edit_file","path":"src/App.vue","old":"...","new":"..."}],"done":false}

actions items MUST have "type". Wrong: {"read_file":{"path":"src/style.css"}}. Right: {"type":"read_file","path":"src/style.css"}.

Tools:
read_file {path, query?} | search_code {query} | list_files {path?}
edit_file {path, old, new} | create_file {path, content} | delete_file {path} | mkdir {path}
run_command {command} | run_start {command} | run_test {command}

How you work (Cursor-style):
- The PROJECT MAP is already in context. Do not re-list the whole repo.
- Mix reads and edits in the same turn. Start editing as soon as you know the hunk.
- Batch 3–8 tools. Follow wiring: App/layout → pages → components → css.
- edit_file: copy old EXACTLY from the numbered lines. new must be valid code.
- Do NOT re-read a file already in TOOL RESULTS. Next JSON must include edit_file.
- Plan steps are edits ("file — change"), never "read lines 100-140".
- A UI/content change is not done after one CSS file or :root tokens.
- done=true only when the user-visible task is finished and the planned files were edited.
- Never say you lack tools. Never repeat a long plan as the final answer.`;

const TURN = `Return only that JSON. Escape quotes as \\".`;

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
        if (state.isReadOnlyPlan?.(item)) return false;
        const files = planFiles(item);
        if (!files.length) return true;
        return !files.some((file) => (state.filesChanged || []).some((rel) => (
            rel === file || rel.endsWith(`/${file}`) || rel.endsWith(file)
        )));
    });
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
    if (uncoveredPlan(state).length) return true;
    const changed = state.filesChanged || [];
    if (isBroadChange(task) && changed.length <= 1) return true;
    if (isBroadChange(task) && changed.length === 1 && /\.css$/i.test(changed[0])) return true;
    if (isBroadChange(task) && (state.uiCount || 0) >= 4 && changed.length < 3) return true;
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

function terminalProblems(text) {
    const clean = String(text || '').replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').trim();
    if (!clean) return { empty: true, ok: true, text: '' };
    const tail = clean.slice(-6000);
    const errAt = Math.max(
        lastIndexOfRe(tail, /\berror\b/i),
        lastIndexOfRe(tail, /failed to (compile|resolve|load)/i),
        lastIndexOfRe(tail, /cannot find module/i),
        lastIndexOfRe(tail, /module not found/i),
        lastIndexOfRe(tail, /syntaxerror|typeerror|referenceerror/i),
        lastIndexOfRe(tail, /traceback \(most recent/i),
        lastIndexOfRe(tail, /internal server error/i),
    );
    const okAt = Math.max(
        lastIndexOfRe(tail, /compiled successfully/i),
        lastIndexOfRe(tail, /ready in\b/i),
        lastIndexOfRe(tail, /listening on/i),
        lastIndexOfRe(tail, /dev server running/i),
        lastIndexOfRe(tail, /✓ built/i),
        lastIndexOfRe(tail, /0 error/i),
    );
    return { empty: false, ok: errAt < 0 || errAt < okAt, text: tail };
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
    'package.json', 'index.html', 'README.md', 'pyproject.toml', 'requirements.txt',
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
        const path = resolve(file);
        if (path) add({ type: 'read_file', path });
    }
    for (const path of (uiSurfaces || []).slice(0, 8)) {
        if (/\.(vue|html|css|js|ts|json)$/i.test(path)) add({ type: 'read_file', path });
    }
    for (const path of (relevant || []).slice(0, 5)) {
        if (/\.(vue|js|ts|css|html|json)$/i.test(path)) add({ type: 'read_file', path });
    }
    const needles = String(task || '')
        .split(/[^A-Za-z0-9À-ỹ_-]+/)
        .map((word) => word.trim())
        .filter((word) => word.length >= 4)
        .slice(0, 6);
    for (const query of needles) add({ type: 'search_code', query });
    if (isBroadChange(task)) {
        add({ type: 'search_code', query: 'title' });
        add({ type: 'search_code', query: 'router' });
    }
    return actions.slice(0, 16);
}

class AgentOrchestrator {
    constructor({ workspaceService, gemini, terminalService, onProgress }) {
        this.workspace = workspaceService;
        this.context = new ProjectContext(workspaceService);
        this.gemini = gemini;
        this.llmName = 'Gemini';
        this.terminalService = terminalService;
        this.onProgress = onProgress;
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

    emitPlan(state) {
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

    remainingPlanText(state) {
        const pending = state.pendingPlan();
        if (!pending.length) return '';
        return pending.map((item, idx) => `${idx + 1}. ${item.task}`).join('\n');
    }

    appendSurvey(state, results) {
        const chunk = formatToolResults(results, 5000);
        state.surveyDigest = `${state.surveyDigest || ''}\n${chunk}`.trim().slice(-14000);
    }

    async bootstrapSurvey(tools, state, task, relevant, uiSurfaces) {
        this.emit('status', 'Đang đọc dự án để nắm hiện trạng...');
        state.markPhase('survey');
        const first = [
            { type: 'list_files', path: '' },
            { type: 'list_files', path: 'src' },
            { type: 'git_status' },
        ];
        const listed = await this.executeActions(tools, first, state, { quiet: true });
        this.appendSurvey(state, listed.results);
        const more = buildSurveyReads(parseListedPaths(listed.results), task, relevant, uiSurfaces);
        if (more.length) {
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

Expand the plan to 6–16 concrete steps from what you already read. Name real files. Cover leftover pages, components, CSS, i18n, footer, title.
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

Emit several connected edit_file / create_file in this JSON. Do not finish after one isolated file.
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
JSON only. Copy old from disk. Edit the remaining files now. done=false until those files are changed.`;
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
        if (state.currentPhase === 'survey') return false;
        if (state.currentPhase === 'plan' && !looksModelDone(parsed)) return false;
        if (parsed.actions.length) return false;
        if (state.awaitingFollowUp) return false;
        if (state.oldNeedles.length && !state.sweepOk) return false;
        if (workLeft(state, task)) return false;
        if (looksModelDone(parsed)) return true;
        if (wantsFileWork(task) && !state.filesChanged.length) return false;
        if (wantsFileWork(task) && !state.proofed) return false;
        if (wantsVerify(task) && !hasRun(state)) return false;
        if (state.pendingPlan().length) return false;
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
        return `${PROTOCOL}

TASK:
${task}

You only changed: ${changed}
That is not enough. These plan steps still have untouched files:
${leftover || this.remainingPlanText(state) || '(more views/components still old)'}

Emit 3–8 edit_file / create_file NOW for those files. Copy old from the file map.
Do not rewrite the plan. Do not say complete. done=false.
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
            this.emit('step', 'Terminal không báo lỗi — dừng.');
            return { ...parsed, actions: [], done: true, claimedDone: true };
        }

        this.emit('status', 'Terminal có lỗi — sửa ngay...');
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
            ? `\nNOT DONE. These plan files are still untouched. Emit 3–8 edit_file now:\n${leftover}\ndone=false.`
            : '\nIf any connected page/component still looks old, patch it now. Only done=true after those files are edited.';
        if (missing.length) {
            extra = `\nNOT FINISHED. For new files use create_file. For existing files use edit_file old/new (snippet only):\n${missing.join('\n')}\ndone=false.`;
        } else if (failedRuns.length) {
            extra = '\nCOMMAND FAILED. Read the terminal output, fix files, then run_command / run_test / run_start again. done=false.';
        } else if (state.filesChanged.length && !state.proofed) {
            extra = `\n${state.lastProof || 'DISK CHECK: FAIL'}\nDo not claim the CSS/code was added. Patch the missing bits. done=false.`;
        } else if (state.oldNeedles.length && !state.sweepOk) {
            extra = `\n${state.lastSweep || 'SWEEP FAIL'}\nOld text still exists elsewhere. Patch those files too. done=false.`;
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
            if (!quiet) {
                this.emit('tool', action.path || action.command || action.query || action.type, {
                    tool: action.type,
                    path: action.path || '',
                    command: action.command || '',
                    query: action.query || '',
                });
            }
            let result = await tools.run(action);
            if (result.ok && /create_file|edit_file|mkdir|delete_file/.test(action.type)) {
                const audit = await auditAction(this.workspace, tools.root, action, result);
                if (!audit.ok) {
                    result = { ...result, ok: false, changed: false, error: audit.error };
                    this.emit('audit', audit.error, {
                        ok: false,
                        path: action.path || '',
                        tool: action.type,
                    });
                } else {
                    state.rememberNeedles(collectNeedles(action));
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
            if (result.ok && result.diff?.length) {
                this.emit('diff', result.path, { path: result.path, lines: result.diff });
            }
            state.recordTool(action.type, action.path || action.command || action.query || '');
            if (result.ok && action.type === 'read_file' && action.path && !quiet) {
                readPaths.push(action.path);
            }
            if (!result.ok) state.recordError(result.error || `${action.type} failed`);
            if (result.changed && result.path) {
                state.recordChange(result.path);
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
            state.lastProof = formatReport(report);
            results.push({
                ok: report.ok,
                type: 'verify',
                result: state.lastProof,
            });
            this.emit('verify', state.lastProof, {
                ok: report.ok,
                checked: report.checked || [],
                missing: report.missing || [],
            });
            if (state.oldNeedles.length) {
                const leftover = await sweepLeftovers(this.workspace, tools.root, state.oldNeedles);
                state.sweepOk = leftover.length === 0;
                state.lastSweep = formatSweep(leftover);
                results.push({
                    ok: state.sweepOk,
                    type: 'sweep',
                    result: state.lastSweep,
                });
                this.emit('sweep', state.lastSweep, { ok: state.sweepOk, leftover });
            } else {
                state.sweepOk = true;
                this.emit('sweep', formatSweep([]), { ok: true, leftover: [] });
            }
        }
        return { results, applied };
    }

    async run({ root, message, openFile, page, memory }) {
        this.aborted = false;
        const task = String(message || '').trim();
        const state = new AgentState(task);
        const tools = new ToolManager(this.workspace, root, this.terminalService);
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

PROJECT MAP:
${state.projectBrief || state.surveyDigest || '(empty)'}

TASK:
${task}
${openFile?.path ? `\nFocused file: ${openFile.path}` : ''}

Use tools now. You may edit in this same turn. ${TURN}`;

        const resultPrompt = (results) => {
            const leftover = uncoveredPlan(state);
            const onlyReads = (results || []).every((item) => READ_TOOLS.has(item.type) || item.type === 'already_read');
            const blocks = (results || []).map((item) => {
                const head = `${item.type}${item.path ? ` ${item.path}` : ''}${item.command ? ` ${item.command}` : ''}`;
                return `### ${head}\n${item.error || item.result || ''}`;
            }).join('\n\n');
            let extra = leftover.length
                ? `\nStill untouched files to EDIT:\n${leftover.map((item) => `- ${item.task}`).join('\n')}\ndone=false.`
                : '';
            if (onlyReads || (results || []).some((item) => item.type === 'already_read')) {
                extra += `\nSTOP read_file. Those files are already in context. Emit edit_file / create_file now. done=false.`;
            } else if (!leftover.length && workLeft(state, task)) {
                extra += `\nYou already have the files. Do NOT read_file again. Emit 3–8 edit_file now. done=false.`;
            }
            return `${PROTOCOL}

TOOL RESULTS:
${blocks || '(none)'}
${extra}

Continue the same TASK. If you just read a file, the next JSON must edit it — do not read it again.
${TURN}`;
        };

        try {
        this.emit('status', 'Đang đọc dự án...');
        state.markPhase('scan');
        const scan = await this.context.scan(root);
        state.relevantFiles = this.context.pickRelevant(scan.tree, task, openFile);
        const uiSurfaces = this.context.pickUiSurfaces(scan.tree);
        state.uiCount = uiSurfaces.length;

        const reuseSurvey = Boolean(
            memory?.surveyed && memory.surveyDigest && (!memory.root || memory.root === root)
        );
        if (reuseSurvey) {
            state.surveyDigest = memory.surveyDigest;
            state.projectBrief = memory.projectBrief || memory.surveyDigest;
            this.emit('status', 'Đang làm việc…');
        } else {
            await this.bootstrapSurvey(tools, state, task, state.relevantFiles, uiSurfaces);
        }

        state.markPhase('execute');
        this.emit('status', `${this.llmName} đang chạy…`);
        let raw = await send(firstPrompt());
        let parsed = this.ingest(state, raw);
        let empty = 0;
        let readStreak = 0;

        for (let i = 1; i <= MAX_ITERS; i += 1) {
            this.throwIfAborted();
            state.iteration = i;

            if (parsed.refusal && !parsed.actions.length) {
                raw = await send(this.buildRefusalNudge(task));
                parsed = this.ingest(state, raw);
            }

            parsed.actions = attachReadRanges(parsed.actions, parsed);
            const deduped = dropDuplicateReads(parsed.actions, state);
            parsed.actions = deduped.actions;
            if (deduped.skipped.length && !parsed.actions.length && readStreak < 2) {
                readStreak += 1;
                this.emit('status', 'File đã đọc — chuyển sang sửa…');
                raw = await send(`${PROTOCOL}

TASK:
${task}

ALREADY READ (do not read again):
${deduped.skipped.join('\n')}

You already have the numbered lines. Emit 3–8 edit_file / create_file now. done=false.
${TURN}`);
                parsed = this.ingest(state, raw);
                parsed.done = false;
                parsed.claimedDone = false;
                continue;
            }

            if (!parsed.actions.length) {
                if (workLeft(state, task) && empty < 4) {
                    empty += 1;
                    this.emit('status', 'Còn việc — tiếp tục…');
                    raw = await send(`${this.buildKeepWorkingPrompt(state, task)}

Do not emit read_file for files you already received. Actions must have {"type":"edit_file","path":"...","old":"...","new":"..."}.`);
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
            this.emit('status', quiet ? 'Đang đọc…' : `Đang sửa (${parsed.actions.filter((item) => WRITE_TOOLS.has(item.type)).length})…`);
            const { results, applied } = await this.executeActions(tools, parsed.actions, state, { quiet });
            appliedAll.push(...applied);
            if (i === MAX_ITERS) break;
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
