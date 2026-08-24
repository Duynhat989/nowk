const INPUT_SELECTORS = [
    'div.ql-editor[contenteditable="true"]',
    'rich-textarea div[contenteditable="true"]',
    'div[contenteditable="true"][role="textbox"]',
    '[aria-label="Enter a prompt for Gemini"]',
    'div[contenteditable="true"]',
    'textarea[aria-label]',
    'textarea',
];

const SEND_SELECTORS = [
    'button.send-button',
    'button.send-button.submit',
    'button[aria-label="Send"]',
    'button[aria-label="Send message"]',
    'button[aria-label="Gửi"]',
    'button[aria-label="Gửi tin nhắn"]',
    'button[aria-label*="Send" i]',
    'button[aria-label*="Gửi" i]',
    'button[type="submit"]',
];

const INSERT_CHUNK = 800;

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function normalizePrompt(text) {
    return String(text || '').replace(/\u200B/g, '').replace(/\s+/g, ' ').trim();
}

function composerMatches(got, want) {
    const have = normalizePrompt(got);
    const need = normalizePrompt(want);
    if (!need) return true;
    if (have.length < Math.max(24, Math.floor(need.length * 0.72))) return false;
    const head = need.slice(0, Math.min(48, need.length));
    const tail = need.slice(-Math.min(48, need.length));
    return have.includes(head) && (need.length < 80 || have.includes(tail));
}

class GeminiAgent {
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

    async ensureOnGemini(page) {
        const url = page.url() || '';
        if (!/gemini\.google\.com/i.test(url)) {
            throw new Error('Chưa thấy tab Gemini. Hãy mở sẵn https://gemini.google.com/app?hl=vi trên Chrome rồi gửi lại.');
        }
        const ready = await page.evaluate(() => Boolean(
            document.querySelector('div.ql-editor[contenteditable="true"]')
            || document.querySelector('div[contenteditable="true"]')
            || document.querySelector('rich-textarea')
            || document.querySelector('textarea'),
        ));
        if (!ready) {
            throw new Error('Trang Gemini chưa sẵn sàng ô nhập. Đợi load xong rồi gửi lại.');
        }
    }

    async findInput(page) {
        for (const selector of INPUT_SELECTORS) {
            const handle = await page.$(selector);
            if (handle) return { handle, selector };
        }
        throw new Error('Không thấy ô nhập của Gemini. Hãy mở https://gemini.google.com/app?hl=vi trên profile đang chạy.');
    }

    async snapshotResponse(page) {
        return page.evaluate(() => {
            const nodes = [
                ...document.querySelectorAll('model-response'),
                ...document.querySelectorAll('message-content'),
                ...document.querySelectorAll('[data-message-author-role="model"]'),
                ...document.querySelectorAll('.markdown'),
            ];
            const last = nodes[nodes.length - 1];
            return last ? String(last.innerText || '').trim() : '';
        });
    }

