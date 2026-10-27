# Stabilize core integration flakes

## Overview

Fix the remaining unrelated core integration-test failure that blocks PR #7875 without changing that security PR. PR #8030 landed the cart and communication-channel repairs while this run was being triaged, so this branch now carries forward only the still-needed catalog worker-race fix from #8017, with credit retained for the original diagnosis by @mobinea.

## Goal

Make the catalog bulk-create integration scenario deterministic under the ephemeral CI harness without extending per-test timeouts.

## Scope

- Prevent the catalog integration test from starting a competing queue consumer when the ephemeral app already auto-spawns workers.
- Preserve fallback queue drains for environments where auto-spawned workers are disabled.

## Non-goals

- No production catalog, queue, API, or database behavior changes.
- No global or per-test timeout increases.
- No fix for the broader queue-job fencing issue tracked by #6008.
- No changes to PR #7875's tenant-scope implementation.
- No duplicate cart or communication-channel edits already merged through #8030.

## Implementation Plan

### Phase 1: Deterministic queue ownership

- Make catalog queue progression respect the ephemeral server's worker ownership and continue polling the existing progress-job terminal state.

### Phase 2: Verification and delivery

- Run focused static checks and the affected integration scenarios in the managed ephemeral environment.
- Run the configured validation gate, review the final diff, and open a test-only PR against `main`.
- Run the repository's automated PR review/autofix pass and record the final CI-backed verdict.

## Risks

- Worker-owned polling could expose a real worker-startup failure; bounded diagnostics must retain the last observed state.
- `AUTO_SPAWN_WORKERS` and `OM_AUTO_SPAWN_WORKERS` precedence must mirror the application runtime.
- #8017 overlaps this work; the resulting PR must credit that contribution and clearly identify itself as the focused replacement for its remaining catalog change.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Deterministic queue ownership

- [x] 1.1 Prevent the catalog integration test from competing with auto-spawned queue workers — b1a0effaf

### Phase 2: Verification and delivery

- [ ] 2.1 Verify focused integration behavior and the configured validation gate
- [ ] 2.2 Open, review, and finalize the test-stability PR
