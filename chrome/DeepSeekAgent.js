const INPUT_SELECTORS = [
    '#chat-input',
    'textarea#chat-input',
    'textarea[placeholder*="DeepSeek" i]',
    'textarea[placeholder*="Message" i]',
    'textarea[placeholder*="Ask" i]',
    'textarea',
    'div[contenteditable="true"][role="textbox"]',
    '[contenteditable="true"]',
];

const SEND_SELECTORS = [
    'button[aria-label="Send message"]',
    'button[aria-label*="Send" i]',
    'button[aria-label*="Gửi" i]',
    '[data-testid="send-button"]',
    'button[type="submit"]',
    '.ds-icon-button',
    '[role="button"].ds-icon-button',
    'div.ds-icon-button',
];

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

class DeepSeekAgent {
    constructor() {
        this.cancelled = false;
    }

    cancel() {
        this.cancelled = true;
    }

    throwIfCancelled() {
        if (!this.cancelled) return;
        const error = new Error('Đã dừng');
        error.aborted = true;
        throw error;
    }

    async ensureOnDeepSeek(page) {
        const url = page.url() || '';
        if (!/chat\.deepseek\.com/i.test(url)) {
            throw new Error('Chưa thấy tab DeepSeek. Hãy mở sẵn https://chat.deepseek.com/ trên Chrome rồi gửi lại.');
        }
        const ready = await page.evaluate(() => Boolean(
            document.querySelector('#chat-input')
            || document.querySelector('textarea')
            || document.querySelector('[contenteditable="true"]'),
        ));
        if (!ready) {
            throw new Error('Trang DeepSeek chưa sẵn sàng ô nhập. Đăng nhập xong rồi gửi lại.');
        }
    }

