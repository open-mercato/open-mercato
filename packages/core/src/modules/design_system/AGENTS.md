# Design System Module — Agent Guidelines

Live component gallery at `/backend/design-system`, gated by `design_system.view`. Entries are plain data (`gallery/entries/<family>.tsx`) listed in the family manifest (`gallery/registry.ts`) and lazy-loaded per family. The gallery is a DS consumer: it must showcase the DS without ever violating it.

## Registry Contract

- `gallery/types.ts` defines `GalleryVariant` / `GalleryEntry` / `GalleryFamily` — do not extend them casually; the shapes are the spec contract (`.ai/specs/2026-07-05-ds-live-component-gallery.md`).
- A family = one manifest row in `galleryFamilies` + one `entries/<id>.tsx` exporting `entries: GalleryEntry[]`.
- Every variant keeps `render` and `code` side by side in one object literal; review them together — colocation is the drift defense.

## Always

1. **MUST keep every variant `code` snippet containing the entry's `importPath`** — enforced by `gallery/__tests__/registry-integrity.test.ts`.
2. **MUST update the coverage allowlist honestly** — when adding a primitive entry, delete its row from `PENDING_FAMILIES` in `gallery/__tests__/gallery-coverage.test.ts`; when a new primitive lands without an entry, add it there with a one-line reason. `PENDING_FAMILIES` must only shrink as families land.
3. **MUST use semantic tokens only** in gallery chrome (`border-border`, `bg-background`, `bg-muted`, `text-muted-foreground`) and lucide icons only.
4. **MUST route all gallery chrome strings through `i18n/` in all four locales** (en, pl, es, de) via `useT()`. Component titles and variant names (`Button`, `destructive-soft`) are proper nouns and stay untranslated.
5. **MUST render entries with inline mock props only** — the gallery never calls tenant APIs and never renders tenant data.
6. **MUST keep `figmaNodeId` in `<page>:<node>` format** pointing into `DS_FIGMA_FILE`; omit it when unknown — never guess node ids.

## Never

- Never add gallery-specific props or code to `packages/ui` — the gallery consumes primitives exactly as any other module does.
- Never hardcode colors, arbitrary sizes, or full-pill chips in gallery chrome.
- Never add API routes, entities, DI registrations, or tenant-scoped anything to this module.
- Never remove a file from the primitives coverage enumeration by loosening the test — only entries or allowlist rows with reasons.

## Validation Commands

```bash
yarn generate
yarn workspace @open-mercato/core test --testPathPattern design_system
yarn workspace @open-mercato/core typecheck
yarn i18n:check-hardcoded
```
