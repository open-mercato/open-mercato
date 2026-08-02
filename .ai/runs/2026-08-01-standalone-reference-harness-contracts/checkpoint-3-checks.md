# Checkpoint 3 — Phase 3 spec-first routing

- **Recorded:** 2026-08-02T15:26:12Z
- **Steps:** 3.1..3.3
- **SHA range:** `ae728abcf..3a264dce4`
- **Touched areas:** emitted standalone instructions and planning skills, harness cases/schemas/fixtures, trusted routing and writable spec oracles, release matrices, catalog counts, generated-preset contracts, documentation, and focused tests
- **Runner:** local; no configured compose `app` container was running

## Checks

| Check | Result | Evidence |
|---|---|---|
| Harness evaluator suite | Pass | 89/89 tests passed with all 210 catalog cases and 48 writable cases synchronized. |
| Companion harness suites | Pass | 86 tests passed and four platform-specific sandbox tests skipped. |
| Spec-first focused suite | Pass | 7/7 tests passed across routing decisions, preset emission, installed skill links, instruction budgets, and writable ordering proofs. |
| Create-app package typecheck | Pass | `yarn workspace create-mercato-app typecheck` completed without diagnostics. |
| Knowledge-change governance | Pass | The clean-HEAD controller classified the change as `knowledge-contract` and verified its fail-before/pass-after evidence against base `3d591a4b7`. |
| Script, schema, and JSON validation | Pass | Touched scripts parsed, harness JSON/schema assets loaded, and mode-specific validator/release surfaces matched the catalog. |
| Diff whitespace | Pass | `git diff --check` passed for the Phase 3 range. |
| UI/browser evidence | Skip | Phase 3 changed no rendered surface; screenshots are not applicable. |

## Environment note

The linked worktree uses the primary checkout's installed dependencies. Repository-local `TMPDIR` was used for harness fixtures to avoid the host temporary-filesystem error recorded by earlier checkpoints.
