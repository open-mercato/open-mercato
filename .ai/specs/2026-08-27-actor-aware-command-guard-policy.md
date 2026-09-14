# Actor-Aware Command Guard Policy (RFC)

**Status:** draft — RFC for maintainer discussion before any implementation PR

## 📝 TLDR

Command-layer guards that reject writes based on document state (the sales shipped-line freeze,
paid-order shipment locks, status-transition locks, and their siblings across modules) currently
bind every caller identically — including trusted server-side replication from an external system
of record, which replays *facts*, not *intents*. This RFC classifies every such guard as
**structural** (an invariant that must bind every caller) or **workflow** (policy that protects an
interactive user from an unintended action), and has workflow guards consult the
`CommandRuntimeContext` every command already receives through one small, DI-overridable policy
service — so a trusted importer that explicitly claims replication (`trustedReplication` +
`syncOrigin`) can replay corrections recorded in the system of record without per-guard toggles,
per-tenant settings, or local patches. Structural guards are untouched and stay unconditional.

## 📝 Overview

The change is one shared primitive (`guard-policy` in `@open-mercato/shared/lib/commands`), one
additive context field (`trustedReplication`), one canonical sync-context builder, and a
per-module classification table adopted first by the sales module. It is inert until a module
adopts it and invisible to every HTTP caller; the behavioral delta exists only for server-side
bridges that explicitly claim replication trust.

## 📝 Problem Statement

Open Mercato deployments frequently mirror an external system of record — an ERP, an accounting
system, a legacy OMS. A recurring integration failure mode (observed in production with an ERP
nightly sync against the sales module):

> An order ships Monday. Thursday, accounting in the ERP corrects the VAT rate (or grants a
> complaint discount, or a return lowers a quantity). The nightly import diffs
> `unitPriceNet`/`taxRate`/`discountPercent`, calls `sales.orders.lines.upsert`, and gets a 409
> from the shipped-line freeze. One refused line fails the whole document write — that night and
> every night after. The mirror silently shows stale totals that disagree with the system of
> record, and nobody knows why.

The root cause is not any single guard. It is that the guard family conflates two different kinds
of rule:

- **Structural invariants** — states the system cannot represent or that break other components:
  FK integrity (`sales_shipment_items.order_line_id`), "an order must contain at least one line",
  ledger/stock math, idempotency locks. These must bind *every* caller, human or machine.
- **Workflow policy** — states that are perfectly representable but that an interactive user
  should not reach by accident: editing the price of a line that already shipped, updating a
  shipment on a fully-paid order, transitioning a claim out of order. These protect a human from
  an unintended click. A trusted importer replaying the system of record's own corrections is not
  making a mistake — the state it writes is, by definition, already true.

All guards in the family are keyed on **document state**, none on the **actor**. The command
envelope already distinguishes the actors — `CommandRuntimeContext` carries `syncOrigin`
(provenance tag set by sync bridges, threaded through side-effect suppression and loop prevention
since SPEC-045b/SPEC-046c) and `systemActor` (trusted server-side invocation, read by
auth/feature_toggles/planner/staff commands as a privilege grant) — but no state guard reads
either. Verified 2026-08-27: zero hits for `systemActor|syncOrigin` under
`packages/core/src/modules/sales/`.

### The guard survey (sales, the worst-affected module)

All inline in `packages/core/src/modules/sales/commands/{documents,shipments}.ts`:

