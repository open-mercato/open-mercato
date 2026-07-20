# Design System Module — Agent Guidelines

Live component gallery at `/backend/design-system` plus the mockup composer at `/backend/design-system/mockups`, both gated by `design_system.view`. Gallery entries are plain data (`gallery/entries/<family>.tsx`) listed in the family manifest (`gallery/registry.ts`) and lazy-loaded per family. The module is a DS consumer: it must showcase the DS without ever violating it.

## Registry Contract

- `gallery/types.ts` defines `GalleryVariant` / `GalleryEntry` / `GalleryFamily` — do not extend them casually; the shapes are the spec contract (`.ai/specs/2026-07-05-ds-live-component-gallery.md`).
- A family = one manifest row in `galleryFamilies` + one `entries/<id>.tsx` exporting `entries: GalleryEntry[]`.
- Every variant keeps `render` and `code` side by side in one object literal; review them together — colocation is the drift defense.
- `compose` / `composePropsSchema` are the optional mockup-composer extension (`.ai/specs/2026-07-05-ds-live-mockup-composer.md`): `compose` renders an entry from sample props, the strict zod schema validates those props at integrity-check time. Entries without `compose` are still usable in mockups but may not take `props`.

## Mockups (spec 2026-07-05-ds-live-mockup-composer.md, Phase 1)

- Documents are `*.mockup.json` files validated by `mockups/schema.ts` — screen metadata plus a `stack`/`columns` tree whose leaves are `block` nodes (gallery entry id + optional variant + optional sample props + `status: implemented | proposed | om-default`, optional `userStory` / `note`) or `placeholder` nodes (dashed labeled boxes, counted separately).
- Locations: `.ai/mockups/<slug>.mockup.json` (spec-stage, repo root) or `packages/**/src/modules/<module>/mockups/<slug>.mockup.json` (module-local). Slugs are unique across both sources.
- **Blocks may ONLY reference gallery registry entries** — that closed vocabulary is the whole point: a mockup cannot drift from the shipped DS. `mockups/__tests__/mockup-integrity.test.ts` is the CI gate: every committed document must parse and resolve every entry/variant/prop reference; `props` are only legal on entries exposing `compose` and must satisfy `composePropsSchema`.
- The annotation layer is review-margin only: a slim status rail beside the block (`border-l-4` + status tokens; brand-violet 10/30/100 for `proposed` — never amber) plus the side ledger with per-status counts. Content is never outlined, badged, or dimmed; Clean and Annotated renders are pixel-identical underneath.
- API: `GET /api/design_system/mockups`, `GET /api/design_system/mockups/[slug]` (`design_system.view`), and a **development-only** `PUT /api/design_system/mockups/[slug]/annotations` (`design_system.mockups.manage`) that rewrites annotation fields only (Phase 2: plus `findings` / `documentFindings`) and 404s outside dev or outside the working tree.
- Authoring workflow: the `om-ds-mockup` skill (`.ai/skills/om-ds-mockup/`).

## Mockups Phase 2 — studio, share links, snapshots/diff, findings, copy (same spec)

