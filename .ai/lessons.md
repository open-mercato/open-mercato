# Lessons Learned

## 2026-02-04 — Undo handlers must invalidate CRUD cache

**Context:** Editing a sales order or quote and then clicking "Undo" on the LastOperationBanner reverted the database correctly but the UI still displayed the edited (stale) values.

**Root cause:** The `undo` handlers in `packages/core/src/modules/sales/commands/documents.ts` for `sales.quotes.update` and `sales.orders.update` called `restoreQuoteGraph`/`restoreOrderGraph` + `em.flush()` but did not call `invalidateCrudCache`. The `execute` handlers did call it, so the asymmetry caused the cache to serve stale data on page reload after undo.

**Fix:** Added `invalidateCrudCache` calls to both undo handlers, matching the pattern from their `execute` counterparts.

**Rule:** Every command `undo` handler that modifies entity state must mirror the cache invalidation logic from its `execute` handler. Specifically:
1. Call `invalidateCrudCache(container, resourceKind, identifiers, tenantId, action)` after `em.flush()`.
2. If the `execute` handler also calls `emitCrudSideEffects` / `emitCrudUndoSideEffects` with `indexer`, do the same in `undo`.
3. When writing new commands, always check that both `execute` and `undo` have symmetrical side effects (cache invalidation, index updates, event emission).
