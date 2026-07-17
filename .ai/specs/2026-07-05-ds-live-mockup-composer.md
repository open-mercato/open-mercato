# DS Live Mockup Composer — Registry-Backed Screen Mockups, Mockup Studio, and the Story-to-Module Loop

## TLDR

Extend the `design_system` module (spec [`2026-07-05-ds-live-component-gallery.md`](2026-07-05-ds-live-component-gallery.md) — hard dependency) with a **mockup composer** that closes the full arc from user story to running module without leaving the working session. **Phase 1 — Core:** a versionable JSON document format (`*.mockup.json`, zod-validated) describing a screen as layout regions and a tree of blocks, where every block references a **gallery registry entry** plus sample props and carries an annotation (`status: implemented | proposed | om-default`, optional `userStory`, optional note); a renderer at `/backend/design-system/mockups/[slug]` renders blocks with the **real shipped components** — a true render, not a drawing — behind a toggleable annotation overlay of status-coded frames and badges, with per-mockup and per-user-story coverage rollups and a CI registry-integrity gate. Because blocks can only reference registry entries, DS conformance is structural: a mockup cannot drift from the shipped design system the way a Figma export or hand-drawn wireframe can. **Phase 2 — Studio & review:** in-browser visual editing on the palette · canvas · inspector pattern (JSON stays the source of truth; persistence through the dev-mode write contract), tokenized read-only share links for client review, and a version diff view — plus the first two UX skills, `om-ux-heuristics` (encoded heuristic critique attached to blocks as a new `finding` annotation type) and `om-ux-copy` (microcopy pass emitting ready i18n keys for all four locales). **Phase 3 — Generative loop:** `om-ux-flows` turns a user story into a flow outline, the composer turns the outline into a draft mockup (list stories → DataTable with inferred columns, form stories → CrudForm with inferred fields — always human-reviewed, never auto-final), and an `implemented`-ready mockup **promotes into `mercato module scaffold --with-ui` input**, so one session can go user story → DS-true mockup → UX-critiqued, annotated screen → running module. A cross-cutting **UX skills layer** (`om-ux-flows`, `om-ux-heuristics`, `om-ux-copy`) encodes design judgment as versioned skills with defined I/O contracts against the mockup document; heuristic critique works pre-implementation on mockups, while persona walkthroughs ([`2026-07-07-ux-synthetic-user-walkthroughs.md`](2026-07-07-ux-synthetic-user-walkthroughs.md)) verify post-implementation — the two ends of the same UX quality loop. This is item 8 of the DS DX roadmap.

## Overview

- **Track:** DS DX roadmap, item 8 (builds directly on item 2, the live component gallery)
- **Branch:** `spec/ds-dx-developer-experience` (spec only; implementation lands on feature branches per phase)
- **Depends on (hard):** [`2026-07-05-ds-live-component-gallery.md`](2026-07-05-ds-live-component-gallery.md) — the `design_system` module, the `GalleryEntry`/`GalleryVariant` registry, its entry-id stability and registry-integrity concepts, and the `design_system.view` ACL feature are prerequisites for every phase
- **Depends on (hard, Phase 3 only):** [`2026-07-05-ds-module-ui-scaffold.md`](2026-07-05-ds-module-ui-scaffold.md) — promote-to-scaffold emits `mercato module scaffold --with-ui` input, including its `--fields` DSL
- **Related:** [`2026-07-07-ux-synthetic-user-walkthroughs.md`](2026-07-07-ux-synthetic-user-walkthroughs.md) — the post-implementation counterpart of the UX skills layer; no code dependency in either direction
- **New content, Phase 1:** mockup schema + loader + renderer pages inside `packages/core/src/modules/design_system/`; `.ai/mockups/` with one golden mockup; `.ai/skills/om-ds-mockup/SKILL.md`; `design_system.mockups.manage` ACL feature; GET routes and one dev-only PUT route
- **New content, Phase 2:** studio (inspector editing), share-link route + token minting, version snapshots + diff view; `.ai/skills/om-ux-heuristics/` and `.ai/skills/om-ux-copy/`; schema v1 extensions (findings, copy files)
- **New content, Phase 3:** `.ai/skills/om-ux-flows/` + flow-outline schema; draft-generation path in `om-ds-mockup`; `yarn ds:mockups:promote` CLI bridge to the scaffold command
- **Touched:** `design_system` module `acl.ts`/`setup.ts`/i18n; `.ai/skills/om-spec-writing/SKILL.md` and `.ai/skills/om-backend-ui-design/SKILL.md` (one section each pointing at the composer)
- **Not touched:** `packages/ui` (no primitive changes), the gallery's public behavior, the QA harness, the walkthrough spec's machinery, CI workflows beyond the standard test run

## Problem Statement

Teams one-shotting whole modules need screen mockups alongside specs, and the current options all fail the same tests — DS fidelity, iteration speed, and encoded judgment:

1. **The repo's native mockup format is ASCII art.** Existing screen-mockup companions (e.g. [`2026-04-11-unified-ai-tooling-and-subagents-screen-mockups.md`](2026-04-11-unified-ai-tooling-and-subagents-screen-mockups.md)) draw screens as `+---+` boxes. They communicate layout intent but render nothing, encode zero DS decisions, and cannot be reviewed visually by a non-developer.
2. **Figma mockups drift from the shipped DS.** The tokens spec ([`2026-07-05-ds-tokens-figma-sync-and-code-connect.md`](2026-07-05-ds-tokens-figma-sync-and-code-connect.md)) documents real token drift between the Figma file and `globals.css`, caught only by a human eyeballing swatches. A Figma frame is a *picture of* components; the moment a primitive changes, every exported frame is silently wrong, and nothing fails.
3. **Per-block delivery status has no artifact.** A delivery review needs a per-block answer to "which parts of this screen are newly delivered, which are proposals, and which are stock platform behavior" for each user story. Today that answer exists nowhere: it is reconstructed verbally or with ad-hoc markup on screenshots, redone on every iteration, and has no machine-readable trace back to user stories.
4. **There is no in-conversation iteration loop.** During a spec-writing or client session, changing a mockup means a Figma round-trip or hand-editing throwaway HTML. Neither survives the session as a reviewable, diffable artifact; the DS rule against detached mockups exists precisely because throwaway HTML always diverges.
5. **Coverage is unanswerable.** "Which user stories in this spec have a UI surface, and is each block built, proposed, or default platform behavior?" has no queryable answer — the information exists only in people's heads and hand-drawn frames.
6. **UX judgment is not encoded anywhere upstream of code.** The project has executable UX contracts (every list has an empty state with a next action, destructive actions confirm and offer undo, long operations show progress, dialogs honor the keyboard contract) scattered across DS docs and reviewers' heads. The synthetic-walkthrough spec verifies flows *after* implementation; nothing critiques a screen *before* a line of it is built, and nothing writes its microcopy in the product voice across the four locales.
7. **An approved mockup is a dead end.** Even when a screen is agreed, implementation restarts from zero — the agreement is not machine-usable, although the scaffold spec already defines a generator that could consume exactly the information a mockup holds (entity, columns, form fields).

