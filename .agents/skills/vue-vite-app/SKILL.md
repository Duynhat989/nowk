---
name: vue-vite-app
description: Build Vue 3 + Vite UIs as a complete product. Split files and features. Default src/ layout when the user does not specify folders. Modern monochrome look, photos for demos, Lucide icons (no emoji), no CSS gradients. Use for Vue, Vite, giao dien, website, landing, or any new web UI scaffold.
when_to_use: "When creating or expanding a Vue/Vite app, building a website or giao dien, or when the UI request is vague. Also when scaffolding frontend folders. NOT for native mobile."
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
version: 1.0.0
---

# Vue + Vite product UI

> Read sibling files before writing code. Do not dump a whole app into `App.vue`.

| File | When |
|------|------|
| [structure.md](structure.md) | Folder tree, Pinia, router, services |
| [router.md](router.md) | Install + `app.use(router)` or RouterView will fail |
| [complete-product.md](complete-product.md) | Vague brief → full site + many features |
| [visual-rules.md](visual-rules.md) | Modern, photos, solid colors, Lucide icons, no emoji, no gradients |
| [icons.md](icons.md) | `lucide-vue-next` from lucide.dev/icons — never emoji |
| [split-work.md](split-work.md) | Split files in src; do not split one user chat into many plans |

## Stack (unless the user names another)

Vue 3 `<script setup>` · Vue Router · Pinia · Vite · `lucide-vue-next` · CSS variables in `src/assets/styles/` · no Tailwind unless already in the project.

## Hard gates

1. Create **only files this user goal needs**. Do not add `TheHeaderEnhanced.vue` / `*Correct.vue` — edit `TheHeader.vue` in place.
2. If the brief is a full product website, add real routes/views for that product — still no unused boilerplate files.
3. Split files when a view gets large: view + feature components + store/service as used. Never one 400-line SFC for unrelated features.
4. Visuals: **visual-rules.md** + **icons.md**. Lucide, no emoji, no CSS gradients.
5. **Vue Router:** follow **router.md**. `app.use(router)` before `mount`. `<RouterView />` / `<RouterLink>` only.
6. **verify-changes (always):** `run_start` (`npm run dev`) and keep going until Local URL works. `done=true` is forbidden while the app does not run.

## First actions

1. `list_files` the project. `read_file` only the sibling skill docs you will apply (router/visual), not all of them.
2. After reads, fill plan[]. Then create_file / edit_file **one path per JSON**.
3. Wire router in `main.js` if you added routes. Grep kebab router tags.
4. `run_start` and fix errors. Do not mark done without a running app.
