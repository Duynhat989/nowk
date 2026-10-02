---
name: vue-ui-rules
version: 1.0.0
priority: P0
trigger: glob
globs: "**/*.{vue,css,scss},**/views/**,**/layouts/**"
---

# Vue / web UI scaffold (TIER 2)

Load skill `vue-vite-app` and read its split files (`structure.md`, `router.md`, `complete-product.md`, `visual-rules.md`, `icons.md`, `split-work.md`).

`vue-router` must be installed. `main.js` must `app.use(router)` before `mount`.

Templates: only `<RouterView />` and `<RouterLink>`. Import from `vue-router`. Kebab-case router tags are forbidden.

## Structure

If the user did not specify a tree, or `src/` is incomplete, use the Vue+Vite layout: `assets/styles` (main, variables, global), `components/common|layout|ui`, `views/<Area>/` + local `components/`, `layouts/`, `router/`, `stores/`, `composables/`, `services/`, `utils/`, `constants/`, `types/`, `App.vue`, `main.js`, `public/`, env files, `vite.config.js`.

`App.vue` must not contain the whole site.

## Vague or tiny apps

Generic "build UI / website / Vue app" = finished product: home + auth + dashboard + at least two domain features + settings, each in its own files. Do not leave a single-file demo.

## Look

Modern, near-monochrome (grays + one solid accent). Demo with **photos**. UI chrome: **Lucide** (`lucide-vue-next`, [lucide.dev/icons](https://lucide.dev/icons/)). No emoji. No CSS gradients. No three identical cards as the whole homepage.
