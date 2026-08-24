function splitLines(text) {
    return String(text ?? '').replace(/\r\n/g, '\n').split('\n');
}

function fileRemovedLines(content, limit = 80) {
    const lines = splitLines(content).map((text) => ({ type: 'del', text }));
    if (lines.length <= limit) return lines;
    return [...lines.slice(0, limit), { type: 'ctx', text: `… ${lines.length - limit} dòng nữa` }];
}

function toDiffLines(oldText, newText, limit = 80) {
    const oldStr = String(oldText ?? '');
    const newStr = String(newText ?? '');
    if (!oldStr && newStr) return fileAddedLines(newStr, limit);
    if (oldStr && !newStr) return fileRemovedLines(oldStr, limit);
    const oldLines = splitLines(oldStr);
    const newLines = splitLines(newStr);
    let start = 0;
    while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) {
        start += 1;
    }
    let endOld = oldLines.length - 1;
    let endNew = newLines.length - 1;
    while (endOld >= start && endNew >= start && oldLines[endOld] === newLines[endNew]) {
        endOld -= 1;
        endNew -= 1;
    }

    const lines = [];
    const ctxFrom = Math.max(0, start - 1);
    for (let i = ctxFrom; i < start; i += 1) {
        lines.push({ type: 'ctx', text: oldLines[i] });
    }
    for (let i = start; i <= endOld; i += 1) {
        lines.push({ type: 'del', text: oldLines[i] });
    }
    for (let i = start; i <= endNew; i += 1) {
        lines.push({ type: 'add', text: newLines[i] });
    }
    const ctxTo = Math.min(oldLines.length, endOld + 3);
    for (let i = endOld + 1; i < ctxTo; i += 1) {
        lines.push({ type: 'ctx', text: oldLines[i] });
    }

    if (lines.length <= limit) return lines;
    return [...lines.slice(0, limit), { type: 'ctx', text: `… ${lines.length - limit} dòng nữa` }];
}

function fileAddedLines(content, limit = 80) {
    const lines = splitLines(content).map((text) => ({ type: 'add', text }));
    if (lines.length <= limit) return lines;
    return [...lines.slice(0, limit), { type: 'ctx', text: `… ${lines.length - limit} dòng nữa` }];
}

module.exports = { toDiffLines, fileAddedLines, fileRemovedLines };
