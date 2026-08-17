# Reference Example Module — Developer Documentation Showcase

- **Status:** Draft
- **Date:** 2026-08-17
- **Scope:** OSS, `apps/docs` (Docusaurus site)
- **Related:** [Standalone Canonical Example Module](./2026-07-31-standalone-canonical-example-module.md) (implementation contract for `example` itself — does not cover `apps/docs`), merged PR [#4897](https://github.com/open-mercato/open-mercato/pull/4897) (`feat(create-app): complete the canonical example and standalone harness`), issue [#5202](https://github.com/open-mercato/open-mercato/issues/5202)

## 📝 TLDR

`apps/mercato/src/modules/example/` is the platform's canonical, source-present-but-runtime-disabled reference module, and its `references/surface-inventory.json` / `references/surface-map.md` already curate 70 capability rows (69 `canonical`/`example` + 1 `canonical`/`specialist-route` QA-only row). None of that is discoverable from `apps/docs` today — the public developer documentation site has no page that tells a module author the reference module exists, what it demonstrates, or how to read it safely. This spec adds one new Docusaurus page, `apps/docs/docs/framework/modules/reference-example-module.mdx`, that transcribes the inventory into a reader-oriented showcase grouped into 12 sections, links it from the two entry points named in the issue, and adds a drift-detecting test that fails the moment the page and the inventory disagree.

## 📝 Problem Statement

PR #4897 (already merged to `develop`) built the `example` module and its machine-readable inventory, but the "reader-facing documentation experience" was explicitly left out of that PR's scope and out of the [implementation spec](./2026-07-31-standalone-canonical-example-module.md) that governs it — that spec's own text audits every emitted skill, guide, and harness owner for source-link coverage, and never once mentions `apps/docs` (confirmed: zero matches for `apps/docs` in the spec body). The only mention of `example` in the current public docs is one plain-text tip in `apps/docs/docs/customization/create-first-module.mdx`:

> Browse `apps/mercato/src/modules/example/` for a full working module that exercises most platform features (entities, APIs, forms, grids, events, dashboard widgets, custom fields, and injection).

That sentence does not tell a reader which of the 70 capability rows exist, which are safe to copy (`readable`) versus QA-only, or where each one lives. A module author who wants "the canonical way to add a queued DataTable bulk action with progress" today has to already know the inventory files exist and read raw JSON. Documentation, not implementation, is the entire gap.

## 📝 Proposed Solution

Transcribe, not re-derive. The inventory (`surface-inventory.json`) and its human view (`surface-map.md`) are already the audited, tested source of truth for what `example` demonstrates — this spec does not re-audit the module or invent new capability rows. It:

1. Adds one new page that groups the inventory's 70 rows into 12 reader-oriented sections (regrouped from `surface-map.md`'s 11 code-organization-oriented sections into the areas the issue names — see Architecture below), each capability rendered as `capabilityId`, title, one-paragraph "what this demonstrates," and a link to its exact source path(s).
2. Distinguishes the one `qa-only` row (`testing.integration-coverage`) visibly and separately, consistent with the module's own `README.md` rule that `qa-only` rows are not a pattern to copy.
3. Links the page from the two entry points the issue names, replacing the plain-text tip with a real cross-reference.
4. Adds a Node test that derives its expected capability-id set from `surface-inventory.json` at test time (never a hard-coded count), so a future capability added to the module without a matching docs update fails CI instead of drifting silently.
5. Does not touch `example`'s runtime, the inventory generator, the create-app harness, or any FROZEN/STABLE `BACKWARD_COMPATIBILITY.md` surface — this is an additive `apps/docs` change only.

### Alternatives considered

- **Auto-generate the mdx page from the JSON at build time.** Rejected: every other `apps/docs/docs/framework/modules/*.mdx` page is hand-authored prose with code samples and framing text (see `currencies.mdx`, `notifications.mdx`); a generated page would read as a JSON dump and break that voice. The drift test (item 4) gets the safety property a generator would have given, without the generator's added build-pipeline surface.
- **Fold the showcase into the existing `overview.mdx` (`Modules: Authoring and Usage`).** Rejected: that page is already a long "how modules work" reference; appending 70 capability rows would bury it. A dedicated page keeps both documents scannable, and `overview.mdx` still gets a short entry-point link (acceptance criterion 6).
- **Link every capability to a repo-relative path instead of a GitHub blob URL.** Rejected: the published docs site (`docs.open-mercato.dev`) does not serve repository files, and a relative Markdown link would 404 there. Eight existing pages already resolve this the same way (`https://github.com/open-mercato/open-mercato/blob/develop/<path>`); this page follows that established convention rather than inventing a new one.

