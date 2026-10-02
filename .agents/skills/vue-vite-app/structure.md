# Vue + Vite default structure

Use this tree as a **map**. Create a path only when the current feature imports it. Do not generate the whole tree, DESIGN.md, `.env`, Base* components, or unused utils.

```
src/
├── assets/
│   ├── images/
│   ├── icons/
│   └── styles/
│       ├── main.css
│       ├── variables.css
│       └── global.css
├── components/
│   ├── common/
│   │   ├── BaseButton.vue
│   │   ├── BaseInput.vue
│   │   └── BaseModal.vue
├── components/layout/
│   ├── AppHeader.vue
│   ├── AppSidebar.vue
│   └── AppFooter.vue
├── components/ui/
│   ├── Loading.vue
│   └── EmptyState.vue
├── views/
│   ├── Home/HomeView.vue + components/
│   ├── Auth/LoginView.vue + RegisterView.vue + components/
│   └── Dashboard/DashboardView.vue + components/
├── layouts/
│   ├── DefaultLayout.vue
│   ├── AuthLayout.vue
│   └── DashboardLayout.vue
├── router/index.js
├── stores/auth.js, user.js, app.js
├── composables/useAuth.js, useFetch.js, useModal.js, useDebounce.js
├── services/api.js, auth.service.js, user.service.js
├── utils/format.js, validation.js, storage.js
├── constants/routes.js, config.js
├── types/index.js
├── App.vue
└── main.js
public/favicon.ico, public/images/
.env, .env.development, .env.production
index.html, package.json, vite.config.js
```

`App.vue` only mounts `<RouterView />` after `import { RouterView } from 'vue-router'`. No page sections in `App.vue`.

**Router (required):** [router.md](router.md). `app.use(router)` before `mount`. Header/Footer: `<RouterLink>` plus `import { RouterLink } from 'vue-router'`. Kebab-case router tags are forbidden in templates.

Alias `@` → `src` in `vite.config.js`.

Pinia: one store file per domain. Services: no `fetch` inside `.vue` files. Composables: `useX` only. Icons: `lucide-vue-next` ([icons.md](icons.md)).

If the project is already Nuxt, keep Nuxt `app/` conventions; still split views, components, stores, and services the same way.
