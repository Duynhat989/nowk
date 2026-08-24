const { entityQueries } = require('./retriever/Retriever');

function unique(list) {
    const out = [];
    for (const item of list || []) {
        if (item && !out.includes(item)) out.push(item);
    }
    return out;
}

function looksStateLine(text, query) {
    const line = String(text || '');
    const raw = String(query || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!raw) return false;
    if (/import\s+|from\s+['"]/.test(line)) return false;
    const name = new RegExp(
        `(?:const|let|var)\\s+${raw}\\s*=\\s*(?:ref|reactive|useState)\\b|${raw}\\s*=\\s*ref\\s*\\(|defineStore\\s*\\(\\s*['"][^'"]*${raw}`,
        'i',
    );
    return name.test(line);
}

async function checkWiring(workspace, root, task, filesChanged = []) {
    const queries = entityQueries(task)
        .filter((item) => /^[A-Za-zÀ-ỹ]{3,}$/.test(item))
        .filter((item) => !/^(modal|popup|dialog|TableList)$/i.test(item));
    if (!queries.length || !(filesChanged || []).length) {
        return { ok: true, notes: [] };
    }
    const notes = [];
    for (const query of queries.slice(0, 5)) {
        let hits = [];
        try {
            hits = await workspace.searchCode(root, query, '');
        } catch {
            continue;
        }
        const decls = hits.filter((hit) => looksStateLine(hit.text, query));
        const files = unique(decls.map((hit) => hit.path));
        if (files.length >= 2) {
            notes.push(
                `WIRING FAIL: "${query}" đang có state riêng ở ${files.slice(0, 6).join(', ')}. `
                + 'Phải dùng CHUNG một nguồn (ref/store ở parent). Popup/list/order không được mỗi nơi một mảng.',
            );
        }
    }
    return { ok: notes.length === 0, notes };
}

function formatWiring(report) {
    if (!report?.notes?.length) {
        return 'WIRING: các màn hình liên quan dùng chung dữ liệu.';
    }
    return report.notes.join('\n');
}

module.exports = { checkWiring, formatWiring };
