const RealChromeController = require('../chrome/RealChromeController');

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

    getOwner(profileId) {
        return this.profileOwners.get(profileId) || null;
    }

    isLocked(profileId) {
        return this.profileOwners.has(profileId);
    }

    acquire(profileId, owner) {
        if (this.profileOwners.has(profileId)) {
            const current = this.profileOwners.get(profileId);
            return { ok: false, owner: current };
        }
        this.profileOwners.set(profileId, owner);
        return { ok: true };
    }

    release(profileId) {
        this.profileOwners.delete(profileId);
    }

    async open(profileId, owner, { connect = true, startupUrl } = {}) {
        const existing = this.profileOwners.get(profileId);
        if (existing && existing.id !== owner.id) {
            throw new Error(`Profile đang được dùng bởi ${existing.label}`);
        }

        if (this.runningBrowsers.has(profileId)) {
            const entry = this.runningBrowsers.get(profileId);
            if (entry.owner.id !== owner.id) {
                throw new Error(`Profile đang được dùng bởi ${entry.owner.label}`);
            }
            if (connect && !entry.controller.page && !entry.controller.nativeMode) {
                await entry.controller.connect();
            }
            return entry.controller;
        }

        if (!existing) {
            this.profileOwners.set(profileId, owner);
        }

        const profile = await this.profileStore.getById(profileId);
        if (!profile) throw new Error('Không tìm thấy profile');

        const fpMode = profile.fingerprint?.mode || 'consistent';
        const automationOwner = owner.type === 'process' || owner.type === 'youtube-process';
        if (automationOwner && fpMode === 'native') {
            this.profileOwners.delete(profileId);
            throw new Error('Auto upload cần profile ở chế độ Consistent hoặc Stealth (không dùng Native)');
        }

        const settings = await this.settingsStore.load();
        const profilesRoot = this.settingsStore.getProfilesRoot(settings, this.projectPath);
        const channel = profile.chromeChannel || settings.chromeChannel || 'stable';
        const { path: chromePath } = this.chromeResolver.resolve(channel, settings.chromePath);
        const profilePath = this.profileStore.getProfileDir(profilesRoot, profileId);
        const extensions = (settings.extensions || []).map(e => e.path).filter(Boolean);

        const launchProfile = {
            ...profile,
            startupUrl: startupUrl || profile.startupUrl || 'about:blank',
        };

        const controller = new RealChromeController({
            profile: launchProfile,
            profilePath,
            chromePath,
            extensions,
            onClose: async () => {
                this.runningBrowsers.delete(profileId);
                this.profileOwners.delete(profileId);
                await this.profileStore.setStatus(profileId, 'idle');
                this.onStatus?.('profile-status', { id: profileId, status: 'idle' });
            },
        });

        await controller.launch();
        if (connect && !controller.nativeMode) {
            await controller.connect();
        }

        this.runningBrowsers.set(profileId, { controller, owner });
        await this.profileStore.setStatus(profileId, 'running');
        this.onStatus?.('profile-status', { id: profileId, status: 'running' });

        return controller;
    }

    async close(profileId, ownerId) {
        const entry = this.runningBrowsers.get(profileId);
        if (!entry) {
            this.profileOwners.delete(profileId);
            await this.profileStore.setStatus(profileId, 'idle');
            return;
        }
        if (entry.owner.id !== ownerId) {
            throw new Error('Không thể đóng profile của tiến trình khác');
        }
        await entry.controller.close();
        this.runningBrowsers.delete(profileId);
        this.profileOwners.delete(profileId);
        await this.profileStore.setStatus(profileId, 'idle');
        this.onStatus?.('profile-status', { id: profileId, status: 'idle' });
    }
}

module.exports = ProfileLauncher;
