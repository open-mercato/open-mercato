# Forms Module — Reactive Form Core (conditional visibility, logic jumps, calculator/variables, hidden fields + recall, multiple endings)

> **Parent:** [`2026-04-22-forms-module.md`](./2026-04-22-forms-module.md)
> **Builds on:** [`2026-05-10-forms-visual-builder.md`](./2026-05-10-forms-visual-builder.md) (Form Studio — Builder/Preview tabs, layout containers, page modes, Properties panel).
> **Adjacent / partial overlap:** [`2026-04-22-forms-phase-1c-submission-core.md`](./2026-04-22-forms-phase-1c-submission-core.md) (submission entities) and the planned phase 1d Public Renderer. This spec ships a **minimal** public renderer (Q1 locked to (b)) — full ResumeGate, autosave, review-step, and attachments remain phase-1d scope.
> **Supersedes (partially):** visual-builder Decision 15 ("Logic tab hidden until phase 2c") — this spec pulls the Logic tab forward.
> **Research input:** [`.ai/analysis/2026-05-12-typeform-research-form-studio-gaps.md`](../analysis/2026-05-12-typeform-research-form-studio-gaps.md) (Tier 1).
> **Session sizing:** ~3–4 weeks (7 sub-phases).
> **DS compliance reference:** [`.ai/ds-rules.md`](../ds-rules.md). Every studio UI choice maps to a semantic token — no hardcoded colours, arbitrary radii/text-sizes, or `dark:` overrides on semantic/status tokens.

## TLDR

- Turn the form definition from a static questionnaire into a **reactive** one: fields and sections appear based on prior answers, navigation branches to different pages or endings, numeric scores are computed on the fly, external context flows in via hidden fields, and question text can echo earlier answers.
- All schema changes are **additive** to the FROZEN `x-om-*` grammar — new optional keywords, read-time defaults applied to derived views only, persisted bytes verbatim, `schemaHash` survives a round-trip (per `packages/forms/AGENTS.md` MUST 9–12).
- Five capabilities, delivered in seven phases (A–G):
  1. **Conditional visibility (Logic tab).** Wire the already-declared `x-om-visibility-if` (jsonlogic) keyword into a visual condition editor in the Properties panel. Extends to **sections** as well as fields (Q6).
  2. **Logic jumps (`x-om-jumps`).** Ordered jsonlogic rules that route from a page or field to a target page, ending, or "submit". Active in `paginated` mode; inert in `stacked`.
  3. **Calculator / scored variables (`x-om-variables`).** Named numeric/boolean/string variables computed from field answers, hidden values, and earlier variables. Render-only — recomputed on demand from stored answers + the pinned schema (Q2=b).
  4. **Hidden fields (`x-om-hidden-fields`) + answer recall.** URL-populated context names; recall tokens `@{field_key}`, `@{hidden.name}`, `@{var.name}` resolve in any localized text (label / help / ending body) at render time.
  5. **Multiple endings + redirect.** Endings become a `kind: 'ending'` variant on the existing `x-om-sections` array. Logic jumps can target a specific ending; the ending may carry `x-om-redirect-url` to bounce the respondent after submit.
- **Single pure evaluator service** (`services/form-logic-evaluator.ts`) shared by the Studio Preview tab and the minimal public renderer — one source of truth, exhaustive tests.
- **One small DB-side change:** none. The existing `form_submission_revision.data` (encrypted JSON) hosts both answers and hidden-field values under a reserved `__hidden__` namespace; no migration needed.
- **No API contract changes** on existing routes. New endpoints in Phase G for the public runner (`GET /forms/:id/run`, `POST /forms/:id/submissions`).

## Locked Decisions (2026-05-12 gate)

| # | Decision | Value |
|---|----------|-------|
| 1 | Runtime scope | Build the schema + Studio authoring UI + a **standalone pure evaluator service** **AND** a minimal public renderer that exercises it. Full 1d (ResumeGate, autosave, review step, attachments) stays in phase 1d. |
| 2 | Computed-variable persistence | Render-only; recomputed from answers + pinned `registry_version` + pinned schema. No new DB columns. Revisit if a downstream consumer needs the value indexed. |
| 3 | Formula language | Reuse **jsonlogic** for everything (visibility, jumps, formulas) — one evaluator, one validator, one Studio AST surface. |
| 4 | Endings model | Extend `x-om-sections[*].kind` enum to `'page' \| 'section' \| 'ending'`. Endings live in the same ordered array, get a key, host only `info_block` fields. Never count toward progress. |
| 5 | Recall token syntax | `@{<identifier>}`. Namespaces: bare = field key, `hidden.<name>` = hidden, `var.<name>` = variable. `@@{` escapes a literal `@{`. Unresolved → empty string + dev warning. |
| 6 | Visibility scope | `x-om-visibility-if` applies to **fields AND sections**. Hidden sections cascade — their fields are treated as hidden too (no required-violations, not in jump source list). |
| 7 | Logic-tab UI | Properties-panel surfaces only in v1: Logic tab on fields (visibility) and on page-`kind` sections (visibility + jumps). A standalone full-screen Flow map is a phase-2 follow-up. |

## Overview

The Forms module today (post phase 1b + visual builder) renders **static** forms: every field is always visible, every page is reached in order, the form has one ending. That's enough for simple intake checklists, but inadequate for the first-class use cases the parent spec calls out — medical questionnaires (DentalOS), B2B onboarding, RFP qualification, NPS routing. Those forms need to *branch*: show the prenatal section only when relevant, route a high-risk respondent to a different ending, total a PHQ-9 score live, pre-link a submission to a patient, echo the patient's name in later question copy.

This spec adds the reactive-form core in a single coordinated change so the studio, evaluator, and renderer all speak the same logic surface. Every addition is an additive optional `x-om-*` keyword with a registered validator and a read-time defaulter — old forms keep rendering identically, `schemaHash` survives a round-trip, and downstream consumers (compiler, runner, exporters) ignore unknown keys if they choose.

## Problem Statement

The current Form Studio + compiler:

