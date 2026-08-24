function unique(list) {
    const out = [];
    for (const item of list || []) {
        const text = String(item || '').trim();
        if (text && !out.includes(text)) out.push(text);
    }
    return out;
}

const ACTION_RE = /tạo|xóa|sửa|thêm|viết|fix|implement|đổi|chuyển|thanh toán|popup|nút|button|chưa|phải|muốn|cần|mở|add|create|update|delete|remove|wire|build/i;

const KIND_META = {
    feature: {
        id: 'feature',
        label: 'Tính năng',
        labelEn: 'feature',
        playbook: `FEATURE playbook — follow IN ORDER, do not skip:
1. SURVEY: read_file / search_code every file in RELATION TREE. Name who owns the state, who renders it, who writes it.
2. IMPLEMENT: add the feature on THAT tree. New UI must use the existing store/ref/props. Never duplicate state.
3. VERIFY: related screens share data; buttons/menus actually work.
Editing after reading one random file is incomplete.`,
        surveyFirst: true,
    },
    bugfix: {
        id: 'bugfix',
        label: 'Sửa lỗi',
        labelEn: 'bugfix',
        playbook: `BUGFIX playbook — follow IN ORDER, do not skip:
1. LOCATE: search_code / retrieve the error, stack, or broken behavior.
2. DIAGNOSE: read the failing file AND its callers/importers in RELATION TREE. analysis MUST name the root cause in one sentence.
3. FIX: change the cause, not a symptom in an unrelated file.
4. VERIFY: the original symptom is gone.
Do not edit before you can name the cause.`,
        diagnoseFirst: true,
    },
    update: {
        id: 'update',
        label: 'Cập nhật',
        labelEn: 'update',
        playbook: `UPDATE playbook — follow IN ORDER:
1. SURVEY: find the CURRENT implementation in RELATION TREE (not a similar copy).
2. PATCH: edit in place. Do not recreate a parallel file/state.
3. SYNC: update every connected surface that still shows the old version.`,
        surveyFirst: true,
    },
    refactor: {
        id: 'refactor',
        label: 'Refactor',
        labelEn: 'refactor',
        playbook: `REFACTOR playbook:
1. SURVEY: search_code / find every usage in RELATION TREE.
2. CHANGE: update the definition and ALL call sites together.
3. Do not change behavior unless the user asked.`,
        surveyFirst: true,
    },
    style: {
        id: 'style',
        label: 'Giao diện',
        labelEn: 'style',
        playbook: `STYLE playbook:
1. SURVEY: read existing CSS plus every Vue/HTML in RELATION TREE.
2. PATCH those files in place — colors, type, spacing, components. "A different look" means the tree actually looks different.
3. Adding one extra theme-*.css / wrapper is NOT enough if SiteHeader, views, and sections still have the old look.
4. If a file does not exist, create_file it. Never stop after a missing-file error.`,
        surveyFirst: true,
    },
    remove: {
        id: 'remove',
        label: 'Xóa',
        labelEn: 'remove',
        playbook: `REMOVE playbook:
1. SURVEY: search_code every usage in RELATION TREE.
2. Delete/disconnect all call sites, then the source.
3. Do not leave dead imports or leftover buttons.`,
        surveyFirst: true,
    },
    run: {
        id: 'run',
        label: 'Chạy',
        labelEn: 'run',
        playbook: 'RUN playbook: emit run_start or run_command now. Do not edit files.',
        surveyFirst: false,
    },
    investigate: {
        id: 'investigate',
        label: 'Khảo sát',
        labelEn: 'investigate',
        playbook: `INVESTIGATE playbook:
1. SURVEY RELATION TREE with search_code / read_file.
2. Return analysis of how it works. Edit only if the user also asked to change it.`,
        surveyFirst: true,
    },
};

function kindMeta(kind) {
    return KIND_META[kind] || KIND_META.feature;
}

