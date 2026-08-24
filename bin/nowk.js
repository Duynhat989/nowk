#!/usr/bin/env node
'use strict';

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { isLinux, isWin, electronDistBinary } = require('../utils/runtimePlatform');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));

function electronBinary() {
    try {
        const resolved = require('electron');
        if (typeof resolved === 'string' && fs.existsSync(resolved)) {
            return resolved;
        }
    } catch {
        // fall through
    }

    const fallback = electronDistBinary(path.join(root, 'node_modules', 'electron', 'dist'));
    if (fs.existsSync(fallback)) return fallback;
    throw new Error('Không tìm thấy Electron. Chạy lại: npm i -g nowk-ide');
}

function ensureUi() {
    const indexHtml = path.join(root, 'dist-ui', 'index.html');
    if (fs.existsSync(indexHtml)) return true;

    const vite = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
    if (!fs.existsSync(vite)) {
        console.error('NowK chưa được build (thiếu dist-ui).');
        return false;
    }

    console.log('Đang build giao diện NowK...');
    const result = spawnSync(process.execPath, [vite, 'build'], {
        cwd: root,
        stdio: 'inherit',
        windowsHide: true,
    });
    return (result.status ?? 1) === 0 && fs.existsSync(indexHtml);
}

function launch(electronArgs) {
    if (!ensureUi()) process.exit(1);

    const extra = isLinux && !electronArgs.includes('--no-sandbox')
        ? ['--no-sandbox', ...electronArgs]
        : electronArgs;

    const child = spawn(electronBinary(), [root, ...extra], {
        stdio: 'inherit',
        cwd: process.cwd(),
        env: process.env,
        windowsHide: false,
        detached: false,
    });

    const forward = (signal) => {
        if (!child.killed) {
            try { child.kill(signal); } catch { /* ignore */ }
        }
    };

    if (!isWin) {
        process.on('SIGINT', () => forward('SIGINT'));
        process.on('SIGTERM', () => forward('SIGTERM'));
    }

    child.on('error', (error) => {
        console.error(error.message || error);
        process.exit(1);
    });

    child.on('exit', (code, signal) => {
        if (signal && !isWin) {
            try {
                process.kill(process.pid, signal);
                return;
            } catch {
                // fall through
            }
        }
        process.exit(code ?? 0);
    });
}

function printHelp() {
    console.log(`NowK ${pkg.version}

Usage:
  nowk start      Mở NowK
  nowk help       Hiện lệnh
  nowk version    Hiện phiên bản

Cài:
  npm i -g nowk-ide
  nowk start
`);
}

const argv = process.argv.slice(2);
const cmd = argv[0];

if (!cmd || cmd === 'start') {
    launch(cmd === 'start' ? argv.slice(1) : argv);
} else if (cmd === 'help' || cmd === '-h' || cmd === '--help') {
    printHelp();
} else if (cmd === 'version' || cmd === '-v' || cmd === '--version') {
    console.log(pkg.version);
} else {
    console.error(`Lệnh không hỗ trợ: ${cmd}\n`);
    printHelp();
    process.exit(1);
}
