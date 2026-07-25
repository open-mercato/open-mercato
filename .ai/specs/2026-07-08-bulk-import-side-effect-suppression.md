# Bulk-Import Side-Effect Suppression

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Created** | 2026-07-08 |
| **Builds on** | SPEC-045b (Data Sync Hub), 2026-06-15-query-index-orm-backed-classification-hardening |
| **Related** | Command bus (`@open-mercato/shared/lib/commands`), Data engine (`@open-mercato/shared/lib/data/engine.ts`) |

## TLDR

**Problem.** A large data-sync backfill executes the same write commands as interactive
use — and pays the same per-record side effects: an inline `query_index` reindex (which
rebuilds `search_tokens`, the dominant write cost), a `<module>.<entity>.<action>` domain
event, and any per-record notification fan-out. Across hundreds of thousands of records
this is the backfill's bottleneck, and most of it is wasted work: the index is far cheaper
to rebuild once at the end, the events have no live consumer during a bulk import, and the
notifications would spam users with backfilled history.

**Solution.** An opt-in, additive `bulkImport` flag set on the command runtime context. When
present, the command bus and data engine skip the flagged per-record side effects for that
command's writes; the caller runs a single batched `query_index rebuild` for the affected
entity types at end-of-run. Interactive (unflagged) writes are byte-for-byte unchanged.

**Key property — concurrency safety.** The flags are read from the context and threaded as a
**local parameter** through the side-effect flush. No suppression state is stored on the
shared `dataEngine` instance, so two commands running concurrently with different flags can
never observe or clobber each other's suppression.

## Motivation

`CommandBus.execute()` already exposes `skipCacheInvalidation` as a per-execution escape
hatch for callers that will invalidate the cache themselves. Bulk backfills need the
equivalent for the three heavy per-record side effects, for the same reason: the caller can
restore the deferred work far more cheaply in one pass.

Telemetry from a production data-sync order backfill attributed ~65% of per-order write
cost to the inline `search_tokens` reindex alone. Deferring it (plus one batched rebuild)
is the single biggest backfill throughput lever, and the events/notifications are pure
waste during an import.

## Design

### Contract

`CommandRuntimeContext` gains an optional `bulkImport` field:

```ts
export type BulkImportSuppression = {
  /** Skip the inline `query_index.upsert_one` / `delete_one` reindex (rebuild after the run). */
  skipReindex?: boolean
  /** Skip the per-record `<module>.<entity>.<action>` domain event emission. */
  skipEvents?: boolean
  /** Advisory: handlers that fan out per-record notifications SHOULD honor this and skip them. */
  skipNotifications?: boolean
}

export type CommandRuntimeContext = {
  // …existing fields…
  bulkImport?: BulkImportSuppression
}
```

### Flow (no shared mutable state)

1. A backfill caller sets `ctx.bulkImport = { skipReindex: true, skipEvents: true, skipNotifications: true }`.
2. `CommandBus.execute()` reads `effectiveOptions.ctx?.bulkImport` after the handler runs and
   passes it as a **local argument** into `flushCrudSideEffects(container, suppress)`.
3. `flushCrudSideEffects` forwards it to `DataEngine.flushOrmEntityChanges(suppress)`, which
   forwards it to each queued entry's `emitOrmEntityEvent({ …, suppress })`.
4. `emitOrmEntityEvent` gates the domain event on `!suppress?.skipEvents` and the inline
   reindex on `!suppress?.skipReindex`. When both are suppressed it bails before resolving the
   event bus.
5. Handlers that create per-record notifications (sales `create-order` / `create-quote`) gate
   the `notificationService.createForFeature(...)` call on `!ctx.bulkImport?.skipNotifications`.
   `skipNotifications` is **advisory** — there is no central notification choke point, so each
   fan-out site opts in explicitly.

The exported `flushCrudSideEffects(dataEngine, suppress?)` helper
(`@open-mercato/shared/lib/commands/helpers`) takes the same optional `suppress`, so **direct
bulk-write paths that flush there instead of going through the command bus** (e.g. the staff
bulk timesheet route) can honor the same deferral. Both flush entry points forward to the one
mechanism — `DataEngine.flushOrmEntityChanges(suppress)` — so suppression can never be silently
ignored on one path.

### Caller responsibility

`skipReindex` leaves the `query_index` projection (and its `search_tokens`) stale for every
record written under the flag. **The caller MUST run a batched `query_index rebuild` for the
affected entity types at end-of-run.** A resumable backfill that re-runs to completion
re-fires that rebuild, so a failed rebuild is recoverable by re-running.

### Why `ctx` and not a top-level execution option

`skipReindex` / `skipEvents` are consumed by the command bus, which sees the execution
options. But `skipNotifications` is consumed **inside the handler** (`execute(input, ctx)`),
which only receives `ctx` — never the execution options. Putting all three on `ctx` keeps a
single, coherent home that both the bus and the handlers can read.

## Backward compatibility

Fully additive. With `bulkImport` unset (every interactive path), `emitOrmEntityEvent` keeps
its original early-return and emits both the event and the reindex exactly as before; the
sales notification calls are unchanged. No migration, no config, no behavior change for
existing callers.

## Testing

- Unit (`packages/shared/src/lib/data/__tests__/engine.bulk-suppress.test.ts`): the four
  suppression combinations on `emitOrmEntityEvent`, plus a non-leakage assertion proving
  `flushOrmEntityChanges(suppress)` does not persist suppression across successive flushes on
  the same engine instance (the concurrency-safety guarantee).
- Regression: existing shared `commands`/`data` (130) and sales `commands`/`api` (150) suites
  stay green — the unflagged path is unchanged.

Integration coverage is intentionally omitted: this is an internal command-bus/data-engine
contract with no HTTP or UI surface, fully exercised at the unit level.

## Changelog

- **2026-07-08** — Initial draft + implementation: `BulkImportSuppression` type, `ctx.bulkImport`,
  command-bus → data-engine parameter threading, sales notification gating, unit coverage.
