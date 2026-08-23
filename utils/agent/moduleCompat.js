function usesCommonJs(content) {
    const text = String(content || '');
    const cjs = /\brequire\s*\(|\bmodule\.exports\b|\bexports\.\w+\s*=/.test(text);
    const esm = /^\s*import\s/m.test(text)
        || /\bexport\s+(default|async|function|const|class|\{)/.test(text);
    return cjs && !esm;
}

async function readPkg(workspace, root) {
    try {
        const { content } = await workspace.readFile(root, 'package.json');
        return JSON.parse(content);
    } catch {
        return null;
    }
}

function toCjsPath(relPath) {
    return String(relPath || '').replace(/\.js$/i, '.cjs');
}

function sameEntry(value, relPath) {
    const left = String(value || '').replace(/^\.\//, '');
    const right = String(relPath || '').replace(/^\.\//, '');
    return left === right;
}

async function resolveWritePath(workspace, root, relPath, content) {
    const notes = [];
    if (!/\.js$/i.test(relPath) || !usesCommonJs(content)) {
        return { path: relPath, notes };
    }
    const pkg = await readPkg(workspace, root);
    if (!pkg || pkg.type !== 'module') return { path: relPath, notes };
    const next = toCjsPath(relPath);
    notes.push(`${relPath} dùng require() trong project "type":"module" → ghi ${next}`);
    return { path: next, from: relPath, notes };
}

async function retargetPackageEntry(workspace, root, fromRel, toRel) {
    const pkg = await readPkg(workspace, root);
    if (!pkg) return '';
    let changed = false;
    const next = String(toRel).startsWith('./') ? toRel : `./${toRel}`;
    if (sameEntry(pkg.main, fromRel)) {
        pkg.main = next;
        changed = true;
    }
    if (typeof pkg.exports === 'string' && sameEntry(pkg.exports, fromRel)) {
        pkg.exports = next;
        changed = true;
    }
    if (!changed) return '';
    await workspace.writeFile(root, 'package.json', `${JSON.stringify(pkg, null, 2)}\n`);
    return `package.json main → ${next}`;
}

function alignPackageJsonText(content, existingCjsPaths = []) {
    let pkg;
    try {
        pkg = JSON.parse(content);
    } catch {
        return content;
    }
    if (pkg.type !== 'module' || !pkg.main) return content;
    const main = String(pkg.main).replace(/^\.\//, '');
    if (!/\.js$/i.test(main)) return content;
    const cjs = toCjsPath(main);
    if (!existingCjsPaths.includes(cjs) && !existingCjsPaths.includes(`./${cjs}`)) return content;
    pkg.main = `./${cjs}`;
    return `${JSON.stringify(pkg, null, 2)}\n`;
}

module.exports = {
    usesCommonJs,
    resolveWritePath,
    retargetPackageEntry,
    alignPackageJsonText,
    toCjsPath,
};