    async readComposer(page) {
        return page.evaluate((inputSelectors, sendSelectors) => {
            const pickInput = () => {
                const editors = [...document.querySelectorAll('div.ql-editor[contenteditable="true"]')]
                    .filter((el) => el.offsetParent !== null);
                const inBox = editors.find((el) => el.closest('rich-textarea, input-container, .text-input-field, [class*="input-area"]'));
                if (inBox) return inBox;
                if (editors.length) return editors[editors.length - 1];
                for (const sel of inputSelectors) {
                    const el = document.querySelector(sel);
                    if (el) return el;
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
                    const el = document.querySelector(sel);
                    if (el) return el;
                }
                return [...document.querySelectorAll('button')].find((btn) => {
                    const label = `${btn.getAttribute('aria-label') || ''} ${btn.getAttribute('mattooltip') || ''} ${btn.className || ''}`.toLowerCase();
                    return /send|gửi|submit/.test(label);
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
                blank: Boolean(input?.classList?.contains('ql-blank')),
                hasSend: Boolean(send),
                sendEnabled: Boolean(send && !isDisabled(send)),
                sendLabel: send ? (send.getAttribute('aria-label') || send.className || '') : '',
            };
        }, INPUT_SELECTORS, SEND_SELECTORS);
    }

    async focusComposer(page) {
        const found = await this.findInput(page);
        try {
            await found.handle.click({ delay: 40 });
        } catch {
            await page.evaluate((inputSelectors) => {
                const editors = [...document.querySelectorAll('div.ql-editor[contenteditable="true"]')]
                    .filter((el) => el.offsetParent !== null);
                const el = editors.find((item) => item.closest('rich-textarea, input-container, .text-input-field, [class*="input-area"]'))
                    || editors[editors.length - 1]
                    || document.querySelector(inputSelectors[0]);
                el?.focus();
            }, INPUT_SELECTORS);
        }
        await sleep(180);
    }

    async clearComposer(page) {
        await page.evaluate((inputSelectors) => {
            const editors = [...document.querySelectorAll('div.ql-editor[contenteditable="true"]')]
                .filter((el) => el.offsetParent !== null);
            const el = editors.find((item) => item.closest('rich-textarea, input-container, .text-input-field, [class*="input-area"]'))
                || editors[editors.length - 1]
                || document.querySelector(inputSelectors[0]);
            if (!el) return;
            el.focus();
            if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
                const proto = el.tagName === 'TEXTAREA'
                    ? window.HTMLTextAreaElement.prototype
                    : window.HTMLInputElement.prototype;
                Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, '');
                el.dispatchEvent(new Event('input', { bubbles: true }));
                return;
            }
            const range = document.createRange();
            range.selectNodeContents(el);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            try { document.execCommand('delete'); } catch { el.innerHTML = '<p><br></p>'; }
            el.classList.add('ql-blank');
            el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContent' }));
        }, INPUT_SELECTORS);
        await sleep(120);
    }

    async insertPrompt(page, text) {
        const value = String(text || '');
        await this.focusComposer(page);
        await this.clearComposer(page);
        let state = await this.readComposer(page);
        if (state.chars > 12) {
            await this.clearComposer(page);
            state = await this.readComposer(page);
        }

        await this.insertDom(page, value);
        state = await this.readComposer(page);
        if (!composerMatches(state.text, value)) {
            await this.clearComposer(page);
            await this.insertDom(page, value);
            state = await this.readComposer(page);
        }
        if (!composerMatches(state.text, value) && state.chars < Math.min(20, value.length)) {
            await this.insertViaCdp(page, value);
            state = await this.readComposer(page);
        }

        const filled = await this.waitForComposer(
            page,
            (s) => composerMatches(s.text, value),
            Math.min(14000, 2800 + value.length / 6),
        );
        if (!composerMatches(filled.text, value)) {
            throw new Error('Ô nhập Gemini bị dính chữ cũ / nhập thiếu. Click vào ô chat, xóa hết, rồi gửi lại.');
        }

        await sleep(Math.min(900, 220 + Math.floor(value.length / 60)));
        await this.waitForComposer(page, (s) => s.sendEnabled && s.chars > 0, 6000);
        await sleep(180);
        return this.readComposer(page);
    }

