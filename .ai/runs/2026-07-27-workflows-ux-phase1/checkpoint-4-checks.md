# Checkpoint 4 — Steps 5.1..8.1

**Steps covered:** 5.1 (cdbeadb4e) · 6.1 (14cee0c35) · 7.1 (62a30be35) · 7.2 (a3fba3824) · 8.1 (a830038a2)
**Recorded:** 2026-07-27 (UTC) · **Runner:** local

## Touched areas
- api/openapi.ts + definitions routes (typed responses, #4230), shared openapi generator fallback, shared commands (outputSchema seam), customers deals exemplar, examples/templates + templates API + TemplateGalleryDialog + list/editor wiring, workflow_definition_drafts entity + migration + snapshot

## Checks
| Check | Result | Notes |
|---|---|---|
| yarn build:packages / generate / typecheck | ✅ | |
| yarn i18n:check-sync | ✅ | |
| Scoped jest core→workflows | ✅ | 844 tests |
| Scoped jest shared→commands+openapi | ✅ | 141 tests |
| Migration review | ✅ | Single CREATE TABLE + index + unique; zero unrelated migrations; snapshot diff semantically = new table only (format normalization explained in commit) |
| UI integration | ⏭ skipped | final gate |

## Corrections
- SHAs trued up: 5.1→cdbeadb4e, 6.1→14cee0c35, 7.1→62a30be35, 7.2→a3fba3824, 8.1→a830038a2.
