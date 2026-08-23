const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const isLinux = process.platform === 'linux';

function firstExisting(candidates) {
    for (const candidate of candidates) {
        if (candidate && fs.existsSync(candidate)) return candidate;
    }
    return '';
}

function which(cmd) {
    if (!cmd) return '';
    const result = spawnSync(isWin ? 'where' : 'which', [cmd], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 4000,
    });
    if ((result.status ?? 1) !== 0) return '';
    const line = String(result.stdout || '')
        .split(/\r?\n/)
        .map((item) => item.trim())
        .find((item) => item && fs.existsSync(item));
    return line || '';
}

function defaultShell() {
    if (isWin) {
        return firstExisting([
            process.env.ComSpec,
            path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe'),
        ]) || 'cmd.exe';
    }
    return firstExisting([
        process.env.SHELL,
        '/bin/zsh',
        '/usr/bin/zsh',
        '/bin/bash',
        '/usr/bin/bash',
        '/bin/sh',
        '/usr/bin/sh',
    ]) || '/bin/sh';
}

function interactiveShellArgs() {
    if (isWin) return [];
    return isMac ? ['-il'] : ['-i'];
}

function shellRunArgs(command) {
    if (isWin) return ['/d', '/s', '/c', command];
    return ['-lc', command];
}

function electronDistBinary(electronDist) {
    if (isWin) return path.join(electronDist, 'electron.exe');
    if (isMac) return path.join(electronDist, 'Electron.app', 'Contents', 'MacOS', 'Electron');
    return path.join(electronDist, 'electron');
}

function electronCacheDir(root) {
    const local = path.join(root, '.electron-cache');
    try {
        fs.mkdirSync(local, { recursive: true });
        fs.accessSync(local, fs.constants.W_OK);
        return local;
    } catch {
        // use OS cache
    }
    const fallback = isWin
        ? path.join(process.env.LOCALAPPDATA || os.homedir(), 'electron', 'Cache')
        : isMac
            ? path.join(os.homedir(), 'Library', 'Caches', 'electron')
            : path.join(os.homedir(), '.cache', 'electron');
    fs.mkdirSync(fallback, { recursive: true });
    return fallback;
}

function quoteForShell(value) {
    const text = String(value || '');
    if (isWin) return `"${text.replace(/"/g, '""')}"`;
    const unix = text.replace(/\\/g, '/');
    if (!/[^\w./@%+=:,-]/i.test(unix)) return unix;
    return `'${unix.replace(/'/g, `'\\''`)}'`;
}

function pythonCommand(root) {
    const venv = isWin
        ? path.join(root, '.venv', 'Scripts', 'python.exe')
        : path.join(root, '.venv', 'bin', 'python');
    if (fs.existsSync(venv)) return quoteForShell(venv);
    if (isWin) {
        if (which('python')) return 'python';
        if (which('py')) return 'py -3';
        return 'python';
    }
    return which('python3') ? 'python3' : 'python';
}

function killProcessTree(pid, signal = 'SIGTERM') {
    if (!pid) return;
    if (isWin) {
        spawnSync('taskkill', ['/pid', String(pid), '/t', '/f'], {
            windowsHide: true,
            stdio: 'ignore',
            timeout: 8000,
        });
        return;
    }
    try { process.kill(-pid, signal); } catch { /* ignore */ }
    try { process.kill(pid, signal); } catch { /* ignore */ }
}

function resolvePickedChrome(selected) {
    const picked = String(selected || '').trim();
    if (!picked) return '';
    if (isMac && picked.endsWith('.app')) {
        const inner = path.join(picked, 'Contents', 'MacOS');
        try {
            const names = fs.readdirSync(inner);
            const chrome = names.find((name) => /chrome/i.test(name)) || names[0];
            if (chrome) return path.join(inner, chrome);
        } catch {
            return picked;
        }
    }
    return picked;
}

module.exports = {
    isWin,
    isMac,
    isLinux,
    firstExisting,
    which,
    defaultShell,
    interactiveShellArgs,
    shellRunArgs,
    electronDistBinary,
    electronCacheDir,
    quoteForShell,
    pythonCommand,
    killProcessTree,
    resolvePickedChrome,
};
