const fs = require('fs');
const path = require('path');
const { chmodSpawnHelpers, loadPty, ptyRoot } = require('./rebuild-pty');

const dir = ptyRoot();

function spawnOnce(pty) {
    const proc = pty.spawn('/bin/zsh', ['-i'], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: process.env.HOME || '/tmp',
        env: {
            HOME: process.env.HOME || '/tmp',
            USER: process.env.USER || 'user',
            PATH: '/usr/bin:/bin',
            TERM: 'xterm-256color',
            SHELL: '/bin/zsh',
            SHELL_SESSIONS_DISABLE: '1',
            TERM_PROGRAM: 'NowK',
        },
    });
    try { proc.kill(); } catch { /* ignore */ }
    return proc.pid;
}

function walkHelpers() {
    const files = [];
    const walk = (folder) => {
        for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
            const full = path.join(folder, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name === 'spawn-helper') files.push(full);
        }
    };
    walk(dir);
    return files;
}

async function main() {
    if (process.platform !== 'darwin') {
        console.log('skip: not macOS');
        return;
    }
    const helpers = walkHelpers();
    if (!helpers.length) throw new Error('no spawn-helper found');

    for (const file of helpers) fs.chmodSync(file, 0o644);
    delete require.cache[require.resolve('node-pty')];
    let failed = false;
    try {
        const pty = require('node-pty');
        spawnOnce(pty);
        console.log('WARN: spawn succeeded with 644 helpers (using a helper that is still executable?)');
    } catch (err) {
        failed = /posix_spawn/i.test(err.message);
        console.log('expected fail with 644:', err.message, 'match', failed);
    }

    const chmod = chmodSpawnHelpers(dir);
    console.log('chmod result', chmod);
    for (const file of helpers) {
        const exec = Boolean(fs.statSync(file).mode & 0o111);
        if (!exec) throw new Error(`still not executable: ${file}`);
    }

    delete require.cache[require.resolve('node-pty')];
    const pty = loadPty();
    if (!pty) throw new Error('loadPty failed');
    const pid = spawnOnce(pty);
    if (!pid) throw new Error('spawn pid missing');
    console.log('PASS spawn after chmod pid', pid);

    if (!failed) {
        console.log('NOTE: could not reproduce posix_spawnp with 644 on this machine path');
    }
}

main().catch((err) => {
    console.error('FAIL', err);
    process.exit(1);
});
