'use strict';

const path = require('path');

function pascal(name) {
    return String(name || 'Page')
        .replace(/\.[^.]+$/, '')
        .split(/[-_/]/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join('') || 'Page';
}

function altPaths(relPath) {
    const rel = String(relPath || '').replace(/\\/g, '/');
    const ext = path.posix.extname(rel);
    const stem = rel.slice(0, rel.length - ext.length);
    const alts = [rel];
    if (ext === '.js') alts.push(`${stem}.ts`, `${stem}.mjs`);
    if (ext === '.ts') alts.push(`${stem}.js`);
    if (ext === '.jsx') alts.push(`${stem}.tsx`, `${stem}.vue`);
    if (ext === '.vue') alts.push(`${stem}.jsx`, `${stem}.tsx`);
    if (/\/index\.(js|ts)$/.test(rel)) {
        alts.push(rel.replace(/\/index\.(js|ts)$/, '.js'));
        alts.push(rel.replace(/\/index\.(js|ts)$/, '.ts'));
    }
    return [...new Set(alts)];
}

function vueApp() {
    return `<template>
  <RouterView />
</template>

<script setup>
import { RouterView } from 'vue-router'
</script>
`;
}

function vueLayout(name) {
    return `<template>
  <div class="${name}">
    <RouterView />
  </div>
</template>

<script setup>
import { RouterView } from 'vue-router'
</script>
`;
}

function vueChrome(kind) {
    const isHeader = /header/i.test(kind);
    return `<template>
  <${isHeader ? 'header' : 'footer'} class="${kind}">
    <RouterLink to="/">Home</RouterLink>
  </${isHeader ? 'header' : 'footer'}>
</template>

<script setup>
import { RouterLink } from 'vue-router'
</script>
`;
}

function vueMain() {
    return `import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import './assets/styles/main.css'

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
`;
}

function vuePage(relPath) {
    const name = pascal(relPath.split('/').pop());
    return `<template>
  <section class="page">
    <h1>${name}</h1>
  </section>
</template>

<script setup>
</script>

<style scoped>
.page {
  padding: 24px;
}
</style>
`;
}

function piniaStore(relPath) {
    const id = String(relPath.split('/').pop() || 'app').replace(/\.\w+$/, '');
    return `import { defineStore } from 'pinia';
import { ref } from 'vue';

export const use${pascal(id)}Store = defineStore('${id}', () => {
  const items = ref([]);
  return { items };
});
`;
}

function vueRouter(routes) {
    const lines = (routes || []).length
        ? routes.map((item) => (
            `  { path: '${item.path}', name: '${item.name}', component: () => import('${item.import}') },`
        )).join('\n')
        : `  { path: '/', name: 'home', component: () => import('../views/Home/HomeView.vue') },`;
    return `import { createRouter, createWebHistory } from 'vue-router';

const routes = [
${lines}
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

export default router;
`;
}

function genericStub(relPath) {
    const rel = String(relPath || '').replace(/\\/g, '/');
    if (/(^|\/)App\.vue$/i.test(rel)) return vueApp();
    if (/layouts\/.+\.vue$/i.test(rel)) return vueLayout(pascal(rel.split('/').pop()));
    if (/(AppHeader|Header|AppFooter|Footer)\.vue$/i.test(rel)) {
        return vueChrome(/footer/i.test(rel) ? 'footer' : 'header');
    }
    if (/(^|\/)main\.(js|ts)$/i.test(rel) && /src\//i.test(rel)) return vueMain();
    if (/\.vue$/i.test(rel)) return vuePage(rel);
    if (/\.css$/i.test(rel)) return `/* ${relPath} */\n`;
    if (/\.json$/i.test(rel)) return '{}\n';
    if (/stores\//i.test(rel)) return piniaStore(rel);
    if (/\.(js|ts|mjs|cjs)$/i.test(rel)) {
        return `export default {}\n`;
    }
    return `// ${relPath}\n`;
}

async function collectViewRoutes(workspace, root) {
    const routes = [];
    const walk = async (rel, depth) => {
        if (depth > 4 || routes.length >= 16) return;
        let nodes = [];
        try {
            nodes = await workspace.listDir(root, rel);
        } catch {
            return;
        }
        for (const node of nodes || []) {
            if (node.type === 'dir') {
                await walk(node.path, depth + 1);
                continue;
            }
            if (!/\.vue$/i.test(node.path || '')) continue;
            const relVue = String(node.path).replace(/\\/g, '/');
            const base = relVue.replace(/^src\/views\//i, '').replace(/\.vue$/i, '');
            const slug = base.replace(/View$/i, '').split('/').filter(Boolean);
            const last = slug[slug.length - 1] || 'home';
            const routePath = last.toLowerCase() === 'home' && slug.length === 1
                ? '/'
                : `/${slug.map((part) => part.replace(/View$/i, '').toLowerCase()).join('/')}`;
            routes.push({
                path: routePath,
                name: last.replace(/View$/i, '').toLowerCase(),
                import: `../${relVue.replace(/^src\//i, '')}`,
            });
        }
    };
    await walk('src/views', 0);
    if (!routes.some((item) => item.path === '/')) {
        routes.unshift({
            path: '/',
            name: 'home',
            import: '../views/Home/HomeView.vue',
        });
    }
    return routes;
}

async function stubFor(workspace, root, relPath) {
    const rel = String(relPath || '').replace(/\\/g, '/');
    if (/router\/index\.(js|ts)$/i.test(rel) || /src\/router\.(js|ts)$/i.test(rel)) {
        const routes = await collectViewRoutes(workspace, root);
        return vueRouter(routes);
    }
    return genericStub(rel);
}

module.exports = {
    altPaths,
    stubFor,
    vueRouter,
    vuePage,
};
