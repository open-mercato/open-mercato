---
title: "Worker-emitted progress needs polling fallback even when SSE exists"
modules: ["events","progress","queue"]
areas: ["module-data","backend-ui","debugging"]
topics: ["events","realtime","testing"]
---

# Worker-emitted progress needs polling fallback even when SSE exists

**Context**: Example-page progress SSE worked, but bulk product operations and data sync progress in the top bar did not update live.

**Problem**: The DOM Event Bridge tap in `packages/events/src/modules/events/api/stream/route.ts` is process-local. Queue workers emit `progress.job.updated` in a different process, so those events do not reach the browser through SSE even though the `ProgressJob` database row updates correctly.

**Rule**: For progress UIs, use **SSE for immediacy** and **polling while active jobs exist** as the correctness path. Do not assume worker-emitted progress events will reach the browser unless the event bus is explicitly cross-process bridged for broadcast traffic.

**Applies to**: `packages/ui/src/backend/progress/useProgressSse.ts`, all worker-driven progress jobs (data sync, bulk delete, reindex, similar queue jobs), and any future SSE-based progress UI.
