---
title: "Browser SSE bridges must work across worker and web processes"
modules: ["events","queue","catalog"]
areas: ["backend-ui","module-data","integration"]
topics: ["data-import","events","realtime"]
---

# Browser SSE bridges must work across worker and web processes

**Context**: Akeneo product imports were updating `ProgressJob` rows and even the top bar sometimes, but the browser SSE stream often showed only heartbeats while worker-driven product progress was actively changing in the database.

**Problem**: The DOM Event Bridge only tapped in-process event emits. Queue workers emitted `progress.job.*` from a different Node process, so the web server's `/api/events/stream` never saw those updates live. UI built on SSE then looked stalled or inconsistent, and frontend polling crept back in as a workaround.

**Rule**: If server events can originate from workers, the event bridge must include a cross-process transport. Do not assume an in-memory tap is enough for SSE delivery. Also, orchestration widgets that wrap child sync runs should subscribe to the active child `progressJobId`, not only to a slower wrapper job.

**Applies to**: `packages/events/src/bus.ts`, `packages/events/src/modules/events/api/stream/route.ts`, `packages/sync-akeneo/src/modules/sync_akeneo/lib/first-import.ts`, and worker-backed progress UI across the platform.
