const { spawn } = require('child_process');
const fs = require('fs');
const puppeteer = require('puppeteer-core');
const net = require('net');
const { exec } = require('child_process');
const util = require('util');
const { parseProxy, buildProxyServerUrl } = require('../utils/parseProxy');
const { isWin, isLinux, killProcessTree } = require('../utils/runtimePlatform');
const { killProfileChrome, sleep } = require('./profileProcess');

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
        this.nativeMode = false;
    }

    async findAvailablePort() {
        for (let i = 0; i < 20; i += 1) {
            const port = 20000 + Math.floor(Math.random() * 30000);
            const free = await new Promise((resolve) => {
                const server = net.createServer();
                server.listen(port, '127.0.0.1', () => {
                    server.close(() => resolve(true));
                });
                server.on('error', () => resolve(false));
            });
            if (free) return port;
        }
        throw new Error('Không tìm thấy port trống cho Chrome');
    }

    async waitChromeReady(timeout = 20000) {
        const start = Date.now();
        const wsUrl = `http://127.0.0.1:${this.remoteDebuggingPort}`;
        while (Date.now() - start < timeout) {
            if (this.chromeProcess?.exitCode != null) {
                throw new Error(`Chrome đã thoát sớm (code: ${this.chromeProcess.exitCode})`);
            }
            try {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), 1000);
                const response = await fetch(`${wsUrl}/json/version`, { signal: controller.signal });
                clearTimeout(timer);
                if (response.ok) return true;
            } catch {
                // retry
            }
            await new Promise((resolve) => setTimeout(resolve, 250));
        }
        throw new Error(`Chrome không sẵn sàng sau ${timeout}ms`);
    }

    getParsedProxy() {
        return parseProxy(this.profile.proxy);
    }

    buildArgs() {
        const args = [
            `--user-data-dir=${this.profilePath}`,
            `--remote-debugging-port=${this.remoteDebuggingPort}`,
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-session-crashed-bubble',
            '--hide-crash-restore-bubble',
            '--disable-restore-session-state',
        ];
        if (isLinux) {
            args.push('--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu-sandbox');
        }

        const proxyServer = buildProxyServerUrl(this.profile.proxy);
        if (proxyServer) args.push(`--proxy-server=${proxyServer}`);

        const extensions = this.extensions.filter((ext) => fs.existsSync(ext));
        if (extensions.length) {
            args.push(`--disable-extensions-except=${extensions.join(',')}`);
            args.push(`--load-extension=${extensions.join(',')}`);
        }

        return args;
    }

    startupUrl() {
        const url = String(this.profile.startupUrl || '').trim();
        return url && url !== 'about:blank' ? url : '';
    }

    isEmptyTab(url) {
        const value = String(url || '');
        return !value
            || value === 'about:blank'
            || value.startsWith('chrome://newtab')
            || value.startsWith('chrome://new-tab-page');
    }

    async keepSingleTab() {
        const pages = await this.browser.pages();
        const wanted = this.startupUrl();
        const keep = pages.find((page) => wanted && page.url().startsWith(wanted.replace(/\/$/, '')))
            || pages.find((page) => !this.isEmptyTab(page.url()))
            || pages[0];
        this.page = keep || await this.browser.newPage();
        for (const page of pages) {
            if (page !== this.page) {
                try { await page.close(); } catch { /* ignore */ }
            }
        }
        if (wanted && this.isEmptyTab(this.page.url())) {
            await this.page.goto(wanted, { waitUntil: 'domcontentloaded', timeout: 30000 });
        }
    }

    spawnChrome(args) {
        this.chromeProcess = spawn(this.chromePath, args, {
            detached: false,
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: false,
        });
        this.chromePid = this.chromeProcess.pid;
        this.chromeProcess.on('exit', (code, signal) => {
            if (!this.isShuttingDown) this.onClose?.({ code, signal });
            this.chromeProcess = null;
        });
    }

    async reclaim() {
        killProfileChrome(this.profilePath, this.chromePid);
        await sleep(400);
    }

    async launch() {
        fs.mkdirSync(this.profilePath, { recursive: true });
        if (!fs.existsSync(this.chromePath)) {
            throw new Error(`Không tìm thấy Google Chrome tại: ${this.chromePath}`);
        }
        await this.reclaim();
        this.remoteDebuggingPort = await this.findAvailablePort();
        this.spawnChrome(this.buildArgs());
        await this.waitChromeReady();
    }

    async applyProxyAuth(page) {
        const proxy = this.getParsedProxy();
        if (!proxy.enabled || !proxy.valid || !proxy.username) return;
        await page.authenticate({
            username: proxy.username,
            password: proxy.password || '',
        });
    }

    async connect() {
        if (this.browser) return this.browser;
        this.browser = await puppeteer.connect({
            browserURL: `http://127.0.0.1:${this.remoteDebuggingPort}`,
            defaultViewport: null,
        });
        await this.keepSingleTab();
        const proxy = this.getParsedProxy();
        if (proxy?.enabled && proxy.username) {
            await this.applyProxyAuth(this.page);
            this.browser.on('targetcreated', async (target) => {
                try {
                    const page = await target.page();
                    if (page) await this.applyProxyAuth(page);
                } catch {
                    // ignore
                }
            });
        }
        return this.browser;
    }

    async listPageUrls() {
        if (!this.browser) return [];
        const pages = await this.browser.pages();
        return pages.map((page) => page.url() || '');
    }

    async getAutomationPage(provider = 'gemini') {
        if (!this.browser) await this.connect();
        const pages = await this.browser.pages();
        const { resolveProvider } = require('../utils/agent/providers');
        const match = resolveProvider(provider).urlRe;
        this.page = pages.find((page) => match.test(page.url())) || pages[0] || await this.browser.newPage();
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
        killProfileChrome(this.profilePath, this.chromePid);
        if (this.chromePid) {
            try { killProcessTree(this.chromePid, 'SIGKILL'); } catch { /* ignore */ }
        }
    }

    async close() {
        if (this.isShuttingDown) return;
        this.isShuttingDown = true;
        try {
            if (this.browser) {
                try {
                    await Promise.race([
                        this.browser.close(),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000)),
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
            try { await this.onClose?.({ reason: 'close' }); } catch { /* ignore */ }
            this.isShuttingDown = false;
        }
    }
}

module.exports = RealChromeController;
