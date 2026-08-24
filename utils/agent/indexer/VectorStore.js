const fs = require('fs');
const path = require('path');
const { tokens, embed, cosine, encodeVec, decodeVec } = require('./tokenize');

class VectorStore {
    constructor() {
        this.chunks = [];
        this.df = new Map();
        this.avgLen = 1;
    }

    clear() {
        this.chunks = [];
        this.df = new Map();
        this.avgLen = 1;
    }

    removePath(relPath) {
        const rel = String(relPath || '');
        this.chunks = this.chunks.filter((item) => item.path !== rel && !String(item.path).startsWith(`${rel}#`));
        this.recomputeDf();
    }

    upsert(chunks) {
        const grouped = new Map();
        for (const chunk of chunks || []) {
            const list = grouped.get(chunk.path) || [];
            list.push(chunk);
            grouped.set(chunk.path, list);
        }
        for (const rel of grouped.keys()) this.removePath(rel);
        for (const chunk of chunks || []) {
            const blob = `${chunk.path} ${chunk.kind} ${chunk.name}\n${chunk.text}`;
            const words = tokens(blob);
            this.chunks.push({
                id: `${chunk.path}#${chunk.kind}#${chunk.start}`,
                path: chunk.path,
                kind: chunk.kind,
                name: chunk.name,
                start: chunk.start,
                end: chunk.end,
                preview: String(chunk.text || '').slice(0, 500),
                words,
                tf: count(words),
                vec: encodeVec(embed(blob)),
            });
        }
        this.recomputeDf();
    }

    recomputeDf() {
        this.df = new Map();
        let total = 0;
        for (const chunk of this.chunks) {
            total += chunk.words.length;
            const unique = new Set(chunk.words);
            for (const word of unique) this.df.set(word, (this.df.get(word) || 0) + 1);
        }
        this.avgLen = this.chunks.length ? total / this.chunks.length : 1;
    }

    search(query, { k = 12, kinds } = {}) {
        const qWords = tokens(query);
        if (!qWords.length && !String(query || '').trim()) return [];
        const qVec = embed(query);
        const qSet = new Set(qWords);
        const scored = [];
        for (const chunk of this.chunks) {
            if (kinds && !kinds.includes(chunk.kind)) continue;
            const dense = cosine(qVec, decodeVec(chunk.vec));
            const sparse = this.bm25(chunk, qWords);
            const pathHit = qWords.reduce((sum, word) => (
                sum + (String(chunk.path).toLowerCase().includes(word) ? 1.6 : 0)
                    + (String(chunk.name).toLowerCase().includes(word) ? 1.2 : 0)
            ), 0);
            const score = dense * 0.45 + sparse * 0.4 + pathHit * 0.15;
            if (score <= 0.02 && ![...qSet].some((word) => chunk.words.includes(word))) continue;
            scored.push({ ...chunk, score, vec: undefined, tf: undefined, words: undefined });
        }
        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, k);
    }

    bm25(chunk, qWords) {
        const n = this.chunks.length || 1;
        const dl = chunk.words.length || 1;
        let score = 0;
        for (const word of qWords) {
            const tf = chunk.tf[word] || 0;
            if (!tf) continue;
            const df = this.df.get(word) || 0;
            const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
            score += idf * (tf * 2.2) / (tf + 1.2 * (0.75 + 0.25 * dl / (this.avgLen || 1)));
        }
        return score;
    }

    dump(filePath, meta = null) {
        const dir = path.dirname(filePath);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify({
            v: 1,
            meta: meta || {},
            avgLen: this.avgLen,
            chunks: this.chunks.map((item) => ({
                id: item.id,
                path: item.path,
                kind: item.kind,
                name: item.name,
                start: item.start,
                end: item.end,
                preview: item.preview,
                words: item.words,
                vec: item.vec,
            })),
        }));
    }

    load(filePath) {
        if (!fs.existsSync(filePath)) return false;
        try {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            this.chunks = (data.chunks || []).map((item) => ({
                ...item,
                tf: count(item.words || []),
            }));
            this.recomputeDf();
            return data;
        } catch {
            this.clear();
            return null;
        }
    }
}

function count(words) {
    const map = Object.create(null);
    for (const word of words || []) map[word] = (map[word] || 0) + 1;
    return map;
}

module.exports = VectorStore;
