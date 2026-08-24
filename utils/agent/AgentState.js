class AgentState {
    constructor(task) {
        this.task = String(task || '').trim();
        this.status = 'running';
        this.currentPhase = 'scan';
        this.plan = [];
        this.filesChanged = [];
        this.currentErrors = [];
        this.iteration = 0;
        this.relevantFiles = [];
        this.lastAnalysis = '';
        this.decisions = [];
        this.toolLog = [];
        this.mentioned = [];
        this.truncated = [];
        this.awaitingFollowUp = false;
        this.proofed = false;
        this.lastProof = '';
        this.oldNeedles = [];
        this.sweepOk = true;
        this.lastSweep = '';
        this.surveyDigest = '';
        this.projectBrief = '';
        this.terminalChecks = 0;
        this.filesRead = [];
        this.wiringFail = false;
        this.lastWiring = '';
        this.behaviorFail = false;
        this.lastBehavior = '';
        this.requirements = [];
        this.reqIndex = 0;
        this.reqMark = 0;
        this.relationTree = '';
        this.batchFailed = false;
    }

    setRequirements(items) {
        const list = (items || []).map((item) => {
            if (item && typeof item === 'object' && item.text) {
                return {
                    text: String(item.text).trim(),
                    kind: item.kind || 'feature',
                    status: item.status || 'pending',
                };
            }
            const text = String(item || '').trim();
            return text ? { text, kind: 'feature', status: 'pending' } : null;
        }).filter(Boolean);
        this.requirements = list;
        this.reqIndex = 0;
        this.reqMark = this.filesChanged.length;
        this.mergePlan(list.map((item) => item.text));
    }

    currentRequirement() {
        return this.requirements[this.reqIndex] || null;
    }

    requirementsLeft() {
        return Math.max(0, (this.requirements || []).length - this.reqIndex);
    }

    advanceRequirement() {
        const current = this.requirements[this.reqIndex];
        if (current) {
            current.status = 'completed';
            const item = this.plan.find((row) => row.task === current.text);
            if (item) item.status = 'completed';
        }
        this.reqIndex += 1;
        this.reqMark = this.filesChanged.length;
        this.wiringFail = false;
        this.behaviorFail = false;
        this.batchFailed = false;
        this.clearErrors();
    }

    markPhase(phase) {
        this.currentPhase = phase;
    }

    addPlanItem(task, status = 'pending') {
        const text = String(task || '').trim();
        if (!text) return;
        if (this.isFillerPlan({ task: text })) return;
        if (this.plan.some((item) => item.task === text)) return;
        this.plan.push({ task: text, status });
    }

    mergePlan(items) {
        for (const item of items || []) this.addPlanItem(item);
    }

    pendingPlan() {
        return this.plan.filter((item) => item.status !== 'completed');
    }

    finishPlan() {
        for (const item of this.plan) {
            if (item.status !== 'completed') item.status = 'completed';
        }
    }

    markPlanProgress(changedPaths = []) {
        for (const item of this.plan) {
            if (item.status === 'completed') continue;
            const name = String(item.task || '').toLowerCase();
            const hit = (changedPaths || []).some((path) => {
                const rel = String(path).toLowerCase();
                const base = rel.split('/').pop();
                return (base && name.includes(base)) || (rel && name.includes(rel));
            });
            if (hit) item.status = 'completed';
        }
    }

    isFillerPlan(item) {
        const name = String(item?.task || '');
        return /(finalize|mark (the )?(run |task )?(as )?(done|complete|completion)|finish the task|complete the task|mark completion|ensure clean state|comment cleanup)/i.test(name)
            || /(update|sửa|đổi).{0,50}(readme|package\.json).{0,40}(finish|complete|mark|done|hoàn tất)/i.test(name)
            || /package\.json.{0,40}(name|description|author|homepage|version).{0,40}(mark|finish|complete|done)/i.test(name)
            || /(đánh dấu|hoàn tất (task|yêu cầu)|để hoàn thành|to (completely )?finish)/i.test(name);
    }

    isRunPlan(item) {
        const name = String(item?.task || '');
        return /\b(run|start|chạy|khởi động|npm run|dev server)\b/i.test(name)
            && !/\b(edit|sửa|thêm|create|patch|fix|implement|viết)\b/i.test(name);
    }

    isReadOnlyPlan(item) {
        const name = String(item?.task || '').toLowerCase();
        if (this.isFillerPlan(item)) return true;
        if (/\b(edit|update|rewrite|restyle|patch|replace|sửa|thêm|viết|thay|đổi)\b/.test(name)) {
            return false;
        }
        return /\b(read|đọc|inspect|find|look|search|scan|map|liệt kê|tìm|khảo sát)\b/.test(name)
            || /\blines?\s+\d+/.test(name);
    }

    markRunProgress() {
        for (const item of this.plan) {
            if (item.status === 'completed') continue;
            if (this.isRunPlan(item)) item.status = 'completed';
        }
    }

    markDiscoverDone() {
        for (const item of this.plan) {
            if (item.status === 'completed') continue;
            if (this.isReadOnlyPlan(item)) item.status = 'completed';
        }
    }

    markReadProgress(readPaths = []) {
        for (const path of readPaths || []) {
            const rel = String(path || '');
            if (rel && !this.filesRead.includes(rel)) this.filesRead.push(rel);
        }
        for (const item of this.plan) {
            if (item.status === 'completed' || !this.isReadOnlyPlan(item)) continue;
            const name = String(item.task || '').toLowerCase();
            const hit = (readPaths || []).some((path) => {
                const rel = String(path).toLowerCase();
                const base = rel.split('/').pop();
                return (base && name.includes(base)) || (rel && name.includes(rel));
            });
            if (hit) item.status = 'completed';
        }
    }

    alreadyRead(path, slice = '') {
        const rel = String(path || '');
        if (!rel) return false;
        if (this.filesRead.includes(rel) && !slice) return true;
        return (this.toolLog || []).some((item) => (
            item.type === 'read_file' && item.detail === (slice ? `${rel}#${slice}` : rel)
        ));
    }

    completeLastPlan(status = 'completed') {
        const last = this.plan[this.plan.length - 1];
        if (last) last.status = status;
    }

    recordChange(path) {
        const rel = String(path || '');
        if (rel && !this.filesChanged.includes(rel))         this.filesChanged.push(rel);
        this.truncated = this.truncated.filter((item) => item !== rel);
        this.proofed = true;
        this.sweepOk = true;
    }

    rememberNeedles(needles) {
        for (const needle of needles || []) {
            if (needle && !this.oldNeedles.includes(needle)) this.oldNeedles.push(needle);
        }
        if (this.oldNeedles.length > 24) this.oldNeedles = this.oldNeedles.slice(-24);
    }

    rememberMentioned(paths) {
        for (const path of paths || []) {
            if (path && !this.mentioned.includes(path)) this.mentioned.push(path);
        }
    }

    markTruncated(path) {
        const rel = String(path || '');
        if (rel && !this.truncated.includes(rel)) this.truncated.push(rel);
    }

    missingFiles() {
        return [
            ...this.mentioned.filter((path) => !this.filesChanged.includes(path)),
            ...this.truncated,
        ].filter((path, idx, all) => all.indexOf(path) === idx);
    }

    recordError(message) {
        const text = String(message || '').trim();
        if (text) this.currentErrors.push(text.slice(0, 500));
        if (this.currentErrors.length > 8) this.currentErrors.shift();
    }

    clearErrors() {
        this.currentErrors = [];
    }

    recordTool(type, detail) {
        this.toolLog.push({ type, detail, iteration: this.iteration });
        if (this.toolLog.length > 40) this.toolLog.shift();
    }

    snapshot() {
        return {
            task: this.task,
            status: this.status,
            current_phase: this.currentPhase,
            plan: this.plan,
            files_changed: this.filesChanged,
            current_errors: this.currentErrors,
            iteration: this.iteration,
            relevant_files: this.relevantFiles,
        };
    }
}

module.exports = AgentState;