    async insertDom(page, text) {
        await page.evaluate((value, inputSelectors) => {
            const pickInput = () => {
                const editors = [...document.querySelectorAll('div.ql-editor[contenteditable="true"]')]
                    .filter((el) => el.offsetParent !== null);
                const inBox = editors.find((el) => el.closest('rich-textarea, input-container, .text-input-field, [class*="input-area"]'));
                if (inBox) return inBox;
                if (editors.length) return editors[editors.length - 1];
                for (const sel of inputSelectors) {
                    const el = document.querySelector(sel);
                    if (el) return el;
                }
                return null;
            };

            const el = pickInput();
            if (!el) return;

            const read = () => String(el.innerText || el.value || el.textContent || '').replace(/\u200B/g, '').trim();

            if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
                const proto = el.tagName === 'TEXTAREA'
                    ? window.HTMLTextAreaElement.prototype
                    : window.HTMLInputElement.prototype;
                Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
                return;
            }

            el.focus();
            el.classList.remove('ql-blank');

            let node = el;
            let quill = null;
            while (node) {
                if (node.__quill) {
                    quill = node.__quill;
                    break;
                }
                node = node.parentElement;
            }
            if (quill) {
                try {
                    quill.setText(value.endsWith('\n') ? value : `${value}\n`, 'user');
                } catch {
                    // fall through
                }
            }

            const range = document.createRange();
            range.selectNodeContents(el);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            try {
                document.execCommand('insertText', false, value);
            } catch {
                // ignore
            }
            if (read().length < Math.min(24, value.length)) {
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
                data: value.slice(0, 200),
            }));
        }, text, INPUT_SELECTORS);
    }

    async insertViaCdp(page, text) {
        let session;
        try {
            session = await page.createCDPSession();
            await this.focusComposer(page);
            await this.clearComposer(page);
            await page.evaluate((inputSelectors) => {
                const editors = [...document.querySelectorAll('div.ql-editor[contenteditable="true"]')]
                    .filter((el) => el.offsetParent !== null);
                const el = editors.find((item) => item.closest('rich-textarea, input-container, .text-input-field, [class*="input-area"]'))
                    || editors[editors.length - 1]
                    || document.querySelector(inputSelectors[0]);
                if (!el) return;
                el.focus();
                el.classList.remove('ql-blank');
                const range = document.createRange();
                range.selectNodeContents(el);
                const selection = window.getSelection();
                selection.removeAllRanges();
                selection.addRange(range);
            }, INPUT_SELECTORS);

            const value = String(text || '');
            if (value.length <= 12000) {
                await session.send('Input.insertText', { text: value });
            } else {
                for (let i = 0; i < value.length; i += INSERT_CHUNK) {
                    this.throwIfCancelled();
                    await session.send('Input.insertText', { text: value.slice(i, i + INSERT_CHUNK) });
                    await sleep(40);
                }
            }
        } catch {
            // Chrome window may reject CDP input; DOM path already ran.
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

    composerLooksSent(state, beforeChars) {
        if (!state) return false;
        if (state.blank) return true;
        if (state.chars < 8) return true;
        return state.chars < Math.max(12, beforeChars * 0.12);
    }

    async findSendHandle(page) {
        for (const selector of SEND_SELECTORS) {
            const handles = await page.$$(selector);
            for (const handle of handles) {
                const ok = await handle.evaluate((btn) => {
                    if (!btn) return false;
                    if (btn.disabled || btn.getAttribute('aria-disabled') === 'true' || btn.classList.contains('disabled')) {
                        return false;
                    }
                    const rect = btn.getBoundingClientRect();
                    return rect.width > 8 && rect.height > 8;
                }).catch(() => false);
                if (ok) return handle;
            }
        }
        return null;
    }

    async clickSendOnce(page) {
        const handle = await this.findSendHandle(page);
        if (handle) {
            try {
                await handle.click({ delay: 45 });
                return true;
            } catch {
                // fall through to DOM click
            }
        }

        return page.evaluate((sendSelectors) => {
            const isDisabled = (btn) => Boolean(
                btn.disabled
                || btn.getAttribute('disabled') !== null
                || btn.getAttribute('aria-disabled') === 'true'
                || btn.classList.contains('disabled'),
            );
            const candidates = [];
            for (const sel of sendSelectors) {
                document.querySelectorAll(sel).forEach((el) => candidates.push(el));
            }
            document.querySelectorAll('button').forEach((btn) => {
                const label = `${btn.getAttribute('aria-label') || ''} ${btn.getAttribute('mattooltip') || ''} ${btn.className || ''}`.toLowerCase();
                if (/send|gửi|submit/.test(label)) candidates.push(btn);
            });
            const unique = [...new Set(candidates)];
            const enabled = unique.find((btn) => !isDisabled(btn)) || unique[0];
            if (!enabled) return false;
            enabled.click();
            return true;
        }, SEND_SELECTORS);
    }

    async clickSend(page) {
        const before = await this.readComposer(page);
        if (!before.chars) {
            throw new Error('Không bấm được nút gửi Gemini vì ô nhập vẫn trống.');
        }

        for (let attempt = 0; attempt < 4; attempt += 1) {
            this.throwIfCancelled();
            await this.waitForComposer(page, (s) => s.sendEnabled && s.chars > 0, 5000);
            await sleep(220 + attempt * 180);
            const clicked = await this.clickSendOnce(page);
            if (!clicked && attempt === 0) {
                await this.pressEnter(page);
            }
            const after = await this.waitForComposer(
                page,
                (s) => this.composerLooksSent(s, before.chars),
                1600 + attempt * 400,
            );
            if (this.composerLooksSent(after, before.chars)) return;
            await sleep(320 + attempt * 220);
        }

        await this.pressEnter(page);
        await sleep(700);
        const leftover = await this.readComposer(page);
        if (this.composerLooksSent(leftover, before.chars)) return;
        throw new Error(
            leftover.hasSend
                ? `Gemini treo ở ô nhập — ${leftover.chars} ký tự chưa gửi (nút "${leftover.sendLabel}" ${leftover.sendEnabled ? 'đã hiện' : 'vẫn tắt'}). Thử click ô chat rồi gửi lại.`
                : `Không thấy nút gửi Gemini. Ô nhập đang có ${leftover.chars} ký tự.`,
        );
    }

    async pressEnter(page) {
        let session;
        try {
            session = await page.createCDPSession();
            await session.send('Input.dispatchKeyEvent', {
                type: 'keyDown',
                key: 'Enter',
                code: 'Enter',
                windowsVirtualKeyCode: 13,
                nativeVirtualKeyCode: 13,
            });
            await session.send('Input.dispatchKeyEvent', {
                type: 'keyUp',
                key: 'Enter',
                code: 'Enter',
                windowsVirtualKeyCode: 13,
                nativeVirtualKeyCode: 13,
            });
            return true;
        } catch {
            return page.evaluate(() => {
                const el = document.querySelector('div.ql-editor[contenteditable="true"]')
                    || document.querySelector('[contenteditable="true"]');
                if (!el) return false;
                el.dispatchEvent(new KeyboardEvent('keydown', {
                    key: 'Enter',
                    code: 'Enter',
                    keyCode: 13,
                    which: 13,
                    bubbles: true,
                    cancelable: true,
                }));
                return true;
            });
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
                'button[aria-label="Dừng tạo"]',
                'button[aria-label="Dừng trả lời"]',
            ];
            const generating = stopSelectors.some((sel) => visible(document.querySelector(sel)))
                || Boolean(document.querySelector('[aria-label*="Stop generating" i], [aria-label*="Dừng tạo" i]'));
            const nodes = [
                ...document.querySelectorAll('model-response'),
                ...document.querySelectorAll('message-content'),
                ...document.querySelectorAll('[data-message-author-role="model"]'),
            ];
            const last = nodes[nodes.length - 1];
            return {
                generating,
                count: nodes.length,
                text: last ? String(last.innerText || '').trim() : '',
            };
        });
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
        throw new Error('Gemini trả lời quá lâu hoặc không thấy kết quả.');
    }

    async waitUntilIdle(page, timeout = 20000) {
        const started = Date.now();
        while (Date.now() - started < timeout) {
            this.throwIfCancelled();
            const reply = await this.readReplyState(page);
            const composer = await this.readComposer(page);
            if (!reply.generating && composer.hasInput) return;
            await sleep(280);
        }
    }

    async ask(page, prompt) {
        this.cancelled = false;
        await this.ensureOnGemini(page);
        await this.waitUntilIdle(page);
        const before = await this.readReplyState(page);
        await this.insertPrompt(page, prompt);
        await this.clickSend(page);
        return this.waitUntilDone(page, before);
    }
}

module.exports = GeminiAgent;