| # | Guard | Site | Status | Class (proposed) |
|---|-------|------|--------|------------------|
| G1 | Quantity below shipped quantity | `documents.ts` `assertShippedOrderLineChangeAllowed` | 409 | workflow |
| G2 | Shipped-line price/VAT/discount/unit freeze | `documents.ts` `assertShippedOrderLineChangeAllowed` | 409 | workflow |
| G3 | Add line to fulfilled order | `documents.ts` `assertOrderAcceptsNewLine` | 409 | workflow |
| G4 | Delete line with shipment items | `documents.ts` delete path | 409 | **structural** (fronts the `sales_shipment_items.order_line_id` FK) |
| G5 | Shipment update on fully-returned order | `shipments.ts` update (`sales.shipments.fully_returned`) | 422 | workflow |
| G6 | Shipment update on fully-paid order | `shipments.ts` update | 422 | workflow |
| — | Delete last order line | `documents.ts` | 409 | structural |
| — | Quote already converted | `documents.ts` | 409 | structural (idempotency) |
| — | Customer edit blocked by order status | `documents.ts` (`SalesSettings.orderCustomerEditableStatuses`) | 400 | workflow |
| — | Address edit blocked by order status | `documentAddresses.ts` (`SalesSettings.orderAddressEditableStatuses`) | 400 | workflow |

The same family exists in other modules — status-transition guards in `warranty_claims`
(`lib/stateMachine.ts`) and `eudr` (`commands/statements.ts`, incl. an amend-window field freeze),
`staff` (`ensurePendingStatus`), and structural dependency/stock guards in `wms`, `customers`,
`catalog`, `currencies`. A mechanism scoped to sales would be re-invented per module; this RFC is
deliberately module-agnostic.

### Why the existing workarounds are all bad

Downstream deployments today choose between: carrying a local patch that deletes the guard
(removes the protection for humans too, breaks on every version bump), delete+recreate dances
(id churn observed for shipment updates on paid orders), or letting the sync fail loudly forever.
None of these is a mechanism; all of them are erosion.

## 📝 Proposed Solution

One shared primitive, three rules:

1. **Every state guard gets an identity and a class.** Each module that has guards of this family
   declares them in one reviewable table (`commands/guard-policy.ts`): a stable guard id
   (`<module>.<entity>.<slug>`) and a class, `structural | workflow`.
2. **Structural guards stay unconditional.** No code change at their throw sites. The table lists
   them anyway so the classification of the whole family is reviewable in one place.
3. **Workflow guards consult the context the command already receives.** Each workflow-guard
   throw site adds a `shouldEnforceGuard(ctx, entry)` check *after* its existing predicate has
   fired. The default policy:
   - context explicitly claims replication (`trustedReplication: true` **and** a `syncOrigin`) →
     **skip, with a structured warning log** (the guard is downgraded from a hard stop to an
     audit trail entry — replication of facts);
   - everything else — interactive HTTP callers, `systemActor` invocations (workers, CLI
     seeding), and every context that carries a `syncOrigin` *without* the explicit claim
     (echo-suppression-only bridges like the warranty-claims email intake) → **enforce**,
     byte-identical behavior to today.

The decision goes through a DI-overridable service (`commandGuardPolicyService`), mirroring the
existing `commandOptimisticLockGuardService` seam, so a deployment can tighten (enforce a given
guard even for sync — e.g. a fiscal-period lock) or loosen per guard id without forking guard
code. Resolution is **fail-closed**: if the service cannot be resolved, every guard enforces.

### The classification litmus test

> If the external system of record already contains this state, must the mirror be able to
> represent it?

Yes → the guard is **workflow** (it exists to prevent a human from *creating* that state by
accident, not to make the state unrepresentable). No — skipping the guard would produce a state
the platform itself cannot hold (FK violation, negative invariant, broken ledger) → **structural**.

Corollary for structural guards: the sync caller's fix is *write-ordering*, not bypass. G4 (delete
a line with shipment items) is the canonical example — the importer must drop the shipment items
first, then delete the line; no mechanism can (or should) make the FK vanish.

### Alternatives considered

