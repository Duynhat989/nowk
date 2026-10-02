# Icons (Lucide only)

Catalog: [https://lucide.dev/icons/](https://lucide.dev/icons/)

## Install

```bash
npm install lucide-vue-next
```

Package: `lucide-vue-next`. Not `lucide-react`. Not emoji. Not a custom SVG per button unless Lucide has no match.

## Use

Pick the icon name on the catalog, import that named export, render it as a Vue component.

```vue
<script setup>
import { Search, ChevronDown, Check, Menu, X } from 'lucide-vue-next'
</script>

<template>
  <button type="button" aria-label="Search">
    <Search :size="18" :stroke-width="2" />
  </button>
  <ChevronDown :size="16" />
</template>
```

- Named imports only (`Search`, not `import * as Icons`).
- Size 16–24 for chrome. `currentColor` via CSS `color` on the parent.
- Every icon-only control needs `aria-label`.
- Nav, buttons, empty states, lists, toasts, settings: Lucide. Photos stay for heroes and product images.

## Ban

- Emoji in `.vue`, CSS content, `alt`, placeholders, headings, nav, empty states, mock copy
- Unicode dingbats as icons (`✓`, `✦`, `●`, `★`)
- Other icon kits (`heroicons`, `font-awesome`, `react-icons`) unless the project already uses them