function classifyRequirement(text) {
    const t = String(text || '');
    if (/lỗi|bug|crash|error|exception|traceback|không (chạy|hiện|work|được|hoạt động)|broken|fail|sửa lỗi|\bfix\b|hotfix|undefined is not|cannot find/i.test(t)) {
        return 'bugfix';
    }
    if (/khởi chạy|khởi động|chạy (lại )?(app|dev|test)|npm run|run_start/i.test(t)
        && !/thêm|sửa|tạo|fix|implement|cập nhật/i.test(t)) {
        return 'run';
    }
    if (/refactor|tái cấu trúc|đổi tên symbol|rename|cleanup code|dọn code/i.test(t)) return 'refactor';
    if (/\b(xóa|remove|delete|bỏ)\b/i.test(t) && !/thêm|tạo/i.test(t)) return 'remove';
    if (/thêm|tạo mới|tính năng|feature|\bimplement\b|chức năng mới|popup|trang mới/i.test(t)) return 'feature';
    if (/cập nhật|update\b|nâng cấp|upgrade|đồng bộ/i.test(t)) return 'update';
    if (/đổi màu|restyle|\bcss\b|theme|giao diện/i.test(t) && !/logic|state|api|ipc/i.test(t)) return 'style';
    if (/đổi|thay|sửa|chỉnh/i.test(t)) return 'update';
    if (/khảo sát|investigate|tìm hiểu|giải thích|review/i.test(t)) return 'investigate';
    return 'feature';
}

function toRequirement(item) {
    if (item && typeof item === 'object' && item.text) {
        const text = String(item.text).trim();
        const kind = item.kind || classifyRequirement(text);
        return { text, kind, status: item.status || 'pending' };
    }
    const text = String(item || '').trim();
    if (!text) return null;
    return { text, kind: classifyRequirement(text), status: 'pending' };
}

function looksLikeNoiseLine(line) {
    return /^\s*(at\s+|vue\.js|client:\d+|\[vite\]|webpack|chrome-error|Unhandled error|onClick\._cache)/i.test(String(line || ''));
}

function looksLikeDump(text) {
    const lines = String(text || '').split(/\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length < 3) return false;
    const hits = lines.filter((line) => (
        looksLikeNoiseLine(line)
        || /Uncaught|TypeError|Vue warn|Traceback|Error:|Exception|at </i.test(line)
    )).length;
    return hits >= 2 || (hits >= 1 && lines.length >= 5);
}

function collapseDump(text) {
    const src = String(text || '');
    const err = src.match(/Uncaught \w+Error:[^\n]+/i)
        || src.match(/\b(?:TypeError|ReferenceError|SyntaxError|Error):[^\n]+/i);
    const file = src.match(/([A-Za-z0-9_./-]+\.(?:vue|js|ts|jsx|tsx|mjs|cjs)):\d+/);
    const msg = err ? err[0].replace(/\s+/g, ' ').trim() : 'lỗi runtime trên console';
    const where = file ? ` trong ${file[1]}` : '';
    return [`Sửa ${msg}${where}. Đây là một lỗi (stack/log trùng không tách thành nhiều việc).`];
}

function extractJsonObject(raw) {
    const text = String(raw || '');
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
        return JSON.parse(text.slice(start, end + 1));
    } catch {
        return null;
    }
}

const PLAN_KINDS = new Set(['feature', 'bugfix', 'update', 'refactor', 'style', 'remove', 'run', 'investigate']);

function parseAiPlan(raw) {
    const data = extractJsonObject(raw);
    const list = data?.items || data?.requirements || data?.plan;
    if (!Array.isArray(list) || !list.length) return [];
    const out = [];
    for (const item of list) {
        const text = String(item?.text || item?.task || item || '').replace(/\s+/g, ' ').trim();
        if (text.length < 8) continue;
        if (looksLikeNoiseLine(text)) continue;
        const kind = PLAN_KINDS.has(item?.kind) ? item.kind : classifyRequirement(text);
        if (!out.some((row) => row.text === text)) out.push({ text, kind, status: 'pending' });
        if (out.length >= 8) break;
    }
    return out;
}

function planPrompt(task) {
    return `You are planning work for a coding agent. The user pasted raw text (maybe a request, maybe a console dump).
Turn it into a SHORT list of real tasks.

Return ONLY JSON:
{"items":[{"text":"clear task in Vietnamese","kind":"bugfix"}]}

kind must be one of: feature, bugfix, update, refactor, style, remove, run, investigate.

Rules:
- Understand MEANING. Never split by line.
- Console/Vite/Vue stacks, repeated TypeError, "at <Component>" frames = ONE bugfix.
- Duplicate logs of the same error = still ONE item.
- Ignore noise: [vite] connecting, connected, at <App>, webpack, line numbers alone.
- One distinct user goal = one item. Usually 1–4 items. Never 1 item per log line.
- text = what to do, with file/error name if present. Not a copy of the stack.

USER TEXT:
${String(task || '').slice(0, 6000)}`;
}

