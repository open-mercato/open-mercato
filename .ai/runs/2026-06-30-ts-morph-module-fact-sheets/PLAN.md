# Execution Plan — ts-morph module fact-sheets

**Date-slug:** 2026-06-30-ts-morph-module-fact-sheets
**Branch:** feat/ts-morph-module-fact-sheets
**Source spec:** .ai/specs/2026-06-27-ts-morph-module-fact-sheets.md
**Pre-impl analysis:** .ai/specs/analysis/ANALYSIS-2026-06-27-ts-morph-module-fact-sheets.md

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On landing a Step, flip `Status` to `done` and fill the `Commit` column with the short SHA. The first row whose `Status` is not `done` is the resume point for `om-auto-continue-pr`. Step ids are immutable once a Step has a commit.

| Phase | Step | Title | Status | Commit |
|-------|------|-------|--------|--------|
| 0 | 0.1 | Land run folder (plan/handoff/notify) | done | 484e0e84d |
| 1 | 1.1 | Land corrected spec + analysis | done | 0b919ecba |
| 1 | 1.2 | Extractor skeleton: types, D5 allowlist, entities (E ∩ @Entity AST) | done | 7dac26433 |
| 1 | 1.3 | Extractor: events + ACL features | done | 78e7259d1 |
| 1 | 1.4 | Extractor: API-route auth (registry apis[].metadata), DI service tokens, search, host tokens, notifications, CLI | done | 17917da02 |
| 1 | 1.5 | Markdown + JSON sidecar emitter (§6 shapes) | done | f7ef5630d |
| 1 | 1.6 | Wire into yarn generate → versioned apps/mercato/src/module-facts.generated.json | done | 2e9740062 |
| 1 | 1.7 | T1 customers fixture snapshot test | done | b0bbfdca2 |
| 1 | 1.8 | T2 auth-source test (registry vs api-routes manifest) | done | 7fd887b71 |
| 1 | 1.9 | T3 BC guard test (facts resolve against live E/events/acl/search) | done | 5f377f04a |
| 1 | 1.10 | T4 malformed-source test (empty section + warning, no throw) | done | 933bfc587 |
| 2 | 2.1 | Author conceptual .ai/guides/module-system.md (Layer 1) | done | 7234f44a3 |
| 2 | 2.2 | Dedup migrated prose from core package guide | todo | — |
| 3 | 3.1 | build.mjs extraction step (dist/agentic/guides/modules/*.md + module-facts.json) | todo | — |
| 3 | 3.2 | shared.ts filtered per-enabled-module copy (AST-read enabledModules ∩ D5) | todo | — |
| 3 | 3.3 | AGENTS.md.template D6 marker block + GAP-D6-D intro reword | todo | — |
| 3 | 3.4 | Legacy core.<module>.md redirect stubs (BC bridge) | todo | — |
| 3 | 3.5 | T5 build.mjs wiring smoke (packages/create-app) | todo | — |
| 3 | 3.6 | T6 agents-md module-guides test (packages/create-app) | todo | — |
| 4 | 4.1 | Delete 9 per-module standalone-guide.md | todo | — |
| 4 | 4.2 | RELEASE_NOTES.md deprecation note | todo | — |

## Goal

Replace the 9 hand-written per-module standalone AI guides with (1) one hand-written conceptual guide (`module-system.md`) and (2) per-module fact-sheets generated from source via a reusable ts-morph generator in `packages/cli`, emitted at create-app build time and in the monorepo `yarn generate`.

## Scope

- New generator `packages/cli/src/lib/generators/module-facts.ts` (reuses existing AST infra in `generators/ast/` + `entity-ids`, `module-registry`, `module-di`, `extensions/events`).
- Versioned monorepo artifact `apps/mercato/src/module-facts.generated.json` (NOT under `.mercato/generated/`).
- create-app wiring: `build.mjs`, `src/setup/tools/shared.ts`, `agentic/shared/AGENTS.md.template`.
- One conceptual guide source + dedup of migrated prose.
- Tests: T1–T4 in `packages/cli`, T5–T6 in `packages/create-app`.

## Non-goals

- No prose/tutorial generation (conceptual stays hand-written, one file).
- No extraction of function bodies / business logic / validator internals.
- No runtime behavior change to any module.
- The 7 package-level guides (cache/core/events/queue/search/shared/ui) stay hand-written (only core.md is deduped of migrated sections).
- First cut = the 9 D5 user-facing modules only (auth, catalog, currencies, customer_accounts, customers, data_sync, integrations, sales, workflows); the other 29 are out of scope.

## Risks

- **R-PR3685 overlap:** the design-spec PR #3685 carries the same spec file under `.ai/specs/`. This run carries spec + code together (per user decision: do not merge #3685 separately). Once this impl PR lands, #3685 is redundant and should be closed. Surface in the PR summary.
- **R1 (spec) version skew:** baked facts can lag installed `@open-mercato/core`; mitigated by a version stamp; generate-time regeneration deferred.
- **R2 (spec) registry dependency:** API-route auth must come from `modules.runtime.generated.ts` `apis[].metadata` (NOT `api-routes.generated.ts`); requires `yarn generate` first.
- **R5 (spec) enabled-set extraction:** static-literal AST read of `enabledModules` ∩ D5 allowlist; do not dynamic-import `modules.ts`; fallback to full allowlist on empty.
- BC: generated-file contract — emit legacy `core.<module>.md` as redirect stubs for ≥1 minor before removal; RELEASE_NOTES.md note.

## External References

None (`--skill-url` not used).
