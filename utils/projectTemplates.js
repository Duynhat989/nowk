function filesFor(kind, name) {
    const app = name || 'app';
    if (kind === 'vue3') {
        return {
            'package.json': JSON.stringify({
                name: app,
                private: true,
                version: '0.1.0',
                type: 'module',
                scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
                dependencies: { vue: '^3.5.16' },
                devDependencies: { '@vitejs/plugin-vue': '^5.2.4', vite: '^6.3.5' },
            }, null, 2) + '\n',
            'vite.config.js': `import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
});
`,
            'index.html': `<!doctype html>
<html lang="vi">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${app}</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
`,
            'src/main.js': `import { createApp } from 'vue';
import App from './App.vue';
import './style.css';

createApp(App).mount('#app');
`,
            'src/App.vue': `<script setup>
const title = '${app}';
</script>

<template>
  <main class="page">
    <h1>{{ title }}</h1>
    <p>Vue 3 · script setup</p>
  </main>
</template>
`,
            'src/style.css': `* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, sans-serif; background: #0f1115; color: #e8eaed; }
.page { max-width: 720px; margin: 12vh auto; padding: 0 24px; }
h1 { font-size: 2rem; }
p { color: #9aa0a6; }
`,
            'README.md': `# ${app}\n\nVue 3 (script setup) + Vite.\n\n\`\`\`bash\nnpm install\nnpm run dev\n\`\`\`\n`,
        };
    }

    if (kind === 'node') {
        return {
            'package.json': JSON.stringify({
                name: app,
                version: '0.1.0',
                private: true,
                type: 'module',
                main: 'src/index.js',
                scripts: { start: 'node src/index.js' },
            }, null, 2) + '\n',
            'src/index.js': `console.log('${app} sẵn sàng');\n`,
            'README.md': `# ${app}\n\nNode.js.\n\n\`\`\`bash\nnpm start\n\`\`\`\n`,
        };
    }

    if (kind === 'electron') {
        return {
            'package.json': JSON.stringify({
                name: app,
                version: '0.1.0',
                private: true,
                main: 'main.js',
                scripts: { start: 'electron .' },
                devDependencies: { electron: '^35.7.5' },
            }, null, 2) + '\n',
            'main.js': `const { app, BrowserWindow } = require('electron');

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile('index.html');
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
`,
            'index.html': `<!doctype html>
<html lang="vi">
  <head>
    <meta charset="UTF-8" />
    <title>${app}</title>
    <style>
      body { margin: 0; font-family: system-ui, sans-serif; background: #16181d; color: #eee; }
      main { padding: 48px; }
    </style>
  </head>
  <body>
    <main>
      <h1>${app}</h1>
      <p>Cửa sổ Electron.</p>
    </main>
  </body>
</html>
`,
            'README.md': `# ${app}\n\nElectron.\n\n\`\`\`bash\nnpm install\nnpm start\n\`\`\`\n`,
        };
    }

    if (kind === 'extension') {
        return {
            'manifest.json': JSON.stringify({
                manifest_version: 3,
                name: app,
                version: '0.1.0',
                description: app,
                action: { default_popup: 'popup.html', default_title: app },
            }, null, 2) + '\n',
            'popup.html': `<!doctype html>
<html lang="vi">
  <head>
    <meta charset="UTF-8" />
    <title>${app}</title>
    <style>
      body { width: 260px; margin: 0; padding: 16px; font-family: system-ui, sans-serif; }
    </style>
  </head>
  <body>
    <h1>${app}</h1>
    <button id="go" type="button">OK</button>
    <script src="popup.js"></script>
  </body>
</html>
`,
            'popup.js': `document.getElementById('go')?.addEventListener('click', () => {
  document.querySelector('h1').textContent = 'NowK extension';
});
`,
            'README.md': `# ${app}\n\nChrome extension (Manifest V3).\nchrome://extensions → Load unpacked.\n`,
        };
    }

    return {
        'index.html': `<!doctype html>
<html lang="vi">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${app}</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <main>
      <h1>${app}</h1>
      <p>HTML / CSS / JS.</p>
    </main>
    <script src="app.js"></script>
  </body>
</html>
`,
        'styles.css': `body { margin: 0; font-family: system-ui, sans-serif; background: #111; color: #eee; }
main { padding: 48px; }
`,
        'app.js': `console.log('${app}');\n`,
        'README.md': `# ${app}\n\nMở index.html trong trình duyệt.\n`,
    };
}

function gitignore() {
    return `node_modules
dist
dist-ui
.DS_Store
*.log
.env
`;
}

const KINDS = [
    {
        id: 'vue3',
        prompt: 'Hoàn thiện project Vue 3 script setup + Vite: thêm layout, trang Home, và chạy được npm run dev.',
    },
    {
        id: 'node',
        prompt: 'Hoàn thiện project Node.js: thêm script start rõ ràng và một endpoint hoặc CLI hữu ích.',
    },
    {
        id: 'electron',
        prompt: 'Hoàn thiện app Electron: cửa sổ chính, preload an toàn, và nút trên UI có hành vi thật.',
    },
    {
        id: 'extension',
        prompt: 'Hoàn thiện Chrome extension MV3: popup, quyền tối thiểu, và một hành động trên tab hiện tại.',
    },
    {
        id: 'html',
        prompt: 'Hoàn thiện trang HTML/CSS/JS tĩnh: layout đẹp, responsive, không framework.',
    },
];

function listKinds() {
    return KINDS.map((item) => ({ id: item.id, prompt: item.prompt }));
}

function promptFor(kind) {
    return KINDS.find((item) => item.id === kind)?.prompt || '';
}

function scaffoldFiles(kind, name) {
    return {
        ...filesFor(kind, name),
        '.gitignore': gitignore(),
    };
}

module.exports = { listKinds, promptFor, scaffoldFiles, KINDS };
