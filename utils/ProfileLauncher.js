const RealChromeController = require('../chrome/RealChromeController');
const { killProfileChrome } = require('../chrome/profileProcess');

class ProfileLauncher {
    constructor({ profileStore, settingsStore, chromeResolver, projectPath, runningBrowsers, profileOwners, onStatus }) {
        this.profileStore = profileStore;
        this.settingsStore = settingsStore;
        this.chromeResolver = chromeResolver;
        this.projectPath = projectPath;
        this.runningBrowsers = runningBrowsers;
        this.profileOwners = profileOwners;
        this.onStatus = onStatus;
    }

    isLocked(profileId) {
        return this.runningBrowsers.has(profileId);
    }

    async open(profileId, owner, { connect = true, startupUrl } = {}) {
        if (this.runningBrowsers.has(profileId)) {
            const entry = this.runningBrowsers.get(profileId);
            try {
                if (connect) await entry.controller.connect();
                return entry.controller;
            } catch {
                await this.close(profileId);
            }
        }

        const profile = await this.profileStore.getById(profileId);
        if (!profile) throw new Error('Không tìm thấy profile');

        const settings = await this.settingsStore.load();
        const profilesRoot = this.settingsStore.getProfilesRoot(settings, this.projectPath);
        const channel = profile.chromeChannel || settings.chromeChannel || 'stable';
        const { path: chromePath } = this.chromeResolver.resolve(channel, settings.chromePath);
        const profilePath = this.profileStore.getProfileDir(profilesRoot, profileId);

        killProfileChrome(profilePath, profile.chromePid);

        const controller = new RealChromeController({
            profile: {
                ...profile,
                startupUrl: startupUrl || profile.startupUrl || settings.defaultStartupUrl || '',
            },
            profilePath,
            chromePath,
            extensions: (settings.extensions || []).map((item) => item.path).filter(Boolean),
            onClose: async () => {
                this.runningBrowsers.delete(profileId);
                this.profileOwners.delete(profileId);
                await this.profileStore.update(profileId, { status: 'idle', chromePid: null });
                this.onStatus?.('profile-status', { id: profileId, status: 'idle' });
            },
        });

        this.profileOwners.set(profileId, owner);
        await controller.launch();
        try {
            if (connect) await controller.connect();
        } catch (error) {
            await controller.close().catch(() => {});
            throw error;
        }

        this.runningBrowsers.set(profileId, { controller, owner });
        await this.profileStore.update(profileId, {
            status: 'running',
            chromePid: controller.chromePid || null,
        });
        this.onStatus?.('profile-status', { id: profileId, status: 'running' });
        return controller;
    }

    async profileDir(profileId) {
        const settings = await this.settingsStore.load();
        const root = this.settingsStore.getProfilesRoot(settings, this.projectPath);
        return this.profileStore.getProfileDir(root, profileId);
    }

    async close(profileId) {
        const entry = this.runningBrowsers.get(profileId);
        const profile = await this.profileStore.getById(profileId);
        const dir = await this.profileDir(profileId);
        if (entry) {
            await entry.controller.close();
        } else {
            killProfileChrome(dir, profile?.chromePid);
        }
        this.runningBrowsers.delete(profileId);
        this.profileOwners.delete(profileId);
        await this.profileStore.update(profileId, { status: 'idle', chromePid: null });
        this.onStatus?.('profile-status', { id: profileId, status: 'idle' });
    }

    async reclaimAll() {
        const settings = await this.settingsStore.load();
        const root = this.settingsStore.getProfilesRoot(settings, this.projectPath);
        const profiles = await this.profileStore.loadAll();
        for (const profile of profiles) {
            killProfileChrome(this.profileStore.getProfileDir(root, profile.id), profile.chromePid);
        }
        await this.profileStore.idleAllRunning();
        for (const profile of profiles) {
            this.onStatus?.('profile-status', { id: profile.id, status: 'idle' });
        }
    }

    async closeAll() {
        const ids = [...this.runningBrowsers.keys()];
        await Promise.allSettled(ids.map((id) => this.close(id)));
        await this.reclaimAll();
    }
}

module.exports = ProfileLauncher;
