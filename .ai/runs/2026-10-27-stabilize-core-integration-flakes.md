# Stabilize core integration flakes

## Overview

Fix the unrelated core integration-test failures that block PR #7875 without changing that security PR. This run consolidates and improves the overlapping work proposed in #8016 and #8017, with credit retained for the original diagnosis by @mobinea.

## Goal

Make the cart, catalog bulk-create, and communication-channel integration scenarios deterministic under the ephemeral CI harness without extending per-test or per-hook timeouts.

## Scope

- Remove an unnecessary cold application bootstrap from the HTTP-only cart scenario.
- Run the command-backed cart fixture setup inside its already-budgeted test body instead of a separately timed `beforeAll` hook.
- Prevent catalog and communication-channel tests from starting competing queue consumers when the ephemeral app already auto-spawns workers.
- Poll the observable email-delivery state when server workers own queue processing.
- Preserve fallback queue drains for environments where auto-spawned workers are disabled.

## Non-goals

- No production cart, catalog, communication-channel, queue, API, or database behavior changes.
- No global or per-test timeout increases.
- No fix for the broader queue-job fencing issue tracked by #6008.
- No changes to PR #7875's tenant-scope implementation.

## Implementation Plan

### Phase 1: Deterministic test setup and queue ownership

- Remove the unused bootstrap from the HTTP-only cart test.
- Localize the command-backed cart fixture lifecycle to the test body so the suite timeout applies without a hook override.
- Make catalog and email-hub queue progression respect the ephemeral server's worker ownership and poll terminal state where needed.

### Phase 2: Verification and delivery

- Run focused static checks and the affected integration scenarios in the managed ephemeral environment.
- Run the configured validation gate, review the final diff, and open a test-only PR against `main`.
- Run the repository's automated PR review/autofix pass and record the final CI-backed verdict.

## Risks

- Worker-owned polling could expose a real worker-startup failure; bounded diagnostics must retain the last observed state.
- The command-backed cart test must clean up partially created fixtures if setup fails midway.
- `AUTO_SPAWN_WORKERS` and `OM_AUTO_SPAWN_WORKERS` precedence must mirror the application runtime.
- #8016 and #8017 overlap this work; the resulting PR must credit those contributions and clearly identify itself as the consolidated replacement.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Deterministic test setup and queue ownership

- [ ] 1.1 Remove unnecessary cart bootstrap and localize command-backed fixture lifecycle
- [ ] 1.2 Prevent competing queue consumers and poll worker-owned email delivery

### Phase 2: Verification and delivery

- [ ] 2.1 Verify focused integration behavior and the configured validation gate
- [ ] 2.2 Open, review, and finalize the test-stability PR