| Option | Why it lost |
|--------|-------------|
| **Per-tenant setting per guard** (as prototyped in PR #5572, `sales_settings.orderShippedLineEditable`) | Per-guard: 6+ guards → 6+ toggles, re-invented per module. Opens post-dispatch editing to *every human in the tenant*, not just the sync — the opposite of what the guard is for. Actor-blind: it answers "may this tenant?", the real question is "may this caller?" |
| **Env var per guard** | Same per-guard sprawl, and per-deployment rather than per-tenant — coarser still. |
| **Per-role RBAC feature** ("accounting may correct") | Most expressive for *human* exceptions, but the command bus does not consult ACL features today; needs a new core seam, and does nothing for the sync (which has no role). Complementary, not competing — a deployment can layer it later via the DI override. |
| **Compensating documents** (Shopify/Medusa-style order edits: fulfilled lines are immutable, corrections are refunds/change-orders) | Correct for a platform that is the book of record. Wrong for a mirror: the ERP already recorded the correction *in place*; re-modelling it as a compensating document breaks sync idempotency and diverges the mirror's document from the source's. |
| **Local patches / delete+recreate** | Erosion, not mechanism (see above). |

### Prior art

The industry split follows the book-of-record axis. Platforms that own the order (Shopify, Medusa)
make fulfilled state immutable and model corrections as new documents — they *avoid* the problem
rather than solve it, and their answer does not transfer to a mirror. The closest analog to this
proposal is **commercetools' Import API**: trusted replication gets its own surface that
deliberately "does not duplicate the validation logic of other commercetools commerce APIs". The
ERP world (Odoo lock dates, NetSuite "Override Period Restrictions") scopes immutability by
**fiscal event + principal**, not by tenant-wide toggles — the actor-aware shape this RFC adopts.
Notably, dispatch is not what makes a document final in any of these systems; a fiscal
document/closed period is — which is exactly why "shipped" belongs in the workflow class, and why
the DI override exists for deployments that need a genuinely structural fiscal lock.

This also completes the platform's existing CQRS shape: commands carry *intents* and are
validated; replication replays *facts* — the same reasoning that already lets query-index
projections and `ctx.bulkImport` side-effect suppression treat trusted bulk callers differently.

## 📝 Architecture

### Shared contract (`packages/shared/src/lib/commands/guard-policy.ts`, new)

One additive field on the existing envelope (`packages/shared/src/lib/commands/types.ts`):

```typescript
export type CommandRuntimeContext = {
  // ...existing fields...
  /**
   * Explicit claim that this invocation replays facts already recorded in an external
   * system of record (ERP sync, import bridges). Workflow-class guards are relaxed for
   * contexts carrying this claim TOGETHER WITH a syncOrigin. Only server-side bridges
   * may set it; request-derived contexts MUST NOT. A syncOrigin without this claim keeps
   * its existing, narrower meaning (provenance + echo suppression) and relaxes nothing.
   */
  trustedReplication?: boolean
}
```

The claim is deliberately separate from `syncOrigin`: `syncOrigin` was introduced for
loop-prevention/echo-suppression and is set today by bridges that are *not* replaying a system of
record (e.g. the warranty-claims email intake replays parsed inbound email content). Inferring
replication trust from `syncOrigin` alone would retroactively grant guard bypass to every such
setter; the explicit claim keeps existing setters byte-identical.

```typescript
export type CommandActorKind = 'interactive' | 'system' | 'sync-replication'

/**
 * Derived, never stored. 'sync-replication' requires BOTH trustedReplication and a
 * syncOrigin; otherwise systemActor → 'system', else 'interactive'.
 */
export function resolveCommandActorKind(ctx: CommandRuntimeContext): CommandActorKind

export type GuardClass = 'structural' | 'workflow'

export type GuardPolicyEntry = {
  /** Stable id, `<module>.<entity>.<slug>`, e.g. 'sales.order_line.shipped_pricing_freeze' */
  id: string
  class: GuardClass
}

export type GuardVerdict = 'enforce' | 'skip'

export type CommandGuardPolicyService = {
  decide(input: { entry: GuardPolicyEntry; ctx: CommandRuntimeContext }): GuardVerdict
}

/** Default rules: structural → always enforce; workflow → skip iff actor kind is 'sync-replication'. */
export function createCommandGuardPolicyService(): CommandGuardPolicyService

/**
 * The one call guard sites make. Resolves 'commandGuardPolicyService' from ctx.container
 * (fail-closed: unresolvable → enforce). On 'skip', emits a structured warn log
 * (guardId, syncOrigin, tenantId, resource identifiers) and returns false.
 */
export function shouldEnforceGuard(ctx: CommandRuntimeContext, entry: GuardPolicyEntry): boolean

/** Table helper: freezes entries, prefixes ids with the module, rejects duplicate ids. */
export function defineGuardPolicy<K extends string>(
  module: string,
  entries: Record<K, GuardClass>,
): Record<K, GuardPolicyEntry>
```

DI: the default service registers under `commandGuardPolicyService` next to
`commandOptimisticLockGuardService` — the same "OSS floor + DI-overridable enrichment,
fail-closed" shape (`packages/shared/src/lib/crud/optimistic-lock-command.ts` is the template,
including the defensive try/catch resolver).

