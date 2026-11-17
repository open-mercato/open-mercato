# Stabilize core integration flakes

## Overview

Fix the remaining unrelated core integration-test failures that block PR #7875 without changing that security PR. PR #8030 landed the cart and communication-channel repairs while this run was being triaged. Current `main` later absorbed both the warranty upload-limit and catalog queue-worker stabilizations through #7946. This branch isolates the still-needed phone-calls cache test from asynchronous full-text indexing, with credit retained for the original diagnoses by @mobinea and @haxiorz.

## Goal

Make the phone-calls cache integration scenario deterministic under the ephemeral CI harness without extending per-test timeouts.

## Scope

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

- Keep the phone-calls cache key identical across reads while selecting a run-unique filter that is visible as soon as ingest commits.

### Phase 2: Verification and delivery

- Run focused static checks and the affected integration scenarios in the managed ephemeral environment.
- Run the configured validation gate, review the final diff, and open a test-only PR against `main`.
- Run the repository's automated PR review/autofix pass and record the final CI-backed verdict.

## Risks

- The phone-calls test must continue proving a cache hit before ingest and a cache miss after ingest; changing the filter must not weaken those assertions.
- #8017's catalog diagnosis is superseded by #7946 on `main`; the resulting PR must not retain a duplicate catalog change.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Deterministic queue ownership

- [x] 1.1 Prevent the catalog integration test from competing with auto-spawned queue workers — b1a0effaf (superseded by upstream #7946 during the base refresh)
- [x] 1.2 Stop the warranty upload-limit fixture from flooding the socket after the configured ceiling — 07257cbf2 (superseded by upstream #7946 during the base refresh)
- [x] 1.3 Isolate the phone-calls cache test from deferred full-text search tokens — 35ef138d7

### Phase 2: Verification and delivery

- [x] 2.1 Verify focused integration behavior and the configured validation gate — ef9c88780
- [ ] 2.2 Open, review, and finalize the test-stability PR
