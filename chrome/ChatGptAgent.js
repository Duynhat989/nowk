const INPUT_SELECTORS = [
    '#prompt-textarea',
    '[data-testid="prompt-textarea"]',
    'div.ProseMirror[contenteditable="true"]',
    '[contenteditable="true"][data-lexical-editor="true"]',
    'div[contenteditable="true"][role="textbox"]',
    'textarea[name="prompt-textarea"]',
    'textarea',
];

const SEND_SELECTORS = [
    'button[data-testid="send-button"]',
    'button[aria-label="Send prompt"]',
    'button[aria-label="Send message"]',
    'button[aria-label*="Send" i]',
    'button[aria-label*="Gửi" i]',
];

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

class ChatGptAgent {
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

    async ensureOnChatGpt(page) {
        const url = page.url() || '';
        if (!/chatgpt\.com|chat\.openai\.com/i.test(url)) {
            throw new Error('Chưa thấy tab ChatGPT. Hãy mở sẵn https://chatgpt.com trên Chrome rồi gửi lại.');
        }
        const ready = await page.evaluate(() => Boolean(
            document.querySelector('#prompt-textarea')
            || document.querySelector('[data-testid="prompt-textarea"]')
            || document.querySelector('div.ProseMirror[contenteditable="true"]')
            || document.querySelector('textarea'),
        ));
        if (!ready) {
            throw new Error('Trang ChatGPT chưa sẵn sàng ô nhập. Đăng nhập xong rồi gửi lại.');
        }
    }

    async snapshotResponse(page) {
        const state = await this.readReplyState(page);
        return state.text;
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
                'button[data-testid="stop-button"]',
                'button[aria-label="Stop generating"]',
                'button[aria-label="Stop streaming"]',
                'button[aria-label="Dừng tạo"]',
                'button[aria-label="Dừng trả lời"]',
            ];
            const generating = stopSelectors.some((sel) => visible(document.querySelector(sel)))
                || Boolean(document.querySelector('.result-streaming, [data-is-streaming="true"], [data-streaming="true"]'));
            const nodes = [
                ...document.querySelectorAll('[data-message-author-role="assistant"]'),
                ...document.querySelectorAll('article[data-turn="assistant"]'),
                ...document.querySelectorAll('[data-testid="assistant-message"]'),
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
                || btn.getAttribute('aria-disabled') === 'true',
            );
            const pickSend = () => {
                for (const sel of sendSelectors) {
                    const el = document.querySelector(sel);
                    if (el) return el;
                }
                return [...document.querySelectorAll('button')].find((btn) => {
                    const label = `${btn.getAttribute('aria-label') || ''} ${btn.getAttribute('data-testid') || ''}`.toLowerCase();
                    return /send/.test(label);
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

        if (!filled.ok || filled.chars < 2) {
            await this.insertViaCdp(page, text);
        }
        const state = await this.waitForComposer(page, (s) => s.chars > 0, 2500);
        if (!state.chars) {
            throw new Error('Ô nhập ChatGPT vẫn trống. Click vào ô chat một cái rồi gửi lại.');
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
                    const range = document.createRange();
                    range.selectNodeContents(el);
                    const selection = window.getSelection();
                    selection.removeAllRanges();
                    selection.addRange(range);
                    return;
                }
            }, INPUT_SELECTORS);
            await session.send('Input.insertText', { text });
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
        const ready = await this.waitForComposer(page, (s) => s.sendEnabled, 3500);
        if (!ready.chars) throw new Error('Không bấm được nút gửi ChatGPT vì ô nhập vẫn trống.');

        const clicked = await page.evaluate((sendSelectors) => {
            const isDisabled = (btn) => Boolean(
                btn.disabled
                || btn.getAttribute('disabled') !== null
                || btn.getAttribute('aria-disabled') === 'true',
            );
            const candidates = [];
            for (const sel of sendSelectors) {
                document.querySelectorAll(sel).forEach((el) => candidates.push(el));
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
        throw new Error('ChatGPT trả lời quá lâu hoặc không thấy kết quả.');
    }

    async ask(page, prompt) {
        this.cancelled = false;
        await this.ensureOnChatGpt(page);
        const before = await this.readReplyState(page);
        await this.insertPrompt(page, prompt);
        await this.clickSend(page);
        return this.waitUntilDone(page, before);
    }
}

module.exports = ChatGptAgent;
