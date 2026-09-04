# Execution plan — client-broadcast SSE coalescing

Source doc: `.ai/specs/2026-09-04-client-broadcast-sse-coalescing.md` (spec PR #5895)
Issue: #5733
Engine: om-auto-create-pr (steps: 10, --loop: no)

## Goal

Give the event bus opt-in coalescing of **browser** deliveries for `clientBroadcast` / `portalBroadcast` events, so a bulk writer stops paying one `pg_notify` roundtrip and one tenant-wide SSE fan-out per record, while inline subscribers, webhooks and the queue keep firing once per record.

## Scope

- `packages/shared/src/modules/events/types.ts` — one additive optional `EventDefinition` field.
- `packages/shared/src/modules/events/factory.ts` — the `isCoalescedBroadcastEvent` reader plus a declaration-time guard rejecting `crossProcessBroadcast` + coalescing.
- `packages/events/src/broadcast-coalescer.ts` — new, self-contained scheduler.
- `packages/events/src/bus.ts` — extract the two browser-facing sinks into one closure and route it through the coalescer when eligible.
- `packages/core/src/modules/catalog/events.ts` — opt the three product broadcast events in.
- Docs: `packages/events/AGENTS.md`, `apps/mercato/.env.example` (+ create-app template sync).

## Non-goals

- Migrating `progress.job.updated` off `OM_PROGRESS_BROADCAST_MIN_INTERVAL_MS`.
- Lossless batching of distinct records into a single SSE frame (would change the browser wire format).
- Re-coalescing envelopes received from other processes.
- Opting in any event outside catalog.

## Risks

- **Cross-tenant leakage via the coalescing key.** A key missing scope would let one tenant's payload be delivered in place of another's. Mitigated by building the key from trusted scope and a dedicated regression test (Step 1.5).
- **Delaying private cross-process coordination.** Coalescing a `crossProcessBroadcast` event would let another process serve stale cache. Mitigated by a declaration-time rejection (Step 1.2) and an eligibility guard.
- **Losing the tail of a burst on process exit.** Mitigated by flushing pending entries from the existing SIGTERM/SIGINT hook (Step 1.6); a hard SIGKILL still loses at most one interval.
- **Behavior drift for events that did not opt in.** Mitigated by Phase 1 shipping with zero opted-in events and a test asserting the non-opted-in emit sequence is unchanged.

## Implementation Plan

### Phase 1 — Coalescing mechanism (behavior-neutral)

- 1.1 Declare `broadcastCoalescing?: boolean` on `EventDefinition` and add the `isCoalescedBroadcastEvent` reader.
- 1.2 Reject `crossProcessBroadcast: true` + `broadcastCoalescing: true` at declaration time in `createModuleEvents`.
- 1.3 Add `packages/events/src/broadcast-coalescer.ts` (leading-edge dispatch, unconditional trailing flush, per-key isolation, deferred-error containment).
- 1.4 Wire it into `bus.emit`: extract the tap fan-out + `publishCrossProcessEvent` into one closure, route through the coalescer when eligible.
- 1.5 Build the coalescing key from trusted scope, with cross-tenant/cross-org isolation tests.
- 1.6 Flush pending broadcasts from the existing SIGTERM/SIGINT shutdown hook.
- 1.7 Resolve `OM_BROADCAST_COALESCE_INTERVAL_MS` via `parseNumberWithDefault` and document it in `.env.example` + the create-app template.

### Phase 2 — First consumers and documentation

- 2.1 Opt `catalog.product.{created,updated,deleted}` in; run `yarn generate`.
- 2.2 Bulk-writer guard test: N domain deliveries, ≪N browser dispatches, last payload wins.
- 2.3 Document the mechanism in `packages/events/AGENTS.md` and note the progress-local knob stays.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Coalescing mechanism

- [x] 1.1 Declare the field and the reader — e3b0e3754
- [x] 1.2 Reject the unsafe declaration combination — e3b0e3754
- [x] 1.3 Add the coalescer module — e3b0e3754
- [x] 1.4 Wire the coalescer into bus.emit — e3b0e3754
- [x] 1.5 Scope isolation in the coalescing key — e3b0e3754
- [x] 1.6 Shutdown flush — e3b0e3754
- [x] 1.7 Env knob and .env.example — e3b0e3754

### Phase 2: First consumers and documentation

- [x] 2.1 Opt the catalog product events in — d15ce68dd
- [x] 2.2 Bulk-writer guard test — d15ce68dd
- [x] 2.3 Documentation — d15ce68dd
