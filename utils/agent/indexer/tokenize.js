const DIM = 256;

const STOP = new Set([
    'the', 'and', 'for', 'with', 'this', 'that', 'from', 'into', 'your', 'are',
    'const', 'let', 'var', 'return', 'import', 'export', 'default', 'function',
    'class', 'async', 'await', 'true', 'false', 'null', 'undefined', 'this',
    'file', 'code', 'please', 'project',
    'tạo', 'thêm', 'sửa', 'viết', 'cho', 'của', 'các', 'một', 'này', 'làm',
    'trong', 'với', 'được', 'muốn', 'giúp', 'dùng', 'thử',
]);

function splitIdent(word) {
    return String(word || '')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .replace(/[_./\\-]+/g, ' ');
}

function tokens(text) {
    const out = [];
    const parts = splitIdent(text)
        .toLowerCase()
        .split(/[^a-z0-9à-ỹ]+/i);
    for (const part of parts) {
        const word = part.trim();
        if (word.length < 2 || STOP.has(word)) continue;
        if (/^\d+$/.test(word)) continue;
        out.push(word);
    }
    return out;
}

function hash32(text) {
    let h = 2166136261;
    const src = String(text || '');
    for (let i = 0; i < src.length; i += 1) {
        h ^= src.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function embed(text) {
    const vec = new Float32Array(DIM);
    const words = tokens(text);
    if (!words.length) return vec;
    for (const word of words) {
        const h = hash32(word);
        const idx = h % DIM;
        const sign = (h & 1) ? 1 : -1;
        const weight = Math.min(3, 0.6 + word.length / 12);
        vec[idx] += sign * weight;
        vec[(h >>> 8) % DIM] += sign * weight * 0.35;
    }
    let norm = 0;
    for (let i = 0; i < DIM; i += 1) norm += vec[i] * vec[i];
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < DIM; i += 1) vec[i] /= norm;
    return vec;
}

function cosine(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    let sum = 0;
    for (let i = 0; i < a.length; i += 1) sum += a[i] * b[i];
    return sum;
}

function encodeVec(vec) {
    const buf = Buffer.allocUnsafe(vec.length);
    for (let i = 0; i < vec.length; i += 1) {
        buf[i] = Math.max(0, Math.min(255, Math.round((vec[i] + 1) * 127.5)));
    }
    return buf.toString('base64');
}

function decodeVec(raw) {
    const buf = Buffer.from(String(raw || ''), 'base64');
    const vec = new Float32Array(DIM);
    const n = Math.min(DIM, buf.length);
    for (let i = 0; i < n; i += 1) vec[i] = buf[i] / 127.5 - 1;
    return vec;
}

module.exports = {
    DIM,
    tokens,
    embed,
    cosine,
    encodeVec,
    decodeVec,
};