1. **Cannot branch.** The phase-2c plan acknowledges `x-om-visibility-if` (jsonlogic) at the schema level but ships no authoring UI for it; visual-builder Decision 15 explicitly hides the Logic tab. Authors who need branching either fork forms or maintain hand-edited JSON.
2. **Cannot compute.** There is no way to derive a numeric score, qualification flag, or aggregated count from answered fields. Clinical scoring tools (PHQ-9, GAD-7), quizzes, and lead-qualification flows are off the table.
3. **Cannot accept external context.** URL-passed identifiers (`?patient_id=…&referrer=…`) have nowhere to land. Submissions don't preserve where they came from.
4. **Cannot personalise.** Question text is a fixed `LocalizedText` map. "Thanks, [Name] — a few more questions about [condition]" is impossible.
5. **Has one ending.** Every form ends the same way; the renderer has no concept of routing to a specific outcome ("you qualify" vs "you don't") or redirecting the respondent onward.

The competitor analysis (`2026-05-12-typeform-research-form-studio-gaps.md`) identifies (1)–(5) as the Tier 1 gap closing the "audit-grade questionnaire" promise.

## Proposed Solution

1. **Five additive root/section keywords** registered in `OM_ROOT_KEYWORDS` / `OmSection` per `packages/forms/AGENTS.md` MUST rules 9–12:
   - Section-level: extend `OmSection.kind` enum from `'page' | 'section'` to `'page' | 'section' | 'ending'`; allow `x-om-visibility-if` on a section (already declared at field level — extending the host); allow `x-om-redirect-url` on `kind: 'ending'`.
   - Root-level: `x-om-jumps` (ordered branching rules), `x-om-variables` (named computed values), `x-om-hidden-fields` (declared context names).
2. **One pure evaluator** (`services/form-logic-evaluator.ts`) that, given `(schema, answers, hidden, locale)`, returns a `LogicState`:
   - `visibleFieldKeys: Set<string>`, `visibleSectionKeys: Set<string>`
   - `variables: Record<string, number | boolean | string>`
   - `nextTarget(currentPageKey): JumpTarget` — applies `x-om-jumps` from the current page
   - `resolveRecall(text: LocalizedText, locale): LocalizedText` — substitutes `@{...}` tokens
   - Used by both the Studio Preview tab and the public renderer; pure, deterministic, no I/O.
3. **Logic tab in the Studio Properties panel** (Decision 5d — hide irrelevant tabs):
   - Field selected → tabs `[Field, Style, Logic]`; Logic shows the visibility condition builder.
   - Page section selected → tabs `[Style, Logic]`; Logic shows visibility *and* a jumps editor.
   - Regular section selected → tabs `[Style, Logic]`; Logic shows visibility only.
   - Ending section selected → tabs `[Style]`; ending has no Logic tab (visibility on an ending is meaningless — endings are only reached via jumps, never naturally).
4. **Input Parameters tab additions**:
   - "Hidden fields" panel — declare names, optional default values, URL-snippet helper.
   - "Variables" panel — declare names, type, jsonlogic formula (with a friendlier sum-builder UI for the PHQ-9 / GAD-7 common case + a raw jsonlogic `<details>` for power users).
5. **Recall-token picker** — an `@` button in every text input that supports recall (`x-om-label`, `x-om-help`, ending body) opens a typeahead popover listing field keys / hidden names / variable names; clicking inserts `@{namespace.name}`.
6. **Endings as first-class palette items.** LAYOUT row gains an "Ending screen" card (drag → creates `{ kind: 'ending', fieldKeys: [], 'x-om-redirect-url': null }`). Ending sections render with a `Tag variant="neutral" dot` "Ending" chip in the Studio canvas and only accept `info_block` drops (other types rejected with a tooltip).
7. **Minimal public renderer** (`apps/mercato/src/app/forms/[id]/run/page.tsx` or `packages/forms/.../backend/forms/[id]/run/page.tsx` — see Architecture for placement) that:
   - Reads the form's currently published `FormVersion`.
   - Populates hidden fields from URL query params (matching declared names).
   - Calls the evaluator per page transition; honours visibility, jumps, recall.
   - Persists answers + hidden values + (computed) variables-in-memory at `submit` via the existing submission write path.
   - Redirects to `x-om-redirect-url` if the reached ending has one.
   - **Excludes** (deferred to phase 1d): ResumeGate, autosave during fill, review step, file attachments, role-aware editing.
8. **Preview-tab parity.** The Studio Preview tab uses the same evaluator so authors can test their logic without leaving the studio.

## Architecture

### Files touched / added

```
packages/forms/src/modules/forms/
├─ schema/
│  ├─ jsonschema-extensions.ts          # +OM_ROOT_KEYWORDS.{jumps,variables,hiddenFields}
│  │                                    # +OmSection.kind enum extension to 'ending'
│  │                                    # +OmSection.{visibilityIf, redirectUrl}
│  │                                    # +validators for all of the above
│  └─ jsonlogic-grammar.ts              # NEW — allowed jsonlogic operators + var prefixes
│                                       #       (centralized so evaluator + validators agree)
├─ services/
│  ├─ form-logic-evaluator.ts           # NEW — pure: schema+state → LogicState
│  ├─ form-logic-evaluator.test.ts      # NEW — exhaustive
│  └─ form-version-compiler.ts          # +partition adapts to kind='ending'; defaulters for new keys
├─ backend/forms/[id]/studio/
│  ├─ logic/
│  │  ├─ ConditionBuilder.tsx           # NEW — visual jsonlogic editor (and/or, ops, var picker)
│  │  ├─ JumpsEditor.tsx                # NEW — ordered rule list with goto-target picker
│  │  ├─ VariablesPanel.tsx             # NEW — Input Parameters subpanel
│  │  ├─ HiddenFieldsPanel.tsx          # NEW — Input Parameters subpanel
│  │  └─ RecallTokenPicker.tsx          # NEW — typeahead popover for @{...} insertion
│  ├─ canvas/
│  │  └─ SectionContainer.tsx           # +'Ending' chip variant; reject non-info_block drops
│  ├─ palette/
│  │  ├─ entries.ts                     # +'Ending screen' layout card
│  │  └─ InputParametersTab.tsx         # +VariablesPanel + HiddenFieldsPanel mounts
│  ├─ preview/
│  │  └─ PreviewSurface.tsx             # Uses form-logic-evaluator; honours visibility/jumps/recall
│  ├─ schema-helpers.ts                 # +setVisibilityIf, +setJumps, +setVariables, +setHiddenFields,
│  │                                    # +setRedirectUrl, +SWAP_FAMILIES unchanged
│  ├─ recall.ts                         # NEW — @{...} tokenizer + resolver (pure)
│  └─ FormStudio.tsx                    # +Logic tab on Field/Section panel; thread declaredRoles etc.
├─ runner/                              # NEW MODULE SUBTREE — minimal public renderer
│  ├─ FormRunner.tsx                    # Top-level component
│  ├─ RunnerPage.tsx                    # Page-at-a-time renderer
│  ├─ FormRunner.types.ts
│  └─ index.ts
├─ frontend/forms/[id]/                 # NEW — public route
│  └─ run/page.tsx                      # Mounts FormRunner for the form's published version
├─ api/
│  ├─ forms/[id]/run/
│  │  └─ context/route.ts               # GET — returns published schema + role policy for runner
│  └─ submissions/route.ts              # POST — runner submit endpoint (or extend existing)
├─ i18n/en.json                         # New keys (see § i18n)
└─ AGENTS.md                            # +MUST 13/14: variables purity; +jsonlogic grammar gate
```

