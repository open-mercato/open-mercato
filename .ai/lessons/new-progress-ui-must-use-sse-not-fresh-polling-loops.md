---
title: "New progress UI must use SSE, not fresh polling loops"
modules: ["events","progress","ui"]
areas: ["backend-ui","module-data","integration"]
topics: ["data-import","events","realtime"]
---

# New progress UI must use SSE, not fresh polling loops

**Context**: The Akeneo "first full import" widget originally tracked its sequence state with `setTimeout` polling against a status endpoint, even though the platform already broadcasts `progress.job.*` events to the browser.

**Problem**: Browser-local polling made the feature look active without proving a durable backend job existed, added stale state paths on refresh, and reintroduced a legacy pattern the rest of the progress system is moving away from.

**Rule**: When a feature already has a real `ProgressJob`, drive the UI from `progress.job.*` SSE events and only use one-shot fetches for initial hydration or reconnect recovery. Do not add new timer-based progress polling loops in widgets or backend pages.

**Applies to**: `packages/sync-akeneo/src/modules/sync_akeneo/widgets/injection/akeneo-config/widget.client.tsx` and future progress-driven UI in integrations or data sync.
