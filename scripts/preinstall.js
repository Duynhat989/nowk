const fs = require('fs');
const path = require('path');

if (String(process.env.npm_config_global || '') !== 'true') {
    process.exit(0);
}

const dist = path.join(__dirname, '..', 'node_modules', 'electron', 'dist');
try {
    fs.rmSync(dist, { recursive: true, force: true });
} catch {
    /* ignore */
}
