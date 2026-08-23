const { spawn } = require('child_process');
const fs = require('fs');
const puppeteer = require('puppeteer-core');
const net = require('net');
const { exec } = require('child_process');
const util = require('util');
const FingerprintInjector = require('./FingerprintInjector');
const { parseProxy, buildProxyServerUrl } = require('../utils/parseProxy');
const { isWin, isLinux, killProcessTree } = require('../utils/runtimePlatform');

const execAsync = util.promisify(exec);

class RealChromeController {
    constructor({ profile, profilePath, chromePath, extensions = [], onClose }) {
        this.chromeProcess = null;
        this.browser = null;
        this.page = null;
        this.profilePath = profilePath;
        this.profile = profile;
        this.chromePath = chromePath;
        this.extensions = extensions;
        this.onClose = onClose;
        this.remoteDebuggingPort = null;
        this.isShuttingDown = false;
        this.chromePid = null;
        this.nativeMode = (profile.fingerprint?.mode || 'consistent') === 'native';
    }

    getRandomPort(min = 20000, max = 50000) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    async checkPortAvailable(port) {
        return new Promise((resolve) => {
            const server = net.createServer();
            server.listen(port, '127.0.0.1', () => {
                server.close(() => resolve(true));
            });
            server.on('error', () => resolve(false));
        });
    }

    async findAvailablePort() {
        for (let i = 0; i < 20; i++) {
            const port = this.getRandomPort();
            if (await this.checkPortAvailable(port)) return port;
        }
        throw new Error('Không tìm thấy port trống cho Chrome debugging');
    }