function splitTexts(task) {
    const text = String(task || '').trim();
    if (!text) return [];
    if (looksLikeDump(text)) return collapseDump(text);

    const numbered = [];
    const re = /(?:^|\n)\s*(?:\d+[\.)]|[-*•]|#{1,3})\s+(.+)/g;
    let match = re.exec(text);
    while (match) {
        numbered.push(match[1].trim());
        match = re.exec(text);
    }
    const numberedTasks = numbered.filter((item) => !looksLikeNoiseLine(item) && ACTION_RE.test(item));
    if (numberedTasks.length >= 2) return unique(numberedTasks).slice(0, 8);

    const connected = text
        .split(/\s*(?:;+|sau đó|rồi(?:\s+đến)?|đồng thời|ngoài ra|thêm nữa)\s+/i)
        .map((item) => item.replace(/^[\s>*•\d.)-]+/, '').trim())
        .filter((item) => item.length >= 8 && ACTION_RE.test(item) && !looksLikeNoiseLine(item));
    if (connected.length >= 2) return unique(connected).slice(0, 8);

    const verbChunks = text
        .split(/\s*,\s+(?=(?:tạo|xóa|sửa|thêm|viết|fix|implement|đổi|chuyển|mở|add|create|update)\b)/i)
        .map((item) => item.trim())
        .filter((item) => item.length >= 8 && !looksLikeNoiseLine(item));
    if (verbChunks.length >= 2) return unique(verbChunks).slice(0, 8);

    return [text];
}

function splitRequirements(task) {
    return splitTexts(task).map(toRequirement).filter(Boolean);
}

function formatRequirements(requirements, index = 0) {
    const list = requirements || [];
    if (!list.length) return '';
    const lines = list.map((item, idx) => {
        const mark = idx < index ? 'done' : idx === index ? 'NOW' : 'todo';
        const req = toRequirement(item);
        const kind = req?.kind || 'feature';
        const meta = kindMeta(kind);
        return `${idx + 1}. [${mark}] [${meta.labelEn}/${meta.label}] ${req.text}`;
    });
    return `REQUIREMENTS (${list.length}):\n${lines.join('\n')}\ndone=true ONLY after every requirement is [done]. Never stop after the first.`;
}

function playbookFor(kind) {
    return kindMeta(kind).playbook;
}

function currentRequirementOf(state) {
    return (state?.requirements || [])[state?.reqIndex || 0] || null;
}

