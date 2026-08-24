const fsp = require('fs/promises');
const path = require('path');

function normalizeRecents(list, lastPath) {
    const out = [];
    const seen = new Set();
    for (const item of Array.isArray(list) ? list : []) {
        const folder = String(item?.path || item || '').trim();
        if (!folder || seen.has(folder)) continue;
        seen.add(folder);
        out.push({
            path: folder,
            name: String(item?.name || path.basename(folder)),
            lastOpened: Number(item?.lastOpened) || Date.now(),
        });
    }
    if (lastPath && !seen.has(lastPath)) {
        out.push({ path: lastPath, name: path.basename(lastPath), lastOpened: Date.now() });
    }
    return out.slice(0, 24);
}

const DEFAULT_SETTINGS = {
    dataPath: '',
    chromeChannel: 'stable',
    chromePath: '',
    extensions: [],
    defaultStartupUrl: '',
    uiLocale: 'vi',
    lastProfileId: '',
    lastProjectPath: '',
    recentProjects: [],
    agentProvider: 'gemini',
};

class SettingsStore {
    constructor(configDir) {
        this.configDir = configDir;
        this.settingsFile = path.join(configDir, 'settings.json');
    }

    async ensureDir() {
        await fsp.mkdir(this.configDir, { recursive: true });
    }

    async load() {
        await this.ensureDir();
        try {
            const raw = await fsp.readFile(this.settingsFile, 'utf8');
            const parsed = JSON.parse(raw);
            return {
                ...DEFAULT_SETTINGS,
                dataPath: parsed.dataPath || '',
                chromeChannel: parsed.chromeChannel || 'stable',
                chromePath: parsed.chromePath || '',
                extensions: Array.isArray(parsed.extensions) ? parsed.extensions : [],
                defaultStartupUrl: parsed.defaultStartupUrl || '',
                uiLocale: parsed.uiLocale || 'vi',
                lastProfileId: parsed.lastProfileId || '',
                lastProjectPath: parsed.lastProjectPath || '',
                recentProjects: normalizeRecents(parsed.recentProjects, parsed.lastProjectPath),
                agentProvider: ['gemini', 'chatgpt', 'deepseek'].includes(parsed.agentProvider)
                    ? parsed.agentProvider
                    : 'gemini',
            };
        } catch {
            return { ...DEFAULT_SETTINGS };
        }
    }

    async save(settings) {
        await this.ensureDir();
        await fsp.writeFile(this.settingsFile, JSON.stringify(settings, null, 2), 'utf8');
        return settings;
    }

    async update(partial) {
        const current = await this.load();
        const merged = { ...current, ...partial };
        return this.save(merged);
    }

    getProfilesRoot(settings, projectPath) {
        return settings.dataPath || path.join(projectPath, 'profiles');
    }
}

module.exports = SettingsStore;