    async readReplyState(page) {
        return page.evaluate(() => {
            const visible = (el) => {
                if (!el) return false;
                const style = window.getComputedStyle(el);
                if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
                    return false;
                }
                const rect = el.getBoundingClientRect();
                return rect.width > 2 && rect.height > 2;
            };
            const stopSelectors = [
                'button[aria-label="Stop generating"]',
                'button[aria-label="Stop streaming"]',
                'button[aria-label*="Stop" i]',
                'button[aria-label="Dừng tạo"]',
                'button[aria-label="Dừng trả lời"]',
            ];
            const generating = stopSelectors.some((sel) => visible(document.querySelector(sel)))
                || Boolean(document.querySelector('[class*="stop"], [class*="Stop"]'))
                || Boolean(document.querySelector('.ds-icon-button[aria-label*="Stop" i]'));
            const nodes = [
                ...document.querySelectorAll('.ds-markdown'),
                ...document.querySelectorAll('[data-message-author-role="assistant"]'),
                ...document.querySelectorAll('[class*="AssistantMessage"]'),
                ...document.querySelectorAll('[class*="markdown-body"]'),
            ];
            const last = nodes[nodes.length - 1];
            return {
                generating,
                count: nodes.length,
                text: last ? String(last.innerText || '').trim() : '',
            };
        });
    }

    async readComposer(page) {
        return page.evaluate((inputSelectors, sendSelectors) => {
            const pickInput = () => {
                for (const sel of inputSelectors) {
                    const nodes = [...document.querySelectorAll(sel)].filter((el) => el.offsetParent !== null);
                    if (nodes.length) return nodes[nodes.length - 1];
                }
                return null;
            };
            const isDisabled = (btn) => Boolean(
                btn.disabled
                || btn.getAttribute('disabled') !== null
                || btn.getAttribute('aria-disabled') === 'true'
                || btn.classList.contains('disabled'),
            );
            const pickSend = () => {
                for (const sel of sendSelectors) {
                    const el = [...document.querySelectorAll(sel)].find((node) => node.offsetParent !== null);
                    if (el) return el;
                }
                return [...document.querySelectorAll('button, [role="button"]')].find((btn) => {
                    const label = `${btn.getAttribute('aria-label') || ''} ${btn.getAttribute('data-testid') || ''} ${btn.className || ''}`.toLowerCase();
                    return /send|gửi/.test(label);
                }) || null;
            };
            const input = pickInput();
            const send = pickSend();
            const text = input
                ? String(input.innerText || input.value || input.textContent || '').replace(/\u200B/g, '').trim()
                : '';
            return {
                hasInput: Boolean(input),
                text,
                chars: text.length,
                hasSend: Boolean(send),
                sendEnabled: Boolean(send && !isDisabled(send)),
                sendLabel: send ? (send.getAttribute('aria-label') || send.getAttribute('data-testid') || '') : '',
            };
        }, INPUT_SELECTORS, SEND_SELECTORS);
    }

    async insertPrompt(page, text) {
        const filled = await page.evaluate((value, inputSelectors) => {
            const pickInput = () => {
                for (const sel of inputSelectors) {
                    const nodes = [...document.querySelectorAll(sel)].filter((el) => el.offsetParent !== null);
                    if (nodes.length) return nodes[nodes.length - 1];
                }
                return null;
            };
            const el = pickInput();
            if (!el) return { ok: false, chars: 0 };
            const read = () => String(el.innerText || el.value || el.textContent || '').replace(/\u200B/g, '').trim();

            el.focus();
            if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
                const proto = el.tagName === 'TEXTAREA'
                    ? window.HTMLTextAreaElement.prototype
                    : window.HTMLInputElement.prototype;
                Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
                return { ok: Boolean(read()), chars: read().length };
            }

            const range = document.createRange();
            range.selectNodeContents(el);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            try {
                document.execCommand('insertText', false, value);
            } catch {
                // fall through
            }
            if (!read()) {
                try {
                    const dt = new DataTransfer();
                    dt.setData('text/plain', value);
                    el.dispatchEvent(new ClipboardEvent('paste', {
                        bubbles: true,
                        cancelable: true,
                        clipboardData: dt,
                    }));
                } catch {
                    el.textContent = value;
                }
            }
            el.dispatchEvent(new InputEvent('input', {
                bubbles: true,
                inputType: 'insertFromPaste',
                data: value,
            }));
            return { ok: Boolean(read()), chars: read().length };
        }, text, INPUT_SELECTORS);

        if (!filled.ok || filled.chars < Math.floor(String(text || '').length * 0.9)) {
            await this.insertViaCdp(page, text);
        }
        const want = String(text || '').length;
        const state = await this.waitForComposer(page, (s) => s.chars >= Math.floor(want * 0.9), Math.min(12000, 2500 + want / 8));
        if (state.chars < Math.max(8, Math.floor(want * 0.85))) {
            throw new Error(`Ô nhập DeepSeek thiếu prompt (${state.chars}/${want} ký tự). Click vào ô chat rồi gửi lại.`);
        }
        return state;
    }

    async insertViaCdp(page, text) {
        let session;
        try {
            session = await page.createCDPSession();
            await page.evaluate((inputSelectors) => {
                for (const sel of inputSelectors) {
                    const el = [...document.querySelectorAll(sel)].filter((item) => item.offsetParent !== null).pop();
                    if (!el) continue;
                    el.focus();
                    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
                        el.select?.();
                        return;
                    }
                    const range = document.createRange();
                    range.selectNodeContents(el);
                    const selection = window.getSelection();
                    selection.removeAllRanges();
                    selection.addRange(range);
                    return;
                }
            }, INPUT_SELECTORS);
            const value = String(text || '');
            const chunk = 400;
            for (let i = 0; i < value.length; i += chunk) {
                await session.send('Input.insertText', { text: value.slice(i, i + chunk) });
            }
        } catch {
            // ignore
        } finally {
            try { await session?.detach(); } catch { /* ignore */ }
        }
    }

    async waitForComposer(page, predicate, timeout = 3000) {
        const started = Date.now();
        let last = await this.readComposer(page);
        while (Date.now() - started < timeout) {
            if (predicate(last)) return last;
            await sleep(150);
            last = await this.readComposer(page);
        }
        return last;
    }

    async clickSend(page) {
        const ready = await this.waitForComposer(page, (s) => s.sendEnabled || s.chars > 0, 3500);
        if (!ready.chars) throw new Error('Không bấm được nút gửi DeepSeek vì ô nhập vẫn trống.');

        const clicked = await page.evaluate((sendSelectors) => {
            const isDisabled = (btn) => Boolean(
                btn.disabled
                || btn.getAttribute('disabled') !== null
                || btn.getAttribute('aria-disabled') === 'true'
                || btn.classList.contains('disabled'),
            );
            const candidates = [];
            for (const sel of sendSelectors) {
                document.querySelectorAll(sel).forEach((el) => {
                    if (el.offsetParent !== null) candidates.push(el);
                });
            }
            const unique = [...new Set(candidates)];
            const enabled = unique.find((btn) => !isDisabled(btn)) || unique[0];
            if (!enabled) return { ok: false };
            enabled.click();
            return { ok: true };
        }, SEND_SELECTORS);

        if (clicked.ok) {
            await sleep(400);
            return;
        }
        await this.pressEnter(page);
        await sleep(400);
    }

    async pressEnter(page) {
        let session;
        try {
            session = await page.createCDPSession();
            await session.send('Input.dispatchKeyEvent', {
                type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
            });
            await session.send('Input.dispatchKeyEvent', {
                type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
            });
            return true;
        } catch {
            return false;
        } finally {
            try { await session?.detach(); } catch { /* ignore */ }
        }
    }

    looksIncomplete(text) {
        const value = String(text || '');
        if (!value.trim()) return true;
        const fences = value.match(/```/g);
        return Boolean(fences && fences.length % 2 === 1);
    }

    async waitUntilDone(page, previous, timeout = 180000) {
        const prevText = typeof previous === 'string' ? previous : String(previous?.text || '');
        const prevCount = Number(previous?.count || 0);
        const started = Date.now();
        let lastText = prevText;
        let stable = 0;
        let sawNew = false;

        while (Date.now() - started < timeout) {
            this.throwIfCancelled();
            const state = await this.readReplyState(page);
            const isNew = state.count > prevCount || Boolean(state.text && state.text !== prevText);
            if (isNew) sawNew = true;

            if (!sawNew || state.generating) {
                if (state.text) lastText = state.text;
                stable = 0;
                await sleep(280);
                continue;
            }

            if (!state.text) {
                await sleep(280);
                continue;
            }

            if (state.text === lastText) stable += 1;
            else {
                lastText = state.text;
                stable = 1;
            }

            const need = this.looksIncomplete(state.text) ? 6 : 2;
            if (stable >= need) return state.text;
            await sleep(280);
        }
        if (lastText && lastText !== prevText) return lastText;
        throw new Error('DeepSeek trả lời quá lâu hoặc không thấy kết quả.');
    }

    async ask(page, prompt) {
        this.cancelled = false;
        await this.ensureOnDeepSeek(page);
        const before = await this.readReplyState(page);
        await this.insertPrompt(page, prompt);
        await this.clickSend(page);
        return this.waitUntilDone(page, before);
    }
}

module.exports = DeepSeekAgent;
