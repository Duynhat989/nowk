const { app, BrowserWindow, Menu, ipcMain, dialog, shell, globalShortcut } = require('electron');
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
const FingerprintGenerator = require('./chrome/FingerprintRandomizer');
const { toPlain } = require('./utils/ipcPlain');
const { parseProxy } = require('./utils/parseProxy');
const { isWin, isMac, isLinux, resolvePickedChrome } = require('./utils/runtimePlatform');

const isDev = process.argv.includes('--dev');
const runningBrowsers = new Map();
const profileOwners = new Map();

let mainWindow;
let projectPath;
let profileStore;
let settingsStore;
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

function createWindow() {
    ensureAppServices();
    const win = new BrowserWindow({
        width: 1440,
        height: 860,
        minWidth: 960,
        minHeight: 600,
        backgroundColor: '#111113',
        title: 'NowK',
        titleBarStyle: isMac ? 'hiddenInset' : 'default',
        autoHideMenuBar: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            devTools: true,
        },
    });

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
        { role: 'editMenu' },
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
    app.on('second-instance', () => {
        const win = focusedSession()?.window || BrowserWindow.getAllWindows()[0];
        if (win && !win.isDestroyed()) {
            if (win.isMinimized()) win.restore();
            win.show();
            win.focus();
            return;
        }
        if (app.isReady()) createWindow();
    });

    app.whenReady().then(() => {
        buildAppMenu();
        createWindow();
        registerDevToolsShortcuts();
        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) createWindow();
        });
    });
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

let quitting = false;
app.on('before-quit', (event) => {
    if (quitting || runningBrowsers.size === 0) return;
    event.preventDefault();
    quitting = true;
    Promise.allSettled([...runningBrowsers.values()].map((entry) => (
        entry.controller.close().catch(() => {})
    ))).finally(() => app.quit());
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
    const gen = new FingerprintGenerator();

    const profile = await profileStore.create({
        name: data.name,
        notes: data.notes,
        proxy: normalizeProfileProxy(data.proxy),
        fingerprint: data.fingerprint || { mode: 'consistent' },
        startupUrl: data.startupUrl || settings.defaultStartupUrl,
    });

    let fingerprint;
    if (data.randomFingerprint) {
        fingerprint = gen.generate();
    } else if (data.fingerprint) {
        fingerprint = data.fingerprint;
        if (fingerprint.mode === 'consistent' && !fingerprint.noiseSeed) {
            fingerprint = gen.generateConsistent(profile.id);
        }
    } else {
        fingerprint = gen.generateConsistent(profile.id);
    }

    const updated = await profileStore.update(profile.id, { fingerprint });
    return { success: true, profile: updated };
});

ipcMain.handle('profiles:update', async (_, { id, ...updates }) => {
    if (updates.proxy) {
        updates.proxy = normalizeProfileProxy(updates.proxy);
    }
    if (updates.fingerprint?.mode === 'consistent') {
        const existing = await profileStore.getById(id);
        const prev = existing?.fingerprint || {};
        if (prev.noiseSeed) {
            updates.fingerprint = { ...prev, ...updates.fingerprint };
            if (updates.fingerprint.timezone) {
                updates.fingerprint.timezoneOffset = new FingerprintGenerator()
                    .getOffsetFor(updates.fingerprint.timezone);
            }
        } else {
            updates.fingerprint = new FingerprintGenerator().generateConsistent(id);
        }
    }
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

ipcMain.handle('fingerprint:random', async () => new FingerprintGenerator().generate());
ipcMain.handle('fingerprint:native', async () => new FingerprintGenerator().generateNative());
ipcMain.handle('fingerprint:consistent', async (_, { profileId } = {}) => {
    return new FingerprintGenerator().generateConsistent(profileId || require('crypto').randomUUID());
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
    await shell.openExternal(url);
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