## 📝 Architecture

### Page location and registration

- New file: `apps/docs/docs/framework/modules/reference-example-module.mdx`.
- Frontmatter: `title: Reference Example Module`, a one-line `description`.
- Registered in `apps/docs/sidebars.ts` under the existing `Modules` category, directly after `"framework/modules/overview"` (before the `Core Modules` subcategory) — it documents module *authoring* the same way `overview.mdx` does, not a specific core module.

### Page structure

1. **What this module is and is not** (acceptance criterion 2, verbatim intent):
   - canonical app-local teaching module;
   - ships in monorepo, create-app template, and every standalone preset (`classic`, `empty`, `crm`);
   - source-present, runtime-disabled: absent from every generated `src/modules.ts` (and from the monorepo's own `apps/mercato/src/modules.ts`) until a developer adds `{ id: 'example', from: '@app' }` and runs `yarn generate` (plus `yarn db:migrate` for its migrations — sourced from the module's own `README.md`, quoted rather than restated from memory);
   - a reference for *one compiling way* to use a mechanism, not the production authority for provider internals (routes to `om-integration-builder`), workflow orchestration (routes to the `workflows` framework guide), mutation-capable AI (routes to `om-create-ai-agent`), or portal authentication (routes to the `customer_accounts` guide) — matching the module's own `README.md` → Scope section.
   - a short "do not copy the whole tree" warning linking to the module's copy/rename checklist (`README.md` → *Copy / adapt checklist*), so the docs page does not duplicate that checklist's 10 steps inline.
