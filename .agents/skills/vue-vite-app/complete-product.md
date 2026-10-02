# Vague brief → complete website

Triggers: "lam web", "xay dung giao dien", "vuejs", "trang web", "website", "landing", "app vue", no feature list, or a one-line product name.

Do **not** ship a hero + 3 cards + footer if the user asked for a real site.

Add extra routes only when they belong to the product the user named. Do **not** add Login/Register/Dashboard/EmptyState/useModal just to fill a checklist.

## Product surfaces (only if the brief is a full website)

Adapt to the domain. Skip auth/account unless the user asked.

| Area | What to build |
|------|----------------|
| Home | Real sections for this product (not a generic 3-card template). |
| Domain features the user named | Each = view + components actually used. |
| Shared chrome | Header/nav/footer only if the layout needs them. |

Mock data in `services/` is fine. No unused Base* / EmptyState / extra composables.

## Copy

Vietnamese or English matching the user. Short, concrete. No "seamless / unleash / next-gen". **No emoji.** Icons from Lucide (`lucide-vue-next`).

## Too-simple existing project

If `src/` is mostly `App.vue` + one CSS file: split into views/components the feature needs. Do not dump the whole structure.md tree.

