# Reference Example Module — Developer Documentation Showcase

- **Branch:** `feat/reference-example-module-docs`
- **Base:** `develop`
- **Skill:** `om-auto-create-pr`
- **Source doc:** `.ai/specs/2026-08-17-reference-example-module-docs.md` (spec PR: #5358)
- **Issue:** #5202

## 🎯 Goal

Add `apps/docs/docs/framework/modules/reference-example-module.mdx`, a developer-documentation showcase that transcribes the `example` module's `references/surface-inventory.json` (70 capability rows) into 12 reader-oriented sections, link it from the two entry points the issue names, and ship a drift-detecting test that fails the moment the page and the inventory disagree.

## Scope

- New Docusaurus page + sidebar registration.
- Entry-point links from `overview.mdx` and the `create-first-module.mdx` tip.
- `apps/docs/__tests__/reference-example-module.test.mjs` (drift/content assertions) wired into `apps/docs/package.json`'s `test` script.
- One additional assertion in the existing `apps/docs/__tests__/search-index.test.mjs` for the new page's presence in the generated search index.

### Non-goals

- No change to `example`'s runtime behavior, migrations, or ACL.
- No new capability added to `surface-inventory.json`.
- No replacement of `om-module-scaffold`/`om-system-extension`/etc. framework guides with duplicated code samples.
- No promotion of the `qa-only` `testing.integration-coverage` row as a copyable pattern.

## Risks

- **Drift** between the page and the inventory over time — mitigated by the step-5 test, which derives its expected id set from the JSON at test time rather than a hard-coded count.
- **Dead source links** — every `sourcePaths` entry linked from the page must resolve under `apps/mercato/src/modules/example/`; the test checks this against the filesystem, not just against the URL shape.
- **Path-join mistake**: `sourcePaths` entries in the JSON are relative to `apps/mercato/` (e.g. `"src/modules/example/index.ts"`), not to `src/modules/example/` — the blob URL must be `.../blob/develop/apps/mercato/<sourcePath>` with no extra segment inserted (caught during spec review; documented here so it isn't re-introduced during implementation).

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Showcase page and navigation

- [ ] 1.1 Write `apps/docs/docs/framework/modules/reference-example-module.mdx`: transcribe the 70 inventory rows into the 12-section structure (Module Foundation & Lifecycle, Data Model, APIs & Commands, Events/Indexing & Cache, Backend & Frontend UI, UMES, Search, AI Tools & Agents, Notifications & Messages, Integrations & Workflows, Unified Module Overrides, Testing Evidence QA-only) with correct `develop`-branch GitHub blob links
- [ ] 1.2 Write the "What this module is and is not" section, "How to read this page" legend, and per-section rule-owner paragraphs
- [ ] 1.3 Register the page in `apps/docs/sidebars.ts` under `Modules`, after `framework/modules/overview`
- [ ] 1.4 Add the entry-point link in `overview.mdx` and update the `:::tip Existing reference modules` admonition in `create-first-module.mdx`

### Phase 2: Drift-detecting tests

- [ ] 2.1 Add `apps/docs/__tests__/reference-example-module.test.mjs` (non-zero inventory count, full canonical-id coverage, no stale ids, resolvable source links, QA-only row distinctly marked, activation guidance present)
- [ ] 2.2 Wire the new test file into `apps/docs/package.json`'s `test` script
- [ ] 2.3 Extend `apps/docs/__tests__/search-index.test.mjs` with the new-page search-index assertion
- [ ] 2.4 Run the full validation sequence (`yarn workspace open-mercato-docs build`, `yarn workspace open-mercato-docs test`) and fix anything it surfaces

## Changelog

- 2026-08-17 — Plan created.