2. **How to read this page** — `capabilityId`, "Demonstrates," Source (GitHub blob link(s)), Status (`readable` / `qa-only`) columns; qa-only meaning restated inline (present and working, but fails a current reference-quality gate — never a pattern to copy).
3. **12 capability sections**, each a table with the same four columns, populated verbatim from `surface-inventory.json` (`title` → the row label, `description` → "Demonstrates," `sourcePaths` → link targets). Section membership (a complete, non-overlapping partition of all 70 rows, derived directly from the issue's own grouping bullets):

   | # | Section title | `capabilityId`s |
   |---|---|---|
   | 1 | Module Foundation & Lifecycle | `module.metadata`, `module.acl-features`, `module.setup-role-features`, `module.di-registration`, `module.cli-command`, `module.i18n-catalogs`, `module.translatable-fields`, `module.setup-scheduler-target`, `module.generator-plugin` |
   | 2 | Data Model | `data.entities`, `data.validators`, `data.custom-fields`, `data.migrations`, `data.encryption-map`, `data.entity-extensions` |
   | 3 | APIs & Commands | `api.crud-factory`, `api.crud-query-engine-custom-fields`, `api.openapi`, `api.custom-route`, `api.option-source-routes`, `api.interceptors`, `commands.write`, `commands.undo-redo`, `commands.interceptors` |
   | 4 | Events, Indexing & Cache | `events.typed-definitions`, `events.crud-indexer-bridge`, `events.sync-subscribers`, `events.ephemeral-subscriber`, `events.portal-broadcast`, `runtime.tenant-scoped-cache`, `runtime.bulk-operation-progress` |
   | 5 | Backend & Frontend UI | `ui.page-shell`, `ui.datatable`, `ui.datatable-perspectives-filters`, `ui.form-create`, `ui.form-edit`, `ui.frontend-page`, `ui.page-middleware`, `ui.frontend-page-middleware`, `ui.dashboard-widget` |
   | 6 | Unified Module Extension System (UMES) | `umes.mutation-guard`, `umes.response-enricher`, `umes.extension-points`, `umes.injection-table`, `umes.injection.crud-form-field`, `umes.injection.datatable-column`, `umes.injection.datatable-filter`, `umes.injection.datatable-row-action`, `umes.injection.datatable-bulk-action`, `umes.injection.menu-items`, `umes.injection.rendered-widget`, `umes.component-replacement` |
   | 7 | Search | `search.module-config`, `search.vector-config`, `search.encrypted-column-list-filter` |
   | 8 | AI Tools & Agents | `ai.tool-pack`, `ai.agent`, `ai.agent-extension`, `ai.tool-override`, `ai.agent-override` |
   | 9 | Notifications & Messages | `notifications.type`, `notifications.reactive-handler`, `notifications.client-renderer`, `messages.object-type` |
   | 10 | Integrations & Workflows | `integrations.mock-adapters`, `integrations.local-bundle`, `workflows.code-definition` |
   | 11 | Unified Module Overrides | `overrides.unified-registry`, `overrides.compileable-reference` |
   | 12 | Testing Evidence (QA-only) | `testing.integration-coverage` |

   69 rows across sections 1–11 (`coverageKind: "example"`, `referenceStatus: "canonical"`) + 1 row in section 12 (`coverageKind: "specialist-route"`, `readStatus: "qa-only"`) = all 70 rows in the inventory. No row is skipped; no row appears twice.
4. **Where to go deeper** — one short paragraph per section (not per row) naming the `ruleOwner` skill/guide already recorded in the inventory (e.g., `om-module-scaffold`, `om-system-extension`, `om-data-model-design`, `om-create-ai-agent`, `om-integration-builder`), so a reader who wants the *normative* rule, not just a compiling example, knows where to go. This reuses `ruleOwner` values already present in the JSON; it does not invent new ownership.

### Evidence boundary (acceptance criterion 5)

- Every `sourcePaths` / `integrationTestPaths` link renders as a GitHub blob URL. Inventory paths (e.g. `"src/modules/example/index.ts"`) are already relative to `apps/mercato/`, so the correct link target is `https://github.com/open-mercato/open-mercato/blob/develop/apps/mercato/<sourcePath>` — **not** `.../apps/mercato/src/modules/example/<sourcePath>`, which would double the `src/modules/example/` segment and 404 on every row. This matches the convention in the existing `apps/docs` pages that already link exact repo files (e.g. `official-modules-development.mdx`, `concurrency-locking.mdx`), which build the same `.../blob/<branch>/<repo-relative-path>` shape.
- Rows whose only evidence is an `integrationTestPaths` entry (the QA-only row, plus the "proven by unit tests only" set the module's own `surface-map.md` already tracks) are captioned "repository-only evidence — not emitted source, not a copyable pattern" rather than presented as a normal source link. This mirrors the module's own `surface-map.md` wording rather than inventing new phrasing.
- The showcase never renders `designSystemGallery`, `designFoundation`, `designSystemReferences`, or `designSystemCoverageGaps` from the inventory — those fields belong to the PR #4301/#4277 design-system provenance contract owned by the linked spec, not to this module's own capability rows, and promoting them here would blur that ownership boundary (explicit out-of-scope item in the originating issue).

### Entry-point links (acceptance criterion 6)

- `apps/docs/docs/framework/modules/overview.mdx`: add one short paragraph (not a new top-level section) near the "Listing and Overriding" or "Official Modules" area pointing to the new page, phrased as "see the [Reference Example Module](./reference-example-module) showcase for a capability-by-capability index."
- `apps/docs/docs/customization/create-first-module.mdx`: replace the existing `:::tip Existing reference modules` admonition body (currently one plain-text sentence) with a version that keeps the same tip but links `apps/mercato/src/modules/example/` prose to the new showcase page instead of leaving it as an unlinked path.

## 📝 Data Model

No database or entity changes. The "data model" for this feature is the existing `surface-inventory.json` contract (`capabilityId`, `title`, `description`, `coverageKind`, `referenceStatus`, `readStatus`, `sourcePaths`, `integrationTestPaths`, `dependencyModules`, `ruleOwner`), read but never written by this change. The docs page and its test are both downstream consumers of that file, not new sources of truth.

## 📝 API Contracts

None. This is a static-content and test-only change; no API routes, commands, or events are added or modified.

## 📝 UI/UX

This is Docusaurus content, not an interactive application screen — no new backend/frontend page, form, or component ships in `apps/mercato`. Per `om-auto-write-spec`'s mockup step, UI mockups/screenshots are skipped for this spec: there is no proposed *application* UI to render, and the doc page's own content is fully specified in Architecture above. The implementation PR still runs a full `yarn build` of the docs site (Proposed Solution / Testing) so the rendered page is verified before merge, but that is a build-output check, not a mockup.

## 📝 Edge Cases & Failure Scenarios

| Scenario | What breaks | User-visible behavior / mitigation |
|---|---|---|
| A future PR adds a capability to `example` (new `surface-inventory.json` row) without updating the docs page | The showcase silently under-represents the module | `reference-example-module.test.mjs` reads `surface-inventory.json` at test time, computes the expected `example`/`canonical` capability-id set, and fails listing the missing id(s) — not a hard-coded count that could be bumped without checking coverage |
| A capability is removed or renamed in the inventory | The docs page links a `capabilityId` that no longer resolves | Same test asserts every documented capability id exists in the current inventory; a stale id fails with the offending id named |
| A linked source path is renamed or deleted | A dead GitHub blob link ships to readers | The test resolves every linked `sourcePaths` entry against the filesystem in the worktree (not the fixed `develop` URL, which cannot be checked offline) and fails on a missing file |
| The QA-only row is documented like the other 69 | A reader copies `__integration__`/`__tests__` layout as if it were emitted, copyable source | The test asserts the `testing.integration-coverage` row is rendered inside its own "QA-only" section/caption text (a stable string marker), separate from the 69 `readable` rows |
| The disabled-by-default activation steps are dropped from the page in a future edit | A reader thinks `example` runs out of the box, or does not know `yarn db:migrate` is required | The test asserts the page's "What this module is and is not" section contains the `{ id: 'example', from: '@app' }` snippet and the words `yarn generate` and `yarn db:migrate` |
| `apps/mercato/src/modules/example/references/surface-inventory.json` is unreadable/missing when the test runs | Test would silently pass with an empty expected set (false green) | Test asserts the loaded inventory's capability count is non-zero before comparing, so a missing/empty inventory fails loudly instead of vacuously passing |
| Docusaurus production build breaks a link on this page | `yarn workspace open-mercato-docs build` fails | Existing Docusaurus `onBrokenLinks` build-time check already fails the build (no new mechanism needed); this spec relies on that existing gate per acceptance criterion 8 |

## 📝 Risks & Impact Review

- **Blast radius:** one new `.mdx` file, one new test file, three edited files (`sidebars.ts`, `overview.mdx`, `create-first-module.mdx`), one edited `apps/docs/package.json` test-script wiring. No code under `apps/mercato`, `packages/*`, or any migration/API/schema surface changes.
- **Compatibility:** touches no `BACKWARD_COMPATIBILITY.md` contract-surface category (not an auto-discovery file, type, signature, import path, event id, widget spot id, API route, DB schema, DI key, ACL feature, notification id, CLI command, or generated file).
- **Drift risk (the actual risk worth naming):** the showcase can go stale the moment `example` gains, loses, or renames a capability. Mitigated by the drift test (Edge Cases above), which is the acceptance-criterion-7 requirement, not an optional nice-to-have.
- **Rollback:** revert the PR; no migration, no data, no runtime behavior to unwind.
- **Out of scope (unchanged from the issue):** no change to `example`'s runtime behavior, no new canonical capability added to the inventory, no replacement of the focused framework guides (`om-module-scaffold`, `om-system-extension`, etc.) with duplicated long-form samples, no promotion of QA-only fixtures as recommended patterns.

## 📋 Resolved assumptions (autonomous defaults)

| # | Question | Resolved answer | Rationale |
|---|---|---|---|
| Q1 | How should the 70 inventory rows be grouped into "useful reader sections" (acceptance criterion 3 asks for grouping but the issue's bullet list and the module's own `surface-map.md` group them differently)? | Use the issue's own 11 grouping bullets verbatim (partition table in Architecture), not `surface-map.md`'s 11 code-organization groups. | The issue text is the acceptance criterion; its bullets already form a complete, non-overlapping partition of all 70 capability ids (verified by counting), so following it exactly needs no invention and is the smallest-scope choice that still satisfies criterion 3. |
| Q2 | Should source links point at repo-relative Markdown paths, exact-commit blob URLs, or a fixed-branch GitHub blob URL — and if the latter, `main` or `develop`? | Fixed-branch GitHub blob URLs, on `develop` specifically (`.../blob/develop/<path>`). | `apps/docs` pages already use the `.../blob/<branch>/<repo-relative-path>` shape in general (verified via repo search: 18 links across 8 pages); the branch is split between `main` (13 links) and `develop` (5 links), so this is not a unanimous existing convention — `develop` is chosen because it is this repository's configured `baseBranch` (`.ai/agentic.config.json`), the branch the doc's own source (`example`'s inventory) is verified against. Repo-relative links would 404 on the published Docusaurus site; pinning an exact commit SHA would go stale immediately since `example` changes independently of doc edits. |
| Q3 | Does this spec need UI mockups/screenshots per `om-auto-write-spec` step 5? | No — this is static documentation content, not a new application screen. | The mockup step exists for proposed interactive app UI; a Docusaurus content page has no such surface, so mockups would be busywork with no reviewer value. Recorded here so the implementing PR does not appear to have silently skipped a required step. |
| Q4 | Should `reference-example-module.test.mjs` validate against the built `apps/docs/build/` output (like the existing `search-index.test.mjs`) or against the `.mdx` source plus the inventory JSON directly? | Content/drift assertions (capability coverage, dead links, QA-only distinction, activation guidance) run against the `.mdx` source and `surface-inventory.json` directly; only the "new page is in the generated search index" assertion (acceptance criterion 8) is added to the existing post-build `search-index.test.mjs`. | Source-level assertions run without a full `yarn build` first, keeping the drift check fast and independent of the docs build pipeline; the one assertion that inherently needs the build output (search-index presence) reuses the existing build-output test rather than duplicating a second build-dependent test file. |

No `⚠ NEEDS HUMAN CONFIRMATION` markers — every default above is fully reversible (a future PR can regroup sections or change the link format without touching runtime behavior, data, or any frozen contract) and none weakens security, scoping, or a documented compatibility contract.

## 📋 Phasing

- **Phase 1 — Showcase page and navigation.** Ship the `.mdx` page, sidebar registration, and the two entry-point links. Independently shippable and independently useful (a developer can already navigate to and read the page).
- **Phase 2 — Drift-detecting tests.** Add `reference-example-module.test.mjs`, wire it into `apps/docs/package.json`, and add the search-index assertion to the existing `search-index.test.mjs`. Depends on Phase 1 existing (the tests assert against the page Phase 1 ships) but is its own reviewable, testable unit.

Both phases ship in the same PR (the acceptance criteria treat the page and its regression test as one deliverable, and a docs page without its drift test would immediately violate the "MUST ship in the same PR" convention this repo uses for tests); phasing here documents step ordering within that PR, not separate PRs.

## 📋 Implementation Plan

### Phase 1 — Showcase page and navigation

1. Read `apps/mercato/src/modules/example/references/surface-inventory.json` and transcribe its 70 rows into the 12-section structure fixed in Architecture above. For each row, render `capabilityId` (inline code), the row's `title` as the row heading, `description` as the "Demonstrates" cell, and every `sourcePaths` entry as a `` [`relative/path`](https://github.com/open-mercato/open-mercato/blob/develop/apps/mercato/<path>) `` link — the JSON's `sourcePaths` entries (e.g. `"src/modules/example/index.ts"`) are already relative to `apps/mercato/`, so the blob URL is `.../blob/develop/apps/mercato/` **plus the path as-is**; do not additionally insert `src/modules/example/`, which would double that segment and 404. Leave test-only capabilities (the QA-only row, and rows whose only evidence is `integrationTestPaths`) captioned as repository-only evidence rather than linked as copyable source, per the Evidence boundary section. **Testable:** the page renders through `yarn workspace open-mercato-docs start` (or a local Docusaurus dev build) with no MDX compile errors.
2. Write the "What this module is and is not" section (role, lifecycle, disabled-by-default activation snippet, scope boundary), the "How to read this page" legend, and the per-section "where to go deeper" paragraphs naming each section's `ruleOwner`(s). **Testable:** manual read-through against the acceptance-criterion-2 bullet list; every bullet has a corresponding sentence on the page.
3. Register the page in `apps/docs/sidebars.ts` under `Modules`, directly after `"framework/modules/overview"`. **Testable:** `yarn workspace open-mercato-docs build` succeeds and the sidebar renders the new entry (spot-checked in the build output or dev server).
4. Add the entry-point link/paragraph to `apps/docs/docs/framework/modules/overview.mdx` and update the `:::tip Existing reference modules` admonition in `apps/docs/docs/customization/create-first-module.mdx` to link the new page. **Testable:** `yarn workspace open-mercato-docs build`'s broken-link checker passes with both new internal links resolved.

### Phase 2 — Drift-detecting tests

5. Add `apps/docs/__tests__/reference-example-module.test.mjs`. It reads `apps/mercato/src/modules/example/references/surface-inventory.json` (relative path from the test file via `import.meta.url`, crossing the `apps/mercato`/`apps/docs` workspace boundary the same way the module's own tooling already treats the file as a readable JSON artifact) and the new `.mdx` source, then asserts:
   - the JSON's capability count is non-zero (guards the vacuous-pass edge case);
   - every `capabilityId` with `coverageKind === "example"` and `referenceStatus === "canonical"` appears in the `.mdx` source (`expect.toContain` per id, collected into one failure listing every missing id rather than failing on the first);
   - every `capabilityId` referenced in the `.mdx` source exists in the current inventory (catches a renamed/removed id left behind in docs);
   - every distinct `sourcePaths` entry linked from the `.mdx` resolves to a real file under `apps/mercato/src/modules/example/` in the current worktree;
   - the `testing.integration-coverage` row is present and rendered under/with the QA-only marker text, not commingled with the `readable` rows;
   - the page's source contains the disabled-by-default activation guidance (`{ id: 'example', from: '@app' }`, `yarn generate`, `yarn db:migrate`).
   **Testable:** `node --test apps/docs/__tests__/reference-example-module.test.mjs` fails red against a version of the page missing one capability id (verify by temporarily deleting one row locally), then passes green once restored.
6. Wire the new test file into `apps/docs/package.json`'s `test` script alongside the existing `search-index.test.mjs` invocation (both under the same `node --test` call, or two `--test` targets in sequence — whichever keeps the existing `yarn clean && yarn build && node --test ...` shape intact). **Testable:** `yarn workspace open-mercato-docs test` runs both files.
7. Extend the existing `apps/docs/__tests__/search-index.test.mjs` with one additional assertion: the built `search-index.json` contains a document whose `u` (url) matches the new page's route, mirroring the existing introduction-page assertion pattern. **Testable:** `yarn workspace open-mercato-docs test` fails if the new page is excluded from `docs` inclusion or the search index generation, passes once the page is indexed normally (no special-casing expected — Docusaurus indexes every `docs/**` page by default).
8. Run the full validation sequence below and fix anything it surfaces.

## Testing and Validation

### Focused coverage

- `node --test apps/docs/__tests__/reference-example-module.test.mjs` — new drift/content test (step 5).
- `node --test apps/docs/__tests__/search-index.test.mjs` — extended with the new-page search-index assertion (step 7).

### Validation Sequence

```bash
yarn workspace open-mercato-docs build   # production Docusaurus build; fails on any broken link
yarn workspace open-mercato-docs test    # clean + build + both node --test files
```

No monorepo-wide `yarn typecheck` / `yarn test` impact is expected (no `.ts`/`.tsx` source under `apps/mercato` or `packages/*` changes), but the change still runs through the repository's standard `validation.commands` gate before the PR is marked ready, per the automated-verification exemption rules in `AGENTS.md` (this change touches no `.tsx` outside tests and no `packages/ui/**`/`**/components/**` file, changes no DB/API surface, and ships its own automated test in the same PR — it qualifies for `skip-qa`).

## Backward Compatibility

No FROZEN/STABLE `BACKWARD_COMPATIBILITY.md` surface is touched. `example`'s `capabilityId` values are read as inputs from the already-published inventory; if any of them is ever found to be wrong at the source, that is a fix to `surface-inventory.json` or `example` itself (routed to the owning skill per the `ruleOwner` field), never a contract this docs PR invents or renames.

## Final Compliance Report

### AGENTS.md Files Reviewed

- Root `AGENTS.md` (spec-first workflow, PR/label rules, backward-compatibility contract).
- `.ai/specs/AGENTS.md` (naming convention, required sections, spec lifecycle).

### Compliance Matrix

| Rule | Status | Note |
|---|---|---|
| Spec-first for non-trivial, multi-step work | ✅ | This spec, gating `om-auto-implement-spec` |
| `.ai/specs/` checked before modifying the affected area | ✅ | Read `2026-07-31-standalone-canonical-example-module.md` in full; confirmed it does not cover `apps/docs` |
| No new `SPEC-*`/`SPEC-ENT-*` prefix | ✅ | `{date}-{title}.md` |
| Required sections present | ✅ | TLDR, Problem Statement, Proposed Solution, Architecture, Data Model, API Contracts, Risks & Impact Review, Final Compliance Report, Changelog |
| Backward compatibility reviewed | ✅ | No contract-surface category touched |
| Every implementation step testable | ✅ | See per-step **Testable** notes above |

### Verdict

Ready for implementation. No `⚠ NEEDS HUMAN CONFIRMATION` markers.

## Changelog

- **2026-08-17** — Initial draft, written autonomously (`om-auto-write-spec`) from issue #5202. Resolved 4 open questions per the autonomous-defaults protocol (see Resolved assumptions); none required human confirmation.
