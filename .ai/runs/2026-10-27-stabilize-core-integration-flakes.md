# Stabilize core integration flakes

## Overview

Fix the remaining unrelated core integration-test failures that block PR #7875 without changing that security PR. PR #8030 landed the cart and communication-channel repairs while this run was being triaged. Current `main` later absorbed the warranty upload-limit stabilization through #7946. This branch carries forward the still-needed catalog worker-race fix from #8017 and isolates the phone-calls cache test from asynchronous full-text indexing, with credit retained for the original diagnoses by @mobinea and @haxiorz.

## Goal

Make the catalog bulk-create and phone-calls cache integration scenarios deterministic under the ephemeral CI harness without extending per-test timeouts.

## Scope

- Prevent the catalog integration test from starting a competing queue consumer when the ephemeral app already auto-spawns workers.
- Preserve fallback queue drains for environments where auto-spawned workers are disabled.
- Exercise phone-call list caching through the synchronous `providerKey` filter instead of racing deferred full-text search tokens.

## Non-goals

- No production catalog, queue, API, or database behavior changes.
- No global or per-test timeout increases.
- No fix for the broader queue-job fencing issue tracked by #6008.
- No changes to PR #7875's tenant-scope implementation.
- No duplicate cart or communication-channel edits already merged through #8030.
- No production phone-calls, search-index, cache, API, or database behavior changes.

## Implementation Plan

### Phase 1: Deterministic queue ownership

- Make catalog queue progression respect the ephemeral server's worker ownership and continue polling the existing progress-job terminal state.
- Keep the phone-calls cache key identical across reads while selecting a run-unique filter that is visible as soon as ingest commits.

### Phase 2: Verification and delivery

- Run focused static checks and the affected integration scenarios in the managed ephemeral environment.
- Run the configured validation gate, review the final diff, and open a test-only PR against `main`.
- Run the repository's automated PR review/autofix pass and record the final CI-backed verdict.

## Risks

- Worker-owned polling could expose a real worker-startup failure; bounded diagnostics must retain the last observed state.
- `AUTO_SPAWN_WORKERS` and `OM_AUTO_SPAWN_WORKERS` precedence must mirror the application runtime.
- The phone-calls test must continue proving a cache hit before ingest and a cache miss after ingest; changing the filter must not weaken those assertions.
- #8017 overlaps this work; the resulting PR must credit that contribution and clearly identify itself as the focused replacement for its remaining catalog change.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Deterministic queue ownership

- [x] 1.1 Prevent the catalog integration test from competing with auto-spawned queue workers — b1a0effaf
- [x] 1.2 Stop the warranty upload-limit fixture from flooding the socket after the configured ceiling — 07257cbf2 (superseded by upstream #7946 during the base refresh)
- [x] 1.3 Isolate the phone-calls cache test from deferred full-text search tokens — 35ef138d7

### Phase 2: Verification and delivery

- [x] 2.1 Verify focused integration behavior and the configured validation gate — ef9c88780
- [ ] 2.2 Open, review, and finalize the test-stability PR
