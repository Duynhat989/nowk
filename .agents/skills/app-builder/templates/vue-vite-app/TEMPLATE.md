---
name: vue-vite-app
description: Vue 3 + Vite SPA. Router, Pinia, CSS variables. Default when the user wants Vue/Vite or a generic website UI (not Nuxt).
---

# Vue 3 + Vite SPA

Use with skill `vue-vite-app`. Read `.agents/skills/vue-vite-app/structure.md` for the full tree.

## Tech stack

| Piece | Choice |
|-------|--------|
| App | Vue 3, `<script setup>` |
| Bundler | Vite |
| Router | vue-router |
| State | Pinia |
| Styles | `src/assets/styles/` CSS variables, no default Tailwind, no gradients |
| Icons | `lucide-vue-next` — [lucide.dev/icons](https://lucide.dev/icons/), no emoji |

## Scaffold

`npm create vite@latest . -- --template vue` then `npm install vue-router@4 pinia lucide-vue-next`. Alias `@` → `src`. Icons: [lucide.dev/icons](https://lucide.dev/icons/). No emoji.

`src/main.js` must `app.use(createPinia()).use(router)` then `mount`. Router file exports `createRouter({ history: createWebHistory(), routes })`.

Templates: `<RouterView />` in App/layouts, `<RouterLink>` in Header/Footer. Always `import { RouterView, RouterLink } from 'vue-router'`. Never kebab-case router tags.

Follow structure.md + router.md. `App.vue` is router-only. Vague product briefs: complete-product.md (many routes, not a demo).
