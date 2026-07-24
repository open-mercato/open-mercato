# DS-Compliant Module UI Scaffolding — `mercato module scaffold`

- **Status:** Draft (DS DX roadmap, item 4 in execution order)
- **Scope:** OSS (CLI + docs; no runtime contract changes)
- **Depends on:** [`2026-07-05-ds-system-guardian-refresh.md`](./2026-07-05-ds-system-guardian-refresh.md) (guardian refresh, `eslint-plugin-ds` / `yarn lint:ds`) — the lint gate this spec's generated output must pass
- **Risk:** `risk-medium` (new additive CLI surface, generated code only) · **Priority:** `priority-medium`
- **Category:** `feature`

## TLDR

Add an executable scaffolding path to the mercato CLI — `yarn mercato module scaffold <module> --entity <entity> --with-ui` — that generates a DS-compliant UI slice for a new entity: list page (DataTable with `emptyState`, `isLoading`, filters, export), create page (CrudForm + zod validators), tabbed detail page (`Tabs variant="underline"`, `FormHeader mode="detail"`), i18n files for all four locales, a shared `StatusMap`, and `page.meta.ts` metadata with `requireAuth` / `requireFeatures` / breadcrumbs. Templates are derived from the guardian's `page-templates.md` and the customers reference module, including optimistic locking via `initialValues.updatedAt`. Generated output is pinned by golden-file tests and MUST pass `yarn lint:ds`, guardian ANALYZE with zero findings, and typecheck — enforced by a CI job that scaffolds a throwaway module and lints it. The command works in the monorepo (`packages/core/src/modules/`, `apps/mercato/src/modules/`) and in standalone create-app consumers (`src/modules/`). Purely additive: no existing CLI command, generator, or runtime file changes.

## Problem Statement

New module UI today is born non-compliant and remediated later:

1. **No executable scaffold exists.** `yarn mercato module <add|enable|eject>` (`packages/cli/src/mercato.ts`) installs or ejects *existing packaged* modules — it never generates code. The only "scaffolding" paths are:
   - the `om-module-scaffold` skill (`packages/create-app/agentic/shared/ai/skills/om-module-scaffold/SKILL.md`, shipped to standalone apps via the agentic setup) — agent-driven prose instructions, non-deterministic output;
   - `ds-scaffold-module.sh`, a bash heredoc embedded in `docs/design-system/contributor-guardrails.md` §K.3 — unversioned, untested, already drifted from the shipped primitives;
   - manual copy from the customers reference module — 1,000+-line pages that are far richer than a new module needs.
2. **The DS knowledge is documentation, not tooling.** The guardian skill's `.ai/skills/om-ds-guardian/references/page-templates.md` encodes exactly what a compliant list/create/detail page looks like (EmptyState, LoadingMessage, StatusBadge + StatusMap, `useT()`, `apiCall`, metadata guards), but nothing executes it. Every hand-written page re-derives the same checklist and misses items — the guardian then finds violations *after* the code exists.
3. **Compliance drifts by construction.** Post-guardian-refresh, `yarn lint:ds` will flag hardcoded colors, arbitrary values, and missing shared states. Pages that start from a blank file or a stale doc snippet generate churn: violation → review comment → fix commit. Pages that start from a tested template generate none.
4. **The onboarding guide teaches the stale path.** `docs/design-system/onboarding-guide.md` ("Your First Module", April) still points at `./ds-scaffold-module.sh` and section-letter template references (K.1.1–K.1.3) that predate the guardian skill, the shipped Tabs/FormHeader primitives, and default-ON optimistic locking.

## Goals / Non-Goals

**Goals**

