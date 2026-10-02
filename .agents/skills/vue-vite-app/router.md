# Vue Router wiring (mandatory)

## Tags in templates (hard ban)

In every `.vue` file, router components MUST be PascalCase:

- `<RouterView />`
- `<RouterLink to="...">`

Forbidden in `<template>`: kebab-case `router-view` and `router-link`.
Those names make Vue warn `Failed to resolve component`. Do not emit them, even with an import.

Every SFC that uses them:

```vue
<script setup>
import { RouterLink, RouterView } from 'vue-router'
</script>

<template>
  <RouterView />
</template>
```

```vue
<script setup>
import { RouterLink } from 'vue-router'
</script>

<template>
  <nav>
    <RouterLink to="/">Home</RouterLink>
  </nav>
</template>
```

`App.vue` and layouts: only `RouterView`. Header / Footer / nav: only `RouterLink`.

## 1. Dependency

`package.json` must list `vue-router` (v4 for Vue 3):

```bash
npm install vue-router@4 pinia
```

## 2. `src/router/index.js` must export a router instance

```js
import { createRouter, createWebHistory } from 'vue-router'
import DefaultLayout from '@/layouts/DefaultLayout.vue'
import HomeView from '@/views/Home/HomeView.vue'

const routes = [
  {
    path: '/',
    component: DefaultLayout,
    children: [{ path: '', name: 'home', component: HomeView }],
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

export default router
```

Do not default-export a plain `routes` array.

## 3. `src/main.js` must `.use(router)` before `.mount`

```js
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import './assets/styles/main.css'

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
```

## 4. Check before done

- `vue-router` in `package.json`
- `app.use(router)` in `main.js`
- Grep `.vue`: zero kebab `router-view` / `router-link`; only `RouterView` / `RouterLink` plus imports
