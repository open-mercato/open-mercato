# Checkpoint 5 — command-level optimistic locking (Phases 16–17)

**Steps covered:** 16.0, 16.1, 17.1–17.6 (SHA range `20b4ba3ff..d6448082e`)
**Date:** 2026-05-28

## Touched packages

- `@open-mercato/shared` — new `lib/crud/optimistic-lock-command.ts`; exported `normalizeIsoToken` from `optimistic-lock.ts`.
- `@open-mercato/core` (sales) — `commands/shared.ts` (helper), `commands/documents.ts` (lines + adjustments + convert enforce), `commands/returns.ts` (return create enforce).

## Validation

| Check | Result |
|---|---|
| `yarn workspace @open-mercato/shared test` (optimistic-lock-command + optimistic-lock) | ✓ 57/57 |
| `yarn workspace @open-mercato/core test sales/commands/__tests__/optimistic-lock.test.ts` | ✓ 5/5 (4 helper + 1 command stale→409) |
| `yarn workspace @open-mercato/shared typecheck` | ✓ exit 0 |
| `yarn turbo run typecheck --filter=@open-mercato/core` (root tsc 6.0.3) | ✓ exit 0 (43s) |
| `yarn build:packages` | ✓ exit 0 |
| `yarn generate` | ✓ exit 0, no committed drift (output is gitignored/ephemeral) |

## Known env-only failures (NOT this change)

- `yarn workspace @open-mercato/core typecheck` (workspace tsc 5.9.3) → `TS5103 Invalid value for '--ignoreDeprecations'`. Pre-existing; reproduces on develop. Use root tsc 6.0.3 (via turbo) for a real typecheck — which is green.
- Command-level tests that import `../documents` require `yarn build:packages` + `yarn generate` first (transitive `@open-mercato/cache` + `#generated/*`). After both, green. The existing `documents.scope.test.ts` shares this requirement.

## UI / Playwright

Skipped this checkpoint — no UI files touched in Phases 16–17 (server + shared only). Client wiring is Phase 18; integration proof (TC-LOCK-OSS-005) lands with the CI ephemeral env which is authoritative.

## Design note (recorded for reviewers)

`makeSalesLineRoute` wraps command input in `{ body }`, so the CRUD factory's
`candidateId` (`input.id`) is null → the auto-registered **row-level** guard is
skipped for lines/adjustments, leaving the new document-aggregate command check
as the sole optimistic guard (no double-409). Payments/shipments use a flat
mapInput with a top-level `id`, so their row-level guard fires; a
document-aggregate check there would conflict with the single header, so they
are intentionally left at row-level (tracked in the follow-up).
