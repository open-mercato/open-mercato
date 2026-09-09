# Client-Broadcast SSE Coalescing for Bulk Writers

| Field | Value |
|-------|-------|
| Status | Design complete — implementation **partial** on #5896 (see Implementation divergence) |
| Issue | [#5733](https://github.com/open-mercato/open-mercato/issues/5733) |
| Implementation | [#5896](https://github.com/open-mercato/open-mercato/pull/5896) (`feat/client-broadcast-sse-coalescing`) |
| Origin | Specification review of [#5609](https://github.com/open-mercato/open-mercato/pull/5609) (catalog bulk-create) |
| Packages | `@open-mercato/events`, `@open-mercato/shared`, `@open-mercato/core` (catalog) |

## 📝 Overview

The event bus delivers a `clientBroadcast: true` event to three destinations at once: in-process subscribers, the browser (through two SSE bridges and a `pg_notify` roundtrip that reaches other processes), and — when persistent — the queue. A bulk writer needs the first and third once per record, but the second only needs to say "something changed" often enough for an open list to look live.

This spec separates those two halves inside `bus.emit` and puts a coalescing scheduler in front of the browser half only, engaged per event declaration by a new optional field. It changes no wire format, no event id, no schema and no API route; it adds one optional `EventDefinition` field, one env knob and one internal module. Merging the mechanism is behavior-neutral because nothing opts in until an owner declares it, and the three catalog product events are the only declarations in scope here.

## 📝 TLDR

A `clientBroadcast: true` event emitted in a tight loop costs one serialized `pg_notify` roundtrip plus one tenant-wide SSE fan-out **per record**. The progress module already hit this and solved it privately with `OM_PROGRESS_BROADCAST_MIN_INTERVAL_MS`; every other bulk writer still pays the unthrottled cost. This spec gives the event bus the same coalescing as an opt-in property of an event declaration — `broadcastCoalescing: true` — so a burst collapses to at most one browser delivery per interval plus a guaranteed trailing delivery, while the domain event still fires once per record for subscribers, webhooks and the queue. Nothing changes for an event that does not opt in.

## 📝 Problem Statement

`bus.emit()` does four things in this order for a `clientBroadcast: true` event (`packages/events/src/bus.ts:437-505`):

1. runs the **global taps** — both the backoffice SSE endpoint (`packages/events/src/modules/events/api/stream/route.ts:209`) and the customer-portal SSE endpoint (`packages/core/src/modules/customer_accounts/api/portal/events/stream.ts:131`) register one, and each iterates the whole in-process connection set;
2. delivers **inline subscribers** (`bus.ts:465-469`);
3. `await publishCrossProcessEvent(...)` — a real `SELECT pg_notify($1, $2)` query on a dedicated pool (`packages/events/src/bridge.ts:201`), on the caller's critical path;
4. when persistent, enqueues the queue job.

Only (2) and (4) carry domain meaning. (1) and (3) exist solely so browsers see the change — and note they are **not adjacent**: inline delivery sits between them, which is why the architecture below keeps them as two seams rather than one block.

A 2,000-row product import therefore performs 2,000 Postgres roundtrips and 2,000 fan-outs to make DataTables refresh — and the three catalog events that pay this exist for exactly that reason, as their own declaration says (`packages/core/src/modules/catalog/events.ts:9-15`: *"bridge to the DataTable … so confirmed mutations auto-refresh the list"*). A DataTable does not need 2,000 refresh triggers; it needs the last one.

The progress module recognised this and fixed it for itself (`packages/core/src/modules/progress/lib/progressServiceImpl.ts:19-32`, `:187-254`): a leading-edge throttle behind `OM_PROGRESS_BROADCAST_MIN_INTERVAL_MS`, with database heartbeats kept on their own schedule so the stale-job sweep cannot starve. That throttle is private to one service. The catalog bulk-create work on [#5609](https://github.com/open-mercato/open-mercato/pull/5609) (spec still unmerged at the time of writing, so it is cited as a PR rather than a repo path) deliberately accepts the unthrottled cost for one endpoint, bounded by its 2,000-item cap — a reasonable trade that does not generalise, because it rests on that endpoint's own item cap rather than on anything about the event. Every future bulk writer of a broadcast entity inherits the cost with no lever to pull.

## 📝 Proposed Solution

Add a **coalescing scheduler in the events package** that wraps only the browser-facing half of `emit` — the global-tap fan-out and the cross-process publish — and is engaged per event by a new optional `EventDefinition` field:

```typescript
{ id: 'catalog.product.created', label: 'Product Created', clientBroadcast: true, broadcastCoalescing: true }
```

Semantics: **last-wins within a window, with a guaranteed trailing delivery, and at most one delivery in flight per key.** The first emit of a burst is delivered immediately (leading edge). Subsequent emits sharing a coalescing key inside the window replace the pending payload rather than being delivered; a timer always flushes the survivor when the window closes. A burst of N emits therefore produces **at most** `1 + ceil(burst_duration / interval)` browser deliveries instead of N, and the final state always reaches the browser.

**The single-in-flight rule is a correctness requirement, not an optimization.** The next window is armed only *after* the current dispatch settles — never before it. Arming first lets a slow `pg_notify` roundtrip still be in flight when the next window fires, so two deliveries of one key race, and if the earlier one finishes last the browser ends the burst holding the **older** payload — precisely the staleness this design exists to prevent. Awaiting first gives at most one in-flight delivery per key and makes the window self-extend under load, which is the correct behavior for a throttle; submissions arriving mid-dispatch still queue, because the entry stays in the map until a window closes with nothing pending. This is why the delivery count above is an upper bound rather than an equality: under load the effective window is the interval *plus* the dispatch duration.

Two properties from the issue are structural, not incidental:

- **The domain event still fires per record.** Coalescing touches only the two browser-facing sinks; inline subscriber delivery and the queue enqueue are untouched and stay where they are. Webhooks, notification handlers, workflow triggers and indexers see byte-identical behavior.
- **The last event of a burst is delivered for as long as the emitting process lives.** The trailing timer is unconditional, which is where this design goes past the progress precedent: the progress service can drop the tail because its terminal transitions (`completeJob` / `failJob`) emit through a separate unthrottled path, and a generic mechanism has no such guaranteed epilogue.

  The qualifier is load-bearing and is stated deliberately rather than as a caveat. A pending browser delivery must never keep a process alive, so the trailing timer is `unref`'d; a process can therefore end with a tail still queued. Four exit paths do this — a natural exit once the event loop drains, a `SIGTERM`/`SIGINT` stop, an explicit `process.exit()`, and a `SIGKILL`. The first three are covered by the shutdown flush and the CLI flush (Steps 1.6 and 1.8, and the Edge Cases rows below); only `SIGKILL` — and a third-party host that calls `process.exit()` without flushing first — genuinely drops the tail, bounded at one interval, and the browser's reconnect path re-syncs after it.

### Alternatives considered

| Option | Why it lost |
|--------|-------------|
| Global env interval applied to every `clientBroadcast` event | Silently changes delivery semantics for every existing consumer in one release, including single-event UI reactions that are not bursty. Fails the "never weaken a documented contract by default" rule. |
| Automatic coalescing for ids the bridge observes as high-frequency | Requires per-id rate state and a heuristic threshold; behavior becomes load-dependent and irreproducible between environments, which is a poor property for a delivery contract. |
| Lossless batching (N events delivered in one SSE frame / one envelope) | Preserves per-record fidelity but changes the SSE wire format and `useAppEvent`'s dispatch contract — a much larger blast radius for a benefit no current consumer needs (they refetch). Revisitable additively later. |
| Suppress the event entirely in bulk mode (`ctx.bulkImport.skipEvents`) | Already rejected by the catalog bulk-create design on [#5609](https://github.com/open-mercato/open-mercato/pull/5609) — it makes bulk-created records invisible to webhooks and integrations. This spec deliberately keeps the domain event. |

## 📝 Architecture

### The seam

```
bus.emit(event, payload, options)
  │
  ├─ A. global taps ───────── backoffice SSE fan-out + portal SSE fan-out
  │                           browser-facing
  ├─ B. inline subscriber delivery ────────────── unchanged, per record
  │
  ├─ C. publishCrossProcessEvent → pg_notify → other processes' SSE
  │                           browser-facing
  └─ D. queue enqueue (persistent) ───────────── unchanged, per record
```

The two browser-facing sinks (A and C) sit on **opposite sides** of inline delivery today, so they are wrapped as two closures — `runGlobalTaps()` and `publishToOtherProcesses()` — rather than merged into one block:

- **A non-opted-in event keeps the exact sequence above.** `runGlobalTaps()` is invoked at A and `publishToOtherProcesses()` at C, each at the position its code occupies today, so its emit is byte-identical — including the lazy resolution of `crossProcessOptions`, which must stay inside C so a non-coalesced event resolves scope at exactly the point it always did.
- **An opted-in event hands both closures to the coalescer as one dispatch**, submitted at position A. That is the one deliberate ordering change: for a coalesced event the cross-process publish travels with the taps and therefore precedes inline subscriber delivery instead of following it. It is recorded in the Edge Cases table rather than left implicit, and it is safe because C's consumers are other processes' SSE bridges, which have no ordering relationship with this process's inline subscribers.

Merging A and C into a single closure invoked at one position — the shape a first reading suggests — would move one of them across inline delivery **for every event, opted in or not**, which is why it is rejected here. The two closures must also preserve what differs between the sinks: the taps receive the raw `options`, while the publish receives `crossProcessOptions` from `resolveCrossProcessEmitOptions` and is gated on `isCrossProcessBroadcastEvent && hasTrustedTenantScope && isPrivateCrossProcessEventEmitter` (`bus.ts:476-480`). The taps carry no such gate.

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
export function resolveBroadcastCoalesceIntervalMs(): number
export function resetBroadcastCoalescerForTests(): void
```

This block is the single list of the module's exports; the backward-compatibility table below references it rather than restating it.

`intervalMs` is an explicit parameter rather than an ambient read so the unit tests can drive the window deterministically; see the testing note under the Implementation Plan.

State is a `Map<string, PendingBroadcast>` where `PendingBroadcast = { pending, timer, suppressed }` — `pending` holds the newest superseding dispatch awaiting the trailing flush, or `null` when nothing has been superseded since the last delivery. There is deliberately no `lastDispatchedAt`-style field: the window is not a leading-edge throttle measured against a timestamp, it is armed by the dispatch itself and re-armed only once that dispatch settles (Proposed Solution → the single-in-flight rule), so the timer *is* the state. Entries are deleted when a window closes with nothing pending, so the map is bounded by the number of distinct **keys** currently mid-window — which, because the key is the raw union of the scope-bearing inputs rather than a resolved audience, is at least the number of distinct audiences and occasionally more.

That bound is honest only when the audience is coarse, and it is worth stating plainly rather than as a reassurance: because recipient users and roles are key segments, a burst of recipient-addressed emits — a notification fan-out to N users — produces N distinct keys inside one window. There, distinct-audiences-mid-window *equals* burst length: N map entries and N armed timers, and no two emits ever share a key, so coalescing suppresses nothing. The mechanism costs a little and delivers nothing for that shape. It is safe (every delivery still happens, and the timers are `unref`'d), but it is the wrong declaration — see the Step 2.3 documentation requirement, which states the rule as *coarse audiences only*.

The map lives on `globalThis` under a namespaced key, following the `GLOBAL_EVENT_TAPS_KEY` / `EVENTS_PRODUCER_QUEUE_KEY` precedent in `bus.ts:62,140` — the event bus is rebuilt per request, so a per-bus map would coalesce nothing.

### Coalescing key

**The governing rule: the key must contain every dimension every delivery filter downstream of it narrows on.** Coalescing suppresses a pending delivery in favour of a newer one sharing its key, so any audience dimension missing from the key lets an emit for audience X suppress a pending emit for audience Y. The two emits are not merged — the survivor is delivered correctly to its own audience — but Y's delivery is silently lost, indistinguishable from the event never having been emitted. Getting this wrong is the single highest-severity failure mode in the design, so the key is derived from an explicit enumeration rather than from an intuition about what "scope" means.

**"Every filter" is plural on purpose: the coalesced dispatch guards two sinks feeding three filters, and no two of them resolve scope the same way.** `runGlobalTaps()` feeds both SSE endpoints — the backoffice one and the portal one, which have separate audience functions — and `publishToOtherProcesses()` feeds `publishCrossProcessEvent`, whose audience is `crossProcessOptions` from `resolveCrossProcessEmitOptions` (`bus.ts:475`).

| Filter | Reads | Narrows on |
|--------|-------|------------|
| Backoffice `normalizeAudience` (`stream/route.ts:51-105`), filter `matchesAudience` (`:107-126`) | `options` for tenant and organizations when `options` carries a `tenantId` **property** (the `hasTrustedScope` presence test at `:57-58`), the payload otherwise; recipients always from the payload | tenant, organizations, recipient users, recipient roles |
| Portal `normalizeAudience` (`portal/events/stream.ts:31-66`), filter `matchesAudience` (`:68-78`) | the payload only — the portal tap is registered as `(eventName, payload) => …` and never receives `options` at all (`:131-133`) | tenant, organizations, recipient users (never roles) |
| `resolveCrossProcessEmitOptions` (`bus.ts:72-96`) | `options` when `options.tenantId` is a **non-empty string** (`hasTrustedTenantScope`, `bus.ts:65-66`), otherwise the payload — but only for `isBroadcastEvent` ids (`bus.ts:82`) | tenant, organizations |

Mirroring any one of the three leaves the others' dimensions out of the key, and mirroring all three would couple the key to resolution rules that can change independently of it. So the key does not resolve scope at all. It is the **raw union of every scope-bearing input an emit carries**, and the resolvers are left to do their own work downstream:

```
${eventId}
  ::${payloadTenantId}::${sortedPayloadOrganizationIds}
  ::${sortedPayloadRecipientUserIds}::${sortedPayloadRecipientRoleIds}
  ::${optionsTenantToken}::${sortedOptionsOrganizationIds}
```

built by one function, `buildBroadcastCoalesceKey(event, payload, options)`:

- the payload segments are `payload.tenantId`, `payload.organizationId` + `payload.organizationIds`, `payload.recipientUserId` + `payload.recipientUserIds`, and `payload.recipientRoleId` + `payload.recipientRoleIds` — taken verbatim, with no precedence rule applied;
- the options segments are `options.organizationId` + `options.organizationIds`, and a **presence-encoding** tenant token: a sentinel when `options` carries no `tenantId` own-property at all, the empty string when it carries one that is not a non-empty string, the trimmed value otherwise. The distinction is load-bearing rather than pedantic — `hasTrustedScope` (`stream/route.ts:57-58`) is a presence test, so `{}` and `{ tenantId: undefined }` send the backoffice filter down different branches and must not share a key;
- lists are sorted with an explicit comparator so a multi-value audience keys identically however the caller ordered it.

**Why this is total.** Each of the three filters is a pure function of the event id plus some subset of these raw fields — that is what the table above records. Two emits sharing this key therefore feed identical inputs to all three resolvers and necessarily resolve to identical audiences under each. There is no branch a future reader has to re-derive, and a fourth browser sink with its own filter cannot invalidate the key so long as it scopes from the same payload and options fields.

The cost is that the key is sometimes finer than the audience — two emits that resolve to the same audience by different routes will not coalesce with each other. Over-keying is safe by construction: a key that is too specific only coalesces less, and can never misdeliver. Under-keying loses deliveries. The asymmetry is the whole argument for taking the raw union rather than the resolved one.

Five failure cases this replaces, each of which a narrower key admits:

- **Recipient-addressed events.** Two emits of one opted-in event, same tenant and organization, addressed to different users, share a tenant-and-organization-only key. One user's delivery is dropped.
- **Portal-only events scoped through the payload.** An event declaring `portalBroadcast: true` without `clientBroadcast: true` carries its scope in the payload, since that is the only channel the portal tap reads. A key that consults `options` alone — or that promotes payload scope only for `isBroadcastEvent` ids, as `resolveCrossProcessEmitOptions` does (`bus.ts:82`) — collapses every tenant onto `${eventId}::::`, letting tenant B's emit suppress tenant A's portal delivery.
- **A present-but-empty `options.tenantId`.** `bus.emit(id, { tenantId: 'A', … }, { tenantId: undefined })` — the shape `{ tenantId: ctx.auth?.tenantId }` produces routinely — makes `hasTrustedScope` true and the trusted tenant `null`, so a key mirroring the backoffice resolution is empty for **every** tenant, while the publish promotes the payload tenant and delivers to A. Tenant B's emit then suppresses tenant A's pending dispatch and A's `pg_notify` never fires, so browsers attached to other processes never see A's change — a delivery that happens today, since all three gates at `bus.ts:476-480` pass for this shape: `isCrossProcessBroadcastEvent` is true for any `clientBroadcast` event, `isPrivateCrossProcessEventEmitter` returns true early when `crossProcessBroadcast` is not set, and the payload promotion supplies the trusted tenant the presence test denied. The taps drop this emit either way (audience tenant `null` fails at `stream/route.ts:108`), which is exactly what makes it easy to miss: the sink such a key would have mirrored is the one that was never going to deliver.
- **A portal audience that differs only in the payload's organization.** `bus.emit(id, { tenantId: 'T', organizationId: 'O1', … }, { tenantId: 'T' })` followed by the same emit for `O2`. A key built from the backoffice resolution plus the cross-process resolution is identical for both — `hasTrustedScope` is true, so both take tenant `T` and *no* organizations from `options`, and `hasTrustedTenantScope` is true, so the publish resolves the same — while the portal narrows on `O1` and `O2` from the payload and holds different connection sets for them. `O1`'s portal delivery is dropped, and the backoffice loses nothing, so the loss is invisible from the sink such a key mirrors.
- **A portal-only event whose `options` carries a present-but-empty tenant.** The previous two cases composed: tap segments empty (presence test true, trusted tenant `null`), cross-process segments empty (payload promotion gated off by `isBroadcastEvent`, false for a portal-only id), while the portal delivers per payload tenant. Every tenant collapses onto one key and one tenant's burst suppresses another's portal delivery.

All five get dedicated regression tests (Step 1.5).

### Eligibility

An event is coalesced only when **all** hold:

1. its declaration sets `broadcastCoalescing: true`;
2. `isBroadcastEvent(id) || isPortalBroadcastEvent(id)` — there is a browser sink to coalesce. A declaration setting `broadcastCoalescing` with neither is rejected at declaration time, since it would coalesce nothing;
3. `crossProcessBroadcast !== true` — private cross-process coordination (cache invalidation, registry reloads) must stay immediate; delaying it would make another process serve stale data. A declaration combining `crossProcessBroadcast: true` with `broadcastCoalescing: true` is rejected at declaration time in `createModuleEvents` with a clear error rather than silently ignored;
4. the resolved interval is `> 0`.

Note what is deliberately **not** an eligibility condition: carrying recipient scope or being portal-only. Both are handled by putting those dimensions in the key rather than by excluding the events, so the mechanism stays available to the portal bridge as Resolved assumption #3 intends. That makes them *safe*, not *useful*: a recipient-addressed event keys uniquely per emit, so it coalesces nothing and should not carry the declaration (Step 2.3). The distinction is a documentation rule rather than a guard because eligibility cannot see an audience — only an emit can.

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
 * (event, audience) reaches the SSE bridges, and a trailing flush
 * guarantees the last one is delivered. Audience covers every dimension
 * the SSE filters narrow on, so no audience's delivery is suppressed by
 * another's. Subscribers, webhooks and the queue are unaffected — the
 * domain event still fires per record.
 * Only declare it on events whose browser consumers react to the fact
 * that something changed (list refresh), not to each occurrence, and
 * whose audience is coarse — a recipient-addressed event keys uniquely
 * per emit and gets no coalescing at all.
 * Default: false.
 */
broadcastCoalescing?: boolean
```

`BACKWARD_COMPATIBILITY.md:42` explicitly permits new optional fields on `EventDefinition`; nothing is renamed, removed, or narrowed.

### Unchanged

The SSE frame shape (`{ id, payload, timestamp, organizationId }`), `useAppEvent`, `AppEventPayload`, the audience filter, `isBroadcastEvent`, `isPortalBroadcastEvent`, `EmitOptions`, the queue job shape, and every event id. Suppression counts surface through the structured logger (`logger.debug('Coalesced broadcast', { event, suppressed })`), not through the wire format — deliberately, so this change carries no browser-contract risk.

**Observability limit, stated rather than assumed.** `debug` is below the default log level, so a production deployment gets no signal that coalescing is active, how much it suppresses, or that an event was declared on the wrong shape — a recipient-addressed event keys uniquely per emit and therefore costs one map entry and one armed timer per recipient while suppressing nothing (see the module's state notes and the Step 2.3 rule). The map has no size bound either. That combination is knowingly deferred, not overlooked: this spec keeps its surface to one optional type field and one env knob, and a metrics contract is a larger commitment than the mechanism warrants at three opted-in events. The trigger for revisiting it is the fourth opt-in or the first non-catalog one, whichever comes first — at that point add a suppressed-vs-submitted counter and a warning when a single key's map grows past a threshold, which is what makes a misdeclaration visible instead of latent and lets the Performance estimate below be checked against a real deployment rather than only against Step 2.2's unit assertion.

### New environment variable

| Variable | Default | Meaning |
|----------|---------|---------|
| `OM_BROADCAST_COALESCE_INTERVAL_MS` | `250` | Minimum ms between browser deliveries of one coalescing key. `0` disables coalescing everywhere, restoring per-record delivery. |

## 📝 UI/UX

No UI work. The observable difference is that a bulk import refreshes an open DataTable a few times per second instead of once per row, and the table is correct when the burst ends. Nothing in `packages/ui` changes.

## 📝 Edge Cases & Failure Scenarios

| Scenario | Behavior |
|----------|----------|
| Process stopped by `SIGTERM` / `SIGINT` mid-window | `flushPendingBroadcasts()` runs from a **dedicated** hook this spec registers (Step 1.6), not from the producer-queue hook at `bus.ts:157-169` — that one is registered only from inside `getQueue()`'s shared-async branch (`bus.ts:244`), so a `local`-strategy process, a process with `OM_EVENTS_SHARED_PRODUCER=0`, or one that never enqueues has no such handler at all. |
| Process reaches a **natural** exit mid-window | The reason the shutdown hook cannot rely on signals alone. The trailing timer is `unref`'d so a pending browser delivery never keeps a process open, which means a one-shot script finishes, the loop drains, and no signal ever fires. `beforeExit` runs at exactly that moment and flushes the tail. |
| Process ends via an explicit `process.exit()` — **every `mercato` CLI command** | Neither a signal nor `beforeExit` fires: Node does not emit `beforeExit` when `process.exit()` is called explicitly, and `packages/cli/src/bin.ts:122` ends every returning CLI command with `process.exit(code ?? 0)`. `beforeExit` alone therefore covers none of this repository's CLI, which is exactly the shape the guarantee most needs. The repo already documents the hazard for its own `beforeExit` hook (`packages/shared/src/lib/modules/resource-usage.ts:798-801`). Covered by Step 1.8, which awaits `flushPendingBroadcasts()` in `bin.ts` beside the telemetry shutdown that already awaits there for the same reason. |
| Hard `SIGKILL`, or a third-party host calling `process.exit()` without flushing | The tail is genuinely lost — bounded at one interval, and the browser reconnect path already re-syncs. These are the only exit paths the guarantee does not cover. |
| `pg_notify` fails inside a deferred flush | No caller is awaiting it any more, so the deferred path owns its own `try/catch` and logs at `error` with the event id — matching how `emit` already handles a synchronous publish failure (`bus.ts:481-485`). A failed flush does not block the next window. |
| A dispatch outlives its own window (slow `pg_notify` under load) | The next window is armed only after the dispatch settles, so one key never has two deliveries in flight and an older payload can never land last. The window self-extends to interval + dispatch duration, which is the correct behavior for a throttle; submissions arriving mid-dispatch queue on the entry, which stays in the map until a window closes with nothing pending. Regression test in Step 1.3. |
| `flushPendingBroadcasts()` runs while a dispatch for the same key is in flight | The flush clears the timer and dispatches the survivor, so this is the one path that can overlap two deliveries of one key. It is accepted deliberately: shutdown is the moment where delivering the tail matters more than ordering against a dispatch that is already on the wire, and the alternative — awaiting an in-flight roundtrip during `SIGTERM` — risks losing the tail entirely. The window is bounded by one interval, and both payloads are correctly audience-filtered; only their relative order is unguaranteed. |
| Two tenants burst concurrently | Independent keys, independent timers, independent payloads. Regression test asserts no tenant's delivery is suppressed by another's. |
| Two recipients of one event burst concurrently | Independent keys, because recipient users and roles are part of the key. Without them in the key one recipient's delivery would be silently dropped; regression test asserts both are delivered. Note the corollary: a recipient-addressed event gets **no** coalescing benefit, because every emit keys uniquely — it should not carry the declaration at all (Step 2.3). |
| An emit passes `options` carrying a present-but-empty `tenantId` while scoping through the payload | Independent keys, because the payload tenant is a key segment unconditionally. The three filters disagree here — `normalizeAudience` reads presence as trusted and resolves no tenant, `resolveCrossProcessEmitOptions` promotes the payload tenant, and the portal reads the payload tenant directly — so any key derived from one resolution collapses every tenant onto one entry. Regression test covers exactly this shape. |
| A portal-only event bursts across tenants | Independent keys, because the payload tenant is a key segment unconditionally rather than a fallback that a `tenantId` property in `options` switches off. Regression test covers a `portalBroadcast`-without-`clientBroadcast` declaration specifically, since that is the case a trusted-options-only key derivation gets wrong. |
| A portal event bursts across organizations while `options` carries only a trusted tenant | Independent keys, because the payload's organizations are key segments unconditionally. This is the case a key built from the backoffice and cross-process resolutions still gets wrong: both take their organizations from `options`, which carries none, so both emits key identically while the portal narrows on the payload organizations and holds different connection sets for them. The backoffice loses nothing here — its audience is tenant-wide for both — so the loss is invisible from the sink such a key mirrors. Regression test covers exactly this shape. |
| `options` is `{}` versus `{ tenantId: undefined }` for otherwise identical emits | Independent keys, because the options tenant segment encodes **presence**, not just value. `hasTrustedScope` (`stream/route.ts:57-58`) is a presence test, so these two shapes send the backoffice filter down different branches — one falls back to the payload tenant, the other resolves `null` and delivers to nobody — and must not share a key. |
| Ordering: cross-process publish vs inline subscribers, for a **coalesced** event | Deliberate change. The publish travels with the taps and therefore precedes inline delivery instead of following it. Safe because the publish's consumers are other processes' SSE bridges, which never had an ordering relationship with this process's inline subscribers. A non-coalesced event's sequence is untouched. |
| Ordering between a coalesced and a non-coalesced event | Per key, order is preserved (last wins). Across keys, a later immediate event can reach the browser before an earlier deferred one. Cross-event ordering over the bridge was never guaranteed — cross-process envelopes already race with local taps — but it is now documented rather than incidental. |
| An event opts in whose consumers need per-record fidelity | A real semantic hazard, and the reason this is opt-in per declaration rather than a global default. Documented in `packages/events/AGENTS.md` with the "react to the fact, not the occurrence" test. |
| Payload exceeds the 4096-byte SSE limit / 7000-byte bridge limit | Unchanged — truncation and drop happen inside the dispatch closure exactly as today. |
| Interval set to `0` | Every emit passes straight through. The code path is the same closure invoked synchronously, so behavior is byte-identical to today. |
| Serverless/scale-to-zero deployment where the process may not outlive the request | The trailing flush is a timer, so a frozen process can drop the tail. The Node deployment model this repo targets already relies on process-lifetime timers for SSE heartbeats (`stream/route.ts:274`), so the assumption is not new; the env knob is the opt-out. |

## 📝 Risks & Impact Review

**Blast radius.** Phase 1 changes `emit`'s internal structure but no observable behavior for any event that does not opt in — and, unlike a naive restructuring, that claim rests on the two-closure shape rather than on the coalescer being idle: `runGlobalTaps()` and `publishToOtherProcesses()` are each invoked at the position their code occupies today, so a non-opted-in emit is byte-identical. Since no event opts in during Phase 1, that covers every event. Phase 2 changes the browser delivery pattern of exactly three catalog events, and for those three the cross-process publish moves ahead of inline delivery (Edge Cases). The queue, subscriber, webhook and index paths are untouched in both phases.

**Backward compatibility.**

| Surface | Change | Verdict |
|---------|--------|---------|
| Type interface (`EventDefinition`) | New optional field `broadcastCoalescing?: boolean` | ✓ ADDITIVE — `BACKWARD_COMPATIBILITY.md:42` permits optional additions |
| Import paths / exports (`@open-mercato/events`) | New exports, per the module's published surface above | ✓ ADDITIVE — nothing removed or renamed |
| Test-only helper | `resetBroadcastCoalescerForTests` | ⚠️ ADDITIVE, but **currently root-reachable**: `packages/events/src/index.ts` re-exports the module with `export * from './broadcast-coalescer'`, which takes the test helper with it and makes it a supported public surface the project then owes compatibility on. Contain it before merge — replace the star with a named export list omitting the helper, so it stays reachable only via the deep path `@open-mercato/events/broadcast-coalescer`. Owned by the implementation PR; recorded under Implementation divergence. |
| Event IDs, API routes, DB schema, DI keys, ACL features | None | ✓ Unchanged |
| SSE frame shape | None | ✓ Unchanged |
| Env vars | New optional `OM_BROADCAST_COALESCE_INTERVAL_MS` | ✓ ADDITIVE |

**Rollback.** Two independent levers, no migration to reverse: set `OM_BROADCAST_COALESCE_INTERVAL_MS=0` to disable process-wide at runtime, or drop `broadcastCoalescing: true` from a single declaration to revert one event. Reverting the Phase 2 commit alone restores today's behavior while keeping the mechanism available.

**Security.** Two distinct properties, worth separating because only the second is about data exposure:

- *No payload is ever mixed.* Suppressed payloads are dropped, never merged, so no delivered payload is assembled from more than one record. No new data reaches the browser, and the audience filter is untouched — the surviving payload is filtered by `matchesAudience` exactly as it would have been without coalescing. This holds unconditionally and is what keeps the change out of cross-tenant-*leak* territory.
- *No audience's delivery is suppressed by another's.* This is the property that depends on the key being complete, and it is the one a partial key breaks. It is enforced by keying on the **raw union of every scope-bearing input** rather than on any filter's resolution of them (Architecture → Coalescing key), which makes the property structural: each of the three filters is a pure function of the event id plus a subset of those inputs, so two emits sharing a key cannot resolve to different audiences under any of them. It is verified by five required Phase 1 regression tests, one per collapse a resolved key admits: two tenants, two recipient users, a portal-only event scoped through the payload, an emit whose `options.tenantId` is present but empty while its scope is in the payload, and a portal event whose organizations differ only in the payload while `options` carries a trusted tenant. The last two are the cases a key mirroring one or two of the filters still gets wrong, and they are the ones where the sink that loses the delivery is not the sink the key was mirroring.

**Performance.** Expected reduction for a 2,000-row import at the 250 ms default: from 2,000 `pg_notify` roundtrips and 2,000 fan-outs to roughly `1 + (import_seconds × 4)` of each. Cost added: one `Map` entry and one timer per active key — which for a coarse-audience event like these three is one per tenant/organization mid-window, and for a recipient-addressed event would be one per recipient with no reduction to show for it (see the module's state notes and the Step 2.3 rule).

## 📋 Phasing

- **Phase 1 — the mechanism.** The coalescer, the declaration field, the eligibility guard, the env knob, the shutdown flush, and full unit coverage. No event opts in, so merging is behavior-neutral and independently shippable.
- **Phase 2 — the first consumers.** Opt the three catalog broadcast events in, document the mechanism and its "when to declare it" test, add the guard that a bulk write emits per-record domain events while coalescing browser deliveries, and cover the browser end of the guarantee with integration tests. Phase 2 is where behavior first changes, so it is the phase the QA gate applies to.

## 📋 Implementation Plan

**Testing note (applies to every step below).** The coalescer's contract is expressed in *when* things dispatch, so every assertion here spans a timer window. The unit tests use Jest fake timers and advance them explicitly; `submitBroadcast` takes `intervalMs` as a parameter precisely so a test can pin the window rather than mutate `process.env`. Without this, an assertion like Step 1.4's "≤3 tap invocations" cannot distinguish a working coalescer from a dead timer — a synchronous 100-emit loop lands entirely in one tick and produces exactly 2 dispatches either way. `resetBroadcastCoalescerForTests()` clears the `globalThis` map between tests so one suite's pending entries cannot leak into the next.

### Phase 1 — Coalescing mechanism (behavior-neutral)

**Step 1.1 — Declare the field.** Add `broadcastCoalescing?: boolean` with its JSDoc to `EventDefinition` (`packages/shared/src/modules/events/types.ts:20-41`) and an `isCoalescedBroadcastEvent(eventId)` reader beside `isBroadcastEvent` (`packages/shared/src/modules/events/factory.ts:143-195`). *Test:* the reader returns `true` only for a declared, opted-in event and `false` for undeclared ids and for opted-out ones.

**Step 1.2 — Reject the unsafe declarations.** In `createModuleEvents`, throw on both combinations eligibility rules 2 and 3 forbid, each with a message naming the event id and why: `crossProcessBroadcast: true` with `broadcastCoalescing: true` (private coordination must not be delayed), and `broadcastCoalescing: true` with neither `clientBroadcast` nor `portalBroadcast` (there is no browser delivery to coalesce). *Test:* both declarations throw; a `clientBroadcast` + `broadcastCoalescing` declaration and a `portalBroadcast` + `broadcastCoalescing` declaration do not.

**Step 1.3 — Add the coalescer.** New `packages/events/src/broadcast-coalescer.ts` with `submitBroadcast` / `flushPendingBroadcasts` / `resetBroadcastCoalescerForTests`, `globalThis`-backed state, leading-edge dispatch, unconditional trailing timer, **re-arm only after the dispatch settles** (the single-in-flight rule — arming before the `await` is the defect this step exists to avoid), per-key `try/catch` around the deferred dispatch, and a `logger.debug` suppression counter. *Test (unit, no bus):* a burst of 50 submissions on one key inside the window yields 1 immediate + 1 trailing dispatch and the trailing one is the newest closure; distinct keys never interfere; `intervalMs: 0` dispatches every submission synchronously; a throwing deferred dispatch is logged and does not poison the next window; **and — the ordering regression — a deliberately slow dispatch (one that outlives its own interval) never overlaps the next delivery of the same key, so the last payload submitted is the last payload delivered.** That last assertion is the one that fails against a re-arm-first implementation, and it needs a dispatch whose promise is resolved by the test rather than by the timer, since fake timers alone cannot express "still in flight".

**Step 1.4 — Wire it into `emit`.** Wrap the tap fan-out as `runGlobalTaps()` and the guarded `publishCrossProcessEvent` block as `publishToOtherProcesses()`, each **left at its current position** (`bus.ts:442-449` and `bus.ts:475-486` respectively) so a non-opted-in emit is byte-identical; keep `resolveCrossProcessEmitOptions` inside the second closure so it still resolves lazily, after inline delivery. When the event is eligible, submit both closures to `submitBroadcast` as one dispatch at the taps' position and skip the later publish. Keep inline delivery and the queue enqueue exactly where they are. *Test:* for a non-opted-in event the call sequence and the point of scope resolution are unchanged; for an opted-in event a 100-emit burst produces 100 inline subscriber invocations and 100 queue enqueues but ≤3 tap invocations and ≤3 `publishCrossProcessEvent` calls; `crossProcessBroadcast` events are never deferred; the publish's three gates still hold on the coalesced path.

**Step 1.5 — Audience isolation.** Implement `buildBroadcastCoalesceKey(event, payload, options)` per Architecture → Coalescing key, as the **raw union of the scope-bearing inputs**: the payload's tenant, organizations, recipient users and recipient roles taken verbatim, plus the options' organizations and a presence-encoding tenant token that distinguishes an absent `tenantId` property from one present but empty — every list sorted with an explicit comparator. The function must not resolve scope: it must not apply `normalizeAudience`'s precedence, and it must not call `resolveCrossProcessEmitOptions`. Resolution stays where it belongs, downstream in each filter. *Test:* five regression cases, one per way a resolved key collapses two audiences — concurrent bursts for two tenants and two organizations each deliver; two emits addressed to different `recipientUserId`s both deliver; a `portalBroadcast`-without-`clientBroadcast` event carrying scope only in the payload keys per tenant rather than collapsing to `${eventId}::::`; two emits passing `{ tenantId: undefined }` in `options` while scoping through the payload key per tenant, so neither tenant's cross-process publish is suppressed by the other's; and two emits passing `{ tenantId: 'T' }` in `options` while carrying different `organizationId`s in the payload key separately, so neither organization's *portal* delivery is suppressed by the other's. Plus one keying assertion that `{}` and `{ tenantId: undefined }` do not share a key, and the standing assertion that no delivered payload carries another audience's data.

**Step 1.6 — Shutdown flush.** Register a **dedicated** hook, `registerBroadcastCoalescerShutdownHook()`, from `createEventBus` — unconditionally, and idempotently via a `globalThis` key. It must not reuse the producer hook at `bus.ts:157-169`: that one is registered only from inside `getQueue()`'s shared-async branch (`bus.ts:244`), so a `local`-strategy process, `OM_EVENTS_SHARED_PRODUCER=0`, or a process that never enqueues would silently have no handler. Bind `flushPendingBroadcasts()` to `SIGTERM`, `SIGINT` **and `beforeExit`** — the last covers the natural-exit path an `unref`'d timer creates, for hosts that reach it. *Test:* each of the three registered handlers dispatches a pending entry; the hook registers even when the bus never opens a queue; registering twice adds one handler set.

**Step 1.7 — Env knob.** Resolve `OM_BROADCAST_COALESCE_INTERVAL_MS` through `parseNumberWithDefault` (default 250, min 0) and document it in `apps/mercato/.env.example` — mirroring the template per the `create-app` Template Sync Checklist (`yarn template:sync:fix`). *Test:* unset → 250; `0` → passthrough; a negative or non-numeric value → 250.

**Step 1.8 — CLI flush.** The hook above is not sufficient on its own, and the gap is not an edge case: `packages/cli/src/bin.ts:117-122` ends every returning `mercato` command with `process.exit(code ?? 0)`, and Node does **not** emit `beforeExit` when `process.exit()` is called explicitly. Left as-is, a one-shot CLI bulk write — the shape the trailing guarantee exists for — drops its final `pg_notify`, so a browser watching the DataTable ends the burst stale, which is the outcome issue #5733 names. `bin.ts` already awaits `getTelemetryRuntime()?.shutdown()` immediately before the exit for exactly this class of reason; add `await flushPendingBroadcasts()` in the same slot. An `'exit'` handler is not an option — it runs synchronously only, and a `pg_notify` round-trip cannot complete there.

**Import it from the deep path, `@open-mercato/events/broadcast-coalescer` — not from the package root.** That slot exists because of an import-ordering constraint `bin.ts` documents twice (`:11-13` and `:114-116`): `run` is imported *dynamically* so telemetry initializes before the mercato entry "and its Postgres driver" loads. The package root is `export * from './types'` + `export * from './bus'` (`packages/events/src/index.ts`), `bus.ts` pulls `bridge.ts`, and `bridge.ts:2` is `import { Client, Pool } from 'pg'` — so a top-level `import { flushPendingBroadcasts } from '@open-mercato/events'` would load the Postgres driver *before* `initTelemetry()` and silently cost every `mercato` command its `pg` instrumentation. Nothing in the validation gate would catch that. The coalescer module is dependency-free apart from the logger and the shared number parser, and the package's `exports` map already publishes `./*`, so the deep path is safe as a static import; a dynamic import beside the existing one is the equally acceptable alternative. This is the same containment the backward-compatibility table wants for `resetBroadcastCoalescerForTests`, arrived at from the opposite direction.

*Test:* a pending entry submitted before the CLI teardown dispatches on that path, and the flush is awaited rather than fired and forgotten.

### Phase 2 — First consumers and documentation

**Step 2.1 — Opt the catalog events in.** Add `broadcastCoalescing: true` to `catalog.product.{created,updated,deleted}` (`packages/core/src/modules/catalog/events.ts:13-15`) — the three events whose declared purpose is DataTable auto-refresh. Run `yarn generate`. *Test:* `isCoalescedBroadcastEvent` is true for the three and false for every other catalog event.

**Step 2.2 — Bulk-writer guard.** A test that drives a loop of catalog product creates through the bus and asserts the invariant the issue names: N domain deliveries to a subscriber, ≪N browser dispatches, and the final payload delivered to the browser is the last record's. *Test:* is the step.

**Step 2.3 — Document it.** Extend `packages/events/AGENTS.md` → DOM Event Bridge with a "Coalescing browser deliveries" subsection: the declaration, the env knob, the guarantee **and its process-lifetime qualifier**, the `crossProcessBroadcast` prohibition, and two tests for when to declare it — "only when browser consumers react to the fact that something changed, not to each occurrence", and **"only for coarse audiences"**. The second needs its reason spelled out, because "safe" and "useful" come apart here: recipient-addressed and portal-only events are *safe* to coalesce, since the key covers their dimensions, but a recipient-addressed event keys uniquely per emit, so it gets no coalescing at all and pays a map entry and a timer per recipient. Tenant- or organization-wide events are the intended shape. Add the same to `apps/docs` where the DOM bridge is described, and note in `packages/core/src/modules/progress/AGENTS.md` that `OM_PROGRESS_BROADCAST_MIN_INTERVAL_MS` remains the progress-local knob. *Test:* `yarn agents:check-budget`.

**Step 2.4 — Integration coverage.** The guarantee this spec is built on — *the browser is correct when the burst ends* — is a browser-observable property, and no unit test on the bus can prove it. Add a Playwright integration test at `packages/core/src/modules/catalog/__integration__/TC-CAT-BROADCAST-001.spec.ts` — the `TC-{CATEGORY}-{XXX}.spec.ts` naming `.ai/qa/AGENTS.md:282` requires and every existing file in that folder follows, since the id-keyed `test.describe` block and the sibling `TC-*.meta.ts` mechanism both depend on it. Follow `.ai/qa/AGENTS.md` otherwise too: module `__integration__` folder, shared helpers from `@open-mercato/core/helpers/integration/*`, self-contained fixtures created in setup and removed in teardown, no reliance on seeded data.

| Path | Coverage |
|------|----------|
| `GET /api/events/stream` (SSE, key UI path) | With the catalog products DataTable open, run a bulk product create; assert the table refreshes a bounded number of times rather than once per row, and that **after the burst settles the table lists every created product** — the trailing-flush guarantee, end to end. |
| N sequential creates through `POST /api/catalog/products` | Assert the domain event still fires per record while browser deliveries are coalesced: N records created and N webhook/subscriber deliveries observed against ≪N refreshes. Sequential creates rather than a bulk endpoint on purpose — #5609's bulk-create route is not on `develop`, and a loop over the existing single-create route produces the same burst without depending on unmerged work. |
| `OM_BROADCAST_COALESCE_INTERVAL_MS=0` | The documented kill switch actually restores per-record delivery through the same UI path. |

No API contract changes, so there is no new endpoint to cover; these exercise existing paths under the new delivery pattern.

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
| 3 | Does the mechanism also cover the portal event bridge (`portalBroadcast`)? | **Yes** | Both SSE endpoints subscribe through the same `registerGlobalEventTap`, so coalescing at the `emit` seam covers both with one mechanism and no additional surface. Not quite free, though: the portal tap never receives `options` and scopes purely from the payload, which is a third scope resolution the key has to survive. Keying on the raw union of the scope-bearing inputs rather than on any filter's resolution of them handles it without a branch, and it is covered by two required Phase 1 tests rather than left as an assumption. |
| 4 | Should `progress.job.updated` migrate onto the generic mechanism, retiring its private knob? | **No — out of scope** | The progress throttle is coupled to heartbeat persistence and CAS writes; migrating it is a behavior-sensitive refactor with no user-visible gain. Recorded as a follow-up. |
| 5 | Which events opt in as part of this work? | **The three `catalog.product.*` broadcast events only** | They are the ones the originating review measured, and their declaration already states their only purpose is DataTable refresh — the exact shape last-wins serves losslessly. |
| 6 | Does an opted-in event also need an env flag to activate? | **No — the declaration alone activates it**; `OM_BROADCAST_COALESCE_INTERVAL_MS=0` is the global kill switch | A second required flag would mean the shipped default does nothing; a single kill switch gives operators rollback without a deploy. |
| 7 | Should a coalesced SSE frame carry a `suppressed`/`coalesced` marker so consumers can detect gaps? | **No — observability via the structured logger only** | Keeps the browser wire contract completely unchanged, holding this spec's BC impact to one additive optional type field. A consumer that needs per-occurrence fidelity should not opt the event in. Additive later if asked for. |
| 8 | Default interval? | **250 ms** | Matches `OM_PROGRESS_BROADCAST_MIN_INTERVAL_MS`'s default and sits below the browser bridge's own 500 ms dedup window, so coalescing never becomes the dominant perceived latency; a single interactive mutation is delivered on the leading edge with no added latency at all. |

## 📋 Final Compliance Report

| Requirement | Status |
|-------------|--------|
| No cross-tenant data exposure | ✅ Suppressed payloads are dropped, never merged; the audience filter is untouched, so a delivered payload is filtered exactly as it would be without coalescing. |
| No audience's delivery silently suppressed by another's | ⬜ **Design decides it; the implementation does not yet satisfy it.** The key specified here is the raw union of the scope-bearing inputs, with five required regression tests (tenant, recipient, portal payload-scope, present-but-empty `options.tenantId`, portal organizations under a trusted options tenant). #5896 currently keys on `resolveCrossProcessEmitOptions` alone — see Implementation divergence. |
| Last-wins ordering holds per key (no older payload lands last) | ✅ Guaranteed by the single-in-flight rule — the next window is armed only after the current dispatch settles. Specified in Proposed Solution, tested by Step 1.3's ordering regression, and already built at #5896's head (commit `2511662f`). The one accepted exception, a shutdown flush overlapping an in-flight dispatch, is recorded in Edge Cases. |
| Backward compatibility (`BACKWARD_COMPATIBILITY.md`) | ✅ One optional `EventDefinition` field (permitted explicitly at `BACKWARD_COMPATIBILITY.md:42`), additive exports, no removals or renames. No event id, API route, DB schema, DI key or ACL feature changes. |
| No direct cross-module ORM relationships | ✅ N/A — no entities. |
| Migrations | ✅ N/A — no schema change. |
| i18n / no hardcoded user-facing strings | ✅ N/A — the only new strings are `[internal]`-prefixed declaration-time errors and structured log messages. |
| Design system compliance | ✅ N/A — no UI changes. |
| Env vars mirrored into the create-app template | ⬜ Step 1.7 — `apps/mercato/.env.example` plus `yarn template:sync:fix`. |
| Unit coverage | ⬜ Steps 1.1–1.7, 2.1–2.2. |
| Integration coverage for affected API and key UI paths | ⬜ Step 2.4. |
| Docs and AGENTS.md updated | ⬜ Step 2.3, gated on `yarn agents:check-budget`. |
| Validation gate | ⬜ `yarn build:packages`, `yarn generate`, `yarn build:packages`, `yarn i18n:check-sync`, `yarn i18n:check-usage`, `yarn typecheck`, `yarn test`, `yarn build:app`. |

⬜ items are carried by the implementation PR [#5896](https://github.com/open-mercato/open-mercato/pull/5896), not by this document.

## 📋 Implementation divergence (as of 2026-09-09, #5896 head)

The implementation was written against the first draft of this document and has not yet caught up with the corrections the specification reviews made. This section exists so the gap is visible rather than latent — a reader must not take the design below as a description of what runs today. Each row is owed by #5896, not by this document.

| # | What this spec specifies | What #5896 builds | Consequence |
|---|--------------------------|-------------------|-------------|
| 1 | `buildBroadcastCoalesceKey(event, payload, options)` — the raw union of the scope-bearing inputs, including the payload's recipient users, recipient roles and organizations, and a presence-encoding options tenant token | `buildBroadcastCoalesceKey(event, options)` (`packages/events/src/bus.ts:107-124`), keyed `${event}::${tenantId}::${sortedOrgs}` and called with `resolveCrossProcessEmitOptions(...) ?? options` (`bus.ts:536`) — no payload, no recipient dimensions, and a resolved rather than raw scope | All five of the collapse cases in Architecture → Coalescing key are live: one recipient's, one tenant's portal, one organization's portal, or one tenant's cross-process delivery can be silently suppressed by another's |
| 2 | Eligibility rule 4 — coalesce only when the resolved interval is `> 0`, so `OM_BROADCAST_COALESCE_INTERVAL_MS=0` restores today's code path exactly | `const coalesceBrowserDelivery = isCoalescedBroadcastEvent(event)` (`bus.ts:533`), with no interval test | At `=0` the coalesced branch is still taken, so the cross-process publish still precedes inline delivery. The kill switch restores per-record delivery but not the byte-identical ordering the Edge Cases table promises |
| 3 | The test-only helper stays off the package root (BC table) | `packages/events/src/index.ts` uses `export * from './broadcast-coalescer'` | `resetBroadcastCoalescerForTests` is importable from `@open-mercato/events`, making a test helper a contract surface |
| 4 | Step 2.4 — Playwright integration coverage in `packages/core/src/modules/catalog/__integration__/` | Unit coverage only (`packages/core/src/modules/catalog/__tests__/product-broadcast-coalescing.test.ts`) | The headline guarantee — the browser is correct when the burst ends — is asserted at the bus, never end to end |
| 5 | Step 1.8 — `await flushPendingBroadcasts()` in `packages/cli/src/bin.ts` before its `process.exit(code ?? 0)` | The `beforeExit` hook only (`bus.ts:219`) | Node does not emit `beforeExit` on an explicit `process.exit()`, so every one-shot `mercato` command drops its pending browser dispatch. The trailing-flush guarantee currently covers no CLI-driven bulk write at all |

Already reconciled: the dedicated shutdown hook covering `SIGTERM`/`SIGINT`/`beforeExit` (`bus.ts:212-221`, registered unconditionally at `:254`) — necessary but, per row 5, not sufficient — the two-closure shape of Step 1.4, and both declaration-time rejections of Step 1.2 (`packages/shared/src/modules/events/factory.ts:295-309`) are built as specified.

**One item ran the other way.** The single-in-flight rule (Proposed Solution, Step 1.3, and the two new Edge Cases rows) was found by the *implementation* first, not by this document: #5896 shipped the naive re-arm-before-await version and fixed it in commit `2511662f`, whose message is the clearest statement of why the rule is load-bearing — a slow `pg_notify` still in flight when the next window fires lets the older payload land last, defeating the trailing-flush guarantee outright. The mechanism at #5896's head is correct on this point; the specification simply did not contain the requirement, so a reimplementation from this document would have reintroduced the bug. Written down here on 2026-09-09 so the durable document carries it rather than a commit message.

## 📋 Changelog

Newest first.

| Date | Change |
|------|--------|
| 2026-09-09 | Fourth specification review (#5895). Added the **single-in-flight rule** — the next window is armed only after the current dispatch settles — which the trailing-flush guarantee depends on and which this document did not previously state: #5896 had already found it the hard way (commit `2511662f`), so the spec was behind its own implementation and a reimplementation from this text would have reintroduced the race where an older payload lands last. Dropped the vestigial `lastDispatchedAt` from the module state, made the delivery-count formula an upper bound (the window self-extends under load), added the ordering regression to Step 1.3 and two Edge Cases rows, including the deliberately-accepted overlap between the shutdown flush and an in-flight dispatch. Fixed **Step 1.8**, which sent the implementer into the import-ordering constraint `packages/cli/src/bin.ts` documents twice: a root import of `@open-mercato/events` pulls `pg` through `bridge.ts` and would load the Postgres driver before `initTelemetry()`, silently costing every CLI command its instrumentation — the flush must come from the deep path `@open-mercato/events/broadcast-coalescer` or a dynamic import. Stated the observability limit and its revisit trigger rather than leaving `logger.debug` to imply coverage, and reworded the Step 2.4 coverage row that called the single-create route a bulk write. |
| 2026-09-09 | Third specification review (#5895). Replaced the resolved coalescing key with the **raw union of the scope-bearing inputs**, because mirroring resolvers had now missed a filter twice: the previous revision unioned the backoffice tap's resolution with the cross-process publish's, but the *portal* tap is a third resolution that reads scope purely from the payload, and the tap segments reach the payload only through a fallback that any `tenantId` property in `options` switches off. Two live collapses followed — a portal event whose organizations differ only in the payload while `options` carries a trusted tenant, and a portal-only event whose `options` carries a present-but-empty tenant — both added as Edge Cases rows and regression tests, alongside a presence-encoding options tenant token so `{}` and `{ tenantId: undefined }` cannot share a key. Added **Step 1.8**: `beforeExit` never fires under this repo's CLI, since `packages/cli/src/bin.ts:122` ends every returning command with an explicit `process.exit()`, so the trailing-flush guarantee covered no CLI-driven bulk write; the flush now goes beside the telemetry shutdown `bin.ts` already awaits. Corrected the claim that the cross-process publish is "unconditional" — it is gated at `bus.ts:476-480`, and the point is that all three gates pass for that shape. Renamed Step 2.4's integration file to the `TC-{CATEGORY}-{XXX}.spec.ts` form `.ai/qa/AGENTS.md:282` requires. Ordered this changelog newest-first. |
| 2026-09-09 | Specification re-review (#5895). Reworked the coalescing key again, this time into the **union** of both sinks' scope resolutions: the previous revision mirrored `normalizeAudience` alone, but the coalesced dispatch also carries the cross-process publish, which resolves scope through `resolveCrossProcessEmitOptions` — so an emit passing a present-but-empty `options.tenantId` while scoping through the payload keyed every tenant to one entry and let one tenant's burst suppress another's `pg_notify`. Added its regression test and Edge Cases row. Corrected the portal filter's dimensions (it narrows on recipient users too, and on no roles) and its citation. Stated the map bound honestly — it equals burst length for recipient-addressed events, which therefore should not opt in — and carried that into the Step 2.3 documentation requirement as a "coarse audiences only" rule. Corrected the BC row for `resetBroadcastCoalescerForTests`, which the implementation's `export *` makes root-reachable. Replaced the `Implemented` status and its ✅ compliance row with an **Implementation divergence** section enumerating the four items #5896 still owes. |
| 2026-09-06 | Specification review (#5895). Reworked the coalescing key to enumerate **all four** dimensions `matchesAudience` narrows on — recipient users and roles were missing, and portal-only events keyed to the empty string for every tenant because the key consulted trusted options only; both allowed one audience's burst to silently suppress another's. Corrected Step 1.6: the shutdown flush now registers its own unconditional hook including `beforeExit`, because the producer hook it previously named exists only on the shared-async queue path and misses the natural-exit case an `unref`'d timer creates. Reworked Step 1.4 into two closures left at their existing positions, since the tap fan-out and the cross-process publish sit on opposite sides of inline delivery and merging them would reorder every event. Added the Overview, Final Compliance Report and Changelog sections required by `.ai/specs/AGENTS.md`, integration coverage as Step 2.4, and a testing note pinning the fake-timer strategy. Fixed a citation pointing at a spec path that exists only on unmerged #5609. |
| 2026-09-04 | Initial specification, written from issue #5733 with autonomous defaults for the eight open questions recorded above. |