The gallery (item 2) solved *discovery* — what components exist. It does not solve *composition* (putting them together into a reviewable screen), *critique* (is the composition good UX), or *continuation* (turning the agreed screen into code).

## Proposed Solution

Three independently shippable phases inside the `design_system` module, plus a cross-cutting UX skills layer. Each phase leaves the repo in a complete, useful state; `om-implement-spec` can take any phase as a standalone work order.

### Phase 1 — Core composer

- **Mockup document** — a JSON file conforming to a zod schema. A mockup = screen metadata (title, slug, optional route hint, width preset) + a layout tree of `stack`/`columns` container nodes whose leaves are **blocks**. Each block references a gallery registry entry id (and optionally a variant id) plus sample props, and carries `status`, optional `userStory`, optional `note`. A `placeholder` leaf type exists for blocks with no registry entry yet (rendered as a dashed, status-neutral labeled box) — tracked separately in coverage so placeholders never masquerade as DS-true content.
- **Renderer** — `/backend/design-system/mockups` (list + coverage rollups) and `/backend/design-system/mockups/[slug]` (the live render). Blocks render the real components from the gallery registry inside the real backend shell — real tokens, real dark mode. A toolbar toggle switches the **annotation overlay** on/off: per-block status-coded frames and corner badges, plus the block's `userStory` chip and note. Overlay off yields a clean render for screenshots.
- **Composition workflow** — mockups are data, so iterating is editing JSON: the dev server re-reads the file per request and an auto-refresh poll picks changes up within seconds — no compile step, no Figma round-trip. Guardrails: a registry-reference integrity check (unit test in `yarn test`) validates every committed `*.mockup.json` against the schema and resolves every entry/variant/prop reference against the gallery registry; an invalid mockup fails CI. DS compliance requires no lint at all — **blocks are the shipped components, so drift is structurally impossible**. This is the load-bearing property that neither Figma exports nor freehand HTML can offer.
- **Coverage view** — per-mockup and per-user-story rollups (implemented / proposed / om-default / placeholder) on the list page, and a JSON coverage report per mockup via API for PM consumption. A screenshot script reuses the QA ephemeral-env conventions to export clean and annotated PNGs for spec documents.
- **Skill `om-ds-mockup`** — the composition loop for agents: pick registry entries, compose, validate, iterate with the reviewer in-session, annotate, export. `om-spec-writing` gains a step linking mockup slugs from spec UI/UX sections; `om-backend-ui-design` points at the composer as the preferred pre-implementation mockup path, retiring ASCII mockups for new specs.

### Phase 2 — Studio & review

- **Studio (visual inspector editing)** — the renderer page gains an Edit mode on the **palette · canvas · inspector** pattern familiar from the workflows visual editor: the registry as a searchable palette on the left, the live render as the canvas, and a right-hand inspector for the selected block. Click a block → the inspector offers: swap the gallery entry/variant (palette pick), edit props through a form generated from the entry's `composePropsSchema`, reorder blocks within and across regions, and flip the annotation (`status`/`userStory`/`note`). **JSON stays the single source of truth** — the studio is a structured editor over the document, never a parallel model; saving persists through the dev-mode PUT contract (extended in this phase from annotation-only to full-document writes, same containment and ACL rules, plus an optimistic-concurrency precondition).
- **Share links** — tokenized read-only review for people without backend accounts: a signed, expiring token grants GET access to exactly one mockup on a minimal public page (no backend shell, watermark always on, overlay toggle available, zero write surface). Security constraints are enumerated in Architecture; the structural safety net is that mockups contain no tenant data by construction.
- **Version diff** — named snapshots (`yarn ds:mockups:snapshot <slug> <label>` or from the studio) plus a side-by-side diff view: two versions rendered next to each other with changed/added/removed blocks highlighted in the same status-token visual language used everywhere else in the composer.
- **UX skills, first pair** — `om-ux-heuristics` critiques a mockup against an encoded checklist (Nielsen's 10 + the project's executable UX contracts) and writes findings into the document as a new `finding` annotation type (severity + heuristic id), rendered as overlay markers visually distinct from status frames. `om-ux-copy` runs a microcopy pass over every text-bearing prop and emits ready i18n keys for en/pl/es/de as a companion copy file.

### Phase 3 — Generative loop

