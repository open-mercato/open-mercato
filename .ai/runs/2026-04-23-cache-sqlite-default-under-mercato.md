# Execution Plan — Cache SQLite Default Under `.mercato`

## Overview

- Goal: Move the default SQLite cache file path away from tracked `data/cache.db` and into the runtime-owned `.mercato` area, then lock that behavior with tests.
- Affected modules/packages: `packages/cache`, `packages/core`, `apps/mercato`, `packages/create-app/template`, docs that surface the default cache path.
- Smallest safe scope: update the default path values that users and runtime surfaces rely on, add unit coverage for the runtime default and surfaced system-status default, and leave unrelated cache behavior unchanged.
- Non-goals:
  - Changing the selected cache strategy.
  - Refactoring cache strategy internals beyond the default-path wiring.
  - Changing unrelated runtime file locations outside cache defaults.

## Implementation Plan

### Phase 1: Confirm and align default paths

1. Identify every authoritative default for SQLite cache file locations that currently points outside `.mercato`.
2. Choose a single `.mercato` default path and update runtime-facing defaults consistently.

### Phase 2: Add regression coverage

1. Add unit tests for the cache service default path resolution.
2. Add or extend tests for surfaced config metadata so the default path cannot drift back.

### Phase 3: Validate and prepare PR

1. Run targeted tests and typechecks for touched packages, then the required full validation gate.
2. Self-review for backward compatibility and open the PR with labels, comments, and summary.

## Risks

- Path drift risk: user-facing docs/examples and runtime metadata can diverge if only one surface is updated.
- Runtime compatibility risk: deployments that already override `CACHE_SQLITE_PATH` must continue working unchanged; only defaults should move.
- Review risk: broad doc churn would add noise, so updates should stay limited to surfaces users copy directly or that claim an authoritative default.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Confirm and align default paths

- [ ] 1.1 Identify every authoritative default for SQLite cache file locations that currently points outside `.mercato`
- [ ] 1.2 Choose a single `.mercato` default path and update runtime-facing defaults consistently

### Phase 2: Add regression coverage

- [ ] 2.1 Add unit tests for the cache service default path resolution
- [ ] 2.2 Add or extend tests for surfaced config metadata so the default path cannot drift back

### Phase 3: Validate and prepare PR

- [ ] 3.1 Run targeted tests and typechecks for touched packages, then the required full validation gate
- [ ] 3.2 Self-review for backward compatibility and open the PR with labels, comments, and summary
