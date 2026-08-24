const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function ptyRoot() {
    try {
        return path.join(path.dirname(require.resolve('node-pty')), '..');
    } catch {
        return '';
    }
}

function chmodSpawnHelpers(root) {
    const dir = root || ptyRoot();
    if (!dir || !fs.existsSync(dir)) return { ok: false, files: [] };
    const files = [];
    const walk = (folder) => {
        let names = [];
        try { names = fs.readdirSync(folder, { withFileTypes: true }); } catch { return; }
        for (const entry of names) {
            const full = path.join(folder, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name === 'spawn-helper') files.push(full);
        }
    };
    walk(dir);
    const result = { ok: true, files: [] };
    for (const file of files) {
        try {
            fs.chmodSync(file, 0o755);
            if (process.platform === 'darwin') {
                spawnSync('xattr', ['-cr', file], { stdio: 'ignore', timeout: 4000 });
            }
            const mode = fs.statSync(file).mode & 0o111;
            result.files.push({ file, executable: Boolean(mode) });
            if (!mode) result.ok = false;
        } catch (err) {
            result.ok = false;
            result.files.push({ file, error: err.message });
        }
    }
    return result;
}

function loadPty() {
    const chmod = chmodSpawnHelpers();
    if (!chmod.ok) {
        console.warn('[nowk] spawn-helper is not executable', chmod.files);
    }
    try {
        return require('node-pty');
    } catch (err) {
        console.warn('[nowk] node-pty load failed:', err.message);
        return null;
    }
}

function rebuildPty({ root, electronDir, electronVersion, electronBinary }) {
    const rebuildCli = path.join(root, 'node_modules', '@electron', 'rebuild', 'lib', 'cli.js');
    if (!fs.existsSync(rebuildCli)) {
        return { ok: false, error: 'Missing @electron/rebuild' };
    }

    const args = [
        rebuildCli,
        '-f',
        '-o', 'node-pty',
        '-e', electronDir,
        '-m', path.join(root, 'node_modules'),
    ];
    if (electronVersion) args.push('-v', String(electronVersion));

    const result = spawnSync(process.execPath, args, {
        cwd: root,
        stdio: 'inherit',
        env: process.env,
        timeout: 300000,
    });
    if ((result.status ?? 1) !== 0) {
        return { ok: false, error: `electron-rebuild failed (${result.status})` };
    }

    chmodSpawnHelpers(path.join(root, 'node_modules', 'node-pty'));

    if (electronBinary && fs.existsSync(electronBinary)) {
        const check = spawnSync(electronBinary, ['-e', "require('node-pty')"], {
            cwd: root,
            env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
            encoding: 'utf8',
            timeout: 20000,
        });
        if ((check.status ?? 1) !== 0) {
            return {
                ok: false,
                error: (check.stderr || check.stdout || 'node-pty did not load in Electron').trim(),
            };
        }
    }

    return { ok: true };
}

module.exports = { loadPty, rebuildPty, chmodSpawnHelpers, ptyRoot };
