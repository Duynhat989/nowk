const { defineConfig } = require('vite');
const vue = require('@vitejs/plugin-vue');
const path = require('path');

module.exports = defineConfig({
    plugins: [vue({
        template: {
            compilerOptions: {
                isCustomElement: (tag) => tag === 'webview',
            },
        },
    })],
    root: path.join(__dirname, 'renderer'),
    base: './',
    build: {
        outDir: path.join(__dirname, 'dist-ui'),
        emptyOutDir: true,
    },
    server: {
        port: 24202,
        strictPort: true,
    },
});
