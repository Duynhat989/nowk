const { app, BrowserWindow, Menu, ipcMain, dialog, shell, globalShortcut, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const ProfileStore = require('./utils/ProfileStore');
const SettingsStore = require('./utils/SettingsStore');
const ProfileLauncher = require('./utils/ProfileLauncher');
const ChromeResolver = require('./utils/ChromeResolver');
const WorkspaceService = require('./utils/WorkspaceService');
const WorkspaceWatcher = require('./utils/WorkspaceWatcher');
const AgentRunner = require('./utils/AgentRunner');
const TerminalService = require('./utils/TerminalService');
const NanoAuth = require('./utils/NanoAuth');
const { toPlain } = require('./utils/ipcPlain');
const { parseProxy } = require('./utils/parseProxy');
const { isWin, isMac, isLinux, resolvePickedChrome } = require('./utils/runtimePlatform');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const { listKinds, promptFor, scaffoldFiles } = require('./utils/projectTemplates');

const isDev = process.argv.includes('--dev');
process.env.TERM_PROGRAM = 'NowK';
process.env.SHELL_SESSIONS_DISABLE = '1';
delete process.env.TERM_SESSION_ID;
delete process.env.ITERM_SESSION_ID;
delete process.env.SHELL_SESSION_DID_RESTORE;
delete process.env.SSH_TTY;
const runningBrowsers = new Map();
const profileOwners = new Map();

let mainWindow;
let projectPath;
let profileStore;
let settingsStore;
let nanoAuth;
let chromeResolver;
let profileLauncher;
let workspaceService;
let workspaceWatcher;
let agentRunner;
let terminalService;
let currentProjectRoot = '';
const windowSessions = new Map();

function sessionFromEvent(event) {
    const win = BrowserWindow.fromWebContents(event?.sender);
    return win ? windowSessions.get(win.id) || null : null;
}

function focusedSession() {
    const win = BrowserWindow.getFocusedWindow()
        || (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null)
        || BrowserWindow.getAllWindows()[0];
    return win ? windowSessions.get(win.id) || null : null;
}

function syncSession(session) {
    if (!session) return session;
    mainWindow = session.window;
    terminalService = session.terminalService;
    agentRunner = session.agentRunner;
    workspaceWatcher = session.workspaceWatcher;
    currentProjectRoot = session.projectRoot;
    return session;
}

function attachProject(root, session = focusedSession()) {
    currentProjectRoot = root;
    if (!session) return;
    session.projectRoot = root;
    session.agentRunner?.setProjectRoot(root);
    session.workspaceWatcher?.start(root);
    syncSession(session);
    try { session.window.setTitle(`${path.basename(root)} — NowK`); } catch { /* ignore */ }
}

function focusIdeWindow(win = mainWindow) {
    const target = win && !win.isDestroyed() ? win : focusedSession()?.window;
    if (!target || target.isDestroyed()) return;
    if (target.isMinimized()) target.restore();
    target.show();
    target.focus();
}

function sendToRenderer(channel, data) {
    for (const session of windowSessions.values()) {
        if (session.window && !session.window.isDestroyed()) {
            session.window.webContents.send(channel, data);
        }
    }
}

async function rememberRecent(root) {
    if (!settingsStore || !root) return;
    const settings = await settingsStore.load();
    const recents = (settings.recentProjects || []).filter((item) => item.path !== root);
    recents.unshift({ path: root, name: path.basename(root), lastOpened: Date.now() });
    await settingsStore.update({
        lastProjectPath: root,
        recentProjects: recents.slice(0, 24),
    });
}

async function listRecents() {
    const settings = await settingsStore.load();
    return (settings.recentProjects || []).map((item) => ({
        ...item,
        missing: !fs.existsSync(item.path),
    }));
}

function toggleDevTools() {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    try {
        mainWindow.webContents.toggleDevTools();
        return mainWindow.webContents.isDevToolsOpened();
    } catch (err) {
        console.error('[DevTools]', err.message);
        return false;
    }
}

function registerDevToolsShortcuts() {
    const toggle = () => toggleDevTools();
    for (const accelerator of ['F12', isMac ? 'Command+Alt+I' : 'Control+Shift+I']) {
        try {
            if (!globalShortcut.register(accelerator, toggle)) {
                console.warn('[DevTools] shortcut not registered:', accelerator);
            }
        } catch (err) {
            console.warn('[DevTools] shortcut error:', accelerator, err.message);
        }
    }
}

function registerDevToolsInput(mainWindowRef) {
    mainWindowRef.webContents.on('before-input-event', (event, input) => {
        if (input.type !== 'keyDown') return;
        const isF12 = input.key === 'F12';
        const isMacShortcut = isMac
            && input.meta && input.alt && input.key.toLowerCase() === 'i';
        const isWinLinuxShortcut = !isMac
            && input.control && input.shift && input.key.toLowerCase() === 'i';
        if (!isF12 && !isMacShortcut && !isWinLinuxShortcut) return;
        if (!mainWindowRef || mainWindowRef.isDestroyed()) return;
        mainWindowRef.webContents.toggleDevTools();
        event.preventDefault();
    });
}

function repairChromiumCache(userDataPath) {
    const cachePaths = [
        path.join(userDataPath, 'Cache'),
        path.join(userDataPath, 'Shared Dictionary'),
    ];

    for (const cacheDir of cachePaths) {
        if (!fs.existsSync(cacheDir)) continue;
        try {
            const cacheDataDir = path.join(cacheDir, 'Cache_Data');
            if (fs.existsSync(cacheDataDir)) {
                const entries = fs.readdirSync(cacheDataDir);
                const hasIndex = entries.some(name => name === 'index' || name.startsWith('index-dir'));
                if (!hasIndex) {
                    fs.rmSync(cacheDir, { recursive: true, force: true });
                }
            }
        } catch {
            try {
                fs.rmSync(cacheDir, { recursive: true, force: true });
            } catch { /* ignore */ }
        }
    }
}

function requireWorkspaceRoot(root) {
    const folder = String(root || '').trim();
    if (!folder || !fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
        throw new Error('Chưa mở thư mục dự án');
    }
    return folder;
}

function ensureAppServices() {
    if (settingsStore) return;
    projectPath = isDev ? app.getAppPath() : app.getPath('userData');
    repairChromiumCache(app.getPath('userData'));

    const configDir = path.join(projectPath, 'config');
    const dataDir = path.join(configDir, 'data');
    profileStore = new ProfileStore(dataDir);
    settingsStore = new SettingsStore(configDir);
    nanoAuth = new NanoAuth(configDir);
    chromeResolver = new ChromeResolver();
    workspaceService = new WorkspaceService({
        onChange: (data) => {
            for (const session of windowSessions.values()) {
                if (session.projectRoot && data.root === session.projectRoot) {
                    session.workspaceWatcher?.notify(data.root, data.action, data.path);
                }
            }
        },
    });
    profileLauncher = new ProfileLauncher({
        profileStore,
        settingsStore,
        chromeResolver,
        projectPath,
        runningBrowsers,
        profileOwners,
        onStatus: sendToRenderer,
    });
}

function bindWindowSession(win) {
    const session = {
        window: win,
        projectRoot: '',
        workspaceWatcher: new WorkspaceWatcher({
            onChange: (data) => {
                if (!win.isDestroyed()) win.webContents.send('workspace-changed', data);
            },
        }),
        terminalService: new TerminalService({
            onEvent: (data) => {
                if (!win.isDestroyed()) win.webContents.send('terminal-event', data);
            },
        }),
    };
    session.agentRunner = new AgentRunner({
        runningBrowsers,
        workspaceService,
        terminalService: session.terminalService,
        onProgress: (data) => {
            if (!win.isDestroyed()) win.webContents.send('agent-progress', data);
        },
    });
    settingsStore.load().then((settings) => {
        session.agentRunner?.setProvider(settings.agentProvider);
    }).catch(() => {});
    windowSessions.set(win.id, session);
    win.on('closed', () => {
        session.agentRunner?.abort();
        session.terminalService?.kill('all');
        session.workspaceWatcher?.stop();
        windowSessions.delete(win.id);
        if (mainWindow === win) mainWindow = BrowserWindow.getAllWindows()[0] || null;
    });
    win.on('focus', () => syncSession(session));
    syncSession(session);
    return session;
}

function appIconImage() {
    const png = path.join(__dirname, 'build', 'icon.png');
    const image = nativeImage.createFromPath(png);
    return image.isEmpty() ? null : image;
}

function applyAppIcon(win) {
    const image = appIconImage();
    if (!image) return;
    try { win?.setIcon(image); } catch { /* ignore */ }
    if (isMac && app.dock) {
        try { app.dock.setIcon(image); } catch { /* ignore */ }
    }
}

function createWindow() {
    ensureAppServices();
    const win = new BrowserWindow({
        width: 1440,
        height: 860,
        minWidth: 960,
        minHeight: 600,
        backgroundColor: '#111113',
        title: 'NowK',
        icon: path.join(__dirname, 'build', 'icon.png'),
        titleBarStyle: isMac ? 'hiddenInset' : 'default',
        autoHideMenuBar: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            webviewTag: true,
            devTools: true,
        },
    });

    applyAppIcon(win);
    bindWindowSession(win);
    registerDevToolsInput(win);

    const rendererUrl = process.env.ELECTRON_RENDERER_URL;
    if (rendererUrl) {
        win.loadURL(rendererUrl);
    } else {
        win.loadFile(path.join(__dirname, 'dist-ui', 'index.html'));
    }
    return win;
}