### Module policy table (per adopting module)

```typescript
// packages/core/src/modules/sales/commands/guard-policy.ts
import { defineGuardPolicy } from '@open-mercato/shared/lib/commands/guard-policy'

export const salesGuards = defineGuardPolicy('sales', {
  'order_line.shipped_quantity_floor': 'workflow',      // G1
  'order_line.shipped_pricing_freeze': 'workflow',      // G2
  'order.add_line_to_fulfilled': 'workflow',            // G3
  'order_line.delete_with_shipment_items': 'structural',// G4 — FK; sync fixes by write-ordering
  'shipment.update_fully_returned': 'workflow',         // G5
  'shipment.update_fully_paid': 'workflow',             // G6
  'order.customer_edit_status_lock': 'workflow',
  'order.address_edit_status_lock': 'workflow',
  'order_line.delete_last_line': 'structural',
  'quote.already_converted': 'structural',
})
```

### Guard-site diff (workflow guards only)

The existing predicate, error, i18n key, and status are untouched. Order matters: the predicate
runs first, the policy is consulted (and a skip logged) **only when the guard would actually have
fired** — otherwise every sync write would log a meaningless "skip" for guards that were never
tripped:

```typescript
// documents.ts, inside assertShippedOrderLineChangeAllowed
if (hasShippedLinePricingChange(next, previous, nextQuantity, exact)) {
  if (shouldEnforceGuard(ctx, salesGuards['order_line.shipped_pricing_freeze'])) {
    throw new CrudHttpError(409, { error: translate('sales.documents.items.errorPriceShipped', ...) })
  }
}
```

(Illustrative — the real `assertShippedOrderLineChangeAllowed` computes the quantity-floor and
pricing-freeze verdicts off shared intermediate state with a combined early return, so the sales
adoption step restructures it into per-guard verdicts before wrapping; see Phase 2 step 8.)

Structural guard sites (G4, delete-last-line, quote-converted, and every guard in the survey's
"structural" column across modules) get **no code change**.

Note: the shipped-line helpers (`assertShippedOrderLineEditable`,
`assertShippedOrderGraphRestorable`) do not currently receive `ctx`; threading it through is part
of the sales adoption step. The undo/redo graph-restore path (`restoreOrderGraph`) therefore also
becomes actor-aware, with the same semantics: an interactive undo stays guarded, a sync-context
replay is not.

### Actor derivation and the trust boundary

`trustedReplication`, `syncOrigin`, and `systemActor` are trusted **because they are unreachable
from user input**:

- The CRUD factory's context (`CrudCtx`) includes none of them, and per the `systemActor` doc
  contract HTTP request paths MUST NOT set it. This RFC adds a regression test locking that in
  (a request-derived CRUD context never carries any of the three).
