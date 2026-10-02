# Visual rules (Vue / any new web UI)

Modern = clear type hierarchy, generous whitespace, **real photos** for demos, one solid palette. Not pastel blobs, not “AI landing”.

## Banned (unless the user explicitly asks)

- CSS/SVG **gradients** (`linear-gradient`, `radial-gradient`, mesh, aurora, glow fades) on backgrounds, buttons, text, borders, heroes
- **Emoji** and dingbats (`✓`, `✦`, stars) in markup, buttons, headings, nav, empty states, alt text, placeholders. Use [Lucide](https://lucide.dev/icons/) via `lucide-vue-next` — see [icons.md](icons.md)
- Rainbow or multi-hue palettes, purple/lilac “AI” defaults, glassmorphism everywhere
- Three identical feature cards as the whole homepage

## Color (monochrome + one accent)

Prefer a **single-hue / near-monochrome** site: black, white, one gray scale, **one** solid accent (`--accent` as a hex, not a gradient).

| Use | Token |
|-----|--------|
| Page | `--bg` solid |
| Cards / bars | `--surface` solid |
| Type | `--text` / `--muted` |
| Lines | `--line` |
| CTA | `--accent` once, same on every page |

Do not mix 4+ brand colors. Do not paint sections in unrelated hues. Write tokens once in `variables.css`.

## Images for demo

- Hero, catalog, cards, avatars, galleries: **photos** (`<img>`, object-fit cover)
- Use `https://images.unsplash.com/...` or `https://picsum.photos/seed/<name>/w/h` with real `alt`
- Product lists: 6+ items with distinct images, not the same stock three times

## Icons

Chrome (nav, close, search, empty, settings): **Lucide** only. Install `lucide-vue-next`. Browse [lucide.dev/icons](https://lucide.dev/icons/). Full rules in [icons.md](icons.md). Never emoji as illustration.

## Layout

- Varied sections (editorial split, list, dashboard grid). Repeat a layout family at most once
- Light default unless the brief is dark; no mid-page theme flip
- One radius scale (sharp 0–4px or soft 8–12px)

## CSS files

`variables.css` — solid hex tokens only. `global.css` reset + type. `main.css` imports those two. Scoped SFC styles. **No** `linear-gradient` / `radial-gradient` in shipped CSS.
