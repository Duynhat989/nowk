class FingerprintInjector {
    constructor(options = {}) {
        this.options = options;
        this.mode = options.mode || 'native';
    }

    async inject(page) {
        if (this.mode === 'native') return;
        if (this.mode === 'stealth') return this.injectStealth(page);
        if (this.mode === 'consistent') return this.injectConsistent(page);
        return this.injectCustom(page);
    }

    async injectStealth(page) {
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined,
                configurable: true,
            });
            if (!window.chrome) window.chrome = { runtime: {} };
        });
    }

    async injectConsistent(page) {
        const opts = this.options;
        await page.evaluateOnNewDocument(FingerprintInjector.consistentScript, {
            noiseSeed: opts.noiseSeed || 1,
            timezone: opts.timezone || null,
            timezoneOffset: opts.timezoneOffset ?? null,
            canvasNoise: opts.canvasNoise !== false,
            audioNoise: opts.audioNoise !== false,
            disableWebRTC: opts.disableWebRTC !== false,
        });
    }

    async injectCustom(page) {
        const opts = this.options;
        await page.evaluateOnNewDocument(FingerprintInjector.customScript, opts);
    }

    static consistentScript(opts) {
        // Stealth cơ bản
        Object.defineProperty(navigator, 'webdriver', {
            get: () => undefined,
            configurable: true,
        });
        if (!window.chrome) window.chrome = { runtime: {} };

        const seed = opts.noiseSeed >>> 0;

        // Timezone — khớp proxy/region, không đổi UA
        if (opts.timezone) {
            const tz = opts.timezone;
            const offset = opts.timezoneOffset;
            const OrigDTF = Intl.DateTimeFormat;
            Intl.DateTimeFormat = function (...args) {
                return new OrigDTF(...args);
            };
            Intl.DateTimeFormat.prototype = OrigDTF.prototype;
            Intl.DateTimeFormat.supportedLocalesOf = OrigDTF.supportedLocalesOf;
            Intl.DateTimeFormat.prototype.resolvedOptions = function () {
                return { ...OrigDTF.prototype.resolvedOptions.call(this), timeZone: tz };
            };
            if (offset != null) {
                Date.prototype.getTimezoneOffset = () => offset;
            }
        }

        // WebRTC leak
        if (opts.disableWebRTC) {
            const origOffer = RTCPeerConnection.prototype.createOffer;
            RTCPeerConnection.prototype.createOffer = function (...args) {
                return origOffer.apply(this, args).then(offer => {
                    const sdp = offer.sdp.replace(/a=candidate:.*\r\n/g, '');
                    return new RTCSessionDescription({ type: offer.type, sdp });
                });
            };
        }

        const pixelNoise = (i) => ((seed + i * 2654435761) >>> 0) % 3;

        // Canvas noise cố định theo seed profile
        if (opts.canvasNoise) {
            const patchCanvas = (canvas) => {
                try {
                    const ctx = canvas.getContext('2d');
                    if (!ctx || !canvas.width || !canvas.height) return;
                    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
                    for (let i = 0; i < img.data.length; i += 4) {
                        const n = pixelNoise(i >> 2);
                        img.data[i] = Math.min(255, img.data[i] + n);
                    }
                    ctx.putImageData(img, 0, 0);
                } catch { /* ignore */ }
            };

            const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
            HTMLCanvasElement.prototype.toDataURL = function (...args) {
                patchCanvas(this);
                return origToDataURL.apply(this, args);
            };

            const origToBlob = HTMLCanvasElement.prototype.toBlob;
            HTMLCanvasElement.prototype.toBlob = function (...args) {
                patchCanvas(this);
                return origToBlob.apply(this, args);
            };
        }

        // WebGL image noise nhẹ — không đổi vendor/renderer
        if (opts.canvasNoise) {
            const patchReadPixels = (proto) => {
                if (!proto) return;
                const orig = proto.readPixels;
                proto.readPixels = function (x, y, w, h, format, type, pixels) {
                    const result = orig.call(this, x, y, w, h, format, type, pixels);
                    if (pixels && pixels.length) {
                        for (let i = 0; i < pixels.length; i += 4) {
                            const n = pixelNoise(i + seed);
                            pixels[i] = Math.min(255, pixels[i] + n);
                        }
                    }
                    return result;
                };
            };
            patchReadPixels(WebGLRenderingContext?.prototype);
            patchReadPixels(WebGL2RenderingContext?.prototype);
        }

        // Audio noise cố định theo seed
        if (opts.audioNoise) {
            const origGetChannelData = AudioBuffer.prototype.getChannelData;
            AudioBuffer.prototype.getChannelData = function (channel) {
                const data = origGetChannelData.call(this, channel);
                const n = (seed % 10) * 0.0000001;
                for (let i = 0; i < data.length; i += 100) {
                    data[i] += n;
                }
                return data;
            };
        }
    }

    static customScript(opts) {
        Object.defineProperty(navigator, 'webdriver', {
            get: () => undefined,
            configurable: true,
        });

        if (opts.timezone) {
            const tz = opts.timezone;
            const OrigDTF = Intl.DateTimeFormat;
            Intl.DateTimeFormat = function (...args) { return new OrigDTF(...args); };
            Intl.DateTimeFormat.prototype = OrigDTF.prototype;
            Intl.DateTimeFormat.prototype.resolvedOptions = function () {
                return { ...OrigDTF.prototype.resolvedOptions.call(this), timeZone: tz };
            };
            if (opts.timezoneOffset != null) {
                Date.prototype.getTimezoneOffset = () => opts.timezoneOffset;
            }
        }

        if (opts.disableWebRTC) {
            const origOffer = RTCPeerConnection.prototype.createOffer;
            RTCPeerConnection.prototype.createOffer = function (...args) {
                return origOffer.apply(this, args).then(offer => {
                    const sdp = offer.sdp.replace(/a=candidate:.*\r\n/g, '');
                    return new RTCSessionDescription({ type: offer.type, sdp });
                });
            };
        }

        if (opts.screen) {
            const s = opts.screen;
            if (s.width) Object.defineProperty(screen, 'width', { get: () => s.width });
            if (s.height) Object.defineProperty(screen, 'height', { get: () => s.height });
            if (s.availWidth) Object.defineProperty(screen, 'availWidth', { get: () => s.availWidth });
            if (s.availHeight) Object.defineProperty(screen, 'availHeight', { get: () => s.availHeight });
        }

        if (opts.cpuCores) {
            Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => opts.cpuCores });
        }
        if (opts.ram) {
            Object.defineProperty(navigator, 'deviceMemory', { get: () => opts.ram });
        }

        if (opts.webglVendor || opts.webglRenderer) {
            const vendor = opts.webglVendor || '';
            const renderer = opts.webglRenderer || '';
            const patch = (proto) => {
                if (!proto) return;
                const orig = proto.getParameter;
                proto.getParameter = function (param) {
                    const info = this.getExtension('WEBGL_debug_renderer_info');
                    if (info) {
                        if (param === info.UNMASKED_VENDOR_WEBGL && vendor) return vendor;
                        if (param === info.UNMASKED_RENDERER_WEBGL && renderer) return renderer;
                    }
                    return orig.call(this, param);
                };
            };
            patch(WebGLRenderingContext?.prototype);
            patch(WebGL2RenderingContext?.prototype);
        }

        if (opts.canvasNoise) {
            const patch = (canvas) => {
                const ctx = canvas.getContext('2d');
                if (!ctx) return;
                const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
                for (let i = 0; i < img.data.length; i += 4) img.data[i] += 1;
                ctx.putImageData(img, 0, 0);
            };
            const orig = HTMLCanvasElement.prototype.toDataURL;
            HTMLCanvasElement.prototype.toDataURL = function (...args) {
                patch(this);
                return orig.apply(this, args);
            };
        }
    }
}

module.exports = FingerprintInjector;
