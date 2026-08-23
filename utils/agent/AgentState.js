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
    }

    markPhase(phase) {
        this.currentPhase = phase;
    }

    addPlanItem(task, status = 'pending') {
        const text = String(task || '').trim();
        if (!text) return;
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

    isReadOnlyPlan(item) {
        const name = String(item?.task || '').toLowerCase();
        if (/\b(edit|update|rewrite|restyle|patch|replace|sửa|thêm|viết|thay|đổi)\b/.test(name)) {
            return false;
        }
        return /\b(read|đọc|inspect|find|look|search|scan|map|liệt kê|tìm|khảo sát)\b/.test(name)
            || /\blines?\s+\d+/.test(name);
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
        if (rel && !this.filesChanged.includes(rel)) this.filesChanged.push(rel);
        this.truncated = this.truncated.filter((item) => item !== rel);
        this.proofed = false;
        this.sweepOk = false;
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