- `syncOrigin` is already on the never-client-settable list
  (`.ai/specs/2026-08-12-secure-sse-probe-event-scope.md`); `trustedReplication` joins it.
- Only server-side bridges construct contexts carrying them. Note the boundary is
  *request-derived context*, not "HTTP": a webhook or intake endpoint may legitimately construct
  a bridge context server-side during a request — what matters is that trusted server code, not
  request input, decides the flags.

The three flags stay orthogonal:

| Flag | Claim | Relaxes workflow guards? |
|---|---|---|
| `systemActor` | "may act without a human principal" (privilege — auth/roles, feature toggles, planner/staff read it as such) | No |
| `syncOrigin` | "tag my writes for provenance and echo suppression" | No |
| `trustedReplication` (+ `syncOrigin`) | "I replay facts an external system of record already holds" | Yes — workflow class only |

A worker or CLI invocation without the replication claim keeps today's behavior on every guard,
as does every existing `syncOrigin` setter until it deliberately opts in.

### The canonical sync command context

Bridges currently build contexts inconsistently (`sync_excel` sets neither flag — it hits every
guard exactly like a UI user; the email intake sets both; the create-app template sync module sets
`syncOrigin` + a synthetic `auth`). This RFC canonicalizes the shape as a shared builder:

```typescript
// @open-mercato/shared/lib/commands/syncContext (new)
export function buildSyncCommandContext(input: {
  container: AwilixContainer
  scope: { tenantId: string; organizationId: string | null }
  syncOrigin: string                    // '<module>:<direction>' convention
  trustedReplication?: boolean          // default true — this builder IS the replication path
  systemActor?: boolean                 // opt-in, only when privileged writes are needed
  bulkImport?: BulkImportSuppression
}): CommandRuntimeContext
// sets syncOrigin + trustedReplication, a synthetic auth ({ sub: `system:${syncOrigin}`, ... })
// so audit logs attribute the writes, org scoping from `scope`, and systemActor only when requested
```

`sync_excel` and the create-app template migrate to it; new integrations get the correct shape
for free. Bridges that only need echo suppression (email intake) do **not** use this builder —
they keep setting `syncOrigin` directly and stay outside the replication class.

One attribution detail to pin in Phase 1: the command bus's audit enrichment keys its
system-context tag on `!actorUserId && systemActor`, and the audit service normalizes `system:*`
subjects. The builder's synthetic `sub` must produce coherent `context_json` attribution under
both the `systemActor` and non-`systemActor` variants — covered by a dedicated test rather than
left to convention.

### Observability

A skipped guard must never be invisible:

- `shouldEnforceGuard` logs every skip at `warn` via `createLogger('commands.guardPolicy')` with
  `guardId`, `syncOrigin`, `tenantId`, and the resource identifiers available at the call site.
  Because call sites consult it only after their predicate fired, every logged skip is a write
  that a workflow guard *would have rejected* — no noise from guards that never tripped.
- The command bus's audit enrichment (which already records `systemActor` in `context_json`)
  additionally records `syncOrigin` and `trustedReplication` when present — so every write that
  ran under relaxed workflow guards is identifiable in the action log after the fact. (Additive
  `context_json` keys.)

## 📝 Data Model

No schema changes. No new entities. The only persistence-adjacent change is the additive
`syncOrigin`/`trustedReplication` keys in the action log's existing `context_json` JSON column.

## 📝 API Contracts

No HTTP surface changes. Every request-derived CRUD context lacks the replication claim, so every
existing endpoint behaves byte-identically — including the 409/422 bodies of all guards. The
behavioral delta exists only for server-constructed contexts carrying
`trustedReplication` + `syncOrigin`, which no request input can produce.

Contract-surface classification (per `BACKWARD_COMPATIBILITY.md`):

