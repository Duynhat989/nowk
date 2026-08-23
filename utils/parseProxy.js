/**
 * Chuẩn hóa cấu hình proxy từ form hoặc profile.
 * Hỗ trợ dán: 160.250.166.24:10413, http://host:port, user:pass@host:port
 */
function parseProxy(proxy) {
    if (!proxy?.enabled) {
        return {
            enabled: false,
            type: 'http',
            host: '',
            port: '',
            username: '',
            password: '',
            valid: false,
        };
    }

    let host = String(proxy.host || '').trim();
    let port = String(proxy.port ?? '').trim();
    let username = String(proxy.username || '').trim();
    let password = proxy.password || '';
    let type = proxy.type === 'socks5' ? 'socks5' : 'http';

    host = host.replace(/^https?:\/\//i, '').replace(/^socks5h?:\/\//i, '');

    const credAt = host.match(/^([^:@/]+):([^@/]+)@(.+)$/);
    if (credAt) {
        username = credAt[1];
        password = credAt[2];
        host = credAt[3];
    }

    if (host.includes(':') && !port) {
        const lastColon = host.lastIndexOf(':');
        const maybePort = host.slice(lastColon + 1);
        if (/^\d{1,5}$/.test(maybePort)) {
            port = maybePort;
            host = host.slice(0, lastColon);
        }
    }

    host = host.replace(/\/+$/, '');

    const portNum = parseInt(port, 10);
    const valid = Boolean(host && Number.isFinite(portNum) && portNum > 0 && portNum <= 65535);

    return {
        enabled: true,
        type,
        host,
        port: valid ? String(portNum) : port,
        username,
        password,
        valid,
    };
}

function buildProxyServerUrl(proxy) {
    const parsed = parseProxy(proxy);
    if (!parsed.enabled || !parsed.valid) return null;
    const scheme = parsed.type === 'socks5' ? 'socks5' : 'http';
    return `${scheme}://${parsed.host}:${parsed.port}`;
}

module.exports = { parseProxy, buildProxyServerUrl };