function buildAppMenu() {
    const template = [
        ...(isMac ? [{
            label: app.name,
            submenu: [
                { role: 'about' },
                { type: 'separator' },
                { role: 'services' },
                { type: 'separator' },
                { role: 'hide' },
                { role: 'hideOthers' },
                { role: 'unhide' },
                { type: 'separator' },
                { role: 'quit' },
            ],
        }] : []),
        {
            label: 'File',
            submenu: [
                {
                    label: 'New Window',
                    accelerator: 'CmdOrCtrl+Shift+N',
                    click: () => createWindow(),
                },
                {
                    label: 'Open Folder…',
                    accelerator: 'CmdOrCtrl+O',
                    click: (_, win) => {
                        const target = win || focusedSession()?.window;
                        target?.webContents.send('workspace:pick-request');
                    },
                },
                { type: 'separator' },
                isMac ? { role: 'close' } : { role: 'quit' },
            ],
        },
        {
            label: 'Edit',
            submenu: [
                { role: 'undo' },
                { role: 'redo' },
                { type: 'separator' },
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' },
                { role: 'selectAll' },
                { type: 'separator' },
                {
                    label: 'Find',
                    accelerator: 'CmdOrCtrl+F',
                    click: (_, win) => (win || focusedSession()?.window)?.webContents.send('editor-command', 'find'),
                },
                {
                    label: 'Replace',
                    accelerator: isMac ? 'Alt+Cmd+F' : 'CmdOrCtrl+H',
                    click: (_, win) => (win || focusedSession()?.window)?.webContents.send('editor-command', 'replace'),
                },
                {
                    label: 'Find Next',
                    accelerator: 'CmdOrCtrl+G',
                    click: (_, win) => (win || focusedSession()?.window)?.webContents.send('editor-command', 'findNext'),
                },
                {
                    label: 'Find Previous',
                    accelerator: 'Shift+CmdOrCtrl+G',
                    click: (_, win) => (win || focusedSession()?.window)?.webContents.send('editor-command', 'findPrev'),
                },
            ],
        },
        { role: 'viewMenu' },
        { role: 'windowMenu' },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.setName('NowK');
if (isWin) app.setAppUserModelId('com.nowk.app');
try {
    app.setPath('userData', path.join(app.getPath('appData'), 'NowK'));
} catch {
    // keep Electron default
}

if (isLinux) {
    app.commandLine.appendSwitch('no-sandbox');
    app.commandLine.appendSwitch('disable-gpu-sandbox');
    if (!process.env.ELECTRON_OZONE_PLATFORM_HINT) {
        app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
    }
    if (process.env.NOWK_DISABLE_GPU === '1') {
        app.disableHardwareAcceleration();
    }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
} else {
    app.on('second-instance', (_event, argv) => {
        const deep = (argv || []).find((arg) => String(arg).startsWith('nowk://'));
        if (deep && nanoAuth) nanoAuth.applyDeepLink(deep);
        const win = focusedSession()?.window || BrowserWindow.getAllWindows()[0];
        if (win && !win.isDestroyed()) {
            if (win.isMinimized()) win.restore();
            win.show();
            win.focus();
            return;
        }
        if (app.isReady()) createWindow();
    });

    app.on('open-url', (event, url) => {
        event.preventDefault();
        if (nanoAuth) nanoAuth.applyDeepLink(url);
    });

    app.whenReady().then(async () => {
        ensureAppServices();
        try {
            if (process.defaultApp) {
                app.setAsDefaultProtocolClient('nowk', process.execPath, [path.resolve(process.argv[1])]);
            } else {
                app.setAsDefaultProtocolClient('nowk');
            }
        } catch { /* ignore */ }
        try { await nanoAuth.load(); } catch { /* ignore */ }
        nanoAuth.onHeartbeat = (data) => sendToRenderer('auth-heartbeat', toPlain(data));
        nanoAuth.onForcedLogout = (data) => sendToRenderer('auth-forced-logout', toPlain(data || {}));
        if (nanoAuth.cached.accessToken) nanoAuth.startWatch();
        try { await nanoAuth.startServer(); } catch (err) {
            console.error('[auth] local server', err.message);
        }
        const deepArg = (process.argv || []).find((arg) => String(arg).startsWith('nowk://'));
        if (deepArg) nanoAuth.applyDeepLink(deepArg);
        applyAppIcon();
        try { await profileLauncher.reclaimAll(); } catch { /* ignore */ }
        buildAppMenu();
        createWindow();
        registerDevToolsShortcuts();
        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) createWindow();
        });
    });
}

