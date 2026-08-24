const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
    isMac,
    isLinux,
    electronDistBinary,
    electronCacheDir,
} = require('../utils/runtimePlatform');

const root = path.join(__dirname, '..');
const cacheDir = electronCacheDir(root);
const electronEnv = {
    ...process.env,
    electron_config_cache: cacheDir,
};

const electronPkg = path.join(root, 'node_modules', 'electron', 'package.json');
if (!fs.existsSync(electronPkg)) {
    process.exit(0);
}

const electronDir = path.join(root, 'node_modules', 'electron');
const electronDist = path.join(electronDir, 'dist');
const appPath = path.join(electronDist, 'Electron.app');
const binary = electronDistBinary(electronDist);
const installScript = path.join(electronDir, 'install.js');

function rmDist() {
    try {
        fs.rmSync(electronDist, { recursive: true, force: true });
    } catch {
        /* ignore */
    }
}

function unquarantineMac() {
    if (!isMac || !fs.existsSync(appPath)) return;
    spawnSync('xattr', ['-cr', appPath], { stdio: 'ignore', timeout: 15000 });
}

function ensureExecutable() {
    if (isLinux && fs.existsSync(binary)) {
        try { fs.chmodSync(binary, 0o755); } catch { /* ignore */ }
    }
}

function runElectronInstall() {
    if (!fs.existsSync(installScript)) return 0;
    const result = spawnSync(process.execPath, [installScript], {
        cwd: root,
        stdio: 'inherit',
        env: electronEnv,
    });
    return result.status ?? 1;
}

if (!fs.existsSync(binary)) {
    rmDist();
    let status = runElectronInstall();
    if (status !== 0 || !fs.existsSync(binary)) {
        rmDist();
        status = runElectronInstall();
    }
    if (status !== 0) {
        process.exit(status);
    }
}

unquarantineMac();
ensureExecutable();

const ptyDir = path.join(root, 'node_modules', 'node-pty');
if (fs.existsSync(ptyDir)) {
    const { rebuildPty, chmodSpawnHelpers } = require('./rebuild-pty');
    chmodSpawnHelpers(ptyDir);
    let electronVersion = '';
    try {
        electronVersion = require(electronPkg).version;
    } catch {
        electronVersion = '';
    }
    const rebuilt = rebuildPty({
        root,
        electronDir,
        electronVersion,
        electronBinary: binary,
    });
    chmodSpawnHelpers(ptyDir);
    if (!rebuilt.ok) {
        console.warn('[nowk] Terminal PTY rebuild failed:', rebuilt.error);
        console.warn('[nowk] On macOS install Xcode CLT: xcode-select --install');
    }
}

process.exit(0);
