---
name: om-ds-mockup
description: "Compose and iterate live, DS-true screen mockups for Open Mercato as *.mockup.json documents rendered with the real shipped components. Use when asked to 'mock up a screen', 'compose a mockup', 'add a mockup to the spec', edit or annotate an existing *.mockup.json, mark blocks implemented/proposed, or preview a mockup at /backend/design-system/mockups. Triggers on 'mockup', 'mock this feature up', 'screen mockup', 'mockup.json', 'mockup composer', 'makieta'. Replaces ASCII screen mockups and detached HTML mockups for new specs."
---

# DS Mockup Composer — Registry-Backed Screen Mockups

You compose screen mockups as data: a `*.mockup.json` document validated by a zod schema and rendered live at `/backend/design-system/mockups/<slug>` with the **real shipped DS components**. Blocks can only reference gallery registry entries, so a mockup can never drift from the design system — that structural guarantee is the whole point. Never build a detached HTML mockup and never draw ASCII boxes for new specs.

Spec: `.ai/specs/2026-07-05-ds-live-mockup-composer.md`. Module: `packages/core/src/modules/design_system/` (`mockups/schema.ts`, `mockups/integrity.ts`, gallery registry under `gallery/`).

Composition is one stage of a larger decision system: UX judgment over what you compose — task fit, pattern selection, state coverage, severity-weighed and evidence-tagged findings — is governed by the umbrella skill `.ai/skills/om-ux-product-design/SKILL.md`, executed against mockups by `om-ux-heuristics` (findings with `evidence` tags into the document) and `om-ux-copy` (content rules, four-locale copy files). After composing or editing a screen, hand it to that chain rather than declaring it done; the DS token/primitive layer itself stays om-ds-guardian's territory.

## Where documents live

- **Spec-stage** (default): `.ai/mockups/<slug>.mockup.json` — versioned with specs, does not ship in builds.
- **Module-local**: `packages/**/src/modules/<module>/mockups/<slug>.mockup.json` — for mockups worth keeping next to the module they describe.
- Slugs must be unique across both sources (the integrity test enforces it).
- Golden reference: `.ai/mockups/customers-people-list.mockup.json` — copy its shape when starting a new document.

## Document anatomy

```jsonc
{
  "version": 1,
  "slug": "my-screen",              // ^[a-z0-9-]+$ — becomes the URL segment
  "title": "My screen",
  "description": "Optional summary",
  "routeHint": "/backend/…",        // informational only
  "width": "desktop",               // desktop | tablet | mobile
  "spec": ".ai/specs/….md",         // owning spec, optional
  "root": { /* layout tree */ }
}
```

The layout tree is deliberately coarse — anything finer belongs in the components themselves:

- `{ "type": "stack", "id": "…", "gap": 2|4|6|8, "children": […] }`
- `{ "type": "columns", "id": "…", "weights": [2, 1], "children": […] }`
- `{ "type": "block", "id": "…", "entry": "<gallery entry id>", "variant": "<variant id>", "props": { … }, …annotation }`
- `{ "type": "placeholder", "id": "…", "label": "What would be here", …annotation }`

Node ids are unique within the document. Every leaf carries the annotation fields:

- `status` (required): `implemented` (shipped), `proposed` (new UI being proposed), `om-default` (stock platform behavior).
- `userStory` (optional): `US-…` tag linking the block to a user story.
- `note` (optional, ≤500 chars): reviewer-facing remark, shown in the ledger.

Statuses are **working mechanics** for drafting, review, and later promotion — keep them honest and flip `proposed` → `implemented` when a block ships.

## Rules that will fail CI if ignored

1. **Registry-only blocks.** `entry` must be a real `GalleryEntry.id` and `variant` a real variant id — browse `packages/core/src/modules/design_system/gallery/entries/*.tsx` or the gallery at `/backend/design-system`. No JSX, no HTML, no custom markup, ever.
2. **Props only where `compose` exists.** A block may carry `props` only when its entry exposes `compose` (e.g. `kpi-card`, `section-header`), and the props must satisfy the entry's strict `composePropsSchema`. Entries without `compose` render their variant's canonical preview — supplying props there fails the build.
3. **No styling escape hatches.** `className`, `style`, and `dangerouslySetInnerHTML` prop keys are rejected at parse time.
4. **Placeholders are honest gaps.** When no registry entry fits, use a `placeholder` (dashed labeled box, counted separately) — and report every placeholder to the reviewer instead of faking the block with a lookalike entry. Prefer real entries whenever one exists.
5. **Clearly fictional sample data only** — example.com emails, obvious placeholder names, no real people or tenant data.

## The gate

```bash
yarn workspace @open-mercato/core test --testPathPatterns design_system
```

`mockups/__tests__/mockup-integrity.test.ts` validates every committed `*.mockup.json` against the schema and resolves every entry/variant/prop reference against the gallery registry; `schema.test.ts` covers the document shape. An invalid mockup fails CI naming the file and block — run the suite after every edit, before handing back.

## Preview and iterate

1. Dev server running → open `/backend/design-system/mockups` (list with per-status counts) and `/backend/design-system/mockups/<slug>` (live render). Requires `design_system.view`.
2. Iterating = editing JSON. The server re-reads the file per request and the page polls every 2s in dev — an edit lands on screen within one tick. No compile step.
3. The toolbar toggles **Clean** (screenshot-ready render) vs **Annotated** (margin status rails + side ledger with per-status counts and user-story filter). Annotations never touch the content itself.
4. Annotation-only edits can also go through the dev-only API: `PUT /api/design_system/mockups/<slug>/annotations` with `{ "blocks": [{ "id", "status", "userStory?", "note?" }] }` (feature `design_system.mockups.manage`; 404 outside development). Editing the JSON directly is always equivalent.

## Workflow for "mock this feature up"

1. Read the feature/spec section; list the screens and what belongs on each.
2. For each screen, pick registry entries (gallery first — search `/backend/design-system` or grep `gallery/entries/`); note gaps as placeholders.
3. Write the document in `.ai/mockups/`; statuses: `om-default` for stock chrome, `proposed` for new UI, `implemented` only for blocks that already shipped; tag blocks with the user stories they serve.
4. Run the design_system test suite; fix every schema/integrity failure.
5. Preview with the reviewer, iterate in-session (JSON edit → poll tick), keep the ledger counts honest.
6. Link the mockup slug from the spec's UI/UX section.
