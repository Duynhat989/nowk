const crypto = require('crypto');

class FingerprintGenerator {
    constructor() {
        this.timezones = [
            { name: 'Asia/Ho_Chi_Minh', offset: -420 },
            { name: 'Asia/Bangkok', offset: -420 },
            { name: 'Asia/Singapore', offset: -480 },
            { name: 'Asia/Tokyo', offset: -540 },
            { name: 'America/New_York', offset: 300 },
            { name: 'Europe/London', offset: 0 },
        ];
    }

    hashSeed(input) {
        const hex = crypto.createHash('sha256').update(String(input)).digest('hex');
        return parseInt(hex.slice(0, 8), 16);
    }

    pickFromSeed(seed, pool) {
        return pool[seed % pool.length];
    }

    getOffsetFor(timezoneName) {
        const tz = this.timezones.find(t => t.name === timezoneName);
        return tz?.offset ?? -420;
    }

    generateNative() {
        return { mode: 'native' };
    }

    generateStealth() {
        return { mode: 'stealth' };
    }

    /**
     * Fingerprint nhẹ, cố định theo profile ID.
     * Không đổi User-Agent, Screen, WebGL vendor/renderer, CPU, RAM.
     */
    generateConsistent(profileId = crypto.randomUUID()) {
        const seed = this.hashSeed(profileId);
        const tz = this.pickFromSeed(seed, this.timezones);

        return {
            mode: 'consistent',
            profileSeed: String(profileId),
            noiseSeed: seed,
            timezone: tz.name,
            timezoneOffset: tz.offset,
            language: 'vi-VN',
            canvasNoise: true,
            audioNoise: true,
            disableWebRTC: true,
        };
    }

    generate() {
        return {
            mode: 'custom',
            language: 'vi-VN',
            timezone: 'Asia/Ho_Chi_Minh',
            timezoneOffset: -420,
            canvasNoise: false,
            disableWebRTC: false,
        };
    }
}

module.exports = FingerprintGenerator;
