---
title: "Data-sync run detail should subscribe to its progress job, not just poll it"
modules: ["data_sync","progress","events"]
areas: ["module-data","integration","debugging"]
topics: ["events","realtime","testing"]
---

# Data-sync run detail should subscribe to its progress job, not just poll it

**Context**: The global progress bar already reacted immediately to `progress.job.*` events, but the data-sync run detail page still depended on a 4-second polling loop.

**Problem**: For fast or concurrent sync jobs, the run detail could look stale or inconsistent compared with the top bar, especially when multiple jobs from the same integration had generic names and users expected SSE-driven updates.

**Rule**: Any page centered around a specific `ProgressJob` should subscribe to `progress.job.updated|started|completed|failed|cancelled` for that job ID and use polling only as a recovery/backfill path. Also include enough job metadata or naming detail to distinguish concurrent runs of the same integration.

**Applies to**: `packages/core/src/modules/data_sync/backend/data-sync/runs/[id]/page.tsx`, progress payload serialization, and future job-specific run/detail pages.
