# Develop CI stabilization (follow-up to #4840)

## Goal

Drive every failing check on the `develop` → `main` stabilization PR (#4840) to green by
fixing root causes, not by weakening assertions or disabling checks.

## Scope

Failing checks observed on #4840 (runs 30745211892 / 30745213683 / 30745211888):

| # | Check | Failure | Classification |
|---|-------|---------|----------------|
| 1 | `ephemeral-integration (10/15)`, standalone | `TC-NOTIF-007` — sibling-org list returns the *home* org's notifications | Real bug: cross-org cache leak |
| 2 | `ephemeral-integration (14/15)`, standalone | `TC-WMS-027` — shortfall notification never observed within the 10s poll | Real bug: same cache, stale-negative |
| 3 | `ephemeral-integration (3/15)`, standalone | `TC-INT-008` — `.ai/guides` contains an unexpected `framework-extension-points.md` | Test contract not updated for a generated artifact |
| 4 | `test` (`@open-mercato/cli`) | `module-facts.bc-guard` extraction 54.5s vs a 30s budget | Build-time budget vs. runner reality |
| 5 | `test` (`open-mercato-docs`) | `build/search-index.json` missing after `yarn build` | Docs build/search-index contract |
| 6 | `test` (`create-mercato-app`) | `published-context-contract` + `writable-behavior-oracles` cancelled — "Promise resolution is still pending" | Test-runner lifecycle bug |
| 7 | `ephemeral-integration (8/15)` | `TC-CRM-087` — a second account inherits the previous account's unsaved column width | Real bug or leaked browser state |
| 8 | standalone | `TC-CAT-035` — Polish SEO helper message never rendered | i18n / save-block regression |
| 9 | standalone | `TC-LOCK-OSS-025` — `POST /api/sales/shipments` returns 400 | Real bug or fixture drift |

Base branch: `develop`. The fixes land on their own PR; #4840 stays the observation window.

## Non-goals

- Merging or re-targeting #4840 itself.
- Touching the CI workflow definitions to hide failures (retries, `continue-on-error`, shard
  reshuffles). Every fix must address the cause the log points at.
- Reworking the notification caching architecture beyond bringing the list route in line with
  the already-hardened unread-count route.
- The `license/cla` pending check (external, human-owned).

## Risks

- The notifications list cache fix changes a hot read path; the mitigation is to mirror the
  exact scoping already proven on `api/unread-count/route.ts` rather than invent a new scheme.
- Integration failures 7–9 reproduce only under a full ephemeral stack, so their root causes
  must be established by reading the code paths plus CI artifacts; if one cannot be
  established with confidence it is reported as such rather than patched speculatively.
- The `module-facts` budget (4) may be a genuine perf regression rather than runner slowness;
  it must be measured locally before the budget is touched.

## Implementation Plan

### Phase 1: Notifications list cache scoping (failures 1 + 2)

`packages/core/src/modules/notifications/api/route.ts` caches the list payload under
`notifications:list:v1:u=<userId>:filters=<...>` — the key omits the selected organization, and
the invalidation tags are `buildCollectionTags(resource, tenantId, [null])`. The sibling route
`api/unread-count/route.ts` already keys on `organizationId` + a hash of `organizationIds`,
tags with `getNotificationReadScopeTagOrganizationIds(scope)`, and refuses to cache
unrestricted scopes. The list route never received that hardening, which produces both the
cross-org read (TC-NOTIF-007) and the stale-negative list that outlives TC-WMS-027's 10s poll.

### Phase 2: CLI agentic guide contract (failure 3)

`framework-extension-points.md` is emitted by `packages/cli/build.mjs` and
`packages/create-app/build.mjs` as a *generated* guide, but `expectedGuideOutputNames()` in
`TC-INT-008.spec.ts` only enumerates checked-in static guides plus a hardcoded generated list.

### Phase 3: module-facts build-time budget (failure 4)

### Phase 4: docs search index (failure 5)

### Phase 5: create-app node:test lifecycle (failure 6)

### Phase 6: DataTable column-width session scoping (failure 7)

### Phase 7: Catalog SEO helper i18n save-block (failure 8)

### Phase 8: Sales shipments 400 under optimistic locking (failure 9)

### Phase 9: Full validation gate and PR wrap-up

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Notifications list cache scoping

- [x] 1.1 Scope the notifications list cache key and invalidation tags to the selected organization — 584d6a6ed
- [x] 1.2 Add unit coverage pinning the org-scoped key, tags, and uncacheable-scope guard — 584d6a6ed
- [x] 1.3 Invalidate cached notification reads after service mutations so worker-created notifications converge immediately — 92af34d3e

### Phase 2: CLI agentic guide contract

- [x] 2.1 Include the generated framework extension-point guide in the TC-INT-008 expected set — 237074869

### Phase 3: module-facts build-time budget

- [x] 3.1 Measure extraction locally and establish whether the 30s budget or the extractor regressed — 6.5s wall / 9.1s CPU locally; no regression, the budget measured runner contention
- [x] 3.2 Land the corresponding fix (extractor speedup or a justified, measured budget) — f3d6186d7

### Phase 4: docs search index

- [x] 4.1 Reproduce the missing search index and identify why the plugin emits nothing — passes locally; CI red was turbo cancelling the docs build mid-compile after the cli task failed
- [x] 4.2 Land the fix so `yarn --cwd apps/docs test` passes — no independent defect; resolved by the Phase 3 fix removing the triggering failure
- [x] 4.3 Keep the full unfiltered test gate within its memory budget while giving Docusaurus enough heap to emit the index — d981f3fec (768 MB reproduced an OOM twice; 1024 MB passed all 24 package tasks at concurrency 2)

### Phase 5: create-app node:test lifecycle

- [x] 5.1 Identify the pending-promise cancellation in the two node:test files — collateral of the same turbo teardown (`fail 0`, `cancelled 2`), not an assertion failure
- [x] 5.2 Land the fix so both files complete deterministically — f69b86cd7 (headroom: 19.2s → 11.9s against the 120s per-file timeout)

### Phase 6: DataTable column-width session scoping

- [x] 6.1 Establish the root cause of TC-CRM-087 and land the fix — ba0e82436 + 9f5290bcf (purge anchored to the rendered identity, including a one-time cleanup of unmarked legacy browser state)

### Phase 7: Catalog SEO helper i18n save-block

- [x] 7.1 Establish the root cause of TC-CAT-035 and land the fix — NOT a job failure: Playwright counted it `1 flaky` (passed on retry), so it never blocked the lane. Reported as a suspected pre-hydration `.fill()` race rather than patched speculatively

### Phase 8: Sales shipments 400 under optimistic locking

- [x] 8.1 Establish the root cause of TC-LOCK-OSS-025 and land the fix — c2f7f4fe8 (seed-line filter never matched its timestamped name; selection fell through to unordered list order)

### Phase 9: Validation and wrap-up

- [ ] 9.1 Run the full configured validation gate green
- [ ] 9.2 Re-check #4840's CI lanes against the fixes and report residual failures
