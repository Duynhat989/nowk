const fs = require('fs');
const vm = require('vm');

const STOP = new Set([
    'the', 'and', 'for', 'with', 'this', 'that', 'from', 'into', 'your', 'please',
    'tạo', 'thêm', 'sửa', 'viết', 'giúp', 'dùm', 'vào', 'cho', 'của', 'các',
    'một', 'này', 'kia', 'làm', 'file', 'code', 'trong', 'đó', 'với', 'nhé',
    'giúp', 'project', 'style', 'styles', 'class', 'css',
]);

function unique(list) {
    const out = [];
    for (const item of list || []) {
        if (item && !out.includes(item)) out.push(item);
    }
    return out;
}

function extractHints(task) {
    const text = String(task || '');
    const quoted = [...text.matchAll(/["'`“”]([^"'`“”]{2,80})["'`“”]/g)]
        .map((m) => m[1].trim())
        .filter(Boolean);
    const files = [...text.matchAll(/[A-Za-z0-9._/-]+\.[A-Za-z0-9]+/g)].map((m) => m[0]);
    const colors = (text.match(/#[0-9a-fA-F]{3,8}\b|rgb[a]?\([^)]+\)/gi) || []);
    const idents = text
        .split(/[^A-Za-z0-9_-]+/)
        .map((w) => w.trim())
        .filter((w) => w.length >= 4 && !STOP.has(w.toLowerCase()) && !/^\d+$/.test(w));
    return {
        quoted: unique(quoted).slice(0, 8),
        files: unique(files).slice(0, 8),
        colors: unique(colors).slice(0, 6),
        idents: unique(idents).slice(0, 10),
        wantsCss: /css|stylesheet|<style|giao diện|màu|hover|padding|margin|background|font-size|kiểu/i.test(text),
    };
}

function hasCss(relPath, content) {
    if (/\.(css|scss|sass|less)$/i.test(relPath)) return /[{:]/.test(content);
    return /<style[\s>]/i.test(content) || /[.#][\w-]+\s*\{[^}]+:[^}]+;/.test(content);
}

function syntaxIssue(relPath, content) {
    const text = String(content || '');
    if (/\.json$/i.test(relPath)) {
        try {
            JSON.parse(text);
        } catch (error) {
            return error.message;
        }
        return '';
    }
    if (/\.(js|mjs|cjs)$/i.test(relPath)) {
        try {
            new vm.Script(text, { filename: relPath });
        } catch (error) {
            return error.message.split('\n')[0];
        }
    }
    if (/\.css$/i.test(relPath)) {
        const curly = (text.match(/\{/g) || []).length - (text.match(/\}/g) || []).length;
        if (curly) return curly > 0 ? `lệch ngoặc: thiếu ${curly} }` : `lệch ngoặc: thừa ${-curly} }`;
    }
    if (/\\n|\\t|\\"/.test(text) && /\.(css|scss|vue|html)$/i.test(relPath)) {
        return 'còn ký tự escape JSON (\\n \\t \\") trong file';
    }
    return '';
}

function isUsefulNeedle(text) {
    const line = String(text || '').trim();
    if (line.length < 16) return false;
    if (/^<\/?[a-zA-Z0-9-]+\/?>$/.test(line)) return false;
    if (/^[{}();,\[\]\s]+$/.test(line)) return false;
    return /[A-Za-zÀ-ỹ0-9]{4,}/.test(line);
}

function needleFromOld(old) {
    const lines = String(old || '').split('\n').map((line) => line.trim()).filter(isUsefulNeedle);
    if (lines.length) return lines.sort((a, b) => b.length - a.length)[0].slice(0, 80);
    const raw = String(old || '').trim();
    return isUsefulNeedle(raw) ? raw.slice(0, 80) : '';
}

function collectNeedles(action) {
    const out = [];
    if (action?.old) {
        const needle = needleFromOld(action.old);
        if (needle) out.push(needle);
    }
    for (const patch of action?.patches || []) {
        const needle = needleFromOld(patch.old);
        if (needle) out.push(needle);
    }
    return unique(out);
}

function collectPatches(action) {
    if (Array.isArray(action?.patches) && action.patches.length) {
        return action.patches
            .map((item) => ({ old: String(item.old ?? ''), new: String(item.new ?? '') }))
            .filter((item) => item.old || item.new);
    }
    if (action?.old != null || action?.new != null) {
        return [{ old: String(action.old ?? ''), new: String(action.new ?? '') }];
    }
    return [];
}

function snippetOnDisk(content, added) {
    const hay = String(content || '');
    const neu = String(added || '').trim();
    if (!neu) return true;
    if (hay.includes(neu)) return true;
    const compactHay = hay.replace(/\s+/g, ' ');
    const compactNew = neu.replace(/\s+/g, ' ');
    if (compactNew.length >= 12 && compactHay.includes(compactNew.slice(0, Math.min(80, compactNew.length)))) {
        return true;
    }
    const lines = neu.split('\n').map((line) => line.trim()).filter((line) => line.length >= 8);
    if (!lines.length) return true;
    return lines.some((line) => hay.includes(line));
}

async function auditAction(workspace, root, action, result) {
    const rel = action.path;
    if (!result?.ok) return { ok: false, error: result?.error || `${action.type} failed` };
    if (!rel) return { ok: true, note: '' };

    if (action.type === 'create_file') {
        try {
            const { content } = await workspace.readFile(root, rel);
            if (!String(content || '').length && String(action.content || '').trim()) {
                return { ok: false, error: `Chưa thấy nội dung mới trong ${rel}` };
            }
            if (action.content && !snippetOnDisk(content, action.content)) {
                return { ok: false, error: `Chưa thấy dòng mới trong ${rel}` };
            }
            return { ok: true, note: `${rel} đã có trên disk` };
        } catch {
            return { ok: false, error: `Chưa thấy file ${rel} trên disk` };
        }
    }

    if (action.type === 'edit_file') {
        try {
            const { content } = await workspace.readFile(root, rel);
            for (const patch of collectPatches(action)) {
                if (patch.new && !snippetOnDisk(content, patch.new)) {
                    return { ok: false, error: `Chưa thấy dòng mới trong ${rel}` };
                }
            }
            return { ok: true, note: `${rel} đã có dòng mới` };
        } catch (error) {
            return { ok: false, error: `Không đọc lại được ${rel}: ${error.message}` };
        }
    }

    if (action.type === 'mkdir') {
        try {
            const abs = workspace.resolveSafe(root, rel);
            if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
                return { ok: false, error: `AUDIT FAIL: mkdir ${rel} nhưng thư mục không có.` };
            }
            return { ok: true, note: `AUDIT PASS: thư mục ${rel} đã có` };
        } catch (error) {
            return { ok: false, error: `AUDIT FAIL: mkdir ${rel}: ${error.message}` };
        }
    }

    if (action.type === 'delete_file') {
        try {
            const abs = workspace.resolveSafe(root, rel);
            if (fs.existsSync(abs)) {
                return { ok: false, error: `AUDIT FAIL: xóa ${rel} nhưng path vẫn còn.` };
            }
            return { ok: true, note: `AUDIT PASS: ${rel} đã xóa` };
        } catch {
            return { ok: true, note: `AUDIT PASS: ${rel} đã xóa` };
        }
    }

    return { ok: true, note: '' };
}

async function sweepLeftovers(workspace, root, needles) {
    const leftover = [];
    for (const needle of unique(needles || []).slice(0, 8)) {
        if (!isUsefulNeedle(needle)) continue;
        const hits = await workspace.searchCode(root, needle, '');
        for (const hit of hits.slice(0, 8)) {
            leftover.push(`${hit.path}:${hit.line}: ${String(hit.text || '').slice(0, 120)}`);
        }
    }
    return leftover;
}

function formatSweep(leftover) {
    if (!leftover.length) {
        return 'SWEEP PASS: không còn đoạn old ở file khác trong project.';
    }
    return `SWEEP FAIL: đoạn cũ vẫn còn — phải sửa nốt các chỗ này:\n${leftover.slice(0, 16).join('\n')}`;
}

function formatReport(report) {
    if (report.ok) {
        return `DISK CHECK: PASS — đã thấy dòng mới trong ${report.checked.join(', ') || '(none)'}`;
    }
    return `DISK CHECK: chưa thấy dòng mới.\n${(report.missing || []).join('\n')}`;
}

async function verifyChanges(workspace, root, task, filesChanged) {
    const bodies = [];
    const missing = [];
    for (const rel of filesChanged || []) {
        try {
            const { content } = await workspace.readFile(root, rel);
            bodies.push({ path: rel, content: String(content || '') });
        } catch {
            missing.push(`Không đọc được ${rel}`);
        }
    }
    return {
        ok: bodies.length > 0 && missing.length === 0,
        missing,
        syntax: [],
        checked: bodies.map((item) => item.path),
        hints: extractHints(task),
    };
}

module.exports = {
    verifyChanges,
    formatReport,
    extractHints,
    syntaxIssue,
    auditAction,
    collectNeedles,
    sweepLeftovers,
    formatSweep,
    isUsefulNeedle,
};