let quitting = false;

async function shutdownProfiles() {
    if (!profileLauncher) return;
    await Promise.race([
        profileLauncher.closeAll(),
        new Promise((resolve) => setTimeout(resolve, 8000)),
    ]);
}

app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    for (const session of windowSessions.values()) {
        session.workspaceWatcher?.stop();
        session.terminalService?.kill('all');
        session.agentRunner?.abort();
    }
});

app.on('window-all-closed', () => {
    if (!isMac) app.quit();
});

app.on('before-quit', (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    shutdownProfiles().finally(() => app.quit());
});

function normalizeProfileProxy(proxy) {
    if (!proxy || typeof proxy !== 'object') return proxy;
    const parsed = parseProxy(proxy);
    return {
        enabled: parsed.enabled,
        type: parsed.type,
        host: parsed.host,
        port: parsed.port,
        username: parsed.username,
        password: parsed.password ?? '',
    };
}

ipcMain.handle('profiles:list', async () => profileStore.loadAll());

ipcMain.handle('profiles:create', async (_, data) => {
    const settings = await settingsStore.load();

    const profile = await profileStore.create({
        name: data.name,
        notes: data.notes,
        proxy: normalizeProfileProxy(data.proxy),
        fingerprint: { mode: 'open' },
        startupUrl: data.startupUrl || settings.defaultStartupUrl || '',
    });
    return { success: true, profile };
});