| Surface | Change | Class |
|---|---|---|
| `@open-mercato/shared/lib/commands` exports | New: `guard-policy` module (types, `shouldEnforceGuard`, `defineGuardPolicy`, `resolveCommandActorKind`, `createCommandGuardPolicyService`), `syncContext` builder | ADDITIVE |
| DI names | New: `commandGuardPolicyService` | ADDITIVE |
| `CommandRuntimeContext` | One new **optional** field `trustedReplication?: boolean`; `syncOrigin`/`systemActor` unchanged | ADDITIVE (Type interface, optional field) |
| Guard behavior for HTTP callers | Unchanged, regression-tested | n/a |
| Guard behavior for existing `syncOrigin`-only contexts | Unchanged (the claim is opt-in) | n/a |
| Guard behavior for `trustedReplication` contexts | Workflow guards skip (new semantics for a new context shape) | ADDITIVE (documented) |
| Action log `context_json` | New optional `syncOrigin`/`trustedReplication` keys | ADDITIVE |

No deprecations, so no `UPGRADE_NOTES.md` entry is owed.

## 📝 Edge Cases & Failure Scenarios

- **Guard policy service unresolvable** (misconfigured DI, partial bootstrap): fail-closed —
  every guard enforces. A broken deployment gets today's behavior, never a silently open one.
