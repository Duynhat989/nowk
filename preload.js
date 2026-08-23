const { contextBridge, ipcRenderer } = require('electron');

function toPlain(value) {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value !== 'object') return value;
    return JSON.parse(JSON.stringify(value));
}

contextBridge.exposeInMainWorld('platform', process.platform);

contextBridge.exposeInMainWorld('api', {
    listProfiles: () => ipcRenderer.invoke('profiles:list'),
    createProfile: (data) => ipcRenderer.invoke('profiles:create', data),
    updateProfile: (data) => ipcRenderer.invoke('profiles:update', data),
    deleteProfile: (data) => ipcRenderer.invoke('profiles:delete', data),
    openProfile: (data) => ipcRenderer.invoke('profiles:open', data),
    closeProfile: (data) => ipcRenderer.invoke('profiles:close', data),
    randomFingerprint: () => ipcRenderer.invoke('fingerprint:random'),
    nativeFingerprint: () => ipcRenderer.invoke('fingerprint:native'),
    consistentFingerprint: (data) => ipcRenderer.invoke('fingerprint:consistent', data),
    onProfileStatus: (callback) => {
        const handler = (_, data) => callback(data);
        ipcRenderer.on('profile-status', handler);
        return () => ipcRenderer.removeListener('profile-status', handler);
    },

    pickProjectFolder: () => ipcRenderer.invoke('workspace:pick'),
    openProjectFolder: (data) => ipcRenderer.invoke('workspace:open', toPlain(data)),
    listRecentProjects: () => ipcRenderer.invoke('workspace:recents'),
    removeRecentProject: (data) => ipcRenderer.invoke('workspace:remove-recent', toPlain(data)),
    newWindow: () => ipcRenderer.invoke('window:new'),
    onPickProjectRequest: (callback) => {
        const handler = () => callback();
        ipcRenderer.on('workspace:pick-request', handler);
        return () => ipcRenderer.removeListener('workspace:pick-request', handler);
    },
    listWorkspace: (data) => ipcRenderer.invoke('workspace:list', toPlain(data)),
    gitStatus: (data) => ipcRenderer.invoke('workspace:git-status', toPlain(data)),
    readWorkspaceFile: (data) => ipcRenderer.invoke('workspace:read', toPlain(data)),
    writeWorkspaceFile: (data) => ipcRenderer.invoke('workspace:write', toPlain(data)),
    createWorkspaceItem: (data) => ipcRenderer.invoke('workspace:create', toPlain(data)),
    deleteWorkspaceItem: (data) => ipcRenderer.invoke('workspace:delete', toPlain(data)),
    renameWorkspaceItem: (data) => ipcRenderer.invoke('workspace:rename', toPlain(data)),
    onWorkspaceChanged: (callback) => {
        const handler = (_, data) => callback(data);
        ipcRenderer.on('workspace-changed', handler);
        return () => ipcRenderer.removeListener('workspace-changed', handler);
    },

    runTerminal: (data) => ipcRenderer.invoke('terminal:run', toPlain(data)),
    startTerminalSession: (data) => ipcRenderer.invoke('terminal:session-start', toPlain(data)),
    stopTerminalSession: (data) => ipcRenderer.invoke('terminal:session-stop', toPlain(data)),
    writeTerminal: (data) => ipcRenderer.send('terminal:write', data),
    resizeTerminal: (data) => ipcRenderer.send('terminal:resize', toPlain(data)),
    killTerminal: (target) => ipcRenderer.invoke(
        'terminal:kill',
        toPlain(typeof target === 'object' && target ? target : { target }),
    ),
    onTerminalEvent: (callback) => {
        const handler = (_, data) => callback(data);
        ipcRenderer.on('terminal-event', handler);
        return () => ipcRenderer.removeListener('terminal-event', handler);
    },

    agentStatus: () => ipcRenderer.invoke('agent:status'),
    agentChat: (data) => ipcRenderer.invoke('agent:chat', toPlain(data)),
    agentStop: () => ipcRenderer.invoke('agent:stop'),
    onAgentProgress: (callback) => {
        const handler = (_, data) => callback(data);
        ipcRenderer.on('agent-progress', handler);
        return () => ipcRenderer.removeListener('agent-progress', handler);
    },

    getSettings: () => ipcRenderer.invoke('settings:get'),
    saveSettings: (data) => ipcRenderer.invoke('settings:save', toPlain(data)),
    pickDataPath: () => ipcRenderer.invoke('settings:pick-data-path'),
    pickChromePath: () => ipcRenderer.invoke('settings:pick-chrome-path'),
    pickExtension: () => ipcRenderer.invoke('settings:pick-extension'),
    openFolder: (folderPath) => ipcRenderer.invoke('settings:open-folder', folderPath),
    openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
    toggleDevTools: () => ipcRenderer.invoke('app:toggle-devtools'),
    getDevToolsState: () => ipcRenderer.invoke('app:devtools-state'),
});
