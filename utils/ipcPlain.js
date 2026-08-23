function toPlain(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
}

module.exports = { toPlain };
