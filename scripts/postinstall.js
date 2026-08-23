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

const electronDist = path.join(root, 'node_modules', 'electron', 'dist');
const appPath = path.join(electronDist, 'Electron.app');
const binary = electronDistBinary(electronDist);

function unquarantineMac() {
    if (!isMac || !fs.existsSync(appPath)) return;
    spawnSync('xattr', ['-cr', appPath], { stdio: 'ignore', timeout: 15000 });
}

function ensureExecutable() {
    if (isLinux && fs.existsSync(binary)) {
        try { fs.chmodSync(binary, 0o755); } catch { /* ignore */ }
    }
}

if (!fs.existsSync(binary)) {
    const installScript = path.join(root, 'node_modules', 'electron', 'install.js');
    if (!fs.existsSync(installScript)) {
        process.exit(0);
    }

    const result = spawnSync(process.execPath, [installScript], {
        cwd: root,
        stdio: 'inherit',
        env: electronEnv,
    });

    if ((result.status ?? 1) !== 0) {
        process.exit(result.status ?? 1);
    }
}

unquarantineMac();
ensureExecutable();

const ptyDir = path.join(root, 'node_modules', 'node-pty');
if (fs.existsSync(ptyDir)) {
    let rebuildCli = '';
    try {
        rebuildCli = require.resolve('@electron/rebuild/lib/cli.js');
    } catch {
        rebuildCli = '';
    }

    if (rebuildCli) {
        let electronVersion = '';
        try {
            electronVersion = require(electronPkg).version;
        } catch {
            electronVersion = '';
        }

        const args = [rebuildCli, '-f', '-w', 'node-pty'];
        if (electronVersion) args.push('-v', electronVersion);

        spawnSync(process.execPath, args, {
            cwd: root,
            stdio: 'ignore',
            env: electronEnv,
            timeout: 180000,
        });
    }
}

process.exit(0);
