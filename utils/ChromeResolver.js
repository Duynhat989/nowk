const fs = require('fs');
const path = require('path');

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
        if (process.platform === 'darwin') {
            const map = {
                stable: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                beta: '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta',
                dev: '/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev',
                canary: '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
            };
            return [map[channel] || map.stable];
        }

        if (process.platform === 'win32') {
            const local = process.env.LOCALAPPDATA || '';
            const map = {
                stable: path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
                beta: path.join(local, 'Google', 'Chrome Beta', 'Application', 'chrome.exe'),
                dev: path.join(local, 'Google', 'Chrome Dev', 'Application', 'chrome.exe'),
                canary: path.join(local, 'Google', 'Chrome SxS', 'Application', 'chrome.exe'),
            };
            return [
                map[channel] || map.stable,
                'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
                'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
            ];
        }

        return [
            '/usr/bin/google-chrome-stable',
            '/usr/bin/google-chrome',
            '/usr/bin/chromium-browser',
        ];
    }

    resolve(channel = 'stable', customPath = '') {
        if (customPath && fs.existsSync(customPath)) {
            return { path: customPath, channel, source: 'custom' };
        }

        const found = this.getPaths(channel).find(p => p && fs.existsSync(p));
        if (found) {
            return { path: found, channel, source: 'system' };
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
