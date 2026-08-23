class GeminiWebAdapter {
    constructor(gemini) {
        this.gemini = gemini;
        this.turns = 0;
        this.chars = 0;
    }

    needsCompress() {
        return this.turns >= 12 || this.chars > 90000;
    }

    async send(page, message) {
        const text = String(message || '');
        this.turns += 1;
        this.chars += text.length;
        const raw = await this.gemini.ask(page, text);
        this.chars += String(raw || '').length;
        return String(raw || '');
    }
}

module.exports = GeminiWebAdapter;