- **Sync adapter without the replication claim** (today's `sync_excel`): behaves exactly as today
  — guards enforce, the run fails loudly. Safe-by-default; adopting the canonical builder is the
  fix.
- **Bridge that sets `syncOrigin` for echo suppression only** (warranty-claims email intake,
  which replays parsed inbound email content, not system-of-record facts): unchanged — without
  the explicit claim it never enters the replication class, so state-machine guards keep binding
  email-driven writes.
- **Undo of a sync-written state by an interactive admin**: the undo runs under the admin's
  interactive context, so workflow guards enforce and may block the undo (e.g. restoring a
  pre-correction price onto a shipped line). This is intentional — a human reverting replicated
  facts is exactly the accident the guard exists for; the correction belongs in the system of
  record. The 409 message the admin sees is the guard's existing message.
- **Sync lowers quantity below shipped (G1 skip)**: the mirror now represents an over-shipment /
  post-dispatch return truthfully. Consumers that derive from lines (totals recompute, the
  aggregation consumer of `2026-08-01-sales-orders-aggregation-consumer.md`) already recompute
  from current line state; no consumer asserts `quantity >= shipped`. Verified as part of the
  sales adoption step's test plan.
- **Sync deletes a line with shipment items (G4)**: still 409, by classification. The importer's
  documented fix is write-ordering (remove shipment items → delete line → reconciliation
  recreates shipments as needed).
- **Client-side mirrors of guards** (`lineItemShipmentLock.ts` strips frozen fields before
  submit): untouched — interactive UX keeps the freeze regardless of server policy, which is
  correct because the skip never applies to interactive callers anyway.
- **A deployment that needs a shipped-line freeze even for sync** (e.g. fiscal lock after
  invoicing): re-register `commandGuardPolicyService` and return `'enforce'` for the relevant
  guard ids — a pure DI swap, no guard-code fork, same pattern as the enterprise
  `record_locks` override of the optimistic-lock service.
- **Two guards, one write** (e.g. a sync upsert that trips both the pricing freeze and the
  quantity floor): each is consulted independently; skips are logged per guard id.

## 📝 Risks & Impact Review

| Risk | Severity | Mitigation | Residual |
|---|---|---|---|
| A guard is misclassified as workflow and a sync writes a state that breaks a downstream consumer | High | The litmus test + the reviewable one-table-per-module format + per-guard tests in the adoption step; classification changes are one-line diffs, easy to revert | Low — the blast radius of any single reclassification is one guard, and skips are logged |
| Silent divergence: skips happen and nobody notices a bad adapter | Medium | Warn-level structured log per skip + `syncOrigin` recorded in the action log; adapters remain responsible for their own diff correctness | Low |
| Privilege confusion: future code conflates the three flags | Medium | The flag-semantics table + doc comments + shared AGENTS.md; `resolveCommandActorKind` is the single derivation point | Low |
| An existing `syncOrigin` setter inherits guard bypass it never asked for | High | Eliminated by design: replication is a separate opt-in claim; `syncOrigin` alone relaxes nothing | Very low |
| A client finds a way to set the flags on a request-derived context | High | Already impossible by construction (`CrudCtx` lacks the fields); locked with a regression test in Phase 1 | Very low |
| Behavior drift for existing HTTP callers | High | Zero code change on structural sites; workflow sites change only behind a `syncOrigin` check; regression tests assert byte-identical 409/422 responses for interactive contexts | Very low |
| Rollback | — | Feature is inert without adopters: reverting a module's guard-policy table (or the wrap at a site) restores unconditional enforcement; the shared primitive can ship and sit unused | — |

## 📋 Phasing

- **Phase 1 — shared primitive** (independently shippable, inert until adopted): guard-policy
  module, DI registration, sync-context builder, audit `syncOrigin` enrichment, tests, docs.
- **Phase 2 — sales adoption** (first consumer, retires the known ERP-sync failure): sales guard
  table, wrap the seven workflow sites, thread `ctx` into the shipped-line helpers, tests.
- **Phase 3 — bridge alignment**: `sync_excel` + create-app template migrate to
  `buildSyncCommandContext` (template edit runs `yarn template:sync:fix` per the Template Sync
  Checklist).
- **Phase 4 — cross-module rollout** (deliberately incremental, one PR per module as need
  arises): `warranty_claims`, `eudr`, `staff` state-machine guards classified per the litmus
  test; structural families (`wms` stock/ledger, dependency blocks in `customers`/`catalog`/
  `currencies`) enter their tables as `structural` with no site changes. No module is blocked on
  another.

## 📋 Implementation Plan

### Phase 1 — shared primitive

1. `packages/shared/src/lib/commands/types.ts`: add the optional `trustedReplication` field with
   its doc contract (server-side only, requires `syncOrigin`, semantics table). Then
   `packages/shared/src/lib/commands/guard-policy.ts`: types, `resolveCommandActorKind`,
   `createCommandGuardPolicyService`, `shouldEnforceGuard` (fail-closed resolver + skip logging),
   `defineGuardPolicy`. Unit tests: default verdicts per actor kind × guard class (incl.
   `syncOrigin`-without-claim → enforce, claim-without-`syncOrigin` → enforce); fail-closed on
   unresolvable service; duplicate-id rejection; skip logging shape.
2. Register `commandGuardPolicyService` in the shared DI container next to the optimistic-lock
   guard service. Test: override via re-registration changes the verdict.
3. `packages/shared/src/lib/commands/syncContext.ts`: `buildSyncCommandContext` + unit tests
   (synthetic auth shape, `trustedReplication` default, `systemActor` opt-in, org scoping, and
   coherent action-log attribution of the synthetic `system:<origin>` sub under both
   `systemActor` variants).
4. Command-bus audit enrichment: record `ctx.syncOrigin` and `ctx.trustedReplication` in
   `context_json` when present. Test extends the existing `systemActor` enrichment test.
5. Regression test: the CRUD factory's request-derived context contains none of `syncOrigin`,
   `systemActor`, `trustedReplication`.
6. Docs: `packages/shared/AGENTS.md` row for `commands/guard-policy` + `commands/syncContext`;
   `BACKWARD_COMPATIBILITY.md` entry (table above); root AGENTS.md Task Router row pointing here.

### Phase 2 — sales adoption

7. `packages/core/src/modules/sales/commands/guard-policy.ts` with the table from Architecture.
8. Thread `ctx` into `assertShippedOrderLineEditable` / `assertShippedOrderGraphRestorable` /
   `assertShippedOrderLineChangeAllowed` / `assertOrderAcceptsNewLine` and wrap G1–G3 checks;
   wrap G5/G6 in `shipments.ts`; wrap the customer/address status locks. Note:
   `assertShippedOrderLineChangeAllowed` computes the quantity-floor and pricing-freeze verdicts
   off shared intermediate state with a combined early return — restructure it into per-guard
   verdicts (preserving the tolerance and exact-mode logic byte-for-byte, pinned by tests) before
   adding the policy checks. G4 and the other structural sites: table entries only, no code
   change.
9. Command-level tests, one pair per workflow guard: interactive context → existing 409/422
   (byte-identical body); replication context → write succeeds and the skip is logged. Plus:
   replication context on G4 → still 409; `systemActor`-only and `syncOrigin`-only contexts on
   G2 → still 409.
10. Integration coverage (API, Playwright): existing shipped-line-freeze API behavior re-asserted
    for the HTTP path (`PUT` on a shipped line still 409s) — the affected API paths are
    unchanged, and no UI paths change, so integration coverage is regression-focused.

### Phase 3 — bridge alignment

11. `sync_excel/lib/adapters/customers.ts` `buildCommandContext` → `buildSyncCommandContext`
    with `syncOrigin: 'sync_excel:inbound'`; adapter test asserts the context shape.
12. Create-app template `example_customers_sync/lib/runtime.ts` migrates to the shared builder;
    run `yarn template:sync:fix`; template harness docs updated.

### Phase 4 — cross-module rollout (follow-up PRs, per module)

13. Per module (`warranty_claims`, `eudr`, `staff`, then others as integrations demand): add
    `commands/guard-policy.ts`, classify per the litmus test, wrap only workflow sites, ship the
    same test pair per wrapped guard. Each PR is independent and references this spec.

## Resolved assumptions (defaults chosen where the source ticket left latitude)

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Only the explicit `trustedReplication` claim (with a `syncOrigin`) relaxes workflow guards; neither `systemActor` nor `syncOrigin` alone ever does | Smallest blast radius; keeps privilege, provenance, and replication trust orthogonal; workers, CLI, and every existing `syncOrigin` setter keep today's behavior |
| 2 | Skips are logged (warn + audit `context_json`), not silent | "Downgraded to a warning" semantics from the mechanism survey; divergence must be diagnosable |
| 3 | No per-tenant or RBAC layer in v1 | Both are expressible later through the DI override without touching guard sites; adding them now re-imports the per-guard-toggle sprawl this RFC rejects |
| 4 | Sales customer/address status locks are wrapped even though they already have per-tenant settings | The tenant setting answers "which humans may", the actor policy answers "is this a human" — composing them (sync skips regardless of the tenant list) matches the fact-replay semantics |
| 5 | Guard status-code normalization (400/409/422 inconsistency across the family) is out of scope | Behavior-preserving RFC; normalization is an orthogonal breaking-change discussion |
| 6 | `CommandInterceptorContext` is not widened with `syncOrigin`/`systemActor` | Guards live in handlers where full `ctx` already flows; interceptors run before `prepare` and cannot see loaded document state anyway. Widening stays available as an additive follow-up |

## Final Compliance Report

Owed at implementation time (this document is a pre-implementation RFC). Each phase's PR fills in
the checklist verdicts: contract-surface classification verified against `BACKWARD_COMPATIBILITY.md`,
byte-identical HTTP behavior regression suite green, per-guard test pairs present, docs rows added.

## Changelog

- **2026-08-27** — Initial RFC draft: problem survey (sales G1–G6 + adjacent family + cross-module
  analogs), structural-vs-workflow classification, `shouldEnforceGuard` + `commandGuardPolicyService`
  design mirroring the optimistic-lock DI seam, explicit `trustedReplication` claim (separate from
  `syncOrigin` after fresh-context review flagged the retroactive-grant hole), canonical sync
  command context, phased plan.