### Studio component tree additions

```
FormStudio
└── Builder
    ├── Palette (left)
    │   └── InputParametersTab
    │       ├── …existing controls…
    │       ├── HiddenFieldsPanel
    │       └── VariablesPanel
    └── Properties (right)
        └── (per selection)
            ├── Field selected           → [Field, Style, Logic]
            ├── Page section selected    → [Style, Logic]   ← Logic = visibility + JumpsEditor
            ├── Regular section selected → [Style, Logic]   ← Logic = visibility only
            └── Ending section selected  → [Style]          ← visibility N/A on endings
```

### `form-logic-evaluator` contract

```ts
export type LogicContext = {
  answers: Record<string, unknown>        // field key → answered value
  hidden: Record<string, unknown>         // hidden field name → resolved value
  variables: Record<string, unknown>      // computed — filled by the evaluator
  locale: string
}

export type JumpTarget =
  | { type: 'page'; pageKey: string }
  | { type: 'ending'; endingKey: string }
  | { type: 'next' }
  | { type: 'submit' }

export type LogicState = {
  visibleFieldKeys: ReadonlySet<string>
  visibleSectionKeys: ReadonlySet<string>
  variables: Readonly<Record<string, unknown>>
  resolveRecall(text: LocalizedText | undefined, locale: string): string
  nextTarget(fromPageKey: string): JumpTarget
}

export function evaluateFormLogic(
  schema: FormSchema,
  context: Omit<LogicContext, 'variables'>,
): LogicState
```

**Determinism guarantees:**
- Variables are computed in topological order; cycles throw `LogicEvaluatorError` (Phase A validator also throws at compile time).
- Visibility is evaluated AFTER variables, so a field's `x-om-visibility-if` may reference a computed variable.
- Jumps are evaluated last, after visibility, so a jump rule operates on the visible state.

### Schema extensions (additive)

```ts
// jsonschema-extensions.ts — additive
export const OM_ROOT_KEYWORDS = {
  // …existing keys…
  jumps: 'x-om-jumps',                // NEW
  variables: 'x-om-variables',        // NEW
  hiddenFields: 'x-om-hidden-fields', // NEW
} as const

export type OmSection = {
  key: string
  title: LocalizedText
  fieldKeys: string[]
  // ── existing additive (visual-builder) ──
  kind?: 'page' | 'section' | 'ending'   // EXTENDED — adds 'ending'
  columns?: 1 | 2 | 3 | 4
  gap?: 'sm' | 'md' | 'lg'
  divider?: boolean
  hideTitle?: boolean
  // ── new (this spec) ──
  'x-om-visibility-if'?: JsonLogic       // NEW host (already declared at field level)
  'x-om-redirect-url'?: string | null    // NEW — only valid when kind === 'ending'
}

export type JumpRule = {
  from: { type: 'page'; pageKey: string } | { type: 'field'; fieldKey: string }
  rules: Array<{ if: JsonLogic; goto: JumpTarget }>
  otherwise?: JumpTarget
}

export type FormVariable = {
  name: string                           // [a-z][a-z0-9_]* — distinct namespace from field keys
  type: 'number' | 'boolean' | 'string'
  formula: JsonLogic
  default?: number | boolean | string
}

export type HiddenFieldDecl = {
  name: string                           // [a-z][a-z0-9_]*
  defaultValue?: string
}
```

Validator additions:

- `OM_ROOT_VALIDATORS['x-om-jumps']`: array of `JumpRule`; each `from.pageKey` / `from.fieldKey` must resolve; each `goto` target must resolve (page key / ending key in `x-om-sections`).
- `OM_ROOT_VALIDATORS['x-om-variables']`: array of `FormVariable`; names match the regex; no name collides with field keys, hidden-field names, or other variable names; formulas reference only known names; **no cycles** (topological sort succeeds).
- `OM_ROOT_VALIDATORS['x-om-hidden-fields']`: array of `HiddenFieldDecl`; names match the regex; no collision with field keys or variable names.
- `OM_SECTION_VALIDATORS` (extension of `x-om-sections`):
  - `kind === 'ending'` → `fieldKeys[]` may only reference fields of type `info_block`.
  - `x-om-redirect-url` is only valid when `kind === 'ending'` (a value on a non-ending section is a validation error).
  - `x-om-visibility-if` on `kind === 'ending'` is a validation error (endings are reached via jumps, never via natural flow).
- `OM_FIELD_VALIDATORS['x-om-visibility-if']` (already declared) — no change.

**`jsonlogic-grammar.ts`** declares the allowed operators (`==, !=, <, <=, >, >=, and, or, not, +, -, *, /, %, in, var, if`) and `var` prefixes (`bare` → field, `hidden.` → hidden, `var.` → variable). Anything outside the grammar is rejected at validator time and by the evaluator (defence in depth).

