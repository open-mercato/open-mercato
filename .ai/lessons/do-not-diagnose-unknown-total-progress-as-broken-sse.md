---
title: "Do not diagnose unknown-total progress as broken SSE"
modules: ["events","progress","catalog"]
areas: ["module-data","integration","backend-ui"]
topics: ["data-import","events","provider-lifecycle"]
---

# Do not diagnose unknown-total progress as broken SSE

**Context**: Data sync jobs were emitting `progress.job.updated` correctly through the same SSE bridge used by the working example page, but the top bar and run detail still looked frozen at `0%`.

**Problem**: Product imports often do not know `totalCount` up front. `ProgressService.updateProgress()` therefore kept `progressPercent` at `0`, so the UI rendered a static 0% bar even while `processedCount` was increasing in real time.

**Rule**: When a long-running job has no reliable total, treat it as **indeterminate progress** in the UI. Keep SSE/poll updates for `processedCount`, avoid showing `0% complete`, and preserve any available `totalEstimate` instead of discarding it in adapters.

**Applies to**: `packages/core/src/modules/data_sync/lib/sync-engine.ts`, provider adapters such as `packages/sync-akeneo/src/modules/sync_akeneo/lib/adapter.ts`, and any UI using `ProgressTopBar` or run-detail progress bars.
