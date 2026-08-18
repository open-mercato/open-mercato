# Reference Example Module — Developer Documentation Showcase

- **Status:** In review
- **Date:** 2026-08-17
- **Scope:** OSS, `apps/docs` (Docusaurus site)
- **Related:** [Standalone Canonical Example Module](./2026-07-31-standalone-canonical-example-module.md) (implementation contract for `example` itself — does not cover `apps/docs`), merged PR [#4897](https://github.com/open-mercato/open-mercato/pull/4897) (`feat(create-app): complete the canonical example and standalone harness`), issue [#5202](https://github.com/open-mercato/open-mercato/issues/5202)

## 📝 TLDR

`apps/mercato/src/modules/example/` is the platform's canonical, source-present-but-runtime-disabled reference module, and its `references/surface-inventory.json` / `references/surface-map.md` already curate 70 capability rows (69 `canonical`/`example` + 1 `canonical`/`specialist-route` QA-only row). None of that is discoverable from `apps/docs` today — the public developer documentation site has no page that tells a module author the reference module exists, what it demonstrates, or how to read it safely. This spec adds one new Docusaurus page, `apps/docs/docs/framework/modules/reference-example-module.mdx`, that transcribes the inventory into a reader-oriented showcase grouped into 12 sections, links it from the two entry points named in the issue, and adds a drift-detecting test that fails the moment the page and the inventory disagree.

## 📝 Problem Statement

PR #4897 (already merged to `develop`) built the `example` module and its machine-readable inventory, but the "reader-facing documentation experience" was explicitly left out of that PR's scope and out of the [implementation spec](./2026-07-31-standalone-canonical-example-module.md) that governs it — that spec's own text audits every emitted skill, guide, and harness owner for source-link coverage, and never once mentions `apps/docs` (confirmed: zero matches for `apps/docs` in the spec body). The closest thing the current public docs have to an entry point is one plain-text tip in `apps/docs/docs/customization/create-first-module.mdx`:

> Browse `apps/mercato/src/modules/example/` for a full working module that exercises most platform features (entities, APIs, forms, grids, events, dashboard widgets, custom fields, and injection).

That sentence does not tell a reader which of the 70 capability rows exist, which are safe to copy (`readable`) versus QA-only, or where each one lives. A module author who wants "the canonical way to add a queued DataTable bulk action with progress" today has to already know the inventory files exist and read raw JSON. Documentation, not implementation, is the entire gap.

**The tip is not, however, the only existing reference — and the others are worse than absent.** Ten files under `apps/docs/docs/` mention `modules/example`; beyond the tip above, four name the module directly (`framework/widget-injection.md:252`, `:868`; `framework/runtime/data-engine.mdx:56`; `framework/dashboard/widgets-overview.mdx:77`; `tutorials/api-data-fetching.mdx:34`, `:38`). Five of those locations point at `packages/example/…`, **a directory that does not exist in this repository** — the module lives at `apps/mercato/src/modules/example/`. The most damaging is a tutorial instructing readers to run a command that cannot succeed:

```bash
# apps/docs/docs/tutorials/api-data-fetching.mdx:38
cp packages/example/src/modules/example/index.ts src/modules/inventory/index.ts
```

This matters for scoping. Adding the showcase makes it the canonical landing page for `example` while those stale pointers keep routing readers to a non-existent path — the same discoverability failure this spec exists to fix, sitting next to the fix. Repairing them is deliberately **not** folded into this change (see Out of scope): it is a mechanical path correction across four unrelated pages, and bundling it would blur the review surface of a documentation-showcase PR. It is instead tracked as a named follow-up so the finding is not simply lost.

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
   - ships in monorepo, create-app template, and **every** standalone starter preset — phrased without enumerating preset names, mirroring `packages/create-app/src/lib/starter-presets.ts` ("The example source ships in every preset and stays runtime-disabled through…"). Enumerating them dates the page and is not covered by the drift test: the list was `classic`/`empty`/`crm` when this spec was drafted and `wms` landed on `develop` shortly afterwards (#5356);
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
| A future PR adds a capability to `example` (new `surface-inventory.json` row) without updating the docs page | The showcase silently under-represents the module | `reference-example-module.test.mjs` reads `surface-inventory.json` at test time, computes the expected capability-id set across **every** row (not only `coverageKind: "example"` — a new `specialist-route` row must land in the QA-only section rather than drift unnoticed), and fails listing the missing id(s) — not a hard-coded count that could be bumped without checking coverage. See *CI wiring* below: the test only delivers this if it actually runs on the PR that changes the inventory |
| That same PR changes only `apps/mercato/**`, so CI's package-scoped turbo filter never selects the `open-mercato-docs` workspace | The drift test does not run on the PR that caused the drift; it first fails on the post-merge unfiltered `yarn test`, turning `develop` red for everyone (the #3779 / #4527 / #4534 pattern) | The drift test must run **unfiltered**, not merely exist — see *CI wiring* in the Implementation Plan (step 6) |
| A capability is removed or renamed in the inventory | The docs page links a `capabilityId` that no longer resolves | Same test asserts every documented capability id exists in the current inventory; a stale id fails with the offending id named |
| A linked source path is renamed or deleted | A dead GitHub blob link ships to readers | The test resolves every linked `sourcePaths` entry against the filesystem in the worktree (not the fixed `develop` URL, which cannot be checked offline) and fails on a missing file |
| The QA-only row is documented like the other 69 | A reader copies `__integration__`/`__tests__` layout as if it were emitted, copyable source | The test asserts the `testing.integration-coverage` row is rendered inside its own "QA-only" section/caption text (a stable string marker), separate from the 69 `readable` rows |
| A linked source path legitimately lives outside the module directory | A test that requires every path to sit under `apps/mercato/src/modules/example/` fails on a correct page | The path assertion resolves against `apps/mercato/` only. One of the 98 distinct `sourcePaths` genuinely escapes the module tree — `overrides.unified-registry` points at `src/modules.ts`, the app-root registry — so a module-directory constraint would be wrong, not stricter |
| The disabled-by-default activation steps are dropped from the page in a future edit | A reader thinks `example` runs out of the box, or does not know `yarn db:migrate` is required | The test asserts the page's "What this module is and is not" section contains the `{ id: 'example', from: '@app' }` snippet and the words `yarn generate` and `yarn db:migrate` |
| `apps/mercato/src/modules/example/references/surface-inventory.json` is unreadable/missing when the test runs | Test would silently pass with an empty expected set (false green) | Test asserts the loaded inventory's capability count is non-zero before comparing, so a missing/empty inventory fails loudly instead of vacuously passing |
| Docusaurus production build breaks a link on this page | `yarn workspace open-mercato-docs build` fails | Existing Docusaurus `onBrokenLinks` build-time check already fails the build (no new mechanism needed); this spec relies on that existing gate per acceptance criterion 8 |

## 📝 Risks & Impact Review

- **Blast radius:** one new `.mdx` file, one new test file, three edited files (`sidebars.ts`, `overview.mdx`, `create-first-module.mdx`), one edited `apps/docs/package.json` test-script wiring. No code under `apps/mercato`, `packages/*`, or any migration/API/schema surface changes.
- **Compatibility:** touches no `BACKWARD_COMPATIBILITY.md` contract-surface category (not an auto-discovery file, type, signature, import path, event id, widget spot id, API route, DB schema, DI key, ACL feature, notification id, CLI command, or generated file).
- **Drift risk (the actual risk worth naming):** the showcase can go stale the moment `example` gains, loses, or renames a capability. Mitigated by the drift test (Edge Cases above), which is the acceptance-criterion-7 requirement, not an optional nice-to-have. **The mitigation is the test _running unfiltered_, not the test existing.** A drift test wired only into `apps/docs`'s own `test` script is selected by CI's `--filter=[origin/<base>]...` only when `apps/docs` itself changes, which is never the case for the drift it guards against; unwired, it converts a would-be red PR into a red `develop`. Implementation step 6 owns this and is not optional.
- **Rollback:** revert the PR; no migration, no data, no runtime behavior to unwind.
- **Out of scope (unchanged from the issue):** no change to `example`'s runtime behavior, no new canonical capability added to the inventory, no replacement of the focused framework guides (`om-module-scaffold`, `om-system-extension`, etc.) with duplicated long-form samples, no promotion of QA-only fixtures as recommended patterns.
- **Out of scope (added during review) — repairing the stale `packages/example/…` doc references.** Five locations across four pages (`framework/widget-injection.md:868`, `framework/runtime/data-engine.mdx:56`, `framework/dashboard/widgets-overview.mdx:77`, `tutorials/api-data-fetching.mdx:34` and `:38`) point readers at `packages/example/…`, which does not exist; the module is at `apps/mercato/src/modules/example/`. These predate this change and are a mechanical path correction on pages unrelated to the showcase, so they ship as a **named follow-up issue** rather than inflating this PR's review surface. Documented here so the finding is tracked rather than lost — the follow-up must be filed when this spec is implemented, not left implicit.

## 📋 Resolved assumptions (autonomous defaults)

| # | Question | Resolved answer | Rationale |
|---|---|---|---|
| Q1 | How should the 70 inventory rows be grouped into "useful reader sections" (acceptance criterion 3 asks for grouping but the issue's bullet list and the module's own `surface-map.md` group them differently)? | Use the issue's own 11 grouping bullets verbatim (partition table in Architecture), not `surface-map.md`'s 11 code-organization groups. | The issue text is the acceptance criterion; its bullets already form a complete, non-overlapping partition of all 70 capability ids (verified by counting), so following it exactly needs no invention and is the smallest-scope choice that still satisfies criterion 3. |
| Q2 | Should source links point at repo-relative Markdown paths, exact-commit blob URLs, or a fixed-branch GitHub blob URL — and if the latter, `main` or `develop`? | Fixed-branch GitHub blob URLs, on `develop` specifically (`.../blob/develop/<path>`). | `apps/docs` pages already use the `.../blob/<branch>/<repo-relative-path>` shape in general (verified via repo search: 18 links across 8 pages); the branch is split between `main` (13 links) and `develop` (5 links), so this is not a unanimous existing convention — `develop` is chosen because it is this repository's configured `baseBranch` (`.ai/agentic.config.json`), the branch the doc's own source (`example`'s inventory) is verified against. Repo-relative links would 404 on the published Docusaurus site; pinning an exact commit SHA would go stale immediately since `example` changes independently of doc edits. |
| Q3 | Does this spec need UI mockups/screenshots per `om-auto-write-spec` step 5? | No — this is static documentation content, not a new application screen. | The mockup step exists for proposed interactive app UI; a Docusaurus content page has no such surface, so mockups would be busywork with no reviewer value. Recorded here so the implementing PR does not appear to have silently skipped a required step. |
| Q4 | Should `reference-example-module.test.mjs` validate against the built `apps/docs/build/` output (like the existing `search-index.test.mjs`) or against the `.mdx` source plus the inventory JSON directly? | Content/drift assertions (capability coverage, dead links, QA-only distinction, activation guidance) run against the `.mdx` source and `surface-inventory.json` directly; only the "new page is in the generated search index" assertion (acceptance criterion 8) is added to the existing post-build `search-index.test.mjs`. | Source-level assertions run without a full `yarn build` first, keeping the drift check fast and independent of the docs build pipeline; the one assertion that inherently needs the build output (search-index presence) reuses the existing build-output test rather than duplicating a second build-dependent test file. **This rationale is only realised if the assertions get a build-free entry point** — wiring them solely into `apps/docs`'s `test` script (`yarn clean && yarn build && node --test …`) would gate the "fast, build-independent" check behind a full Docusaurus production build and discard the entire benefit. Implementation step 6a adds the separate `test:drift` script that makes this default true rather than aspirational. |

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
   - **every** `capabilityId` in the inventory appears in the `.mdx` source, regardless of `coverageKind` (collected into one failure listing every missing id rather than failing on the first). Scoping this to `coverageKind === "example" && referenceStatus === "canonical"` would cover only 69 of the 70 rows and would let a future `specialist-route` row — the same kind as `testing.integration-coverage` — drift in silently; the QA-only rows are covered by their own placement assertion below, not by exclusion here;
   - every `capabilityId` referenced in the `.mdx` source exists in the current inventory (catches a renamed/removed id left behind in docs);
   - every distinct `sourcePaths` entry linked from the `.mdx` resolves to a real file under **`apps/mercato/`** in the current worktree — *not* under `apps/mercato/src/modules/example/`. The tighter constraint is wrong and would fail on a correct page: `overrides.unified-registry` legitimately points at `src/modules.ts` (the app-root registry), the only one of the 98 distinct source paths that escapes the module tree;
   - the `testing.integration-coverage` row is present and rendered under/with the QA-only marker text, not commingled with the `readable` rows;
   - the page's source contains the disabled-by-default activation guidance (`{ id: 'example', from: '@app' }`, `yarn generate`, `yarn db:migrate`).
   **Testable:** `node --test apps/docs/__tests__/reference-example-module.test.mjs` fails red against a version of the page missing one capability id (verify by temporarily deleting one row locally), then passes green once restored.
6. **CI wiring — make the drift test run unfiltered.** This step is what turns the test from decoration into the acceptance-criterion-7 guarantee; it has two parts.

   **6a. Give the drift test a build-free script.** The existing `test` script is `yarn clean && yarn build && node --test __tests__/search-index.test.mjs`, because `search-index.test.mjs` asserts against `build/` output. The drift assertions do not need the build (Q4), so add a separate script rather than burying them behind a full Docusaurus clean+build:

   ```jsonc
   "test:drift": "node --test __tests__/reference-example-module.test.mjs",
   "test": "yarn clean && yarn build && node --test __tests__/search-index.test.mjs __tests__/reference-example-module.test.mjs"
   ```

   Keeping it in `test` too preserves the post-merge unfiltered signal; `test:drift` is what CI calls on every PR, in seconds.

   **6b. Classify the test as a repo-wide guard.** The test reads `apps/mercato/**` from `apps/docs/**`, which is exactly the case `scripts/repo-wide-guards.mjs` exists for — its header states the rule: *"Adding a test that reads files outside its own package? Add it to `REPO_WIDE_GUARDS` (or to `CROSS_PACKAGE_EXCEPTIONS` with a reason if it must not run on every PR)."* Without this, a PR that changes only `apps/mercato/**` never selects `open-mercato-docs` under `--filter=[origin/<base>]...` and the drift goes undetected until it reddens `develop`.

   Note that nothing currently catches this omission automatically: `findCrossPackageTestCandidates` only walks `<workspace>/src` (`scripts/repo-wide-guards.mjs:492`), and the issue mandates the test at `apps/docs/__tests__/`, outside that scan. The classification must therefore be made deliberately here.

   Preferred approach — **follow the existing `create-app` precedent**: add an unconditional `.github/workflows/ci.yml` step in the `test` job running `yarn workspace open-mercato-docs test:drift`, alongside the existing always-unfiltered steps, and record the test in `CROSS_PACKAGE_EXCEPTIONS` with the matching reason (*"Already unfiltered — the docs drift-guard CI step runs it on every PR"*), mirroring the create-app parity entries verbatim in shape.

   Alternative, if a manifest entry is preferred over a CI step: extend the runner to spawn non-jest guards. Every `REPO_WIDE_GUARDS` group today is jest-based (`jestConfig` is required and `buildJestArgs` builds jest arguments), so a `node --test` file cannot be listed without that change — do not add a `jestConfig`-less entry and assume it runs.

   **Testable:** `yarn workspace open-mercato-docs test:drift` passes standalone with no prior build; `yarn test:repo-wide-guards --list` and `scripts/__tests__/repo-wide-guards.test.mjs` stay green; deleting one capability row from the `.mdx` makes the new CI step fail on a branch that touches only `apps/mercato/**`.
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
| Required sections present | ✅ | TLDR, Problem Statement, Proposed Solution, Architecture, Data Model, API Contracts, Risks & Impact Review, Final Compliance Report, Changelog. `.ai/specs/AGENTS.md` also names **Overview**; the TLDR serves that role here and no separate Overview section is added, recorded explicitly rather than dropped from this list |
| Backward compatibility reviewed | ✅ | No contract-surface category touched |
| Every implementation step testable | ✅ | See per-step **Testable** notes above |

### Verdict

Ready for implementation. No `⚠ NEEDS HUMAN CONFIRMATION` markers.

## Changelog

- **2026-08-17** — Initial draft, written autonomously (`om-auto-write-spec`) from issue #5202. Resolved 4 open questions per the autonomous-defaults protocol (see Resolved assumptions); none required human confirmation.
- **2026-08-18** — Specification review (`om-auto-review-pr`, PR #5358) applied six corrections. **Majors:** (1) the drift test was specified to exist but not to *run* — CI's `--filter=[origin/<base>]...` never selects `open-mercato-docs` for an `apps/mercato` change, so implementation step 6 was rewritten to add a build-free `test:drift` script plus repo-wide-guard classification, and the Risks section no longer claims the mitigation without it; (2) the Problem Statement's "only mention in the docs" premise was wrong — ten docs files reference `modules/example` and five point at the non-existent `packages/example/…` path, now documented with the repair tracked as a named follow-up in Out of scope. **Minors:** the source-path assertion required paths under `apps/mercato/src/modules/example/`, which `overrides.unified-registry` (`src/modules.ts`) correctly violates, relaxed to `apps/mercato/`; the coverage assertion was scoped to `coverageKind: "example"`, leaving future `specialist-route` rows undetected, widened to all rows; Q4's "fast and build-independent" rationale was not delivered by the specified wiring, now tied to step 6a; the hard-coded preset list (`classic`/`empty`/`crm`) went stale when `wms` landed (#5356), replaced with unenumerated phrasing. **Nit:** `Status` moved from `Draft` to `In review`, and the compliance matrix now records the `Overview`/TLDR decision instead of omitting it. Implementation PR #5359 predates these corrections and must be updated to match — it currently reproduces majors (1) and minors (Q4 wiring, source-path scope).