- One deterministic command that scaffolds a compliant UI slice for a given entity, in monorepo and standalone targets.
- Generated output passes `yarn lint:ds`, guardian ANALYZE (zero findings), `yarn i18n:check-hardcoded`, and typecheck on day zero.
- Templates have a single executable source of truth, pinned by golden-file tests so they cannot rot silently.
- Refresh the onboarding guide to the post-guardian-refresh reality (PR #3777 lineage).

**Non-Goals**

- Scaffolding the non-UI backbone (entities, migrations, commands, search, events) beyond the minimum the UI slice needs — the `om-module-scaffold` skill remains the guide for the full module; this spec's command becomes the step it calls for pages (see § Skill integration).
- Interactive TUI wizards; the command is flag-driven and non-interactive-safe (CI-friendly). Prompting can layer on later.
- Regenerating or migrating existing pages (the guardian's MIGRATE capability owns that).
- Visual/theme customization flags.

## Proposed Solution

### CLI contract (additive)

Extend the existing `module` dispatch block in `packages/cli/src/mercato.ts` with one subcommand:

```bash
yarn mercato module scaffold <module_id> \
  --entity <entity_singular> \
  --fields "name:text:required,status:select(active|inactive),notes:textarea" \
  --with-ui \
  [--target packages/core | app | <path>] \
  [--features-prefix <module_id>] \
  [--dry-run]
```

- `<module_id>` — plural snake_case, validated against module naming conventions.
- `--entity` — singular entity name; drives file names, i18n key prefixes, `StatusMap` type, API path (`/api/<module_id>`).
- `--fields` — a small field DSL: `name:type[:required][(opt1|opt2)]`. One declaration drives four artifacts at once — the zod schema in `data/validators.ts`, `CrudField[]` on the create page, `ColumnDef[]` on the list page, and the i18n label keys — so they can never disagree:

  | DSL type | zod fragment | CrudField type | List column rendering |
  |---|---|---|---|
  | `text` | `z.string()` (`.min(1)` when `:required`) | `text` | plain cell |
  | `textarea` | `z.string()` | `textarea` | truncated cell, excluded from default columns |
  | `number` | `z.number()` (coerced) | `number` | right-aligned cell |
  | `select(a\|b)` | `z.enum(['a','b'])` | `select` with options | `StatusBadge` via `StatusMap` when the field is named `status`, plain otherwise; quick filter generated |
  | `checkbox` | `z.boolean()` | `checkbox` | boolean cell |
  | `date` | `z.coerce.date()` | `date` | locale-formatted cell |

  Field names must match `^[a-z][a-zA-Z0-9]*$` and clear a reserved-word list (`id`, `createdAt`, `updatedAt`, `deletedAt`, `organizationId`, `tenantId` are always present and never redeclared). Unknown types or malformed options fail fast with the allowed grammar printed.
- `--with-ui` — generates the page slice (the point of this spec). Default **on**; `--no-ui` reserved for a future backbone-only mode so the flag surface is forward-compatible.
- `--target` — where the module lives:
  - `app` (default in the monorepo) → `apps/mercato/src/modules/<module_id>/` (the sanctioned location for user modules; nothing else under `apps/mercato/src/` is touched);
  - `packages/core` → `packages/core/src/modules/<module_id>/` (core contributors);
  - in a standalone app (detected via the existing CLI resolver, same detection `createResolver()` uses to scan `node_modules/@open-mercato/*/dist/modules/`) the default and only target is `src/modules/<module_id>/`.
- `--dry-run` — prints the file plan without writing.

Safety: the command **never overwrites**. If any target file exists it aborts listing the conflicts (exit 1). It prints a "next steps" block (add to `modules.ts` where applicable, `yarn generate`, `yarn db:generate`, `yarn lint:ds`) mirroring the style of `module add`.

### Generated files (`--with-ui` slice)

For `mercato module scaffold tickets --entity ticket --fields "subject:text:required,status:select(open|closed),notes:textarea"`:

```
<target>/modules/tickets/
├── backend/tickets/
│   ├── page.tsx                 # List page
│   ├── page.meta.ts             # nav + RBAC metadata
│   ├── create/
│   │   ├── page.tsx             # Create page (CrudForm)
│   │   └── page.meta.ts
│   └── [id]/
│       ├── page.tsx             # Tabbed detail page
│       └── page.meta.ts
├── components/
│   ├── formConfig.ts            # zod schema + CrudField[] + groups (customers pattern)
│   └── statusMap.ts             # shared StatusMap<'open' | 'closed'>
├── data/validators.ts           # zod validators; types via z.infer
├── acl.ts                       # tickets.view / create / edit / delete
├── setup.ts                     # defaultRoleFeatures wiring for the new features
├── index.ts                     # module metadata
└── i18n/
    ├── en.json                  # all keys used by generated pages
    ├── pl.json
    ├── es.json
    └── de.json
```

`acl.ts`, `setup.ts`, and `index.ts` are generated only when absent (the UI slice must reference real feature IDs); when the module already exists, the command appends nothing and instead reports the feature IDs the pages expect.

**List page** (template lineage: guardian `page-templates.md` § List Page, trimmed from `packages/core/src/modules/customers/backend/customers/people/page.tsx`):
- `Page`/`PageBody` + `DataTable` with `isLoading`, pagination (`pageSize` ≤ 100), `searchValue`/`onSearchChange`;
- `emptyState` for the zero-data case (`EmptyState` with title/description/action, i18n keys) — no empty grid ever renders;
- filters via the shared filter surface (`FilterBar` quick filters generated for the `status` field; the `data-table:<tableId>:filters` spot stays open for injection);
- export enabled through DataTable's export config (CSV/Excel), `exportFileName` derived from the module id;
- status column rendered with `StatusBadge` + the shared `StatusMap` from `components/statusMap.ts` — never hardcoded colors;
- data fetched with `apiCall` — never raw `fetch`; `RowActions` with stable ids (`edit`, `delete`), delete wrapped in `useConfirmDialog` + `flash`.

**Create page** (lineage: guardian § Create Page + `people/create/page.tsx`):
- `CrudForm` with `schema` (zod from `formConfig.ts`), `fields`, `groups`, `submitLabel`, `backHref`/`cancelHref`;
- `createCrud('<module_id>', payload)` with `createCrudFormError` for local validation failures and `flash(..., 'success')` + router push on success;
- `entityIds` wired so custom-field sets load once the module declares `ce.ts`.

**Detail page** (lineage: guardian § Detail Page, upgraded to the shipped primitives — the guardian doc's flat header predates them and is updated by this spec, see § Template source of truth):
- `LoadingMessage` / `ErrorMessage` from `@open-mercato/ui/backend/detail` for the fetch lifecycle;
- `FormHeader mode="detail"` (`packages/ui/src/backend/forms/FormHeader.tsx`) as the page header — title, StatusBadge, Edit/Delete actions; this also exposes the `form-header:detail` injection spot for free;
- tab navigation via `Tabs variant="underline"` from `@open-mercato/ui/primitives/tabs` with a generated `overview` tab (field read-view) and a commented extension point for related-entity tabs. The customers module's `DetailTabsLayout` is module-internal and intentionally **not** copied — the scaffold stays on public primitives;
- edit flows through `CrudForm` with `initialValues` **including `updatedAt`**, so the optimistic-lock header auto-derives for update *and* delete per the platform default-ON contract. The generated `data/validators.ts` documents that the entity's API responses must return `updatedAt` and its table must carry `updated_at` — keeping the scaffold on the right side of `optimistic-lock-editable-entities.test.ts` and `optimistic-lock-ui-coverage.test.ts`.

**`page.meta.ts`** — list page carries the full nav contract observed in `people/page.meta.ts`: `requireAuth: true`, `requireFeatures: ['<module>.view']`, `pageTitle`/`pageTitleKey`, `pageGroup`/`pageGroupKey`, `pageOrder`, `icon` (lucide name), `breadcrumb` with `labelKey`. Create/detail metas carry `requireAuth`, the matching feature (`<module>.create` / `<module>.view`), and breadcrumb chains back to the list.

**i18n** — `en.json` is fully authored from the field DSL (labels, empty-state copy, flash messages, confirm dialog, tab labels, nav keys). `pl.json`, `es.json`, `de.json` are generated with the identical key set and English values, and the command's summary explicitly lists them as "needs translation" (this satisfies `yarn i18n:check-hardcoded` — all page strings go through `useT()` — while `yarn i18n:check-values` remains the advisory nudge to translate, per the Phase-1 i18n audit spec).

### Template source of truth

Templates live as `.tpl` files in `packages/cli/src/lib/scaffold/templates/` (new directory alongside the existing `lib/generators/`), interpolated with a minimal `{{placeholder}}` substitution — no runtime template engine dependency. They ship inside the published `@open-mercato/cli` package, so standalone apps get the exact same templates as the monorepo, versioned with the CLI.

Relationship to the guardian doc: **the CLI templates become the executable source of truth**. `.ai/skills/om-ds-guardian/references/page-templates.md` is updated in the same change to (a) reflect the detail-page upgrade to `FormHeader mode="detail"` + `Tabs variant="underline"` and `initialValues.updatedAt`, and (b) open with a pointer: "these templates are maintained as executable scaffolds in `packages/cli/src/lib/scaffold/templates/`; scaffold with `yarn mercato module scaffold … --with-ui` instead of copy-pasting." The doc's "DS Checklist for Generated Pages" section is retained — it is the assertion list the contract test below encodes.

### Skill integration

- `om-module-scaffold` (create-app agentic skill): step 6 ("Create Backend Pages") is rewritten to run `yarn mercato module scaffold … --with-ui` and then customize, instead of instructing the agent to write pages from prose. Keep `packages/cli/src/lib/agentic-setup.ts` and `packages/cli/build.mjs` in sync per the existing CLI AGENTS.md rule.
- `om-ds-guardian` SCAFFOLD-adjacent flows reference the command as the preferred starting point before ANALYZE.

## Architecture

```
packages/cli/src/
├── mercato.ts                        # + `module scaffold` branch in the existing `module` dispatch
└── lib/scaffold/
    ├── index.ts                      # orchestrator: parse flags → plan → write → report
    ├── field-dsl.ts                  # parse/validate --fields; emit zod/CrudField/ColumnDef fragments
    ├── targets.ts                    # monorepo vs standalone target resolution (reuses resolver)
    ├── templates/                    # *.tpl files (pages, metas, formConfig, statusMap, i18n, acl, setup, index)
    └── __tests__/
        ├── scaffold-golden.test.ts   # golden-file snapshots of every generated file
        └── scaffold-ds-contract.test.ts  # DS checklist assertions + programmatic lint run
```

- No `generators.ts` plugin involvement: scaffolding is a one-shot authoring action, not a `yarn generate` registry concern. The scaffolded module is picked up by the normal auto-discovery once registered.
- No new dependencies; ESLint is already a workspace devDependency for the programmatic lint in tests.
- Determinism: identical inputs produce byte-identical output (stable key ordering, no timestamps), per the CLI package's "generator output deterministic" rule — this is what makes golden files viable.

## Data Models / API Contracts

No database entities, migrations, or HTTP API changes. The only new contract surface is the CLI command itself (see § Migration & Backward Compatibility). Generated code consumes existing STABLE surfaces only: `@open-mercato/ui` backend components and primitives, `@open-mercato/shared` i18n, `apiCall`/`createCrud` helpers, and page-metadata auto-discovery.

## Phasing

- **Phase 1 — Scaffold core (monorepo).** `lib/scaffold/` orchestrator, field DSL, templates for all generated files, `module scaffold` dispatch branch, golden-file tests, checklist half of the DS contract test. Deliverable: the Validation Plan's monorepo flow passes end to end (guardian ANALYZE run manually).
- **Phase 2 — Gates.** Wire the programmatic `eslint-plugin-ds` run into the contract test (once the guardian-refresh spec's plugin merges) and add the CI scaffold-and-lint job to `ci.yml`.
- **Phase 3 — Standalone + skill.** Target resolution for standalone apps, create-app integration coverage in the package-preview pipeline, `om-module-scaffold` skill step-6 rewrite, `agentic-setup.ts`/`build.mjs` sync.
- **Phase 4 — Docs.** Onboarding-guide refresh (§ Documentation Refresh), `page-templates.md` annotation, `contributor-guardrails.md` §K.3 supersession note, `packages/cli/AGENTS.md` gains a "Module UI Scaffolding" section documenting the command and the no-overwrite/determinism rules.

Phases 1–2 are the merge-worthy core; 3–4 can land as fast follows on the same branch train but before the release that publishes the CLI.

## Testing Strategy

Three layers, from cheapest to most end-to-end:

1. **Golden-file tests** (`scaffold-golden.test.ts`, jest snapshots — same pattern as `packages/cli/src/lib/generators/__tests__/output-snapshots.test.ts`): scaffold a fixture module covering every field type and both `--target` shapes into a temp dir; snapshot every emitted file. Intentional template changes update snapshots via `--updateSnapshot` and therefore always show up in review diffs — a template edit can never ship invisibly.
2. **DS contract test** (`scaffold-ds-contract.test.ts`): scaffold into a temp dir, then
   - run ESLint programmatically with the `eslint-plugin-ds` flat config from the guardian-refresh spec → assert zero errors and zero warnings;
   - assert the guardian checklist markers from `page-templates.md` § DS Checklist (EmptyState import on list, `LoadingMessage`/`ErrorMessage` on detail, `StatusBadge`+`StatusMap`, no string literals outside `t(...)` defaults, `apiCall` not `fetch`, metadata guards present, no inline `<svg>`, no `text-[`/raw palette classes).
   This test is the pin between templates and guardian: when the guardian gains a rule, this test fails until the templates comply.
3. **CI scaffold-and-lint job** (new step in `.github/workflows/ci.yml`): scaffold a throwaway module into `apps/mercato/src/modules/__scaffold_ci__/`, run `yarn generate`, `yarn lint:ds` scoped to the folder, and `yarn typecheck`; delete the folder afterwards (and the job asserts a clean `git status`). This exercises the real repo wiring — path aliases, `#generated` imports, tsconfig — that temp-dir tests cannot. The standalone path is covered by extending the existing create-app integration flow (`packages/cli/src/lib/__integration__/`, Verdaccio-based per `packages/create-app/AGENTS.md`) with a scaffold + `next build`-level typecheck assertion; it runs in the package-preview pipeline, not on every PR.

Guardian ANALYZE with zero findings is verified once manually at implementation time and then held by layer 2 (the contract test encodes the ANALYZE checklist) — ANALYZE itself is agent-run and not CI-invocable.

## Documentation Refresh — `docs/design-system/onboarding-guide.md`

Update the April guide to the post-#3777 (guardian refresh) reality. Concrete changes:

1. **M.2 Step 1 (Scaffold):** replace "Option A: `./ds-scaffold-module.sh invoices invoice`" with `yarn mercato module scaffold invoices --entity invoice --fields … --with-ui`; keep "copy from customers" as the manual fallback. Deprecate the bash script in `contributor-guardrails.md` §K.3 with a pointer to the command (script kept one release for link stability, marked superseded).
2. **M.2 Step 4 (Backend pages):** drop the stale K.1.1–K.1.3 section-letter template references; point at `packages/cli/src/lib/scaffold/templates/` and `.ai/skills/om-ds-guardian/references/page-templates.md`. Add `FormHeader mode="detail"` and `Tabs variant="underline"` to the "every template requires" list.
3. **M.2 Step 2:** add the optimistic-locking requirement (entity `updated_at` column, `updatedAt` in list/detail responses, `initialValues.updatedAt` on edit forms) — absent from the April text, now default-ON platform behavior.
4. **M.2 Step 6 (i18n):** replace "en + pl (if applicable)" with the four-locale contract (`en`, `pl`, `es`, `de`) matching what the scaffold emits.
5. **M.2 Step 8 (Verification):** add `yarn lint:ds` and a guardian ANALYZE pass to the verification block alongside `yarn lint` / `yarn build:packages`.
6. **M.3 Self-Check:** add two questions — "Did the pages come from the scaffold (or match its output)?" and "Does `yarn lint:ds` pass with zero findings?".
7. **M.4 Anti-Patterns:** add "hand-writing list/create/detail pages from scratch when the scaffold exists".

## Risks & Impact Review

| Risk | Severity | Affected area | Mitigation | Residual |
|---|---|---|---|---|
| **Template rot** — templates drift from the evolving DS (new tokens, renamed props, new guardian rules) and the scaffold starts generating violations | High | Every newly scaffolded module | Golden files force template diffs into review; the DS contract test is *pinned to guardian checks* (runs `eslint-plugin-ds` + encodes the ANALYZE checklist), so a guardian rule change breaks CI until templates comply; CI scaffold-and-lint job re-proves real-repo compilation on every PR | Low — rot is detected at rule-introduction time, not at user-scaffold time |
| Guardian doc and CLI templates diverge | Medium | Contributor guidance | Single executable source of truth in the CLI; `page-templates.md` demoted to annotated reference with a pointer; checklist section shared with the contract test | Low |
| Standalone version skew — an app's installed `@open-mercato/ui` predates what the CLI templates import | Medium | create-app consumers | Templates ship inside `@open-mercato/cli` and are versioned/published with the matching `@open-mercato/ui`; scaffold prints the minimum package versions it assumes; create-app integration test guards the released pairing | Low-medium — mixed manual upgrades can still skew; failure mode is a typecheck error, not silent breakage |
| Field DSL edge cases emit non-compiling code (reserved words, weird option strings) | Medium | CLI | Strict DSL validation (identifier regex, reserved-word list, option sanitization) with actionable errors; golden fixtures include hostile names | Low |
| Overwriting user work | High if unmitigated | User modules | Hard no-overwrite rule with conflict listing and non-zero exit; `--dry-run` | Negligible |
| `lint:ds` / guardian-refresh spec slips (dependency not merged) | Medium | Delivery order | Layers 1 and CI typecheck are independent of `eslint-plugin-ds`; the contract test's lint step is added behind the dependency and the checklist assertions land immediately | Low — degraded (checklist-only) gate until the plugin ships |

Blast radius: generated-code-only. The command writes new files and never edits existing ones; no runtime, schema, or API surface changes. A buggy release affects only modules scaffolded with it, and those fail loudly at lint/typecheck.

## Migration & Backward Compatibility

- **New CLI command — ADDITIVE.** `module scaffold` is a new subcommand under the existing `module` namespace; `add`/`enable`/`eject` are untouched. Per `BACKWARD_COMPATIBILITY.md`, CLI commands are a contract surface with additive changes allowed without a deprecation cycle. Once shipped, the command name, flag names, and generated-file layout become STABLE (renames require the deprecation protocol).
- No existing generator output, auto-discovery convention, or generated-file location changes (`packages/cli` AGENTS.md "Ask First" items are not triggered beyond this spec itself serving as the ask).
- `ds-scaffold-module.sh` in the docs is superseded, not removed, for one release.
- The `om-module-scaffold` skill update is backward compatible: agents on older create-app scaffolds simply keep the prose path until they upgrade `@open-mercato/cli`.
- No data migration; nothing to roll back beyond reverting the CLI release.

## Validation Plan

```bash
# Unit + golden + DS contract
yarn workspace @open-mercato/cli test
yarn workspace @open-mercato/cli build

# End-to-end in the monorepo (mirrors the CI job)
yarn mercato module scaffold tickets --entity ticket \
  --fields "subject:text:required,status:select(open|closed),notes:textarea" --with-ui
yarn generate
yarn lint:ds packages/../apps/mercato/src/modules/tickets   # zero findings
yarn typecheck
yarn i18n:check-hardcoded                                   # no new hardcoded strings
# guardian: run ANALYZE on the scaffolded module — expect zero findings
git clean -fd apps/mercato/src/modules/tickets              # throwaway

# Determinism
yarn mercato module scaffold … --dry-run                    # identical plan on re-run

# Standalone (package-preview pipeline)
# create-app via Verdaccio → mercato module scaffold → yarn generate → typecheck
```

Manual QA: boot `yarn dev`, confirm the scaffolded module appears in the sidebar (nav metadata), the list shows the EmptyState, create → detail → edit round-trips with the optimistic-lock header visible in the request, and export produces a file.

## Integration & Test Coverage (spec-mandated list)

- API paths: none added (generated pages call the module's own future CRUD route; route scaffolding is out of scope).
- Key UI paths covered by the CI scaffold job + golden/contract tests: list (empty state, loading, filters, export config), create (CrudForm submit/validation error), detail (loading/error, tabs, edit with `updatedAt`), delete confirm.
- Playwright integration tests are **not** added for the throwaway module (it never persists); the create-app integration flow asserts scaffold + build only.

## Resolved Decisions

1. **`module scaffold --with-ui` over a separate `scaffold-ui` command** — keeps one `module` namespace, leaves room for the non-UI backbone under the same verb, and `--no-ui` is already reserved.
2. **CLI templates as source of truth; guardian doc annotated** — an executable artifact with tests beats a doc with intentions; the doc keeps the human-readable checklist that the contract test encodes.
3. **Detail page on public primitives (`FormHeader` + `Tabs`), not customers' `DetailTabsLayout`** — the reference module's layout component is module-internal; copying it would create exactly the cross-module coupling the architecture rules ban.
4. **Non-English locales generated with English values** — key parity on day zero beats missing files; `i18n:check-values` remains the advisory that flags them for translation.

## Changelog

- 2026-07-05 — Initial draft (DS DX roadmap item 4: executable DS-compliant UI scaffolding).
- 2026-07-18 — Phases 1–2 implemented: `packages/cli/src/lib/scaffold/` (orchestrator, field DSL, targets with a marked Phase-3 standalone seam, templates), `module scaffold` dispatch in `mercato.ts`, golden-snapshot + DS-contract tests (programmatic `eslint.ds.config.mjs` run, zero errors/warnings, guardian checklist markers, hostile-input cases, determinism), CI scaffold-and-lint step. Deviations: templates ship as TS string-constant modules rather than loose `.tpl` assets (`build.mjs` bundles only `src/**/*.ts`); the CI probe targets `packages/core` as `scaffold_ci` (`__scaffold_ci__` fails the module-id grammar and the DS lint config scopes `files` to `packages/**`); list/detail deletes wrap `deleteCrud` in `useGuardedMutation` + the optimistic-lock header per the workspace coverage guard; the detail `overview` tab hosts the CrudForm edit surface directly. Phases 3–4 (standalone targets, skill/doc refresh) pending.