ipcMain.handle('profiles:update', async (_, { id, ...updates }) => {
    if (updates.proxy) {
        updates.proxy = normalizeProfileProxy(updates.proxy);
    }
    delete updates.fingerprint;
    const profile = await profileStore.update(id, updates);
    return { success: !!profile, profile };
});

ipcMain.handle('profiles:delete', async (_, { id, deleteData }) => {
    if (profileLauncher.isLocked(id)) {
        return { success: false, error: 'Profile đang được sử dụng' };
    }

    try {
        await profileLauncher.close(id, 'manual');
    } catch { /* not open */ }

    const settings = await settingsStore.load();
    const profilesRoot = settingsStore.getProfilesRoot(settings, projectPath);
    if (deleteData) await profileStore.deleteProfileDir(profilesRoot, id);

    const deleted = await profileStore.delete(id);
    return { success: deleted };
});

ipcMain.handle('profiles:open', async (_, { id }) => {
    try {
        const owner = { type: 'manual', id: 'manual', label: 'mở thủ công' };
        await profileLauncher.open(id, owner, { connect: true });
        await settingsStore.update({ lastProfileId: id });
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('profiles:close', async (_, { id }) => {
    try {
        const entry = runningBrowsers.get(id);
        const ownerId = entry?.owner?.id || 'manual';
        await profileLauncher.close(id, ownerId);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('workspace:pick', async (event) => {
    const session = syncSession(sessionFromEvent(event) || focusedSession());
    const result = await dialog.showOpenDialog(session?.window || mainWindow, {
        properties: ['openDirectory'],
        title: 'Mở thư mục dự án',
    });
    if (result.canceled || !result.filePaths.length) return { success: false };
    const root = result.filePaths[0];
    await rememberRecent(root);
    attachProject(root, session);
    return { success: true, root, name: path.basename(root) };
});

ipcMain.handle('workspace:default-parent', async () => ({
    success: true,
    path: os.homedir(),
}));

ipcMain.handle('workspace:pick-parent', async (event) => {
    const session = syncSession(sessionFromEvent(event) || focusedSession());
    const result = await dialog.showOpenDialog(session?.window || mainWindow, {
        properties: ['openDirectory', 'createDirectory'],
        title: 'Chọn chỗ lưu project',
        defaultPath: os.homedir(),
    });
    if (result.canceled || !result.filePaths.length) return { success: false };
    return { success: true, path: result.filePaths[0] };
});

ipcMain.handle('workspace:templates', async () => ({
    success: true,
    templates: listKinds(),
}));

ipcMain.handle('workspace:create-project', async (event, payload = {}) => {
    try {
        const session = syncSession(sessionFromEvent(event) || focusedSession());
        const parent = path.resolve(String(payload.parent || os.homedir()));
        const rawName = String(payload.name || '').trim().replace(/[<>:"|?*\\/]/g, '-').replace(/\s+/g, '-');
        if (!rawName || rawName === '.' || rawName === '..') {
            return { success: false, error: 'Tên folder không hợp lệ.' };
        }
        const kind = String(payload.kind || 'vue3');
        if (!listKinds().some((item) => item.id === kind)) {
            return { success: false, error: 'Kiểu dự án không hỗ trợ.' };
        }
        if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) {
            return { success: false, error: 'Thư mục lưu không tồn tại.' };
        }
        const root = path.join(parent, rawName);
        if (fs.existsSync(root) && fs.readdirSync(root).length) {
            return { success: false, error: 'Folder đã có nội dung. Chọn tên khác.' };
        }
        fs.mkdirSync(root, { recursive: true });
        const files = scaffoldFiles(kind, rawName);
        for (const [rel, body] of Object.entries(files)) {
            const abs = path.join(root, rel);
            fs.mkdirSync(path.dirname(abs), { recursive: true });
            fs.writeFileSync(abs, body, 'utf8');
        }
        await rememberRecent(root);
        attachProject(root, session);
        return {
            success: true,
            root,
            name: path.basename(root),
            kind,
            prompt: promptFor(kind),
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('workspace:clone', async (event, payload = {}) => {
    try {
        const session = syncSession(sessionFromEvent(event) || focusedSession());
        const rawUrl = String(payload.url || '').trim();
        if (!/^(https?:\/\/|git@)/i.test(rawUrl) || /\s/.test(rawUrl)) {
            return { success: false, error: 'URL git không hợp lệ.' };
        }
        const parent = path.resolve(String(payload.parent || os.homedir()));
        let rawName = String(payload.name || '').trim().replace(/[<>:"|?*\\]/g, '-');
        if (!rawName) {
            rawName = rawUrl.replace(/\.git$/i, '').split(/[/:]/).filter(Boolean).pop() || 'repo';
        }
        if (!rawName || rawName === '.' || rawName === '..') {
            return { success: false, error: 'Tên folder không hợp lệ.' };
        }
        if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) {
            return { success: false, error: 'Thư mục lưu không tồn tại.' };
        }
        const root = path.join(parent, rawName);
        if (fs.existsSync(root)) {
            return { success: false, error: 'Folder đã tồn tại. Chọn tên khác.' };
        }
        await execFileAsync('git', ['clone', '--', rawUrl, root], {
            timeout: 180000,
            windowsHide: true,
        });
        await rememberRecent(root);
        attachProject(root, session);
        return { success: true, root, name: path.basename(root) };
    } catch (error) {
        const msg = String(error?.stderr || error?.message || error);
        if (/ENOENT|not found/i.test(msg)) {
            return { success: false, error: 'Không tìm thấy git trên máy.' };
        }
        return { success: false, error: msg.slice(0, 280) };
    }
});

ipcMain.handle('workspace:open', async (event, { root }) => {
    try {
        const session = syncSession(sessionFromEvent(event) || focusedSession());
        const folder = requireWorkspaceRoot(root);
        await rememberRecent(folder);
        attachProject(folder, session);
        return { success: true, root: folder, name: path.basename(folder) };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('workspace:recents', async () => ({
    success: true,
    recents: await listRecents(),
}));

ipcMain.handle('workspace:remove-recent', async (_, { path: folder } = {}) => {
    const settings = await settingsStore.load();
    const recents = (settings.recentProjects || []).filter((item) => item.path !== folder);
    await settingsStore.update({
        recentProjects: recents,
        lastProjectPath: settings.lastProjectPath === folder ? (recents[0]?.path || '') : settings.lastProjectPath,
    });
    return { success: true, recents: await listRecents() };
});

ipcMain.handle('window:new', async () => {
    createWindow();
    return { success: true };
});

ipcMain.handle('workspace:list', async (_, { root, relPath }) => {
    try {
        const folder = requireWorkspaceRoot(root);
        const tree = await workspaceService.listDir(folder, relPath || '');
        return { success: true, tree };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('workspace:git-status', async (_, { root }) => {
    try {
        const folder = requireWorkspaceRoot(root);
        const status = await workspaceService.gitStatus(folder);
        return { success: true, status };
    } catch (error) {
        return { success: false, error: error.message, status: {} };
    }
});

ipcMain.handle('workspace:read', async (_, { root, relPath }) => {
    try {
        const folder = requireWorkspaceRoot(root);
        const result = await workspaceService.readFile(folder, relPath);
        return { success: true, ...result };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('workspace:media', async (_, { root, relPath }) => {
    try {
        const folder = requireWorkspaceRoot(root);
        const result = await workspaceService.readMedia(folder, relPath);
        return { success: true, ...result };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('workspace:write', async (_, { root, relPath, content }) => {
    try {
        const folder = requireWorkspaceRoot(root);
        await workspaceService.writeFile(folder, relPath, content);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('workspace:create', async (_, { root, relPath, type }) => {
    try {
        const folder = requireWorkspaceRoot(root);
        await workspaceService.create(folder, relPath, type);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('workspace:delete', async (_, { root, relPath }) => {
    try {
        const folder = requireWorkspaceRoot(root);
        await workspaceService.remove(folder, relPath);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('workspace:rename', async (_, { root, fromRel, toRel }) => {
    try {
        const folder = requireWorkspaceRoot(root);
        await workspaceService.rename(folder, fromRel, toRel);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('terminal:run', async (event, { root, command }) => {
    try {
        const session = syncSession(sessionFromEvent(event));
        const folder = requireWorkspaceRoot(root || session?.projectRoot || currentProjectRoot);
        if (session) session.projectRoot = folder;
        currentProjectRoot = folder;
        return await session.terminalService.run({ cwd: folder, command, source: 'user' });
    } catch (error) {
        return { ok: false, type: 'run_command', error: error.message };
    }
});

ipcMain.handle('terminal:session-start', async (event, { root, cols, rows, id } = {}) => {
    try {
        const session = syncSession(sessionFromEvent(event));
        const folder = requireWorkspaceRoot(root || session?.projectRoot || currentProjectRoot);
        if (session) session.projectRoot = folder;
        currentProjectRoot = folder;
        return session.terminalService.startSession({ id, cwd: folder, cols, rows });
    } catch (error) {
        return { ok: false, error: error.message };
    }
});

ipcMain.handle('terminal:session-stop', async (event, { id } = {}) => (
    syncSession(sessionFromEvent(event))?.terminalService?.stopSession(id) || { ok: true }
));

ipcMain.on('terminal:write', (event, data) => {
    const service = syncSession(sessionFromEvent(event))?.terminalService;
    if (typeof data === 'string') {
        service?.write(data);
        return;
    }
    service?.write(data?.data, data?.id);
});

ipcMain.on('terminal:resize', (event, { cols, rows, id } = {}) => {
    syncSession(sessionFromEvent(event))?.terminalService?.resize(cols, rows, id);
});

ipcMain.handle('terminal:kill', async (event, payload) => {
    const service = syncSession(sessionFromEvent(event))?.terminalService;
    if (typeof payload === 'string' || payload == null) {
        return service?.kill(payload || 'jobs') || { success: true };
    }
    return service?.kill(payload.target || 'int', payload.id) || { success: true };
});

ipcMain.handle('agent:status', async (event) => {
    const runner = syncSession(sessionFromEvent(event))?.agentRunner;
    if (!runner) return { ok: false, chromeOpen: false, geminiOpen: false, error: 'Agent chưa sẵn sàng. Hãy khởi động lại app.' };
    return runner.inspectBrowser();
});

ipcMain.handle('agent:stop', async (event) => {
    syncSession(sessionFromEvent(event))?.agentRunner?.abort();
    return { success: true };
});

ipcMain.handle('agent:chat', async (event, data) => {
    const session = syncSession(sessionFromEvent(event));
    const runner = session?.agentRunner;
    if (!runner) return { success: false, error: 'Agent chưa sẵn sàng. Hãy khởi động lại app (npm run dev).' };
    if (data?.root) attachProject(data.root, session);
    focusIdeWindow(session?.window);
    try {
        return await runner.chat({
            message: data?.message,
            openFile: data?.openFile || null,
            sessionId: data?.sessionId || '',
        });
    } finally {
        focusIdeWindow(session?.window);
    }
});

ipcMain.handle('auth:session', async () => {
    ensureAppServices();
    const stored = await nanoAuth.load();
    if (!stored.accessToken) return { loggedIn: false, balance: 0 };
    const checked = await nanoAuth.verify(stored.accessToken);
    if (!checked.valid) {
        await nanoAuth.clear();
        return { loggedIn: false, balance: 0 };
    }
    await nanoAuth.save({
        accessToken: checked.token || stored.accessToken,
        balance: checked.balance,
    });
    nanoAuth.startWatch();
    return { loggedIn: true, balance: checked.balance };
});

ipcMain.handle('auth:register', async (_, { token } = {}) => {
    ensureAppServices();
    if (!nanoAuth.port) await nanoAuth.startServer();
    nanoAuth.register(token);
    return { success: true, url: nanoAuth.signInUrl(token) };
});

ipcMain.handle('auth:poll', async (_, { token } = {}) => {
    ensureAppServices();
    return nanoAuth.poll(token);
});

ipcMain.handle('auth:abandon', async (_, { token } = {}) => {
    ensureAppServices();
    return nanoAuth.abandon(token);
});

ipcMain.handle('auth:finish', async (_, { accessToken } = {}) => {
    ensureAppServices();
    const checked = await nanoAuth.verify(accessToken);
    if (!checked.valid) return { success: false, message: 'invalid' };
    await nanoAuth.save({
        accessToken: checked.token || accessToken,
        balance: checked.balance,
    });
    nanoAuth.startWatch();
    return { success: true, balance: checked.balance };
});

ipcMain.handle('auth:logout', async () => {
    ensureAppServices();
    await nanoAuth.clear();
    return { success: true };
});

ipcMain.handle('settings:get', async () => {
    const settings = await settingsStore.load();
    const channels = chromeResolver.getAvailableChannels();
    let chromeExecutable = null;
    let chromeReady = false;

    try {
        const resolved = chromeResolver.resolve(settings.chromeChannel, settings.chromePath);
        chromeExecutable = resolved.path;
        chromeReady = true;
    } catch {
        chromeReady = false;
    }

    return toPlain({
        ...settings,
        channels,
        chromeExecutable,
        chromeReady,
        profilesRoot: settingsStore.getProfilesRoot(settings, projectPath),
        appVersion: app.getVersion() || '1.0.0',
    });
});

ipcMain.handle('settings:save', async (_, data) => {
    const saved = await settingsStore.update(toPlain(data));
    for (const session of windowSessions.values()) {
        session.agentRunner?.setProvider(saved.agentProvider);
    }
    return { success: true, settings: toPlain(saved) };
});

ipcMain.handle('settings:pick-chrome-path', async (event) => {
    const win = sessionFromEvent(event)?.window || mainWindow;
    const result = await dialog.showOpenDialog(win, {
        properties: ['openFile'],
        title: 'Chọn file Chrome',
        filters: isWin
            ? [{ name: 'Chrome', extensions: ['exe'] }]
            : [{ name: 'Chrome', extensions: ['*'] }],
    });
    if (result.canceled || !result.filePaths.length) return null;
    return resolvePickedChrome(result.filePaths[0]);
});

ipcMain.handle('settings:pick-data-path', async (event) => {
    const win = sessionFromEvent(event)?.window || mainWindow;
    const result = await dialog.showOpenDialog(win, {
        properties: ['openDirectory', 'createDirectory'],
        title: 'Chọn thư mục lưu profile',
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
});

ipcMain.handle('settings:pick-extension', async (event) => {
    const win = sessionFromEvent(event)?.window || mainWindow;
    const result = await dialog.showOpenDialog(win, {
        properties: ['openDirectory'],
        title: 'Chọn thư mục extension (unpacked)',
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
});

ipcMain.handle('settings:open-folder', async (_, folderPath) => {
    const target = folderPath || settingsStore.getProfilesRoot(await settingsStore.load(), projectPath);
    await shell.openPath(target);
    return { success: true };
});

ipcMain.handle('app:open-external', async (_, url) => {
    try {
        await shell.openExternal(url);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('app:toggle-devtools', async (event) => {
    const win = sessionFromEvent(event)?.window || mainWindow;
    if (!win || win.isDestroyed()) return { open: false };
    win.webContents.toggleDevTools();
    return { open: win.webContents.isDevToolsOpened() };
});

ipcMain.handle('app:devtools-state', async (event) => {
    const win = sessionFromEvent(event)?.window || mainWindow;
    return {
        open: Boolean(win && !win.isDestroyed() && win.webContents.isDevToolsOpened()),
    };
});
