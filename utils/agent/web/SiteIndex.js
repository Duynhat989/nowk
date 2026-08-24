const { chunkFile } = require('../indexer/CodeChunker');

function extractUrls(text) {
    const matches = String(text || '').match(/https?:\/\/[^\s"'<>]+/gi) || [];
    return [...new Set(matches.map((item) => item.replace(/[),.;]+$/, '')))].slice(0, 3);
}

function outlineHtml(html) {
    const text = String(html || '');
    const title = (text.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
    const headings = [...text.matchAll(/<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi)]
        .map((m) => `h${m[1]} ${m[2].replace(/<[^>]+>/g, '').trim()}`)
        .filter((line) => line.length > 4)
        .slice(0, 30);
    const buttons = [...text.matchAll(/<(button|a)[^>]*>([\s\S]*?)<\/\1>/gi)]
        .map((m) => m[2].replace(/<[^>]+>/g, '').trim())
        .filter((line) => line.length >= 2 && line.length <= 60)
        .slice(0, 24);
    return { title: title.replace(/<[^>]+>/g, '').trim(), headings, buttons };
}

class SiteIndex {
    constructor(indexer) {
        this.indexer = indexer;
        this.lastShot = '';
    }

    async capture(controller, url) {
        const target = String(url || '').trim();
        if (!target || !controller?.browser) {
            return { ok: false, error: 'Không có browser để mở website.' };
        }
        const page = await controller.browser.newPage();
        try {
            await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 25000 });
            await new Promise((resolve) => setTimeout(resolve, 600));
            const html = await page.content();
            const bodyText = await page.evaluate(() => String(document.body?.innerText || '')).catch(() => '');
            const links = await page.evaluate(() => [...document.querySelectorAll('a[href]')]
                .slice(0, 40)
                .map((a) => ({ href: a.href, text: String(a.textContent || '').trim().slice(0, 80) }))
                .filter((item) => item.href && item.text)).catch(() => []);
            let screenshot = '';
            try {
                screenshot = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 42 });
            } catch {
                screenshot = '';
            }
            this.lastShot = screenshot;
            const meta = outlineHtml(html);
            const virtual = `web/${encodeURIComponent(target)}.md`;
            const sitemap = links.map((item) => `- ${item.text}: ${item.href}`).join('\n');
            const content = [
                `# ${meta.title || target}`,
                `URL: ${target}`,
                '',
                '## Headings',
                (meta.headings || []).join('\n'),
                '',
                '## Controls',
                (meta.buttons || []).join('\n'),
                '',
                '## Visible text',
                String(bodyText || '').slice(0, 4000),
                '',
                '## Sitemap',
                sitemap,
            ].join('\n');
            this.indexer.store.upsert(chunkFile(virtual, content).map((item) => ({
                ...item,
                path: virtual,
                kind: item.kind === 'file' ? 'web' : item.kind,
            })));
            this.indexer.store.upsert([{
                path: virtual,
                kind: 'web',
                name: meta.title || target,
                start: 1,
                end: 1,
                text: content.slice(0, 2400),
            }]);
            return {
                ok: true,
                url: target,
                title: meta.title,
                path: virtual,
                screenshot: Boolean(screenshot),
                digest: content.slice(0, 3500),
            };
        } catch (error) {
            return { ok: false, error: error.message || 'Không crawl được website.' };
        } finally {
            try { await page.close(); } catch { /* ignore */ }
        }
    }

    async screenshot(controller, url) {
        const target = String(url || '').trim();
        if (this.lastShot && !target) {
            return { ok: true, result: 'Screenshot đã lấy ở lần crawl trước (jpeg base64 stored).' };
        }
        if (!controller?.browser) return { ok: false, error: 'Chrome chưa mở.' };
        const page = await controller.browser.newPage();
        try {
            if (target) await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 20000 });
            const shot = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 50 });
            this.lastShot = shot;
            return { ok: true, result: `screenshot jpeg ${Math.round(shot.length / 1024)}kb captured` };
        } catch (error) {
            return { ok: false, error: error.message };
        } finally {
            try { await page.close(); } catch { /* ignore */ }
        }
    }
}

module.exports = SiteIndex;
module.exports.extractUrls = extractUrls;
