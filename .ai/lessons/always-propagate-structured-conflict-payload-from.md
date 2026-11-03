---
title: "Always propagate structured conflict payload from `onBeforeSave` blockers"
modules: ["ui"]
areas: ["backend-ui","umes","debugging"]
topics: ["concurrency","optimistic-locking","ui-components"]
---

# Always propagate structured conflict payload from `onBeforeSave` blockers

**Context**: Conflict handling in record locks had two paths: preflight `onBeforeSave` and real mutation `save` response. UI recovered conflict dialog only from save error path.

**Problem**: When conflict was blocked in preflight, users could hit dead-end loops (`Keep editing` / `Keep my changes`) because the dialog state was not rehydrated with full conflict payload.

**Rule**: Any blocking `onBeforeSave` result must carry machine-readable `details` (code + payload), and `CrudForm` must route it through the same global save-error recovery channel as normal save failures.

**Applies to**: Injection widgets that gate save (`WidgetBeforeSaveResult`) and conflict-capable modules (record locks, future optimistic concurrency widgets).