function kindProgress(state) {
    const req = currentRequirementOf(state);
    if (!req) return { ok: true, phase: 'done', reason: '' };
    const kind = req.kind || classifyRequirement(req.text);
    const meta = kindMeta(kind);
    const reads = state.filesRead || [];
    const related = (state.relevantFiles || []).filter(Boolean);
    const relatedRead = reads.filter((rel) => related.includes(rel));
    const searched = (state.toolLog || []).some((item) => (
        /search_code|grep|retrieve|find_symbol|find_references/.test(item.type)
    ));
    const wrote = (state.filesChanged || []).length > (state.reqMark || 0);

    if (kind === 'run') {
        return { ok: true, phase: 'run', reason: '', kind, meta };
    }

    if (kind === 'bugfix') {
        const need = Math.min(2, Math.max(1, related.length || 1));
        const located = searched || relatedRead.length >= 1 || reads.length >= 1;
        if (!located || (related.length >= 2 && relatedRead.length < need && reads.length < need)) {
            return {
                ok: false,
                phase: 'diagnose',
                reason: 'diagnose',
                kind,
                meta,
                hint: 'Tìm nguyên nhân: search_code chỗ lỗi, rồi đọc file hỏng VÀ caller trong RELATION TREE trước khi sửa.',
            };
        }
        if (!wrote) {
            return {
                ok: false,
                phase: 'fix',
                reason: 'fix',
                kind,
                meta,
                hint: 'Đã định vị — sửa đúng chỗ gây lỗi, không vá file không liên quan.',
            };
        }
        return { ok: true, phase: 'verify', reason: '', kind, meta };
    }

    if (kind === 'investigate') {
        if (relatedRead.length < 1 && reads.length < 1 && !searched) {
            return {
                ok: false,
                phase: 'survey',
                reason: 'survey',
                kind,
                meta,
                hint: 'Khảo sát cây liên hệ: đọc file liên quan trước.',
            };
        }
        return { ok: true, phase: 'done', reason: '', kind, meta };
    }

    if (!related.length) {
        if (!wrote && reads.length < 1 && !searched) {
            return {
                ok: false,
                phase: 'survey',
                reason: 'survey',
                kind,
                meta,
                hint: 'Chưa đọc file nào. search_code / read_file phần liên quan trước khi sửa.',
            };
        }
        if (!wrote && kind !== 'run') {
            return {
                ok: false,
                phase: 'implement',
                reason: 'implement',
                kind,
                meta,
                hint: 'Đã khảo sát — implement trên đúng file đó.',
            };
        }
        return { ok: true, phase: 'verify', reason: '', kind, meta };
    }

    const surveyNeed = Math.min(3, Math.max(1, related.length));
    const surveyed = Math.max(relatedRead.length, Math.min(reads.length, surveyNeed));
    if (meta.surveyFirst && surveyed < surveyNeed) {
        return {
            ok: false,
            phase: 'survey',
            reason: 'survey',
            kind,
            meta,
            need: surveyNeed,
            surveyed,
            hint: `Khảo sát cây liên hệ: đọc ít nhất ${surveyNeed} file liên quan trước khi sửa (${surveyed}/${surveyNeed}).`,
        };
    }
    if (!wrote) {
        return {
            ok: false,
            phase: 'implement',
            reason: 'implement',
            kind,
            meta,
            hint: 'Đã khảo sát — implement trên đúng cây file, đừng tạo state/file song song.',
        };
    }

    const cover = coverageGap(state, kind, req);
    if (cover) return cover;

    return { ok: true, phase: 'verify', reason: '', kind, meta };
}

function coverageGap(state, kind, req) {
    if (kind !== 'style' && kind !== 'feature' && kind !== 'update') return null;
    const blob = `${state.task || ''} ${req?.text || ''}`;
    const wantsAll = /tất cả|toàn bộ|mọi|cả site|all (ui|views|pages)|kiểu khác|restyle/i.test(blob);
    if (!wantsAll && kind !== 'style') return null;
    const related = (state.relevantFiles || []).filter((rel) => /\.(vue|css|scss|less|html)$/i.test(rel));
    if (related.length < 3) return null;
    const changed = state.filesChanged || [];
    const untouched = related.filter((rel) => !changed.includes(rel));
    const need = Math.min(related.length, Math.max(3, Math.ceil(related.length * 0.55)));
    const touched = related.length - untouched.length;
    if (touched >= need) return null;
    return {
        ok: false,
        phase: 'implement',
        reason: 'implement',
        kind,
        meta: kindMeta(kind),
        hint: `Còn file trên cây chưa đổi (${touched}/${need}). Sửa tiếp, đừng dừng:\n${untouched.slice(0, 10).join('\n')}`,
    };
}

function formatKindBlock(state) {
    const req = currentRequirementOf(state);
    if (!req) return '';
    const progress = kindProgress(state);
    const meta = progress.meta || kindMeta(req.kind);
    const tree = state.relationTree || '(chưa có cây — retrieve / search_code trước)';
    return `KIND: ${meta.labelEn} / ${meta.label}
CURRENT REQUIREMENT: ${req.text}

${meta.playbook}

RELATION TREE:
${tree}

PHASE NOW: ${progress.phase}${progress.hint ? `\nMISSING: ${progress.hint}` : ''}
Writes are BLOCKED until survey/diagnose is done.`;
}

module.exports = {
    splitRequirements,
    parseAiPlan,
    planPrompt,
    looksLikeDump,
    formatRequirements,
    classifyRequirement,
    kindMeta,
    playbookFor,
    kindProgress,
    formatKindBlock,
    toRequirement,
    KIND_META,
};
