const fs = require('fs');
const os = require('os');
const path = require('path');
const { isMac, isWin, firstExisting, which } = require('./runtimePlatform');

const CHANNELS = [
    { id: 'stable', label: 'Chrome Stable' },
    { id: 'beta', label: 'Chrome Beta' },
    { id: 'dev', label: 'Chrome Dev' },
    { id: 'canary', label: 'Chrome Canary' },
];

class ChromeResolver {
    listChannels() {
        return CHANNELS;
    }

    getPaths(channel = 'stable') {
        if (isMac) {
            const homeApps = path.join(os.homedir(), 'Applications');
            const map = {
                stable: [
                    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                    path.join(homeApps, 'Google Chrome.app/Contents/MacOS/Google Chrome'),
                ],
                beta: [
                    '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta',
                    path.join(homeApps, 'Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta'),
                ],
                dev: [
                    '/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev',
                    path.join(homeApps, 'Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev'),
                ],
                canary: [
                    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
                    path.join(homeApps, 'Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary'),
                ],
            };
            return map[channel] || map.stable;
        }

        if (isWin) {
            const local = process.env.LOCALAPPDATA || '';
            const pf = process.env.PROGRAMFILES || 'C:\\Program Files';
            const pf86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
            const map = {
                stable: [
                    path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
                    path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
                    path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
                ],
                beta: [
                    path.join(local, 'Google', 'Chrome Beta', 'Application', 'chrome.exe'),
                    path.join(pf, 'Google', 'Chrome Beta', 'Application', 'chrome.exe'),
                ],
                dev: [
                    path.join(local, 'Google', 'Chrome Dev', 'Application', 'chrome.exe'),
                    path.join(pf, 'Google', 'Chrome Dev', 'Application', 'chrome.exe'),
                ],
                canary: [
                    path.join(local, 'Google', 'Chrome SxS', 'Application', 'chrome.exe'),
                    path.join(pf, 'Google', 'Chrome SxS', 'Application', 'chrome.exe'),
                ],
            };
            return map[channel] || map.stable;
        }

        const linux = {
            stable: [
                '/usr/bin/google-chrome-stable',
                '/usr/bin/google-chrome',
                '/opt/google/chrome/chrome',
                '/opt/google/chrome/google-chrome',
                '/snap/bin/chromium',
                '/usr/bin/chromium-browser',
                '/usr/bin/chromium',
                '/var/lib/flatpak/exports/bin/com.google.Chrome',
            ],
            beta: [
                '/usr/bin/google-chrome-beta',
                '/opt/google/chrome-beta/chrome',
                '/opt/google/chrome-beta/google-chrome-beta',
            ],
            dev: [
                '/usr/bin/google-chrome-unstable',
                '/opt/google/chrome-unstable/chrome',
            ],
            canary: [
                '/usr/bin/google-chrome-canary',
                '/opt/google/chrome-canary/chrome',
            ],
        };
        return linux[channel] || linux.stable;
    }

    pathCommands(channel = 'stable') {
        if (isWin) return ['chrome'];
        if (isMac) return [];
        const map = {
            stable: ['google-chrome-stable', 'google-chrome', 'chromium-browser', 'chromium'],
            beta: ['google-chrome-beta'],
            dev: ['google-chrome-unstable'],
            canary: ['google-chrome-canary'],
        };
        return map[channel] || map.stable;
    }

    resolve(channel = 'stable', customPath = '') {
        if (customPath && fs.existsSync(customPath)) {
            return { path: customPath, channel, source: 'custom' };
        }

        const found = firstExisting(this.getPaths(channel));
        if (found) {
            return { path: found, channel, source: 'system' };
        }

        for (const cmd of this.pathCommands(channel)) {
            const fromPath = which(cmd);
            if (fromPath) return { path: fromPath, channel, source: 'path' };
        }

        throw new Error(
            `Không tìm thấy Google Chrome (${channel}) trên máy.\n` +
            'Hãy cài Chrome hoặc chọn đường dẫn Chrome thủ công trong Setup.'
        );
    }

    getAvailableChannels() {
        return CHANNELS.map(({ id, label }) => {
            try {
                const { path: chromePath } = this.resolve(id);
                return { id, label, path: chromePath, available: true };
            } catch {
                return { id, label, path: null, available: false };
            }
        });
    }
}

module.exports = ChromeResolver;