### Recall token resolution

`@{<identifier>}`:
- `<identifier>` matches `[a-z][a-z0-9_.]*` after the `@{`.
- Bare (no dot) → field key in `properties`.
- `hidden.<name>` → hidden-field declared in `x-om-hidden-fields`.
- `var.<name>` → variable declared in `x-om-variables`.
- `@@{` → literal `@{` (escape).
- Resolution renders the value via locale-aware formatting (numbers via `Intl.NumberFormat`, booleans via i18n keys `forms.runner.bool.true|false`, dates via locale).
- Unresolved or null → empty string + dev console warning (production silent).

Pure function `resolveRecallTokens(text, ctx, locale): string` lives in `studio/recall.ts` so it's reusable from canvas, preview, and runner.

### Public runner — minimal

- Route: `/forms/:formId/run` (server component at the package level; final URL is `/forms/:formId/run`).
- Auth: per the parent spec, customer-facing forms support unauthenticated runs (subject linked at submit) or `requireCustomerAuth` (subject = customer). This spec keeps the existing parent contract; the runner reads `requireCustomerAuth` from the form's metadata.
- Lifecycle:
  1. Fetch the current published `FormVersion` via `GET /api/forms/:id/run/context`. The route returns `{ schema, uiSchema, registry_version }` (no roles policy needed for a runner that's role-locked to the public actor).
  2. Initialise `LogicContext` with `answers = {}`, `hidden = {…URL params resolved against declared names}`, `locale = page locale`.
  3. Render the first page (= the first `kind: 'page'` or implicit page 1 per visual-builder Decision 2a).
  4. On each answer change, recompute the `LogicState` (debounced 100ms) so visibility, recall, and computed variables update.
  5. On "Next", consult `state.nextTarget(currentPageKey)` and navigate.
  6. On reaching a `kind: 'ending'` section, render the ending body (with recall resolved) and call the submit endpoint.
  7. After successful submit, if the ending has `x-om-redirect-url`, redirect (`router.replace` for SPA, full nav for cross-origin).
- Persistence: one shot at submit time. Payload: `{ formVersionId, answers, hidden, endingKey, locale }`. The server constructs the encrypted `FormSubmissionRevision.data` (containing `{ __answers__, __hidden__ }`); computed variables are NOT persisted (Q2=b). The pinned `registry_version` on the `FormVersion` makes recomputation deterministic.
- **Out of scope** (deferred to phase 1d):
  - Resume an in-progress submission via signed token (ResumeGate).
  - Autosave during fill (in-flight drafts).
  - Review-before-submit step.
  - File attachments / signatures (per parent spec — phase 2c/3 field types).
  - Role-aware editing (the runner runs as a single public actor).

## Data Models

No new entities. No new columns. No migrations.

Hidden-field values ride inside the existing `FormSubmissionRevision.data` (encrypted JSON `bytea`) under a reserved namespace key. Concretely, the decrypted JSON has shape:

```jsonc
{
  "__answers__": { "field_1": "...", "field_2": 42 },
  "__hidden__":  { "patient_id": "abc-123", "utm_source": "newsletter" }
}
```

Field keys cannot collide with `__hidden__` (the `field_<n>` convention guarantees no `__*__` keys); the runner serialiser enforces it. Reads via `findOneWithDecryption` continue to work unchanged; consumers that previously read `data.<field>` now read `data.__answers__.<field>` — a one-line migration in the SubmissionService that this spec includes.

`schemaHash` survives all schema additions because the new keywords are absent from old persisted schemas, and the compiler's read-time defaulters never write them back (R-9 mitigation from the visual-builder spec).

## API Contracts

Three changes — all additive or new routes.

### Existing routes — unchanged behaviour, slightly enriched payloads

- `GET /api/forms/:id/versions/:versionId` — returns `schema` / `uiSchema` verbatim, now including any of the new optional keys.
- `PATCH /api/forms/:id/versions/:versionId` — `formVersionPatchRequestSchema` already declares `schema: z.record(z.string(), z.unknown())`; no schema change required, validators on the new keys gate writes.
- `POST /api/forms/:id/versions/:versionId/publish` — unchanged. Adding any new keyword changes `schemaHash` (correct — it's a real schema change).

### New routes

- `GET /api/forms/:id/run/context` — runner bootstrap.
  - Auth: declared per form (parent-spec contract for public vs customer-authed forms).
  - Returns `{ schema, uiSchema, registryVersion, supportedLocales, requiresCustomerAuth }`.
  - `openApi` documented; rate-limited per the existing public-form gate.
- `POST /api/forms/:id/run/submissions` — runner submit.
  - Body schema: `{ formVersionId: uuid, answers: Record<string, unknown>, hidden: Record<string, string>, endingKey: string | null, locale: string }`.
  - Server-side validation: re-runs the evaluator and asserts the reached `endingKey` is reachable from `(answers, hidden)`; defends against tampering.
  - Persists via the existing `FormSubmission` / `FormSubmissionRevision` write path (phase 1c), encrypting `{ __answers__, __hidden__ }`.
  - Emits the existing `forms.form_submission.submitted` event (or whichever 1c defines).

## UI/UX

### Logic tab — Conditional visibility editor

When a field or non-ending section is selected, the Logic tab shows:

```
┌────────────────────────────────────────────────────────────┐
│ Show this field when                          [+ Add rule] │
├────────────────────────────────────────────────────────────┤
│ [smoker     ▾]  [equals       ▾]  [yes  ▾]    🗑           │
│ AND                                                        │
│ [age        ▾]  [is at least  ▾]  [18      ]   🗑          │
│                                                            │
│ Combine with: ( ) any (OR)   (•) all (AND)                 │
├────────────────────────────────────────────────────────────┤
│ ▾ Compiled jsonlogic                                       │
│ {"and": [{"==": [{"var": "smoker"}, "yes"]},               │
│          {">=":[{"var": "age"}, 18]}]}                     │
└────────────────────────────────────────────────────────────┘
```

- Source dropdown lists field keys (resolved to localized labels via `resolveTypeLabel` + the field's `x-om-label`), hidden-field names, and variable names — same picker as recall.
- Operator list adapts to the source's type (text → `equals / contains / is empty / is not empty`; number → `equals / != / </ <=/ >/ >=`; bool → `is true / is false`; etc.).
- Empty rule list ⇒ "Always show" (the keyword is omitted from the schema — R-9 minimalism).

### Logic tab — Jumps editor (page selected)

```
┌────────────────────────────────────────────────────────────┐
│ When this page completes                      [+ Add rule] │
├────────────────────────────────────────────────────────────┤
│ When [age < 18]                  go to  [Page “Disclaimer” ▾]│
│ When [phq_total >= 20]           go to  [Ending “High-risk” ▾]│
│ Otherwise                        go to  [Next page         ▾]│
└────────────────────────────────────────────────────────────┘
```

- Rules are ordered (top wins); reorder via drag handle.
- Target dropdown lists every page section (by localized title + `(page X)`) + every ending section + `Next page` + `Submit`.
- "Otherwise" target defaults to `Next page`; setting it to anything else writes the `otherwise` key.

### Hidden fields panel (Input Parameters tab)

```
┌────────────────────────────────────────────────────────────┐
│ Hidden fields                                  [+ Add]     │
├────────────────────────────────────────────────────────────┤
│ patient_id    Default: (none)             🗑               │
│ utm_source    Default: direct             🗑               │
│                                                            │
│ How to populate:                                           │
│ /forms/abc-123/run?patient_id=<value>&utm_source=<value>   │
└────────────────────────────────────────────────────────────┘
```

- Name input validates the regex (rejected on commit with an inline `Alert variant="destructive"`).
- Default-value input is a `<Input>`.
- The URL snippet auto-updates and offers a copy button.

### Variables panel (Input Parameters tab)

```
┌────────────────────────────────────────────────────────────┐
│ Variables                                      [+ Add]     │
├────────────────────────────────────────────────────────────┤
│ phq_total   number    = sum(phq_1, phq_2, … phq_9)   🗑    │
│ qualifies   boolean   = phq_total >= 10              🗑    │
│                                                            │
│ ▾ Compiled formula                                         │
│ phq_total: {"+": [{"var":"phq_1"},…]}                      │
└────────────────────────────────────────────────────────────┘
```

- v1 formula UI: a small AST builder for the common patterns (`sum(…)`, `count_yes(…)`, `if(condition, a, b)`). Raw jsonlogic exposed under a `<details>` block for power users.
- Type selector locks the formula's required return type (an `if` formula returning a string can't bind to a number variable — the validator throws on save).

### Endings in the palette and canvas

- Palette LAYOUT row: **Page**, **Section/Group**, **Ending screen**, **Info / Heading** (in that order).
- Drag an Ending card onto the canvas → inserts a new `{ key: section_<n>, kind: 'ending', title: { en: 'New ending' }, fieldKeys: [] }` at the drop position.
- An ending section in the canvas has:
  - A `Tag variant="neutral" dot` chip labelled "Ending" at the top of the header (parallel to the page chip).
  - A drop zone that only accepts `info_block` drops; any other drop fails silently (Decision 23b — invalid drops don't render an indicator).
  - A "Redirect on submit" `<Input type="url">` in the Style tab (only shown for `kind === 'ending'`).
- Endings never get a page chip and don't count toward `pages.length`.

### Recall token picker

In any text input that supports recall:

- A small `@` button (lucide `at-sign`, `size-4`) inside the input's trailing slot.
- Click opens a popover (`z-popover`) with a typeahead listing: field keys (icon + localized label), hidden names, variable names.
- Selecting inserts `@{<namespace.name>}` at the caret.
- Typing `@{` directly auto-opens the popover with the current partial as a filter.

### DS compliance — additions to the existing token table

| Element | Token / class |
|---|---|
| Logic-tab "Compiled jsonlogic" `<details>` | reuses `forms.studio.compiledJson` styling |
| Rule row separator | `border-t border-border` |
| AND/OR pill | `Tag variant="muted"` |
| "Otherwise" pill | `Tag variant="neutral"` |
| Ending-chip in canvas | `Tag variant="neutral" dot` (label: "Ending") |
| Recall `@` trigger button | `IconButton variant="ghost" size="sm"` |
| Recall popover | `z-popover` content; `bg-popover` surface |
| URL snippet in Hidden-fields panel | `font-mono text-xs text-muted-foreground` |
| Variables formula raw view | reuses the compiled-JSON `<details>` styling |
| Runner page background | `bg-background`; field cards `bg-card border border-border rounded-lg p-4` |
| Runner Next/Back | `Button` (primary / outline) — matches Preview tab |
| Runner ending body | `prose prose-sm max-w-none text-foreground` |

Nothing in this spec introduces a new hardcoded colour, arbitrary radius, or `dark:` override. Status colors (used in validator-error toasts) go through `Alert variant="destructive"`.

## Implementation Plan (phases)

### A — Schema + evaluator (pure)

- Extend `OM_ROOT_KEYWORDS` with `jumps`, `variables`, `hiddenFields`.
- Extend `OmSection.kind` enum; declare `OmSection.{ visibilityIf, redirectUrl }`.
- Write `OM_ROOT_VALIDATORS['x-om-jumps' | 'x-om-variables' | 'x-om-hidden-fields']` + `OM_SECTION_VALIDATORS` (kind=ending constraints, redirect-url placement).
- Write `jsonlogic-grammar.ts` (operator allowlist + var-prefix vocabulary).
- Implement `services/form-logic-evaluator.ts` (pure; no DI, no I/O).
- Implement `studio/recall.ts` (pure tokenizer + resolver).
- Tests:
  - `form-logic-evaluator.test.ts` — visibility (field, section, cascade), jumps (single rule, ordered rules, otherwise, dangling target rejection at validate-time), variables (topological sort, cycle detection), recall (all three namespaces, escape, unresolved warning), endings (cannot be reached without a jump unless they're the only ending).
  - `recall.test.ts` — token grammar, escape, locale-aware formatting.
  - Round-trip `schemaHash` test extended: load an old schema with no new keys → byte-identical save (already covered by visual-builder Phase A; this phase adds a *new* fixture with the new keys present and asserts round-trip).
- Update `packages/forms/AGENTS.md` — add MUST rule 13 ("variables formulas MUST use only operators in `jsonlogic-grammar.ts`; the validator throws at compile time on unknown operators") and MUST rule 14 ("hidden-field names and variable names MUST NOT collide with field keys; the validator rejects collisions").

### B — Studio: Logic tab — conditional visibility (fields + sections)

- `studio/logic/ConditionBuilder.tsx` — the visual jsonlogic editor.
- Mount the Logic tab in `FormStudio.tsx`'s `FieldPropertiesPanel`. Add a Logic tab to `SectionStylePanel` (renamed → `SectionPropertiesPanel` with `[Style, Logic]`).
- Helpers in `schema-helpers.ts`: `setFieldVisibilityIf`, `setSectionVisibilityIf`.
- Preview-tab integration: wire `PreviewSurface` to call the evaluator so hidden fields/sections disappear in preview.
- Tests: `condition-builder.test.ts` (round-trips a built condition through the schema and the evaluator); preview-rendering test with a hidden field.

### C — Studio: Hidden fields panel + recall tokens

- `studio/logic/HiddenFieldsPanel.tsx` mounted in the Input Parameters tab.
- `studio/logic/RecallTokenPicker.tsx` — the `@` button + popover.
- Recall resolution wired into `PreviewSurface` (label, help, ending body) and the Logic-tab condition builder's source dropdown (so authors can build conditions against hidden values).
- Helpers in `schema-helpers.ts`: `setHiddenFields`.
- Tests: token grammar, escape, unresolved warning, preview render with a recall token referencing a hidden value.

### D — Studio: Variables / Calculator panel

- `studio/logic/VariablesPanel.tsx` mounted in the Input Parameters tab.
- Formula UI: sum-builder + count-yes-builder + raw jsonlogic `<details>`.
- Recall + condition pickers gain a `var.` namespace (so authors can reference variables in labels, help text, jumps, and visibility).
- Helpers in `schema-helpers.ts`: `setVariables`.
- Tests: PHQ-9 round-trip (define 9 fields, define `phq_total` as their sum, set `qualifies` as `phq_total >= 10`, run the evaluator over a fixture with all 9 answered → assert `variables.phq_total` and `variables.qualifies`).

### E — Studio: Endings

- Palette: add "Ending screen" LAYOUT card.
- Canvas: `SectionContainer` gains an "Ending" chip variant for `kind === 'ending'`; drop-zone rejects non-`info_block` drops with a tooltip.
- Properties panel: when an ending is selected, Style tab adds the "Redirect on submit" URL input; Logic tab is hidden (Decision: endings have no visibility).
- Helpers in `schema-helpers.ts`: `setRedirectUrl`, `addLayoutFromPalette` extended to accept `kind: 'ending'`.
- Preview tab: when reached (via jump or default), renders the ending body with recall resolved and a "Restart" button (purely local — clears the preview's `LogicContext`).

### F — Studio: Logic jumps (page sections)

- `studio/logic/JumpsEditor.tsx` — ordered rule list.
- Mounted on the Logic tab when a page-`kind` section is selected.
- Helpers in `schema-helpers.ts`: `setJumps`.
- Preview tab: paginated mode uses `state.nextTarget(currentPageKey)` instead of "linear next" when `x-om-jumps` is present.
- Tests: target validation (rejects a `goto` to a deleted page); preview navigation honours rules; round-trip with a 3-page, 2-rule fixture.

### G — Public runner (minimal)

- `runner/FormRunner.tsx` + `runner/RunnerPage.tsx` — page-at-a-time renderer (always `paginated` for the runner; if the form is `stacked` the runner renders all in one page and submit-on-Next is the only action).
- `frontend/forms/[id]/run/page.tsx` — Next.js page mounting `<FormRunner formId={id} />`.
- `api/forms/[id]/run/context/route.ts` — `GET` returning the published version.
- `api/forms/[id]/run/submissions/route.ts` — `POST` (re-validating server-side via the evaluator; persisting via the existing 1c submission write path with `{ __answers__, __hidden__ }`).
- SubmissionService extension: serialiser nests answers under `__answers__` and stores `__hidden__` alongside. Old revisions (where `data.__answers__` is absent) are read with a one-shot migration helper (`legacyAnswers = data` when no namespace key present) — pure read path, no DB write.
- Tests:
  - Integration (Playwright) — full happy path: GET context → fill 2 pages → jump → reach ending → submit → submission visible in the admin inbox; URL with `?patient_id=abc` populates the hidden field; `x-om-redirect-url` is hit after submit.
  - Server-side tamper test: post a submission claiming `endingKey: 'high_risk'` with answers that don't trigger that ending → server rejects.

## i18n

All new keys 4-level deep per visual-builder Decision 17a (`forms.studio.<area>.<group>.<key>` / `forms.runner.<area>.<group>.<key>`). Sample:

```jsonc
{
  "forms.studio.logic.tab.label": "Logic",
  "forms.studio.logic.visibility.heading": "Show this field when",
  "forms.studio.logic.visibility.always": "Always show",
  "forms.studio.logic.visibility.addRule": "Add rule",
  "forms.studio.logic.visibility.combine.and": "all (AND)",
  "forms.studio.logic.visibility.combine.or": "any (OR)",
  "forms.studio.logic.jumps.heading": "When this page completes",
  "forms.studio.logic.jumps.otherwise": "Otherwise",
  "forms.studio.logic.jumps.target.page": "Page “{{name}}”",
  "forms.studio.logic.jumps.target.ending": "Ending “{{name}}”",
  "forms.studio.logic.jumps.target.next": "Next page",
  "forms.studio.logic.jumps.target.submit": "Submit",
  "forms.studio.parameters.variables.heading": "Variables",
  "forms.studio.parameters.variables.add": "Add variable",
  "forms.studio.parameters.hidden.heading": "Hidden fields",
  "forms.studio.parameters.hidden.add": "Add hidden field",
  "forms.studio.parameters.hidden.urlSnippet.label": "How to populate",
  "forms.studio.canvas.ending.chip": "Ending",
  "forms.studio.canvas.ending.dropRejected": "Endings only accept Info / Heading blocks.",
  "forms.studio.recall.trigger.ariaLabel": "Insert recall token",
  "forms.studio.recall.picker.empty": "No tokens available yet.",
  "forms.runner.bool.true": "Yes",
  "forms.runner.bool.false": "No",
  "forms.runner.actions.next": "Next",
  "forms.runner.actions.back": "Back",
  "forms.runner.actions.submit": "Submit",
  "forms.runner.ending.restart": "Start over"
}
```

## Tests

### Unit (Jest)

- `form-logic-evaluator.test.ts` — visibility cascade, jumps ordering, variables topological sort + cycle detection, recall token resolution, locale formatting.
- `jsonschema-extensions.test.ts` (extension) — validator rejects: dangling jump target, ending with non-info_block field, redirect-url on a non-ending, visibility-if on an ending, hidden/variable name collision with a field key, jsonlogic operator outside the grammar, variable cycle.
- `recall.test.ts` — grammar, escape, namespaces, unresolved warning.
- `condition-builder.test.ts` — built UI state round-trips through schema.
- Studio helpers: `setVisibilityIf`, `setJumps`, `setVariables`, `setHiddenFields`, `setRedirectUrl`.

### Integration (Playwright)

| Path | Coverage |
|---|---|
| Studio Logic tab (field visibility) | Build a condition `smoker == "yes"` on field B; preview hides B when A=No, shows when A=Yes. |
| Studio Logic tab (section visibility) | Section-level condition hides a whole section in preview. |
| Studio Jumps editor | 3-page form with a rule "if `age < 18` → ending Disclaimer"; preview navigates correctly. |
| Studio Variables — PHQ-9 | Define 9 number fields + `phq_total = sum(…)`; preview shows the live total via a recall token in a labels. |
| Studio Hidden fields + recall | Declare `patient_id`; build a label "Welcome, @{patient_id}"; preview with `patient_id=abc` shows "Welcome, abc". |
| Studio Endings | Drag an Ending card; reject a `text` field drop; set redirect URL; preview reaches the ending and shows the body with recall resolved. |
| Public runner happy path | GET context, fill 2 pages, jump rule fires, reach ending, submit → submission appears in admin inbox; redirect URL is honoured. |
| Public runner tamper resistance | POST a submission whose `endingKey` is unreachable from `(answers, hidden)` → server returns 422. |
| Schema-hash stability | Open a form created before this spec, save without edits → `schemaHash` unchanged. |

## Risks & Impact Review

### R-1 — Variable cycle blows up the evaluator

- **Scenario**: An author writes `a = b + 1` and `b = a + 1`; the evaluator infinite-loops or stack-overflows.
- **Severity**: High (DoS-on-self in the studio; potentially in the public runner if the form is published).
- **Affected area**: Studio preview, runner.
- **Mitigation**: Topological sort at evaluator entry; cycles throw `LogicEvaluatorError`. Validator also runs the same sort at save/publish time so a cyclic form cannot be persisted. Unit-tested with a fixture that intentionally cycles.
- **Residual risk**: None.

### R-2 — Jump target dangling after a section delete

- **Scenario**: A jump rule targets page X; the author deletes page X; the form is published; the runner explodes when the rule fires.
- **Severity**: High.
- **Affected area**: Runtime navigation.
- **Mitigation**: Section deletion in the studio (Phase B–G work) rewrites `x-om-jumps` to drop or relink dangling targets. The validator at save and publish time rejects any unresolved target as a hard error. The evaluator falls back to "Next page" if it somehow encounters one at runtime (defence in depth) and logs an error.
- **Residual risk**: Hand-edited schemas — the validator catches them at next save.

### R-3 — Server-side ending tamper

- **Scenario**: A respondent posts `{ endingKey: 'qualified' }` with answers that don't qualify, to game a downstream consumer (a CRM that auto-creates a lead for "qualified").
- **Severity**: High (data integrity / fraud).
- **Affected area**: `POST /api/forms/:id/run/submissions`.
- **Mitigation**: The submit endpoint re-runs the evaluator against `(answers, hidden)` and asserts the claimed `endingKey` is the one the evaluator reaches. Mismatch → 422 with no submission written. Integration-tested.
- **Residual risk**: None within the runner; downstream consumers should still treat `endingKey` as advisory and recompute scores as needed.

### R-4 — Recall token leaks sensitive data into clipboard / DOM

- **Scenario**: A recall token in an ending body renders a sensitive answer (e.g. a free-text symptom description) into the success page, where it can be screenshotted or copied. If the form is shared via a public URL the redirect target could be off-network.
- **Severity**: Medium.
- **Affected area**: Runner ending screen.
- **Mitigation**: Fields marked `x-om-sensitive: true` are NEVER resolvable via recall — the resolver returns the empty string (with a dev warning) for any token referencing a sensitive field. Tested with a fixture. Document in `packages/forms/AGENTS.md` MUST 13 addendum.
- **Residual risk**: Author can still build a leaky form by marking the field non-sensitive then echoing it — that's a design choice we can't take from them, but the default protects the medical case.

### R-5 — jsonlogic operator escalation

- **Scenario**: An author writes a custom jsonlogic op outside the documented grammar (e.g. a remote-eval op from a custom library) and pastes it into the raw JSON. The evaluator silently accepts it.
- **Severity**: Medium.
- **Affected area**: Evaluator security model.
- **Mitigation**: `jsonlogic-grammar.ts` is an allowlist of operators; the evaluator builds its jsonlogic runtime from that list only (no `add_operation` calls). The validator rejects unknown ops at compile time. Tested with a "forbidden op" fixture.
- **Residual risk**: None.

### R-6 — Phase-1d collision

- **Scenario**: The phase-1d Public Renderer spec ships ResumeGate / autosave / review-step / attachments on a different code path than this spec's minimal runner; the two diverge.
- **Severity**: Medium (architectural duplication risk).
- **Affected area**: `runner/`.
- **Mitigation**: This spec places the runner at `packages/forms/.../runner/` with a clear single-entry component (`FormRunner.tsx`); the phase-1d spec MUST extend that component (add hooks for resume, autosave, review) rather than fork a parallel renderer. Document the contract in `packages/forms/AGENTS.md` MUST 15 ("phase-1d enhancements extend, never replace, the Phase-G runner from `2026-05-12-forms-reactive-core.md`").
- **Residual risk**: Acknowledged — if 1d's scope diverges materially, the two specs will need a coordination pass.

### R-7 — Read-time hidden-namespace collision on old revisions

- **Scenario**: An old `FormSubmissionRevision.data` was written before this spec and lacks the `__answers__` / `__hidden__` nesting; readers built for the new shape break.
- **Severity**: Medium.
- **Affected area**: SubmissionService reads.
- **Mitigation**: The deserialiser detects the absence of the namespace key (`if (!data.__answers__) treat the whole blob as legacy answers; hidden = {}`). One unit test per old/new shape. No DB migration.
- **Residual risk**: None.

### R-8 — Recall token grammar collision with future i18n placeholders

- **Scenario**: A future i18n change moves from `{{var}}` to `@{var}` (or similar) and collides with recall tokens.
- **Severity**: Low.
- **Affected area**: Token resolution.
- **Mitigation**: The recall syntax `@{...}` is namespace-prefixed (`hidden.`, `var.`) for two of three forms; the bare form is unambiguous because i18n placeholders today are `{{name}}` (no `@`). Document the conflict-zone in the i18n AGENTS.md if/when i18n migrates.
- **Residual risk**: Acceptable.

## Final Compliance Report (to be filled at PR time)

- [ ] All new keywords listed in `OM_FIELD_KEYWORDS` / `OM_ROOT_KEYWORDS` with validators in `OM_FIELD_VALIDATORS` / `OM_ROOT_VALIDATORS` and entries in `schema-extensions` catalog (MUST 9).
- [ ] `registry_version` not written on draft saves (MUST 10).
- [ ] No new persisted-schema rewrites; `dirtyFlag` guard intact; `schemaHash` survives a no-op round-trip on a pre-upgrade fixture (MUST 12).
- [ ] Pack-registered layout entries stay field-shaped (MUST 11) — endings are a section variant, not a third-party-pack surface.
- [ ] `x-om-sensitive` fields excluded from recall resolution.
- [ ] No raw `fetch` in studio or runner — `apiCall` / `apiCallOrThrow` only.
- [ ] All user-facing strings via `useT()` / `resolveTranslations()`; no hardcoded English.
- [ ] DS-compliant — no hardcoded status colors, no arbitrary text sizes, no `dark:` overrides on semantic tokens; viewport-frame widths remain the documented exception.
- [ ] Every new dialog/popover implements `Cmd/Ctrl+Enter` submit and `Escape` cancel.
- [ ] `pageSize` of any list query stays at or below 100.
- [ ] Integration tests for every UI/runner path listed in § Tests are implemented and pass headlessly.
- [ ] `packages/forms/AGENTS.md` updated with MUST 13 (jsonlogic grammar gate), MUST 14 (name collision), MUST 15 (runner extension contract).
- [ ] No raw AES/KMS; encryption keeps flowing through `FormSubmissionRevision`'s existing encryption path.

## Changelog

- 2026-05-12 — Skeleton drafted; Open Questions gate opened.
- 2026-05-14 — Gate resolved (Q1=b minimal-runner, Q2=b render-only variables, Q3 jsonlogic-only, Q4 kind=ending, Q5 `@{…}`, Q6 sections too, Q7 properties-panel-only). Full spec written: schema extensions, pure evaluator service, Studio Logic tab + jumps editor + variables panel + hidden fields panel + recall picker, endings palette/canvas/properties surfaces, minimal public renderer with tamper-resistant submit. 7 phases (A–G), 8 risks documented.
- 2026-05-14 — Phase A implemented: schema extensions (`x-om-jumps`, `x-om-variables`, `x-om-hidden-fields`, `kind: 'ending'`, section-level `x-om-visibility-if` and `x-om-redirect-url`); per-keyword + cross-keyword validators; `jsonlogic-grammar.ts` allowlist; `form-logic-evaluator.ts` (variables → visibility → jumps, with topological sort + cycle detection); `studio/recall.ts` (tokenizer + resolver); 4 new test suites; AGENTS.md MUST 13/14 added; verified — 269 tests pass.

## Implementation Status

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| Phase A — Schema + evaluator (pure) | Done | 2026-05-14 | All steps implemented, 269 tests pass, typecheck clean for Phase A files |
| Phase B — Studio: Logic tab — conditional visibility | Not Started | — | — |
| Phase C — Hidden fields panel + recall tokens | Not Started | — | — |
| Phase D — Variables / Calculator panel | Not Started | — | — |
| Phase E — Endings (palette/canvas/properties) | Not Started | — | — |
| Phase F — Logic jumps (page sections) | Not Started | — | — |
| Phase G — Public runner (minimal) | Not Started | — | — |

### Phase A — Detailed Progress
- [x] Extend `OM_ROOT_KEYWORDS` with `jumps` / `variables` / `hiddenFields`
- [x] Extend `OmSection.kind` enum with `'ending'`
- [x] Declare `OmSection.{x-om-visibility-if, x-om-redirect-url}` section-level keys
- [x] Add `OM_ROOT_VALIDATORS` for new keywords + ending/redirect/visibility constraints on sections
- [x] Create `schema/jsonlogic-grammar.ts` (operator allowlist + var-prefix vocabulary)
- [x] Create `services/form-logic-evaluator.ts` (pure)
- [x] Create `studio/recall.ts` (pure tokenizer + resolver)
- [x] Add cross-keyword validator (`validateOmCrossKeyword`) wired into schema-helpers + form-version-compiler
- [x] Tests: `form-logic-evaluator.test.ts`, `recall.test.ts`, `jsonlogic-grammar.test.ts`, extended `jsonschema-extensions.test.ts`
- [x] Update `packages/forms/AGENTS.md` MUST 13 (jsonlogic grammar gate) + MUST 14 (name collision)