- **Studio** — Edit mode on the renderer (`mockups/components/MockupStudio.tsx`, lazy-loaded), palette · canvas · inspector over the SAME JSON document. All tree edits go through the pure mutations in `mockups/mutations.ts` (unit-tested to always yield schema-valid documents). Save = full-document `PUT /api/design_system/mockups/[slug]` with `baseHash` optimistic concurrency — mismatch is a **409** and the UI prompts reload-and-reapply. The PUT is dev-mode + path-contained + server-validated (schema AND registry integrity) like every mockup write. Selection and hover ride the margin-rail emphasis — never a frame on content.
- **Findings** (`om-ux-heuristics`) — the `finding` annotation type (severity `low|medium|high|critical` + `heuristicId` + `atHash`) on leaves and `documentFindings` on the document. Rendered in the SAME rail+ledger language: severity segments in the margin gutter (critical/high → `status-error`, medium → `status-info`, low → `status-neutral` tokens) and ledger entries; **stale findings (atHash ≠ contentHash) dim IN THE LEDGER with a label — never on content**. `atHash` compares against the CONTENT hash (`stableContentString`/`computeContentHash` — findings stripped, keys sorted) so writing findings never stale-flags itself. Mechanical checks live in `mockups/heuristics.ts` and are deterministic + idempotent, and always emit `evidence: 'heuristic'`. Findings carry an optional **`evidence`** tag (`product | standard | platform | research | heuristic | assumption` — the om-ux-product-design hierarchy, strictly additive so pre-evidence documents stay valid): rendered as a muted uppercase chip beside the severity dot (technical token, untranslated), with `assumptions` counted separately in the findings summary (ledger header + GET payloads) — assumption-tagged findings demand verification, like stale ones demand a re-run.
- **Snapshots + diff** — `yarn ds:mockups:snapshot <slug> <label>` (or the studio action / dev-only `POST …/versions`) copies the document to `.ai/mockups/versions/<slug>@<label>.mockup.json`; snapshots are schema-valid files under the same integrity test. `?compare=<label>` (or `<from>..<to>`) renders two stages side by side with the block delta from `mockups/diff.ts` in the same rail vocabulary: added → success, removed → error (rail on the FROM stage + ghost ledger entry), changed → info, moved-only → neutral. `GET …/diff?from&to` returns the delta JSON; `GET …/versions[/[label]]` lists/fetches snapshots.
- **Share links** — `POST /api/design_system/mockups/[slug]/share` (`design_system.mockups.manage`) mints an HMAC-SHA256 token (`mockups/share.ts`, payload `{slug, exp}`, expiry ≤30 days, secret `MOCKUP_SHARE_SECRET` — unset ⇒ 503, sharing disabled). The **single public surface** `GET /api/design_system/mockup-share/[token]` + the `frontend/mockup-share/[token]` page: one slug per token, uniform 404 for invalid/expired/tampered tokens (no oracle), per-IP rate limit (fail-open), `X-Robots-Tag: noindex` + robots meta, watermark always on, no backend shell, zero write surface. Revocation = secret rotation.
- **Copy files** (`om-ux-copy`) — `<slug>.copy.json` beside the mockup (`mockups/copy.ts`): deterministic keys `mockup.<slug>.<blockId>.<propPath>` with en/pl/es/de values for every text-bearing compose prop; the renderer overrides string props with the active locale's values. Committed copy files are schema- and coverage-checked.
- Skills: `.ai/skills/om-ux-product-design/` (the umbrella evidence-first decision system), `.ai/skills/om-ux-heuristics/`, `.ai/skills/om-ux-copy/` (design tier), chained flows → compose → heuristics → copy.

## Always

1. **MUST keep every variant `code` snippet containing the entry's `importPath`** — enforced by `gallery/__tests__/registry-integrity.test.ts`.
2. **MUST update the coverage allowlist honestly** — when adding a primitive entry, delete its row from `PENDING_FAMILIES` in `gallery/__tests__/gallery-coverage.test.ts`; when a new primitive lands without an entry, add it there with a one-line reason. `PENDING_FAMILIES` must only shrink as families land.
3. **MUST use semantic tokens only** in gallery and mockup chrome (`border-border`, `bg-background`, `bg-muted`, `text-muted-foreground`, `status-*` tokens, `brand-violet` for proposals) and lucide icons only.
4. **MUST route all chrome strings through `i18n/` in all four locales** (en, pl, es, de) via `useT()`. Component titles, variant names, slugs, user-story ids, and statuses in documents are technical content and stay untranslated.
5. **MUST render entries and mockup blocks with inline mock props only** — this module never calls tenant APIs and never renders tenant data. Sample data in mockups is clearly fictional.
6. **MUST keep `figmaNodeId` in `<page>:<node>` format** pointing into `DS_FIGMA_FILE`; omit it when unknown — never guess node ids.
7. **MUST keep mockup writes dev-only and path-contained** — any write route 404s outside `NODE_ENV=development`, resolves slugs through the loader (never client paths), and verifies the resolved file lives inside the repo working tree.

## Never

- Never add gallery- or mockup-specific props or code to `packages/ui` — the module consumes primitives exactly as any other module does.
- Never hardcode colors, arbitrary sizes, or full-pill chips in module chrome.
- Never add entities, DI registrations, or tenant-scoped anything to this module. API routes are limited to the file-based mockup surface above.
- Never remove a file from the primitives coverage enumeration by loosening the test — only entries or allowlist rows with reasons.
- Never draw annotation state on mockup content (frames, badges, dimming) — the margin rail and the ledger are the only annotation surfaces.

## Validation Commands

```bash
yarn generate
yarn workspace @open-mercato/core test --testPathPatterns design_system
yarn workspace @open-mercato/core typecheck
yarn i18n:check-hardcoded
yarn i18n:check-sync
```
