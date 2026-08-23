const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const cacheDir = path.join(root, '.electron-cache');
fs.mkdirSync(cacheDir, { recursive: true });

const electronPkg = path.join(root, 'node_modules', 'electron', 'package.json');
if (!fs.existsSync(electronPkg)) {
    process.exit(0);
}

const electronDist = path.join(root, 'node_modules', 'electron', 'dist');
const appPath = path.join(electronDist, 'Electron.app');
const binary = process.platform === 'win32'
    ? path.join(electronDist, 'electron.exe')
    : path.join(appPath, 'Contents', 'MacOS', 'Electron');

function unquarantineMac() {
    if (process.platform !== 'darwin' || !fs.existsSync(appPath)) return;
    spawnSync('xattr', ['-cr', appPath], { stdio: 'ignore' });
}

if (!fs.existsSync(binary)) {
    const installScript = path.join(root, 'node_modules', 'electron', 'install.js');
    if (!fs.existsSync(installScript)) {
        process.exit(0);
    }

    const result = spawnSync(process.execPath, [installScript], {
        cwd: root,
        stdio: 'inherit',
        env: {
            ...process.env,
            electron_config_cache: cacheDir,
        },
    });

    if ((result.status ?? 1) !== 0) {
        process.exit(result.status ?? 1);
    }
}

unquarantineMac();

const ptyDir = path.join(root, 'node_modules', 'node-pty');
if (fs.existsSync(ptyDir)) {
    spawnSync('npx', ['electron-rebuild', '-f', '-w', 'node-pty'], {
        cwd: root,
        stdio: 'ignore',
        env: {
            ...process.env,
            electron_config_cache: cacheDir,
        },
    });
}

process.exit(0);
