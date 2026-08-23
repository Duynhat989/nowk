const PROVIDERS = {
    gemini: {
        id: 'gemini',
        name: 'Gemini',
        urlRe: /gemini\.google\.com/i,
        openUrl: 'https://gemini.google.com/app?hl=vi',
    },
    chatgpt: {
        id: 'chatgpt',
        name: 'ChatGPT',
        urlRe: /chatgpt\.com|chat\.openai\.com/i,
        openUrl: 'https://chatgpt.com',
    },
    deepseek: {
        id: 'deepseek',
        name: 'DeepSeek',
        urlRe: /chat\.deepseek\.com/i,
        openUrl: 'https://chat.deepseek.com/',
    },
};

function resolveProvider(id) {
    return PROVIDERS[id] || PROVIDERS.gemini;
}

function isKnownProvider(id) {
    return Boolean(PROVIDERS[id]);
}

module.exports = { PROVIDERS, resolveProvider, isKnownProvider };
