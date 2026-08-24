const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { isWin, killProcessTree } = require('../utils/runtimePlatform');

const LOCK_FILES = ['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'DevToolsActivePort'];

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function pathNeedles(profilePath) {
    const abs = path.resolve(profilePath);
    return [...new Set([
        abs,
        abs.replace(/\\/g, '/'),
        abs.replace(/\//g, '\\'),
    ])].filter(Boolean);
}

function parseUnixPs(stdout, needles) {
    const pids = [];
    for (const line of String(stdout || '').split('\n')) {
        const text = line.trim();
        if (!text) continue;
        if (!needles.some((needle) => text.includes(needle))) continue;
        const pid = Number(text.split(/\s+/)[0]);
        if (pid && pid !== process.pid) pids.push(pid);
    }
    return pids;
}

function parseWindowsList(stdout, needles) {
    const pids = [];
    const blocks = String(stdout || '').split(/\r?\n\r?\n/);
    for (const block of blocks) {
        const cmd = (block.match(/CommandLine=(.*)/i) || [])[1] || '';
        const pid = Number((block.match(/ProcessId=(\d+)/i) || [])[1] || 0);
        if (!pid || !needles.some((needle) => cmd.includes(needle))) continue;
        pids.push(pid);
    }
    return pids;
}

function pidsForProfileDir(profilePath) {
    const needles = pathNeedles(profilePath);
    if (!needles.length) return [];
    try {
        if (isWin) {
            const result = spawnSync('wmic', [
                'process', 'get', 'ProcessId,CommandLine', '/FORMAT:LIST',
            ], {
                encoding: 'utf8',
                windowsHide: true,
                timeout: 10000,
            });
            return [...new Set(parseWindowsList(result.stdout, needles))];
        }
        const result = spawnSync('ps', ['axww', '-o', 'pid=,command='], {
            encoding: 'utf8',
            timeout: 8000,
        });
        return [...new Set(parseUnixPs(result.stdout, needles))];
    } catch {
        return [];
    }
}

function clearProfileLocks(profilePath) {
    for (const name of LOCK_FILES) {
        try { fs.unlinkSync(path.join(profilePath, name)); } catch { /* ignore */ }
    }
}

function killProfileChrome(profilePath, extraPid) {
    const pids = pidsForProfileDir(profilePath);
    if (extraPid) pids.push(Number(extraPid));
    for (const pid of [...new Set(pids.filter(Boolean))]) {
        killProcessTree(pid, 'SIGKILL');
    }
    clearProfileLocks(profilePath);
    return pids;
}

module.exports = {
    pidsForProfileDir,
    killProfileChrome,
    clearProfileLocks,
    sleep,
};
