---
title: "Worker-emitted progress needs polling fallback even when SSE exists"
modules: ["events","progress","queue"]
areas: ["module-data","backend-ui","debugging"]
topics: ["events","realtime","testing"]
---

# Worker-emitted progress needs polling fallback even when SSE exists

**Context**: Example-page progress SSE worked, but bulk product operations and data sync progress in the top bar did not update live.

**Problem**: The DOM Event Bridge tap in `packages/events/src/modules/events/api/stream/route.ts` was process-local, so a `progress.job.updated` emitted by a queue worker in a different process never reached the browser even though the `ProgressJob` database row updated correctly. `packages/events/src/bridge.ts` closed that gap with a Postgres LISTEN/NOTIFY relay for `clientBroadcast` events carrying a trusted tenant scope (progress events qualify), so worker-emitted progress now does cross process boundaries in the normal case. The residual gap is narrower but still real: LISTEN/NOTIFY has no replay, so a notify published while the listener is mid-reconnect (network blip, pool cycling) is lost for every browser tab served by that app process, with nothing to signal the drop.

**Rule**: For progress UIs, use **SSE for immediacy** and keep a **polling reconciliation backstop** for the residual delivery gap: full cadence while a job is active, a slow reconciliation cadence while idle (do not drop to zero) so a missed `progress.job.created` still surfaces within one interval. Do not assume the cross-process bridge guarantees delivery — LISTEN/NOTIFY only guarantees it to a continuously connected listener.

**Applies to**: `packages/ui/src/backend/progress/useProgressSse.ts`, all worker-driven progress jobs (data sync, bulk delete, reindex, similar queue jobs), and any future SSE-based progress UI.
