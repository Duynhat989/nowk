const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

class ProfileStore {
    constructor(dataDir) {
        this.dataDir = dataDir;
        this.profilesFile = path.join(dataDir, 'profiles.json');
    }

    async ensureDir() {
        await fsp.mkdir(this.dataDir, { recursive: true });
    }

    async loadAll() {
        await this.ensureDir();
        try {
            const raw = await fsp.readFile(this.profilesFile, 'utf8');
            return JSON.parse(raw);
        } catch {
            return [];
        }
    }

    async saveAll(profiles) {
        await this.ensureDir();
        await fsp.writeFile(this.profilesFile, JSON.stringify(profiles, null, 2), 'utf8');
    }

    async getById(id) {
        const profiles = await this.loadAll();
        return profiles.find(p => p.id === id) || null;
    }

    async create(profileData) {
        const profiles = await this.loadAll();
        const now = new Date().toISOString();
        const profile = {
            id: crypto.randomUUID(),
            name: profileData.name || `Profile ${profiles.length + 1}`,
            notes: profileData.notes || '',
            status: 'idle',
            createdAt: now,
            updatedAt: now,
            proxy: profileData.proxy || {
                enabled: false,
                type: 'http',
                host: '',
                port: '',
                username: '',
                password: '',
            },
            fingerprint: profileData.fingerprint || { mode: 'open' },
            startupUrl: profileData.startupUrl || '',
        };
        profiles.push(profile);
        await this.saveAll(profiles);
        return profile;
    }

    async update(id, updates) {
        const profiles = await this.loadAll();
        const index = profiles.findIndex(p => p.id === id);
        if (index === -1) return null;

        profiles[index] = {
            ...profiles[index],
            ...updates,
            id,
            updatedAt: new Date().toISOString(),
        };
        await this.saveAll(profiles);
        return profiles[index];
    }

    async delete(id) {
        const profiles = await this.loadAll();
        const filtered = profiles.filter(p => p.id !== id);
        if (filtered.length === profiles.length) return false;
        await this.saveAll(filtered);
        return true;
    }

    async setStatus(id, status) {
        return this.update(id, { status });
    }

    async idleAllRunning() {
        const profiles = await this.loadAll();
        let changed = false;
        const now = new Date().toISOString();
        for (const profile of profiles) {
            if (profile.status === 'running' || profile.chromePid) {
                profile.status = 'idle';
                profile.chromePid = null;
                profile.updatedAt = now;
                changed = true;
            }
        }
        if (changed) await this.saveAll(profiles);
        return profiles;
    }

    getProfileDir(profilesRoot, id) {
        return path.join(profilesRoot, `profile_${id}`);
    }

    async deleteProfileDir(profilesRoot, id) {
        const dir = this.getProfileDir(profilesRoot, id);
        if (fs.existsSync(dir)) {
            await fsp.rm(dir, { recursive: true, force: true });
        }
    }
}

module.exports = ProfileStore;
