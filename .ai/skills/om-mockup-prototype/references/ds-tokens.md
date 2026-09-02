# Token snapshot — format and provenance

## Resolution order

`scripts/sync-tokens.mjs` builds a prototype's `tokens.css` from the first
source that exists:

1. `<repo>/.ai/ds/ds-tokens.json` — the repository's own committed snapshot.
2. `references/ds-tokens.default.json` — the default bundled with this skill.

The generated `tokens.css` header states which source was used, and the
hand-off repeats it.

## Format

A snapshot is JSON with a top-level `tokens` object. Each key is a token name
(emitted as `--<name>`); each value carries:

- `kind` — `color`, `fontStack`, `dimension`, `expression`, `shadow`, or `number`.
- `light` / `dark` — the authored value per theme, or `value` for a single
  theme-invariant value. `dark` may be `null` when the light value applies to
  both themes.
- `themeInvariant` — `true` when the token does not change between themes;
  such tokens are emitted into `:root` only.
- Other fields (display hexes, aliases, design-tool metadata, notes) are
  ignored by the sync and may be omitted.

Tokens with distinct `dark` values are emitted into the `.dark` block;
everything else lives in `:root`. `expression` values (for example a radius
scale derived from `--radius` via `calc()`) are emitted verbatim, which is
what lets one `theme.css` radius value re-round every surface.

## Provenance of the bundled default

The default snapshot carries the authored token values of one real, complete
example design system — 124 tokens covering surfaces, text, borders, status
colors, brand accents, shadows, z-index scale, radius scale, and font stacks,
each with light and dark values in one record. It ships as a working example,
not a neutral abstraction, per the driving spec's decision D2: anyone wanting
a different design system derives a snapshot from this one by matching the
documented fields, or commits their own at `.ai/ds/ds-tokens.json`, which
always wins.

The bundled stylesheets reference these tokens with neutral fallbacks, so a
repository with no snapshot and no design system still renders a legible
prototype; the fallback values are deliberately plain so that drift from the
snapshot stays invisible whenever a real token source is present.
