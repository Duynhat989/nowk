const GeminiAgent = require('../chrome/GeminiAgent');
const ChatGptAgent = require('../chrome/ChatGptAgent');
const DeepSeekAgent = require('../chrome/DeepSeekAgent');
const AgentOrchestrator = require('./agent/AgentOrchestrator');
const { resolveProvider } = require('./agent/providers');
const ProjectIndexer = require('./agent/indexer/ProjectIndexer');
const Retriever = require('./agent/retriever/Retriever');
const SiteIndex = require('./agent/web/SiteIndex');

function slimOpenFile(openFile) {
    if (!openFile?.path) return null;
    const lines = Number(openFile.lines)
        || (openFile.content != null ? String(openFile.content).split('\n').length : 0);
    return { path: String(openFile.path), lines: lines || undefined };
}

class AgentRunner {
    constructor({ runningBrowsers, workspaceService, terminalService, onProgress }) {
        this.runningBrowsers = runningBrowsers;
        this.workspaceService = workspaceService;
        this.terminalService = terminalService;
        this.forwardProgress = onProgress;
        this.activeSessionId = '';
        this.onProgress = (data) => this.forwardProgress?.({
            ...data,
            sessionId: data.sessionId || this.activeSessionId || '',
        });
        this.agents = {
            gemini: new GeminiAgent(),
            chatgpt: new ChatGptAgent(),
            deepseek: new DeepSeekAgent(),
        };
        this.providerId = 'gemini';
        this.indexer = new ProjectIndexer(workspaceService);
        this.retriever = new Retriever(this.indexer);
        this.siteIndex = new SiteIndex(this.indexer);
        this.orchestrator = new AgentOrchestrator({
            workspaceService,
            gemini: this.agents.gemini,
            terminalService,
            onProgress: this.onProgress,
            indexer: this.indexer,
            retriever: this.retriever,
            siteIndex: this.siteIndex,
        });
        this.busy = false;
        this.aborted = false;
        this.projectRoot = '';
        this.sessions = new Map();
    }

    getSession(id, root) {
        const key = String(id || '').trim() || `s-${Date.now()}`;
        let session = this.sessions.get(key);
        if (!session) {
            session = {
                id: key,
                root: root || '',
                surveyed: false,
                surveyDigest: '',
                projectBrief: '',
                lastAnalysis: '',
                filesChanged: [],
                relevantFiles: [],
                uiCount: 0,
                turns: [],
            };
            this.sessions.set(key, session);
            if (this.sessions.size > 16) {
                const oldest = this.sessions.keys().next().value;
                this.sessions.delete(oldest);
            }
        } else if (root && session.root && session.root !== root) {
            session.root = root;
            session.surveyed = false;
            session.surveyDigest = '';
            session.projectBrief = '';
            session.lastAnalysis = '';
            session.filesChanged = [];
            session.relevantFiles = [];
            session.turns = [];
        }
        return session;
    }

    rememberSession(session, result, userMessage) {
        if (!session) return;
        if (result?.memory) {
            session.root = result.memory.root || session.root;
            session.surveyed = Boolean(result.memory.surveyed && result.memory.surveyDigest);
            session.surveyDigest = result.memory.surveyDigest || session.surveyDigest;
            session.projectBrief = result.memory.projectBrief || session.projectBrief;
            session.lastAnalysis = result.memory.lastAnalysis || session.lastAnalysis;
            session.filesChanged = result.memory.filesChanged || session.filesChanged;
            session.relevantFiles = result.memory.relevantFiles || session.relevantFiles;
            session.uiCount = result.memory.uiCount || session.uiCount;
        }
        session.turns.push({ role: 'user', text: String(userMessage || '').slice(0, 500) });
        if (result?.reply) session.turns.push({ role: 'assistant', text: String(result.reply).slice(0, 500) });
        if (session.turns.length > 16) session.turns = session.turns.slice(-16);
    }

    abort() {
        this.aborted = true;
        this.orchestrator.abort();
        Object.values(this.agents).forEach((agent) => agent.cancel?.());
        return { success: true };
    }