    async waitChromeReady(timeout = 20000) {
        const start = Date.now();
        const wsUrl = `http://127.0.0.1:${this.remoteDebuggingPort}`;

        while (Date.now() - start < timeout) {
            if (this.chromeProcess?.exitCode !== null && this.chromeProcess?.exitCode !== undefined) {
                throw new Error(`Chrome đã thoát sớm (code: ${this.chromeProcess.exitCode})`);
            }

            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 1000);
                const response = await fetch(`${wsUrl}/json/version`, { signal: controller.signal });
                clearTimeout(timeoutId);
                if (response.ok) return true;
            } catch {
                // retry
            }
            await new Promise(r => setTimeout(r, 300));
        }
        throw new Error(`Chrome không sẵn sàng sau ${timeout}ms`);
    }

    buildProxyServer(proxy) {
        return buildProxyServerUrl(proxy);
    }

    getParsedProxy() {
        return parseProxy(this.profile.proxy);
    }

    async applyProxyAuth(page) {
        const proxy = this.getParsedProxy();
        if (!proxy.enabled || !proxy.valid || !proxy.username) return;
        await page.authenticate({
            username: proxy.username,
            password: proxy.password || '',
        });
    }

    buildBaseArgs() {
        const args = [
            `--user-data-dir=${this.profilePath}`,
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-session-crashed-bubble',
            '--hide-crash-restore-bubble',
        ];
        if (isLinux) {
            args.push('--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu-sandbox');
        }

        const fp = this.profile.fingerprint || {};
        if (fp.language) {
            args.push(`--lang=${fp.language}`);
        }

        const proxyServer = this.buildProxyServer(this.profile.proxy);
        if (proxyServer) {
            args.push(`--proxy-server=${proxyServer}`);
        } else {
            const parsed = this.getParsedProxy();
            if (parsed.enabled && !parsed.valid) {
                console.warn('[Proxy] Cấu hình không hợp lệ — cần Host + Port (vd: 160.250.166.24 và 10413)');
            }
        }

        const validExtensions = this.extensions.filter(ext => fs.existsSync(ext));
        if (validExtensions.length) {
            args.push(`--disable-extensions-except=${validExtensions.join(',')}`);
            args.push(`--load-extension=${validExtensions.join(',')}`);
        }

        return args;
    }

    spawnChrome(args) {
        this.chromeProcess = spawn(this.chromePath, args, {
            detached: !isWin,
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: false,
        });

        this.chromePid = this.chromeProcess.pid;

        this.chromeProcess.on('exit', (code, signal) => {
            if (!this.isShuttingDown && this.onClose) {
                this.onClose({ code, signal });
            }
            this.chromeProcess = null;
        });
    }

    async launch() {
        if (!fs.existsSync(this.profilePath)) {
            fs.mkdirSync(this.profilePath, { recursive: true });
        }

        if (!fs.existsSync(this.chromePath)) {
            throw new Error(`Không tìm thấy Google Chrome tại: ${this.chromePath}`);
        }

        const startupUrl = this.profile.startupUrl || 'about:blank';

        if (this.nativeMode) {
            const args = [
                ...this.buildBaseArgs(),
                '--start-maximized',
                startupUrl,
            ];
            this.spawnChrome(args);
            return;
        }

        this.remoteDebuggingPort = await this.findAvailablePort();
        const args = [
            `--remote-debugging-port=${this.remoteDebuggingPort}`,
            ...this.buildBaseArgs(),
            '--start-maximized',
            'about:blank',
        ];
        this.spawnChrome(args);
        await this.waitChromeReady();
    }

    async connect() {
        if (this.nativeMode) {
            return null;
        }

        const wsUrl = `http://127.0.0.1:${this.remoteDebuggingPort}`;
        this.browser = await puppeteer.connect({
            browserURL: wsUrl,
            defaultViewport: null,
        });

        const pages = await this.browser.pages();
        this.page = pages.length ? pages[0] : await this.browser.newPage();
        await this.page.bringToFront();

        const proxy = this.getParsedProxy();
        if (proxy?.enabled && proxy.username) {
            await this.applyProxyAuth(this.page);
        }

        const fp = this.profile.fingerprint || { mode: 'consistent' };
        const injector = new FingerprintInjector(fp);

        this.browser.on('targetcreated', async (target) => {
            try {
                const page = await target.page();
                if (!page) return;
                if (proxy?.enabled && proxy.username) {
                    await this.applyProxyAuth(page);
                }
                await injector.inject(page);
            } catch {
                // ignore
            }
        });

        await injector.inject(this.page);

        if (fp.mode === 'custom' && fp.userAgent) {
            await this.page.setUserAgent(fp.userAgent);
        }

        const startupUrl = this.profile.startupUrl || 'about:blank';
        if (startupUrl && startupUrl !== 'about:blank') {
            await this.page.goto(startupUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        }

        return this.browser;
    }

    async listPageUrls() {
        if (this.nativeMode || !this.browser) return [];
        const pages = await this.browser.pages();
        return pages.map((page) => page.url() || '');
    }

    async getAutomationPage(provider = 'gemini') {
        if (this.nativeMode) {
            throw new Error('Profile đang ở chế độ Native — không điều khiển được trình duyệt. Đóng rồi mở lại profile ở chế độ Consistent.');
        }
        if (!this.browser) {
            await this.connect();
        }
        const pages = await this.browser.pages();
        const { resolveProvider } = require('../utils/agent/providers');
        const match = resolveProvider(provider).urlRe;
        const target = pages.find((page) => match.test(page.url()));
        this.page = target || pages[0] || await this.browser.newPage();
        return this.page;
    }

    async processExists(pid) {
        try {
            if (isWin) {
                const { stdout } = await execAsync(`tasklist /FI "PID eq ${pid}" /NH`, { windowsHide: true });
                return stdout.includes(String(pid));
            }
            process.kill(pid, 0);
            return true;
        } catch {
            return false;
        }
    }

    async forceKillChrome() {
        if (!this.chromePid) return;
        const exists = await this.processExists(this.chromePid);
        if (!exists) return;
        killProcessTree(this.chromePid, 'SIGKILL');
    }

    async close() {
        if (this.isShuttingDown) return;
        this.isShuttingDown = true;

        try {
            if (this.browser) {
                try {
                    await Promise.race([
                        this.browser.close(),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
                    ]);
                } catch {
                    // force kill below
                }
                this.browser = null;
                this.page = null;
            }
            await this.forceKillChrome();
            this.chromeProcess = null;
            this.chromePid = null;
        } finally {
            this.isShuttingDown = false;
        }
    }
}

module.exports = RealChromeController;
