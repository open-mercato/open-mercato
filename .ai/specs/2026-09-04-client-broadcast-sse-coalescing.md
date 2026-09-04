# Client-Broadcast SSE Coalescing for Bulk Writers

| Field | Value |
|-------|-------|
| Status | Draft |
| Issue | [#5733](https://github.com/open-mercato/open-mercato/issues/5733) |
| Origin | Specification review of [#5609](https://github.com/open-mercato/open-mercato/pull/5609) (catalog bulk-create) |
| Packages | `@open-mercato/events`, `@open-mercato/shared`, `@open-mercato/core` (catalog) |

## 📝 TLDR

A `clientBroadcast: true` event emitted in a tight loop costs one serialized `pg_notify` roundtrip plus one tenant-wide SSE fan-out **per record**. The progress module already hit this and solved it privately with `OM_PROGRESS_BROADCAST_MIN_INTERVAL_MS`; every other bulk writer still pays the unthrottled cost. This spec gives the event bus the same coalescing as an opt-in property of an event declaration — `broadcastCoalescing: true` — so a burst collapses to at most one browser delivery per interval plus a guaranteed trailing delivery, while the domain event still fires once per record for subscribers, webhooks and the queue. Nothing changes for an event that does not opt in.

## 📝 Problem Statement

`bus.emit()` does three separate things for a `clientBroadcast: true` event (`packages/events/src/bus.ts:437-505`):

1. runs the **global taps** — both the backoffice SSE endpoint (`packages/events/src/modules/events/api/stream/route.ts:209`) and the customer-portal SSE endpoint (`packages/core/src/modules/customer_accounts/api/portal/events/stream.ts:131`) register one, and each iterates the whole in-process connection set;
2. `await publishCrossProcessEvent(...)` — a real `SELECT pg_notify($1, $2)` query on a dedicated pool (`packages/events/src/bridge.ts:201`), on the caller's critical path;
3. delivers inline subscribers and, when persistent, enqueues the queue job.

Only (3) carries domain meaning. (1) and (2) exist solely so browsers see the change. A 2,000-row product import therefore performs 2,000 Postgres roundtrips and 2,000 fan-outs to make DataTables refresh — and the three catalog events that pay this exist for exactly that reason, as their own declaration says (`packages/core/src/modules/catalog/events.ts:9-15`: *"bridge to the DataTable … so confirmed mutations auto-refresh the list"*). A DataTable does not need 2,000 refresh triggers; it needs the last one.

The progress module recognised this and fixed it for itself (`packages/core/src/modules/progress/lib/progressServiceImpl.ts:19-32`, `:187-251`): a leading-edge throttle behind `OM_PROGRESS_BROADCAST_MIN_INTERVAL_MS`, with database heartbeats kept on their own schedule so the stale-job sweep cannot starve. That throttle is private to one service. `.ai/specs/2026-08-25-catalog-bulk-create.md` (Resolved Assumption #8) deliberately accepts the unthrottled cost for one endpoint, bounded by its 2,000-item cap — a reasonable trade that does not generalise. Every future bulk writer of a broadcast entity inherits the cost with no lever to pull.

## 📝 Proposed Solution

Add a **coalescing scheduler in the events package** that wraps only the browser-facing half of `emit` — the global-tap fan-out and the cross-process publish — and is engaged per event by a new optional `EventDefinition` field:

```typescript
{ id: 'catalog.product.created', label: 'Product Created', clientBroadcast: true, broadcastCoalescing: true }
```

Semantics: **last-wins within a window, with a guaranteed trailing delivery.** The first emit of a burst is delivered immediately (leading edge). Subsequent emits sharing a coalescing key inside the window replace the pending payload rather than being delivered; a timer always flushes the survivor when the window closes. A burst of N emits therefore produces `1 + ceil(burst_duration / interval)` browser deliveries instead of N, and the final state always reaches the browser.

Two properties from the issue are structural, not incidental:

- **The domain event still fires per record.** Coalescing is applied strictly after inline subscriber delivery and strictly independently of the queue enqueue. Webhooks, notification handlers, workflow triggers and indexers see byte-identical behavior.
- **The last event is never dropped.** The trailing timer is unconditional, which is where this design goes past the progress precedent: the progress service can drop the tail because its terminal transitions (`completeJob` / `failJob`) emit through a separate unthrottled path, and a generic mechanism has no such guaranteed epilogue.

### Alternatives considered

| Option | Why it lost |
|--------|-------------|
| Global env interval applied to every `clientBroadcast` event | Silently changes delivery semantics for every existing consumer in one release, including single-event UI reactions that are not bursty. Fails the "never weaken a documented contract by default" rule. |
| Automatic coalescing for ids the bridge observes as high-frequency | Requires per-id rate state and a heuristic threshold; behavior becomes load-dependent and irreproducible between environments, which is a poor property for a delivery contract. |
| Lossless batching (N events delivered in one SSE frame / one envelope) | Preserves per-record fidelity but changes the SSE wire format and `useAppEvent`'s dispatch contract — a much larger blast radius for a benefit no current consumer needs (they refetch). Revisitable additively later. |
| Suppress the event entirely in bulk mode (`ctx.bulkImport.skipEvents`) | Already rejected by `.ai/specs/2026-08-25-catalog-bulk-create.md` — it makes bulk-created records invisible to webhooks and integrations. This spec deliberately keeps the domain event. |

## 📝 Architecture

### The seam

```
bus.emit(event, payload, options)
  │
  ├─ 1. inline subscriber delivery ─────────────── unchanged, per record
  │
  ├─ 2. browser-facing dispatch ───── NEW: routed through the coalescer
  │       ├─ global taps  → backoffice SSE fan-out + portal SSE fan-out
  │       └─ publishCrossProcessEvent → pg_notify → other processes' SSE
  │
  └─ 3. queue enqueue (persistent) ─────────────── unchanged, per record
```

Today steps 1–3 are three straight-line blocks in `emit`. The change extracts the two browser-facing sinks into a single `dispatchBroadcast(event, payload, options)` closure and hands it to the coalescer, which either invokes it immediately (the default, and for every non-opted-in event) or schedules it.

Placing the seam at `emit` rather than inside the SSE route is what makes one mechanism cover both bridges and the `pg_notify` roundtrip at once: both SSE endpoints subscribe through `registerGlobalEventTap`, and the cross-process publish is the same statement. Coalescing inside `broadcastEventToConnections` would leave the Postgres roundtrips — half the cost the issue names — untouched.

### New module: `packages/events/src/broadcast-coalescer.ts`

Self-contained and dependency-free apart from the logger and the shared number parser. Public surface:

```typescript
export function submitBroadcast(
  key: string,
  dispatch: () => Promise<void>,
  options?: { intervalMs?: number },
): Promise<void>

export function flushPendingBroadcasts(): Promise<void>
export function resetBroadcastCoalescerForTests(): void
```

State is a `Map<string, PendingBroadcast>` where `PendingBroadcast = { dispatch, timer, lastDispatchedAt, suppressed }`. Entries are deleted on flush, so the map is bounded by the number of distinct keys currently mid-window, not by burst length.

The map lives on `globalThis` under a namespaced key, following the `GLOBAL_EVENT_TAPS_KEY` / `EVENTS_PRODUCER_QUEUE_KEY` precedent in `bus.ts:62,140` — the event bus is rebuilt per request, so a per-bus map would coalesce nothing.

### Coalescing key

`${eventId}::${tenantId ?? ''}::${organizationScope}` where `organizationScope` is the trusted `organizationId`, or the sorted `organizationIds` joined, or empty. Derived from the same trusted-scope resolution `normalizeAudience` already performs (`stream/route.ts:51-105`), never from raw payload fields when trusted options are present.

Scope **must** be part of the key: a key of event id alone would let a burst in tenant A suppress tenant B's delivery and, worse, deliver tenant A's payload in place of tenant B's. That is a cross-tenant leak, and it gets a dedicated regression test.

### Eligibility

An event is coalesced only when **all** hold:

1. its declaration sets `broadcastCoalescing: true`;
2. `isBroadcastEvent(id) || isPortalBroadcastEvent(id)` — there is a browser sink to coalesce;
3. `crossProcessBroadcast !== true` — private cross-process coordination (cache invalidation, registry reloads) must stay immediate; delaying it would make another process serve stale data. A declaration combining `crossProcessBroadcast: true` with `broadcastCoalescing: true` is rejected at declaration time in `createModuleEvents` with a clear error rather than silently ignored;
4. the resolved interval is `> 0`.

### Interval

`OM_BROADCAST_COALESCE_INTERVAL_MS`, default **250 ms**, parsed with `parseNumberWithDefault` from `@open-mercato/shared/lib/number` (`0` disables coalescing process-wide — the escape hatch, mirroring `OM_PROGRESS_BROADCAST_MIN_INTERVAL_MS=0`). 250 ms matches the progress module's default and sits below the browser's own 500 ms dedup window (`packages/ui/src/backend/injection/eventBridge.ts:13`), so coalescing never becomes the dominant source of perceived latency for a single interactive mutation — and a single mutation is delivered on the leading edge anyway, with no added latency at all.

## 📝 Data Model

No entities, columns, or migrations. All state is in-process and ephemeral.

## 📝 API Contracts

### Changed — `EventDefinition` (additive, optional)

```typescript
/**
 * When true, browser deliveries of this event coalesce: within
 * OM_BROADCAST_COALESCE_INTERVAL_MS, only the newest payload per
 * (event, tenant, organization) reaches the SSE bridges, and a trailing
 * flush guarantees the last one is delivered. Subscribers, webhooks and
 * the queue are unaffected — the domain event still fires per record.
 * Only declare it on events whose browser consumers react to the fact
 * that something changed (list refresh), not to each occurrence.
 * Default: false.
 */
broadcastCoalescing?: boolean
```

`BACKWARD_COMPATIBILITY.md:42` explicitly permits new optional fields on `EventDefinition`; nothing is renamed, removed, or narrowed.

### Unchanged

The SSE frame shape (`{ id, payload, timestamp, organizationId }`), `useAppEvent`, `AppEventPayload`, the audience filter, `isBroadcastEvent`, `isPortalBroadcastEvent`, `EmitOptions`, the queue job shape, and every event id. Suppression counts surface through the structured logger (`logger.debug('Coalesced broadcast', { event, suppressed })`), not through the wire format — deliberately, so this change carries no browser-contract risk.

### New environment variable

| Variable | Default | Meaning |
|----------|---------|---------|
| `OM_BROADCAST_COALESCE_INTERVAL_MS` | `250` | Minimum ms between browser deliveries of one coalescing key. `0` disables coalescing everywhere, restoring per-record delivery. |

## 📝 UI/UX

No UI work. The observable difference is that a bulk import refreshes an open DataTable a few times per second instead of once per row, and the table is correct when the burst ends. Nothing in `packages/ui` changes.

## 📝 Edge Cases & Failure Scenarios

| Scenario | Behavior |
|----------|----------|
| Process exits mid-window | Pending flushes would be lost. `flushPendingBroadcasts()` is wired into the existing `SIGTERM`/`SIGINT` hook alongside the producer-queue shutdown (`bus.ts:157-169`). A hard `SIGKILL` still loses the tail — bounded at one interval, and the browser reconnect path already re-syncs. |
| `pg_notify` fails inside a deferred flush | No caller is awaiting it any more, so the deferred path owns its own `try/catch` and logs at `error` with the event id — matching how `emit` already handles a synchronous publish failure (`bus.ts:481-485`). A failed flush does not block the next window. |
| Two tenants burst concurrently | Independent keys, independent timers, independent payloads. Regression test asserts no payload crosses a tenant boundary. |
| Ordering between a coalesced and a non-coalesced event | Per key, order is preserved (last wins). Across keys, a later immediate event can reach the browser before an earlier deferred one. Cross-event ordering over the bridge was never guaranteed — cross-process envelopes already race with local taps — but it is now documented rather than incidental. |
| An event opts in whose consumers need per-record fidelity | A real semantic hazard, and the reason this is opt-in per declaration rather than a global default. Documented in `packages/events/AGENTS.md` with the "react to the fact, not the occurrence" test. |
| Payload exceeds the 4096-byte SSE limit / 7000-byte bridge limit | Unchanged — truncation and drop happen inside the dispatch closure exactly as today. |
| Interval set to `0` | Every emit passes straight through. The code path is the same closure invoked synchronously, so behavior is byte-identical to today. |
| Serverless/scale-to-zero deployment where the process may not outlive the request | The trailing flush is a timer, so a frozen process can drop the tail. The Node deployment model this repo targets already relies on process-lifetime timers for SSE heartbeats (`stream/route.ts:274`), so the assumption is not new; the env knob is the opt-out. |

## 📝 Risks & Impact Review

**Blast radius.** Phase 1 changes `emit`'s internal structure but no observable behavior, because no event opts in — the coalescer is a pass-through until a declaration engages it. Phase 2 changes the browser delivery pattern of exactly three catalog events. The queue, subscriber, webhook and index paths are untouched in both phases.

**Backward compatibility.**

| Surface | Change | Verdict |
|---------|--------|---------|
| Type interface (`EventDefinition`) | New optional field `broadcastCoalescing?: boolean` | ✓ ADDITIVE — `BACKWARD_COMPATIBILITY.md:42` permits optional additions |
| Import paths / exports (`@open-mercato/events`) | New exports `submitBroadcast`, `flushPendingBroadcasts` | ✓ ADDITIVE — nothing removed or renamed |
| Event IDs, API routes, DB schema, DI keys, ACL features | None | ✓ Unchanged |
| SSE frame shape | None | ✓ Unchanged |
| Env vars | New optional `OM_BROADCAST_COALESCE_INTERVAL_MS` | ✓ ADDITIVE |

**Rollback.** Two independent levers, no migration to reverse: set `OM_BROADCAST_COALESCE_INTERVAL_MS=0` to disable process-wide at runtime, or drop `broadcastCoalescing: true` from a single declaration to revert one event. Reverting the Phase 2 commit alone restores today's behavior while keeping the mechanism available.

**Security.** The coalescing key is built from trusted scope only, and the cross-tenant-isolation test is a required Phase 1 step. Suppressed payloads are dropped, never merged, so no payload is ever assembled from more than one record. No new data reaches the browser and the audience filter is untouched.

**Performance.** Expected reduction for a 2,000-row import at the 250 ms default: from 2,000 `pg_notify` roundtrips and 2,000 fan-outs to roughly `1 + (import_seconds × 4)` of each. Cost added: one `Map` entry and one timer per active key.

## 📋 Phasing

- **Phase 1 — the mechanism.** The coalescer, the declaration field, the eligibility guard, the env knob, the shutdown flush, and full unit coverage. No event opts in, so merging is behavior-neutral and independently shippable.
- **Phase 2 — the first consumers.** Opt the three catalog broadcast events in, document the mechanism and its "when to declare it" test, and add the guard that a bulk write emits per-record domain events while coalescing browser deliveries.

## 📋 Implementation Plan

### Phase 1 — Coalescing mechanism (behavior-neutral)

**Step 1.1 — Declare the field.** Add `broadcastCoalescing?: boolean` with its JSDoc to `EventDefinition` (`packages/shared/src/modules/events/types.ts:20-41`) and an `isCoalescedBroadcastEvent(eventId)` reader beside `isBroadcastEvent` (`packages/shared/src/modules/events/factory.ts:143-195`). *Test:* the reader returns `true` only for a declared, opted-in event and `false` for undeclared ids and for opted-out ones.

**Step 1.2 — Reject the unsafe combination.** In `createModuleEvents`, throw when a declaration sets both `crossProcessBroadcast: true` and `broadcastCoalescing: true`, with a message naming the event id and why (private coordination must not be delayed). *Test:* the declaration throws; a `clientBroadcast` + `broadcastCoalescing` declaration does not.

**Step 1.3 — Add the coalescer.** New `packages/events/src/broadcast-coalescer.ts` with `submitBroadcast` / `flushPendingBroadcasts` / `resetBroadcastCoalescerForTests`, `globalThis`-backed state, leading-edge dispatch, unconditional trailing timer, per-key `try/catch` around the deferred dispatch, and a `logger.debug` suppression counter. *Test (unit, no bus):* a burst of 50 submissions on one key inside the window yields 1 immediate + 1 trailing dispatch and the trailing one is the newest closure; distinct keys never interfere; `intervalMs: 0` dispatches every submission synchronously; a throwing deferred dispatch is logged and does not poison the next window.

**Step 1.4 — Wire it into `emit`.** Extract the tap fan-out and `publishCrossProcessEvent` from `bus.emit` into one `dispatchBroadcast` closure; route it through `submitBroadcast` when the event is eligible, invoke it directly otherwise. Keep inline delivery and the queue enqueue exactly where they are. *Test:* for a non-opted-in event the emit sequence is unchanged; for an opted-in event a 100-emit burst produces 100 inline subscriber invocations and 100 queue enqueues but ≤3 tap invocations and ≤3 `publishCrossProcessEvent` calls; `crossProcessBroadcast` events are never deferred.

**Step 1.5 — Scope isolation.** Build the key from trusted scope with the payload fallback that mirrors `resolveCrossProcessEmitOptions` (`bus.ts:72-96`). *Test:* concurrent bursts for two tenants and two organizations produce independent deliveries, and no delivered payload carries another scope's data.

**Step 1.6 — Shutdown flush.** Call `flushPendingBroadcasts()` from the existing `SIGTERM`/`SIGINT` shutdown hook. *Test:* invoking the registered handler with a pending entry dispatches it before resolving.

**Step 1.7 — Env knob.** Resolve `OM_BROADCAST_COALESCE_INTERVAL_MS` through `parseNumberWithDefault` (default 250, min 0) and document it in `apps/mercato/.env.example` — mirroring the template per the `create-app` Template Sync Checklist (`yarn template:sync:fix`). *Test:* unset → 250; `0` → passthrough; a negative or non-numeric value → 250.

### Phase 2 — First consumers and documentation

**Step 2.1 — Opt the catalog events in.** Add `broadcastCoalescing: true` to `catalog.product.{created,updated,deleted}` (`packages/core/src/modules/catalog/events.ts:13-15`) — the three events whose declared purpose is DataTable auto-refresh. Run `yarn generate`. *Test:* `isCoalescedBroadcastEvent` is true for the three and false for every other catalog event.

**Step 2.2 — Bulk-writer guard.** A test that drives a loop of catalog product creates through the bus and asserts the invariant the issue names: N domain deliveries to a subscriber, ≪N browser dispatches, and the final payload delivered to the browser is the last record's. *Test:* is the step.

**Step 2.3 — Document it.** Extend `packages/events/AGENTS.md` → DOM Event Bridge with a "Coalescing browser deliveries" subsection: the declaration, the env knob, the guarantee, the `crossProcessBroadcast` prohibition, and the "declare it only when browser consumers react to the fact that something changed, not to each occurrence" test. Add the same to `apps/docs` where the DOM bridge is described, and note in `packages/core/src/modules/progress/AGENTS.md` that `OM_PROGRESS_BROADCAST_MIN_INTERVAL_MS` remains the progress-local knob. *Test:* `yarn agents:check-budget`.

## 📝 Out of scope

- **Migrating `progress.job.updated` onto the generic mechanism.** Its throttle is entangled with heartbeat persistence and CAS-guarded writes (`progressServiceImpl.ts:187-254`); the migration is behavior-sensitive and buys no user-visible improvement. `OM_PROGRESS_BROADCAST_MIN_INTERVAL_MS` stays as-is and stays documented.
- **Lossless batching of distinct records into one frame.** Additive later if a consumer needs per-record fidelity under coalescing; nothing here forecloses it.
- **Re-coalescing envelopes received from other processes.** The publisher already collapsed them; a second stage would add latency without removing roundtrips.
- **Opting in events outside catalog.** Each is a one-line decision for the owning module, made against the Phase 2 documentation.

## Resolved assumptions (autonomous defaults)

Written by `om-spec-writing --autonomous`; every line below is a default this run chose, not a decision the issue made. Override any of them on the PR before merge.

| # | Question | Chosen default | Rationale |
|---|----------|----------------|-----------|
| 1 | Env-tunable global interval, per-event-definition option, or automatic detection for high-frequency ids? (the issue's explicit design question) | **Per-event-definition opt-in** (`broadcastCoalescing: true`) with an env-tunable interval | Smallest blast radius and most reversible: merging changes nothing until an owner opts an event in. A global default would silently alter delivery semantics for every existing consumer; automatic detection makes behavior load-dependent and irreproducible. |
| 2 | Coalescing semantics for a burst of *distinct* records: last-wins, or lossless batching? | **Last-wins with a guaranteed trailing flush** | It is what the issue's "must not drop the last event, or a DataTable ends the burst stale" describes, it matches the progress precedent, and it needs no change to the SSE wire format or `useAppEvent`. Batching is additive later. |
| 3 | Does the mechanism also cover the portal event bridge (`portalBroadcast`)? | **Yes, at no extra cost** | Both SSE endpoints subscribe through the same `registerGlobalEventTap`, so coalescing at the `emit` seam covers both with one mechanism and no additional surface. |
| 4 | Should `progress.job.updated` migrate onto the generic mechanism, retiring its private knob? | **No — out of scope** | The progress throttle is coupled to heartbeat persistence and CAS writes; migrating it is a behavior-sensitive refactor with no user-visible gain. Recorded as a follow-up. |
| 5 | Which events opt in as part of this work? | **The three `catalog.product.*` broadcast events only** | They are the ones the originating review measured, and their declaration already states their only purpose is DataTable refresh — the exact shape last-wins serves losslessly. |
| 6 | Does an opted-in event also need an env flag to activate? | **No — the declaration alone activates it**; `OM_BROADCAST_COALESCE_INTERVAL_MS=0` is the global kill switch | A second required flag would mean the shipped default does nothing; a single kill switch gives operators rollback without a deploy. |
| 7 | Should a coalesced SSE frame carry a `suppressed`/`coalesced` marker so consumers can detect gaps? | **No — observability via the structured logger only** | Keeps the browser wire contract completely unchanged, holding this spec's BC impact to one additive optional type field. A consumer that needs per-occurrence fidelity should not opt the event in. Additive later if asked for. |
| 8 | Default interval? | **250 ms** | Matches `OM_PROGRESS_BROADCAST_MIN_INTERVAL_MS`'s default and sits below the browser bridge's own 500 ms dedup window, so coalescing never becomes the dominant perceived latency; a single interactive mutation is delivered on the leading edge with no added latency at all. |
