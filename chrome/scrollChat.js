'use strict';

async function scrollChatToBottom(page) {
    if (!page || page.isClosed?.()) return;
    try {
        await page.evaluate(() => {
            const last = [
                ...document.querySelectorAll(
                    [
                        'model-response',
                        'message-content',
                        '[data-message-author-role="model"]',
                        '[data-message-author-role="assistant"]',
                        '[data-testid="conversation-turn"]',
                        '.ds-markdown',
                        '.result-streaming',
                    ].join(','),
                ),
            ].at(-1);
            const roots = new Set([
                last?.closest('infinite-scroller'),
                last?.closest('[class*="overflow-y"]'),
                last?.closest('[class*="scroll"]'),
                document.querySelector('infinite-scroller'),
                document.querySelector('main'),
                document.scrollingElement,
                document.documentElement,
                document.body,
            ].filter(Boolean));
            for (const el of roots) {
                try { el.scrollTop = el.scrollHeight; } catch { /* ignore */ }
            }
            if (last) last.scrollIntoView({ block: 'end', inline: 'nearest', behavior: 'auto' });
            window.scrollTo(0, document.documentElement.scrollHeight || document.body.scrollHeight);
        });
    } catch {
        /* page navigated or detached */
    }
}

module.exports = { scrollChatToBottom };
