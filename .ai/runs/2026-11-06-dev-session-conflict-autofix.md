# Dev-session conflict autofix for dev, greenfield and setup

## Goal

When `yarn dev`, `yarn dev:greenfield` or `yarn setup` hits "Another Open Mercato dev session already owns this workspace", ask the user once whether to clean it up and continue. On yes: stop the owning session's process tree (only processes verified to belong to this workspace), discard the lock — including when the recorded PID no longer exists or was reused by an unrelated process — and continue startup. Idempotent: re-running converges on a fresh, owned session.

## Scope

- `scripts/dev-session-recovery.mjs` — extend the existing orphan-only recovery to also cover a live owner and stale/reused PIDs behind one `[y/N]` prompt; lazy-load process utilities.
- `scripts/dev-session-guard.mjs` — expose a guarded lock-discard to the recovery callback.
- `packages/starter/src/setup-session.mjs` + `cli.mjs` — `yarn setup` (monorepo) uses recovery.
- `packages/create-app/template/scripts/setup.mjs` — standalone `yarn setup` uses recovery; template copies synced via `yarn template:sync:fix`.
- Tests: `scripts/__tests__/dev-session-recovery.test.mjs`, starter and template setup tests.

## Non-goals

- No auto-kill in non-interactive/CI runs (they keep the current hard stop).
- No change to lock format, the acquisition gate, or dev.mjs startup ordering.
- Never signal a process whose workspace cannot be verified or whose start time post-dates its registration (reused PID).

## Risks

- Killing a live session is destructive — mitigated by explicit consent, workspace (cwd) verification, start-time identity checks, re-verification under the acquisition gate after consent, and never signalling our own parent.

## Implementation Plan

### Phase 1: Recovery engine

- 1.1 Guard: expose lock discard inside `withDevSessionRecovery`
- 1.2 Recovery: classify live/stale/unverified records, prompt, stop, discard, re-acquire; tests

### Phase 2: Setup entry points

- 2.1 Starter (`yarn setup` in monorepo) uses recovery
- 2.2 Create-app template `setup.mjs` uses recovery; template sync

## Progress

PR: #8929

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Recovery engine

- [x] 1.1 Guard: expose lock discard inside `withDevSessionRecovery` — c7845e8074
- [x] 1.2 Recovery: classify live/stale/unverified records, prompt, stop, discard, re-acquire; tests — c7845e8074

### Phase 2: Setup entry points

- [x] 2.1 Starter (`yarn setup` in monorepo) uses recovery — 63edcc8cbe
- [x] 2.2 Create-app template `setup.mjs` uses recovery; template sync — 7a21cb8435