- **User-story-to-draft** — `om-ux-flows` converts a user story or feature description into a **flow outline** (which screens exist, what belongs on each, task order — a zod-schema'd artifact, not prose). `om-ds-mockup` consumes the outline — never raw prose — and proposes complete draft mockups from registry entries: list-shaped intents become a DataTable block with inferred columns, form-shaped intents become CrudForm blocks with inferred fields, plus page scaffolding, filters, and empty states per DS conventions. Drafts are marked `draft: true`, render behind a persistent "Generated draft — review required" banner, and every generated block is `status: proposed`. **A human always reviews; the draft is a starting point, never auto-final** — nothing downstream (share, promote) accepts a draft.
- **Promote-to-scaffold** — the closing capability, moved from future work into scope: `yarn ds:mockups:promote <slug>` inspects a reviewed mockup whose blocks include DataTable and/or CrudForm entries, derives the scaffold spec's `--fields` DSL from the blocks' schema-validated props (columns → field list with types, form fields → validators), and emits a ready `yarn mercato module scaffold <module> --entity <entity> --with-ui --fields ...` invocation — printed for confirmation, then optionally executed. The generated module passes the scaffold spec's own gates by that spec's guarantee. One session: user story → flow outline → draft mockup → reviewed, critiqued, copy-finished mockup → running module.

### Cross-cutting — the UX skills layer

`om-ux-flows`, `om-ux-heuristics`, and `om-ux-copy` are authored, versioned skills under `.ai/skills/`, first-class deliverables of this spec (heuristics + copy in Phase 2, flows in Phase 3). Each has a defined I/O contract against the mockup document or the flow outline — they are composable pipeline stages, not prose advice: **flows → compose → heuristics → copy → iterate**. Their relationship to the synthetic-user walkthrough spec is deliberate division of labor: heuristic critique is cheap, static, and works **pre-implementation on mockups**; persona walkthroughs are expensive, dynamic, and verify **post-implementation on the running UI**. Same UX quality loop, opposite ends; the findings severity scale is shared vocabulary between the two.

**Out of scope, explicitly:** pushing mockups to Figma (future work of the tokens/Code Connect spec, not this one); pixel-level freeform drawing or arbitrary JSX in mockups; portal/customer-facing mockup surfaces beyond the tokenized share page; automatic implementation of mockups beyond the scaffold bridge (promote emits scaffold input, it does not write feature code).

## Architecture

### File format decision — JSON + zod, not TSX (Phase 1)

| | JSON + zod schema (chosen) | TSX page per mockup |
|---|---|---|
| DS conformance | Structural — closed vocabulary of registry entries; cannot express a non-DS screen | By discipline only — arbitrary JSX can hardcode anything |
| Validation & CI | Whole document machine-validated; unknown entry/variant/prop = CI failure | Typecheck catches import errors, nothing checks DS intent or annotation completeness |
| Coverage, findings, diff, promote | Walk the data | AST analysis or manual bookkeeping |
| Iteration loop | Edit JSON → refresh; no build step | Edit → recompile; slower, and tempts "just one custom div" |
| Studio editing | Structured editor over data is tractable | Editing arbitrary JSX visually is a code editor, not a studio |
| Annotation model | First-class fields on every block | Props convention at best, unenforceable |
| Expressiveness | Deliberately limited | Unlimited |

TSX wins only on expressiveness, and unlimited expressiveness is precisely the failure mode: a mockup that needs arbitrary code is a prototype, not a mockup. The `placeholder` block is the pressure valve for "this component doesn't exist yet" without opening the door to freehand markup. Every later phase capitalizes on the data decision — the studio, the diff, the heuristic critique, and the scaffold promotion are all walks over the same tree.

### File locations and discovery (Phase 1)

- **Spec-stage artifacts:** `.ai/mockups/<slug>.mockup.json` — versioned with specs, does not ship in builds. Exported screenshots in `.ai/mockups/screenshots/`, snapshots in `.ai/mockups/versions/<slug>@<label>.mockup.json`, copy files as `<slug>.copy.json` beside the mockup.
- **Shipped documentation:** `packages/**/src/modules/<module>/mockups/<slug>.mockup.json` — for mockups worth keeping next to the module they describe.
- The loader resolves both sources server-side; slugs must be unique across sources (integrity test enforces). In a production build where `.ai/` is absent, only module-local mockups appear — the list page shows fewer rows, never errors.

### Document schema (zod, module-internal; Phase 1 core + Phase 2/3 extensions)

```typescript
// packages/core/src/modules/design_system/mockups/schema.ts
import { z } from 'zod'

export const finding = z.object({                       // Phase 2 (om-ux-heuristics)
  id: z.string(),                                       // 'f1' — unique within the document
  heuristicId: z.string(),                              // 'nielsen-01' | 'om-empty-state-next-action' | ...
  severity: z.enum(['low', 'medium', 'high', 'critical']), // shared scale with the walkthrough spec
  summary: z.string().max(300),
  suggestion: z.string().max(500).optional(),
  atHash: z.string(),                                   // document hash at critique time — staleness detection
})

export const blockAnnotation = z.object({
  status: z.enum(['implemented', 'proposed', 'om-default']),
  userStory: z.string().regex(/^US-[A-Za-z0-9._-]+$/).optional(),  // 'US-123'
  note: z.string().max(500).optional(),
  findings: z.array(finding).optional(),                // Phase 2
})

const forbiddenPropKeys = ['className', 'style', 'dangerouslySetInnerHTML']

export const blockNode = z.object({
  type: z.literal('block'),
  id: z.string(),                          // unique within the mockup
  entry: z.string(),                       // GalleryEntry.id — resolved against the registry
  variant: z.string().optional(),          // GalleryVariant.id within that entry
  props: z.record(z.unknown()).optional(), // sample data; forbidden keys rejected at parse time
}).merge(blockAnnotation)

export const placeholderNode = z.object({
  type: z.literal('placeholder'),
  id: z.string(),
  label: z.string(),                       // what would be here
}).merge(blockAnnotation)                  // placeholders are almost always 'proposed'

export type LayoutNode =
  | z.infer<typeof blockNode>
  | z.infer<typeof placeholderNode>
  | { type: 'stack'; id: string; gap?: 2 | 4 | 6 | 8; children: LayoutNode[] }
  | { type: 'columns'; id: string; weights: number[]; children: LayoutNode[] }

export const mockupDocument = z.object({
  version: z.literal(1),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string(),
  description: z.string().optional(),
  routeHint: z.string().optional(),        // '/backend/customers/people' — informational only
  width: z.enum(['desktop', 'tablet', 'mobile']).default('desktop'),
  spec: z.string().optional(),             // relative path to the owning spec document
  draft: z.boolean().default(false),       // Phase 3 — true on generated drafts until human review
  entity: z.string().optional(),           // Phase 3 — promotion hint: target entity name
  module: z.string().optional(),           // Phase 3 — promotion hint: target module id
  documentFindings: z.array(finding).optional(),  // Phase 2 — screen-level findings (flow order, dead ends)
  root: layoutNode,                        // recursive z.lazy union of the four node types
})
```

Layout is deliberately coarse — `stack` and `columns` with 4px-grid gaps cover backend page anatomy; anything finer belongs in the components themselves. The parser rejects `className`, `style`, and `dangerouslySetInnerHTML` prop keys so a mockup cannot restyle a component past the DS. All Phase 2/3 fields are optional: a Phase 1 document remains valid forever (`version` stays `1`; additions are strictly optional-extension, enforced by a schema BC test).

### Registry contract extension (additive, Phase 1)

The gallery's `GalleryVariant.render()` is a fixed closure; composition needs prop injection. `GalleryEntry` gains two optional fields:

```typescript
export type GalleryEntry = {
  // ...existing fields from the gallery spec, unchanged...
  compose?: (props: Record<string, unknown>) => React.ReactNode
  composePropsSchema?: z.ZodTypeAny        // validates block props at integrity-check time; drives the studio prop form
}
```

Entries without `compose` are still usable in mockups: the block renders the referenced variant's canonical `render()` and the integrity check **fails** if such a block supplies `props` (silent prop-dropping would lie to reviewers). `compose` implementations are ordinary registry code, reviewed like any gallery entry, and inherit the gallery's mock-data-only rule — no tenant APIs, ever. In Phase 2 the same `composePropsSchema` doubles as the studio's inspector form definition; in Phase 3 it is the promote bridge's source of field types. The field is module-internal, so this is not a `packages/ui` change.

### Renderer and annotation overlay (Phase 1)

- **Routes:** `backend/design-system/mockups.tsx` → list; `backend/design-system/mockups/[slug].tsx` → renderer. Both declare `requireAuth` + `requireFeatures: ['design_system.view']`; the list hangs off the existing Design system nav entry as a secondary tab (`SectionNav`), not a new top-level nav item.
- **List page:** DataTable of mockups — title, slug, source, block counts by status, distinct user stories, findings count (Phase 2), draft tag (Phase 3), last modified — with the standard `emptyState`.
- **Renderer page:** loads and validates the document server-side (a failing document renders the standard `ErrorNotice` with the zod issues — never a blank page), then renders the layout tree with real components inside a bordered stage sized by the `width` preset. Toolbar: overlay toggle (`SegmentedControl`: Clean / Annotated), user-story filter (dims non-matching blocks), auto-refresh poll (2s; the dev server re-reads per request, so edit-to-screen latency is one poll tick), coverage summary strip.
- **Status overlay** (per `.ai/ds-rules.md` — semantic tokens only, explicitly **no amber**):

| Status | Frame | Badge |
|---|---|---|
| `implemented` | `border-2 border-status-success-border` | `bg-status-success-bg text-status-success-text` |
| `om-default` | `border-2 border-status-neutral-border` | `bg-status-neutral-bg text-status-neutral-text` |
| `proposed` | `border-2 border-brand-violet/30` | `bg-brand-violet/10 border-brand-violet/30 text-brand-violet` |

`proposed` deliberately reuses the brand-violet 10%/30%/100% pattern (the DS's "user-created/custom" visual language) rather than a status color: a proposal is not a warning, and the DS forbids amber chips. The overlay is absolutely positioned and never alters layout — Clean and Annotated renders are pixel-identical underneath.

- **Findings overlay** (Phase 2) — visually distinct from status frames so the two annotation systems never blur: findings render as small **numbered circular markers** clustered at the block's top-right corner (status badges are rectangular, bottom-left), colored by severity — `critical`/`high` → `status-error` tokens, `medium` → `status-info`, `low` → `status-neutral`; selecting a marker opens the finding in a side panel and draws a dashed 1px outline (same severity token) around the block. Findings whose `atHash` no longer matches the current document hash render dimmed with a "stale" label — a critique of a screen that has since changed is flagged, not silently trusted.

### Studio — palette · canvas · inspector (Phase 2)

Edit mode on the renderer page, gated by `design_system.mockups.manage` and available only where the write contract is (dev mode, file in the working tree):

- **Palette (left):** the gallery registry as a searchable list grouped by family; dragging or picking inserts a `block` node with the entry's default variant. Placeholders insertable from the same palette.
- **Canvas (center):** the live render itself; blocks get selection affordances (`border-2 border-primary` on select, standard focus recipe for keyboard selection); reorder within a `stack`/`columns` via drag or keyboard.
- **Inspector (right):** for the selected block — entry/variant swap, a prop form **generated from `composePropsSchema`** (fields typed from the zod shape; entries without a schema expose no prop editing), annotation controls (status, user story, note), and the block's findings list.
- **Persistence:** Save serializes the document and PUTs it (full-document write contract below) with the load-time document hash as a precondition; a `409` (someone edited the file — human, agent, or another studio tab) prompts reload-and-reapply. The studio holds no state the file doesn't; closing the tab loses nothing that was saved.

The studio is a convenience layer for humans in a review session; agents keep editing JSON directly. Both paths converge on the same file and the same validation.

### Share links (Phase 2)

Client reviewers rarely have backend accounts. A share link exposes exactly one mockup, read-only:

- **Minting:** `POST /api/design_system/mockups/[slug]/share` (feature `design_system.mockups.manage`) returns `{ url, expiresAt }`. Refused for `draft: true` documents.
- **Token:** HMAC-SHA256-signed payload `{ slug, exp }` under a dedicated secret (`MOCKUP_SHARE_SECRET`); when the env var is absent, sharing is disabled and the mint route returns a clear 503 — sharing never silently falls back to a guessable scheme. Expiry required: default 7 days, maximum 30.
- **Public surface:** `GET /api/design_system/mockup-share/[token]` plus a minimal page (module `frontend/` route, no backend shell, no session use) rendering the mockup with the overlay toggle available, watermark ribbon always on, and `X-Robots-Tag: noindex`.
- **Security constraints, enumerated:** (1) the token authorizes one slug, nothing else — no list, no other mockups, no write route accepts it; (2) invalid, expired, or tampered tokens return a uniform 404 (no oracle distinguishing "wrong signature" from "no such mockup"); (3) rate-limited per IP like other public routes; (4) revocation is by secret rotation (invalidates all outstanding links) — documented limitation, acceptable because expiry is short and content is non-sensitive by construction; (5) the page executes no write and holds no credentials; (6) structural safety: mockups contain only committed sample data — `compose` functions cannot call tenant APIs (gallery rule), so the share surface can leak nothing the repo doesn't already contain.

### Version snapshots and diff (Phase 2)

`yarn ds:mockups:snapshot <slug> <label>` (also a studio action) copies the current document to `versions/<slug>@<label>.mockup.json` — snapshots are ordinary schema-valid files, covered by the same integrity test. The diff view (`/backend/design-system/mockups/[slug]?compare=<label>` or two labels) renders both versions side by side and computes a block-level delta by id: **added** blocks framed `status-success`, **removed** blocks rendered as ghosts framed `status-error`, **changed** blocks (entry, variant, props, or annotation) framed `status-info`, moved-only blocks `status-neutral`. Same token vocabulary as the rest of the composer; no new visual language. The delta is also available as JSON (`GET .../diff`) for changelog notes.

### UX skills layer — contracts and chaining (Phase 2 + 3)

| Skill | Phase | Consumes | Produces | Contract point |
|---|---|---|---|---|
| `om-ux-flows` | 3 | User story / feature description / spec section (prose) | **Flow outline** (`*.flow.json`, schema below) | The only stage that reads prose; everything downstream reads structured artifacts |
| `om-ds-mockup` | 1 (+3) | Flow outline (Phase 3) or direct instruction (Phase 1) | `*.mockup.json` (draft-flagged when generated) | Writes documents; only stage that touches layout |
| `om-ux-heuristics` | 2 | `*.mockup.json` | Same document + `findings`/`documentFindings` (with `atHash`) | Appends findings; never edits layout, props, or status |
| `om-ux-copy` | 2 | `*.mockup.json` | `<slug>.copy.json` — i18n keys + en/pl/es/de values for every text-bearing prop | Renderer prefers copy-file values when present; on implementation, keys migrate into module i18n files |

```typescript
// flow outline schema (module-internal, validated by ds:mockups:check)
export const flowOutline = z.object({
  version: z.literal(1),
  source: z.string(),                                  // user story id or spec path
  screens: z.array(z.object({
    slug: z.string(),                                  // becomes the mockup slug
    purpose: z.string(),
    order: z.number(),
    intents: z.array(z.object({
      kind: z.enum(['list', 'form', 'detail', 'action', 'navigation', 'feedback']),
      description: z.string(),
      userStory: z.string().optional(),
    })),
  })),
  transitions: z.array(z.object({ from: z.string(), to: z.string(), trigger: z.string() })),
})
```

**Chaining:** flows → compose → heuristics → copy → iterate. Each stage is idempotent over its own output fields, so the loop can re-run any stage after a human edit: re-composing respects hand-edited blocks (drafts regenerate only on request), re-critiquing replaces its own findings (matched by `heuristicId` + block) and stale-flags nothing else, re-copying updates only the copy file. The `om-ds-mockup` SKILL.md documents the full chain as the default workflow for "mock this feature up" requests.

**Heuristic checklist** (versioned inside `om-ux-heuristics`): Nielsen's 10 (`nielsen-01`…`nielsen-10`) plus the project's executable UX contracts as first-class checks — `om-empty-state-next-action` (every list block has an empty state with a next action), `om-destructive-confirm-undo` (destructive actions confirm and offer undo), `om-progress-over-1s` (operations >1s show progress), `om-dialog-keyboard-contract` (dialogs honor Escape/Cmd+Enter), `om-no-dead-ends` (every screen names an exit or next step). Checks that are mechanically decidable from the document (e.g. a DataTable block without an empty-state prop) are listed as such in the checklist so the skill applies them deterministically; judgment checks cite the heuristic and quote the offending block.

**Relationship to synthetic walkthroughs** ([`2026-07-07-ux-synthetic-user-walkthroughs.md`](2026-07-07-ux-synthetic-user-walkthroughs.md)): heuristic critique is static analysis of a *proposed* screen — cheap, per-iteration, pre-implementation; persona walkthroughs are dynamic observation of the *shipped* flow — expensive, per-PR, post-implementation. A finding that survives from mockup critique into a walkthrough report indicates the mockup review was overridden; the shared severity scale makes that traceable. Neither depends on the other's code.

### Generative draft and promote bridge (Phase 3)

- **Draft generation:** given a flow outline, `om-ds-mockup` maps intents to registry entries — `list` → page header + FilterBar + DataTable with columns inferred from the intent description's nouns (each column typed conservatively, defaulting to text), `form` → CrudForm block with inferred fields, `detail` → SectionHeader + detail sections, `feedback` → the DS empty/loading/error states the target pattern requires. Output is `draft: true`, all blocks `status: proposed`, `userStory` carried from intents. The renderer shows a persistent info `Alert` ("Generated draft — review required") while the flag is set; share minting and promotion refuse drafts; clearing the flag is a deliberate human act (studio button or JSON edit). Inference quality is advisory by design — the draft's job is to be 80% right in 30 seconds, not final.
- **Promote:** `yarn ds:mockups:promote <slug>` — validates the mockup is not a draft, requires `entity` (from the document hint or `--entity`), collects DataTable/CrudForm blocks, derives the scaffold `--fields` DSL from their schema-validated props (column ids + types, form fields + validators), prints the complete `yarn mercato module scaffold <module> --entity <entity> --with-ui --fields ...` command, and executes it only on confirmation. Blocks that don't map (placeholders, bespoke compositions) are listed as "not scaffolded — implement manually". The generated module's compliance is the scaffold spec's guarantee (its output must pass `yarn lint:ds` and guardian ANALYZE); this spec adds only the derivation, covered by a golden test. After implementation, statuses flip to `implemented` via the studio — closing the loop back into the coverage view.

### Screenshot export (Phase 1)

`yarn ds:mockups:screenshot <slug>` — reuses or boots the ephemeral integration environment (checking `.ai/qa/ephemeral-env.json` first, per `.ai/qa/AGENTS.md`), logs in with standard fixture credentials, opens the renderer in Clean and Annotated modes, and saves `<slug>.png` / `<slug>-annotated.png` under `.ai/mockups/screenshots/`. Exported PNGs carry a small `Mockup — <date>` ribbon (rendered by the page in export mode, DS tokens) so a screenshot in a deck cannot be mistaken for shipped UI. It tears down only an environment it started.

## Data Models

No database entities, no migrations, no tenant or organization scoping — the mockup document, flow outline, copy file, and snapshots (schemas above) are the data models, versioned in git. Derived and transport shapes:

```typescript
type MockupCoverage = {
  slug: string
  totals: { implemented: number; proposed: number; omDefault: number; placeholder: number }
  byUserStory: Array<{ userStory: string; implemented: number; proposed: number; omDefault: number; placeholder: number; blocks: string[] }>
  findings: { total: number; bySeverity: Record<'low' | 'medium' | 'high' | 'critical', number>; stale: number }  // Phase 2
  draft: boolean                                                                                                  // Phase 3
}

type MockupDiff = {
  slug: string; from: string; to: string   // 'current' or snapshot labels
  added: string[]; removed: string[]; changed: Array<{ id: string; fields: string[] }>; moved: string[]
}

type ShareTokenPayload = { slug: string; exp: number }   // HMAC-SHA256 over the JSON payload, base64url
```

Copy file shape (`<slug>.copy.json`): `{ version: 1, locale keys: { 'mockup.<slug>.<blockId>.<prop>': { en, pl, es, de } } }` — keys are deterministic from block id + prop path so re-runs are stable diffs.

## API Contracts

All under the `design_system` module, standard route auto-discovery:

| Method | Route | Feature | Phase | Contract |
|---|---|---|---|---|
| GET | `/api/design_system/mockups` | `design_system.view` | 1 | `{ items: Array<{ slug, title, source: 'ai' \| 'module', coverage: MockupCoverage['totals'], userStories: string[], findingsCount, draft, modifiedAt }> }` |
| GET | `/api/design_system/mockups/[slug]` | `design_system.view` | 1 | `{ document, coverage, documentHash }` — 404 unknown slug; 422 with zod issues on invalid file |
| PUT | `/api/design_system/mockups/[slug]/annotations` | `design_system.mockups.manage` | 1 | Body `{ blocks: Array<{ id, status, userStory?, note? }> }` — rewrites annotation fields only. **Dev-mode only:** 404 unless the app runs in development and the resolved path is inside the repo working tree. |
| PUT | `/api/design_system/mockups/[slug]` | `design_system.mockups.manage` | 2 | Full-document write (studio save). Body `{ document, baseHash }`; server validates against the schema + registry, requires `baseHash` to match the on-disk document hash (else `409` — optimistic concurrency), same dev-mode + path-containment guards as the annotations route. |
| GET | `/api/design_system/mockups/[slug]/versions` | `design_system.view` | 2 | `{ versions: Array<{ label, createdAt }> }` |
| GET | `/api/design_system/mockups/[slug]/diff?from&to` | `design_system.view` | 2 | `MockupDiff`; `from`/`to` are `current` or snapshot labels |
| POST | `/api/design_system/mockups/[slug]/share` | `design_system.mockups.manage` | 2 | `{ expiresInDays? (≤30, default 7) }` → `{ url, expiresAt }`; 503 when `MOCKUP_SHARE_SECRET` unset; 422 for drafts |
| GET | `/api/design_system/mockup-share/[token]` | **public (token-gated)** | 2 | `{ document, coverage }` read-only; uniform 404 for invalid/expired/tampered tokens; rate-limited; `noindex` |

Promotion is CLI-only (`ds:mockups:promote`) — it writes code via the scaffold command and has no business being an HTTP surface. ACL: `design_system.view` for all authenticated reads; `design_system.mockups.manage` (`{ id: 'design_system.mockups.manage', title: 'Edit and share design mockups', module: 'design_system' }`, admin-only default in `setup.ts`) for every write and for share minting.

## Migration & Backward Compatibility

Against the 13 contract surfaces from [`BACKWARD_COMPATIBILITY.md`](../../BACKWARD_COMPATIBILITY.md):

| # | Surface | Impact | Notes |
|---|---|---|---|
| 1 | Auto-discovery files | Additive | New backend pages, one public frontend page, API routes — all in the existing module. |
| 2 | Types & interfaces | Additive | `compose`/`composePropsSchema` optional on module-internal `GalleryEntry`; all schemas internal; Phase 2/3 document fields strictly optional (schema BC test pins this). |
| 3 | Function signatures | None | No existing exports change. |
| 4 | Import paths | None | — |
| 5 | Event IDs | None | No events. |
| 6 | Widget spot IDs | None | — |
| 7 | API route URLs | Additive — **one public surface** | All routes new. `GET /api/design_system/mockup-share/[token]` + its page are the module's first unauthenticated surface: token-gated, read-only, rate-limited, disabled entirely without `MOCKUP_SHARE_SECRET`, and structurally free of tenant data. Called out in release notes so operators can decide whether to set the secret at all. |
| 8 | Database schema | None | File-based throughout; share tokens are stateless-signed, no storage. |
| 9 | DI service names | None | — |
| 10 | ACL feature IDs | Additive | New `design_system.mockups.manage`; existing `design_system.view` reused unchanged. |
| 11 | Notification IDs | None | — |
| 12 | CLI commands | Additive | `ds:mockups:check`, `ds:mockups:screenshot`, `ds:mockups:snapshot`, `ds:mockups:promote` package scripts; promote shells out to the scaffold spec's command, changing nothing in it. |
| 13 | Generated files | Refresh | Standard `yarn generate` after adding pages/routes. |

Purely additive module surface across all phases; removing the mockup pages and routes leaves the gallery untouched. Phase boundaries are BC boundaries: a repo that stops after Phase 1 is complete and stable.

## Implementation Phases

Each phase is an independent `om-implement-spec` work order with its own gates; no phase requires the next.

1. **Phase 1 — Core** (ship order: schema + integrity check → renderer + overlay → coverage + GET/annotation-PUT routes → `om-ds-mockup` skill + screenshot script + `om-spec-writing`/`om-backend-ui-design` sections). Golden mockup committed with the first step. Exit gate: Phase 1 validation section green, guardian REVIEW zero findings.
2. **Phase 2 — Studio & review** (studio edit mode + full-document PUT with `baseHash` → snapshots + diff view/route → share minting + public page → `om-ux-heuristics` + findings overlay → `om-ux-copy` + copy-file rendering). Exit gate: Phase 2 validation green; share surface reviewed against the enumerated security constraints; skills produce valid artifacts against the golden mockup.
3. **Phase 3 — Generative loop** (`om-ux-flows` + flow-outline schema → draft generation in `om-ds-mockup` + draft banner/refusals → `ds:mockups:promote` with golden derivation test). Exit gate: Phase 3 validation green; end-to-end session demo — user story → outline → draft → reviewed mockup → scaffolded module passing the scaffold spec's own gates.

## Validation Plan

### Golden fixtures

`.ai/mockups/customers-people-list.mockup.json` — the customers people list page (the DS reference implementation) recomposed as a mockup: page header, filter bar, people DataTable, a `proposed` placeholder side panel, blocks annotated across two fictional user stories. Phase 2 adds a snapshot pair (`@v1`, `@v2` with known deltas) and a findings-bearing variant; Phase 3 adds a golden flow outline (`customers-quick-add.flow.json`) and the expected promote command line for the golden mockup. All fixtures use clearly fictional sample data.

### Phase 1 — unit (`design_system/mockups/__tests__/`)

- **Schema** — valid document parses; forbidden prop keys rejected; missing `status` rejected; malformed `userStory` rejected; slug collisions across sources rejected; **BC pin**: a schema-v1-core document (no Phase 2/3 fields) always validates.
- **Registry integrity** — every committed `*.mockup.json` (snapshots included): entry ids resolve, variant ids resolve, `props` only on entries exposing `compose`, props validate against `composePropsSchema`. This is the CI gate.
- **Coverage rollup** — totals and per-user-story grouping correct for the golden mockup; placeholders counted separately.
- **Render smoke** — golden mockup renders under jsdom, overlay on and off.
- **Annotation PUT** — rewrites only annotation fields (fixture in temp dir); refuses paths outside the working tree; 404 outside dev mode.

### Phase 1 — integration (Playwright, `__integration__/design-system-mockups.spec.ts`, per `.ai/qa/AGENTS.md`)

| # | Path | Assertions |
|---|---|---|
| 1 | List + coverage | `design_system.view` user sees golden mockup row with correct status counts and user stories; empty state renders when filtered to nothing. |
| 2 | Renderer + overlay toggle | Real components in DOM; Annotated shows mapped token classes (`border-status-success-border`, `text-brand-violet`) and no amber classes anywhere; layout boxes identical Clean vs Annotated. |
| 3 | Story filter + API parity | Story filter dims non-matching blocks; coverage strip matches the GET API for the same slug. |
| 4 | Access control | Without `view`: standard access-denied UX; with `view` but without `manage`: 403 on annotation PUT. |
| 5 | Invalid document | Broken fixture renders `ErrorNotice` with issues, not a blank page. |

### Phase 2 — unit + integration

- **Unit:** diff computation (added/removed/changed/moved against the snapshot pair); share token round-trip (sign → verify), expiry rejection, tamper rejection (bit-flip), uniform-404 behavior, mint refusal for drafts and missing secret; full-document PUT — schema+registry validation server-side, `baseHash` mismatch → 409, containment guard; findings schema + `atHash` staleness computation; copy-file key determinism (two runs, identical keys).
- **Integration:** (6) studio round-trip — enter edit mode, swap a block's variant, edit a prop via the generated form, reorder, save; file on disk reflects the change; a concurrent out-of-band file edit then a second save yields the 409 reload prompt. (7) share link — minted URL opens the public page logged-out; overlay toggles; watermark present; expired token → 404 page; no authenticated chrome in DOM. (8) diff view — `@v1` vs `@v2` renders side by side with the expected added/removed/changed frames. (9) findings overlay — findings-bearing fixture shows circular severity markers distinct from status badges; stale finding renders dimmed with label.
- **Skill contract checks:** running `om-ux-heuristics` on a golden fixture with a deliberately missing empty state MUST produce an `om-empty-state-next-action` finding (mechanical checks are deterministic and therefore testable); `om-ux-copy` output validates against the copy-file schema and covers all four locales for every text-bearing prop.

### Phase 3 — unit + integration

- **Unit:** flow-outline schema validation; draft generation contract — golden outline produces a document that passes the full integrity check, has `draft: true` and all blocks `proposed`; promote derivation — golden mockup yields the exact expected `--fields` DSL and command line (golden-file test); promote refuses drafts and mockups without mappable blocks.
- **Integration:** (10) draft banner — a `draft: true` fixture renders the persistent review Alert; share mint returns 422. (11) promote smoke (monorepo CI job, mirrors the scaffold spec's own throwaway-module job): promote the golden mockup, run the emitted scaffold command, assert the generated module passes `yarn lint:ds` — the two specs' guarantees composed end to end.

### Gates (every phase)

`yarn lint:ds` scoped to the module — zero findings; guardian REVIEW pass; `yarn i18n:check-hardcoded` clean (chrome in all four locales; slugs, heuristic ids, and statuses are technical content); standard `yarn generate`, `yarn typecheck`, `yarn lint`, `yarn workspace @open-mercato/core build`, `yarn test`, `yarn test:integration`.

## Risks & Impact Review

| # | Risk / failure scenario | Severity | Affected | Mitigation | Residual |
|---|---|---|---|---|---|
| 1 | **Registry churn breaks mockups** — a gallery entry id or variant is renamed; committed mockups reference nothing. | Medium | Mockup authors, CI | Integrity test fails CI in the renaming PR, forcing the mockup update alongside; gallery spec declares entry ids stable. | Low |
| 2 | **Props escape hatch erodes DS truth** — sample props restyle components or smuggle markup. | Medium | DS trust | Parser rejects `className`/`style`/`dangerouslySetInnerHTML`; `compose` is reviewed registry code; `composePropsSchema` narrows shapes; no-`compose` entries take no props at all. | Low |
| 3 | **Placeholder proliferation** — mockups degenerate into labeled boxes. | Medium | Review quality | Placeholders are their own coverage category, surfaced on the list page; skill instructs preferring registry entries and reporting every placeholder. | Medium |
| 4 | **Stale statuses lie** — a `proposed` block ships but nobody flips the annotation. | Medium | PM reporting | Status flip is a named `om-spec-writing` step and a one-click studio action; last-modified visible; promote closes the loop for scaffolded screens. Process guarantee, not mechanical. | Medium |
| 5 | **Write routes mutate the working tree** — misuse in a shared environment, or a traversal bug writes outside the repo. | High if unmitigated | Repo integrity | Both PUTs are 404 outside dev mode; resolved path must be inside the working tree and match a discovered slug (no client paths); admin-only `manage` feature; full-document writes are schema+registry validated server-side before touching disk. Unit tests cover containment. | Low |
| 6 | **Mockups mistaken for shipped UI** — a pixel-true screenshot or share link circulates as "done". | Medium | Stakeholder expectations | Watermark ribbon on every export and permanently on the share page; annotated variant communicates delivery status; drafts additionally banner-labeled and unshareable. | Low |
| 7 | **Share-link exposure** — a leaked or long-lived link exposes internal design intent; a token bug exposes more than one mockup. | Medium | Confidentiality of roadmap/design | Constraints enumerated in Architecture: single-slug HMAC tokens, ≤30-day expiry, uniform 404s, rate limiting, feature disabled without a dedicated secret, revocation by rotation; content is committed sample data only — no tenant data can transit the surface. Residual: intent disclosure within expiry window is accepted, mint-time choice. | Low |
| 8 | **Generative draft overreach** — teams treat Phase 3 drafts as finished designs; the "auto-final" temptation erodes review. | High | Design quality, client trust | `draft: true` is structural: banner in every render, share mint 422, promote refusal; clearing the flag is an explicit human act; skill language frames drafts as starting points and requires a review pass before flag removal; heuristics stage runs on drafts to make review substantive, not rubber-stamp. | Medium |
| 9 | **Inspector write conflicts** — studio save clobbers a concurrent agent/file edit, or two studio tabs fight. | Medium | Session work loss | `baseHash` precondition on full-document PUT → 409 + reload-and-reapply prompt; annotation-only PUT stays field-scoped; auto-refresh poll surfaces out-of-band changes within seconds. | Low |
| 10 | **Findings staleness** — heuristic findings persist after the screen changed, misleading review; or findings pile up as noise. | Medium | Critique credibility | Findings carry `atHash`; overlay dims and labels stale findings; re-running `om-ux-heuristics` replaces its own findings deterministically; coverage rollup counts stale findings so lists surface rot. | Low |
| 11 | **Bundle/perf regression** — a mockup spanning many families loads several lazy chunks; the studio adds editor weight. | Low | Renderer/studio pages only | Same per-family `next/dynamic` chunks as the gallery, on demand; studio code is itself dynamically imported only in edit mode; these are dev/review surfaces, not hot paths. | Low |
| 12 | **Realistic-looking sample data committed** — fabricated names/emails in props or copy files read as real personal data in a public repo. | Low | Compliance | Skills mandate clearly fictional data (example.com domains, obvious placeholder names); review checklist item; compose functions cannot fetch real data. | Low |

## Final Compliance Report

- **DS rules (`.ai/ds-rules.md`)**: all composer chrome — status overlay, findings markers, diff frames, studio, share page — uses semantic tokens only: status-success/neutral/error/info plus the brand-violet 10/30/100 pattern for proposals; no amber anywhere (asserted by integration test); no hardcoded colors, no `dark:` overrides; blocks themselves are shipped components, so their compliance is inherited, not asserted.
- **Module conventions (`packages/core/AGENTS.md`)**: pages and routes auto-discovered with colocated meta inside the existing `design_system` module; feature id in `acl.ts` with `setup.ts` grants; four-locale i18n for chrome and for `om-ux-copy` output; `yarn generate` after adding files; no ORM, no DI additions, no events.
- **Security**: authenticated reads behind `design_system.view`; every write and share mint behind admin-default `design_system.mockups.manage`; writes are dev-mode-only, path-contained, hash-preconditioned, server-validated; the single public surface is token-gated with enumerated constraints, disabled by default (no secret set), and structurally free of tenant data; all API inputs zod-validated.
- **BC**: all 13 surfaces additive or none; the public share route is explicitly called out as a new surface with an operator opt-in (the secret). Phase boundaries are stable stopping points.
- **Tests**: per-phase unit and integration coverage (11 Playwright paths total) including the schema BC pin, share-token adversarial cases, studio concurrency, deterministic heuristic checks, golden promote derivation, and the composed promote→scaffold→`lint:ds` CI job, per `.ai/qa/AGENTS.md`.
- **Dependencies**: hard on the live gallery spec (all phases); hard on the module scaffold spec for Phase 3 promotion only; the synthetic-walkthrough spec is referenced as the post-implementation complement with shared severity vocabulary and no code coupling; Figma push remains deferred to the tokens/Code Connect track.

## Changelog

- **2026-07-05** — Initial spec, phased: **Phase 1** — zod-schema'd `*.mockup.json` documents (`.ai/mockups/` + module-local) composed from gallery registry entries; live renderer with status-coded annotation overlay (implemented/om-default/proposed, brand-violet for proposals, no amber); registry-reference integrity CI gate; per-mockup/per-user-story coverage with JSON export and ephemeral-env screenshots; `om-ds-mockup` skill; `design_system.mockups.manage` with dev-only annotation write-back. **Phase 2** — studio editing on the palette·canvas·inspector pattern over the same JSON (full-document PUT with hash precondition); tokenized read-only share links with enumerated security constraints; snapshot-based side-by-side diff; `om-ux-heuristics` (findings annotation type with severity + heuristic id + staleness hash) and `om-ux-copy` (four-locale i18n key emission). **Phase 3** — `om-ux-flows` flow outlines, outline-driven draft generation (draft-flagged, never auto-final), and `ds:mockups:promote` bridging reviewed mockups into `mercato module scaffold --with-ui --fields` input — completing the user-story-to-running-module loop, with the synthetic-user walkthrough spec as the post-implementation counterpart.