    setProjectRoot(root) {
        this.projectRoot = root || '';
        if (this.projectRoot) {
            this.indexer.ensure(this.projectRoot).catch(() => {});
        }
    }

    setProvider(id) {
        this.providerId = resolveProvider(id).id;
        this.orchestrator.gemini = this.agents[this.providerId];
        this.orchestrator.llmName = resolveProvider(this.providerId).name;
    }

    provider() {
        return resolveProvider(this.providerId);
    }

    getRunningController() {
        const entry = [...this.runningBrowsers.values()][0];
        return entry?.controller || null;
    }

    async inspectBrowser() {
        const meta = this.provider();
        const controller = this.getRunningController();
        if (!controller) {
            return {
                ok: false,
                chromeOpen: false,
                llmOpen: false,
                geminiOpen: false,
                provider: meta.id,
                providerName: meta.name,
                error: `Chrome chưa mở. Hãy mở profile rồi vào ${meta.name} trước.`,
            };
        }
        if (controller.nativeMode) {
            return {
                ok: false,
                chromeOpen: true,
                llmOpen: false,
                geminiOpen: false,
                provider: meta.id,
                providerName: meta.name,
                error: `Chrome đã mở nhưng chưa kết nối được. Đóng rồi mở lại profile.`,
            };
        }
        try {
            const urls = await controller.listPageUrls();
            const url = urls.find((item) => meta.urlRe.test(item)) || '';
            const llmOpen = Boolean(url);
            if (!llmOpen) {
                return {
                    ok: false,
                    chromeOpen: true,
                    llmOpen: false,
                    geminiOpen: false,
                    provider: meta.id,
                    providerName: meta.name,
                    error: `Chrome đã mở nhưng chưa thấy tab ${meta.name}. Hãy vào ${meta.openUrl} rồi gửi lại.`,
                };
            }
            return {
                ok: true,
                chromeOpen: true,
                llmOpen: true,
                geminiOpen: true,
                provider: meta.id,
                providerName: meta.name,
                url,
            };
        } catch (error) {
            return {
                ok: false,
                chromeOpen: true,
                llmOpen: false,
                geminiOpen: false,
                provider: meta.id,
                providerName: meta.name,
                error: error.message || 'Không kết nối được Chrome đang mở.',
            };
        }
    }

    emit(type, message, extra = {}) {
        this.onProgress?.({ type, message, ...extra });
    }

    async chat({ message, openFile, sessionId }) {
        if (this.busy) throw new Error('Agent đang chạy. Đợi xong rồi gửi tiếp.');
        if (!this.projectRoot) throw new Error('Hãy mở folder dự án trước.');
        const userMessage = String(message || '').trim();
        if (!userMessage) throw new Error('Nhập nội dung chat.');

        this.busy = true;
        this.aborted = false;
        const session = this.getSession(sessionId, this.projectRoot);
        this.activeSessionId = session.id;
        try {
            const meta = this.provider();
            this.orchestrator.gemini = this.agents[meta.id];
            this.orchestrator.llmName = meta.name;
            this.emit('status', `Đang kiểm tra Chrome / ${meta.name}...`);
            const browser = await this.inspectBrowser();
            if (!browser.ok) throw new Error(browser.error);

            const controller = this.getRunningController();
            const page = await controller.getAutomationPage(meta.id);
            const result = await this.orchestrator.run({
                root: this.projectRoot,
                message: userMessage,
                openFile: slimOpenFile(openFile),
                page,
                memory: session,
                controller,
            });
            this.rememberSession(session, result, userMessage);
            return { ...result, sessionId: session.id };
        } catch (error) {
            if (this.aborted || error.aborted) {
                this.emit('status', 'Đã dừng');
                return { success: false, aborted: true, error: 'Đã dừng.' };
            }
            this.emit('error', error.message);
            return { success: false, error: error.message };
        } finally {
            this.busy = false;
            this.activeSessionId = '';
        }
    }
}

module.exports = AgentRunner;
