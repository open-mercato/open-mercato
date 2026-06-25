# Record Locks — Unified Coverage Across CRM v2 and All OSS Lock Sites

## TLDR

**Key Points:**
- Evolve the enterprise `record_locks` module so its full experience (pessimistic locks, optimistic/action-log conflict detection, presence indicators, merge/conflict dialog) reaches **every place the OSS `updated_at` optimistic-lock guard is wired today** — starting with the CRM v2 screens that have no live locking, then fanning out module-by-module.
- Keep the existing enterprise capability set intact (no feature regression); achieve coverage with the **minimum number of integration changes** by reusing the existing widget-injection + `crudMutationGuardService` DI seam rather than rebuilding the module.

**Scope:**
- **Phase 1 — CRM v2 (deal, company, person):** make record_locks fully functional on the v2 detail screens (presence + acquire/heartbeat on load + pessimistic block + conflict/merge dialog), including the Deal screen's custom `DealForm` + custom stage/closure command endpoints which today are completely unwired.
- **Phase 2+ — one module/package per phase (customers-first), covering EVERY module with editable entities and every other OSS lock site:** customers (subforms + deletes) → sales (documents, sub-resources, config dialogs) → catalog → auth + directory + staff + resources → platform-config modules (dictionaries, currencies, workflows, feature_toggles, business_rules) → command/raw-helper/package sweep (`entities`, `planner`, `api_keys`, `integrations`, `webhooks`, `checkout`, etc.) → cross-cutting delete sweep. Every entity audited by the OSS `optimistic-lock-editable-entities.test.ts`, every direct `enforceCommandOptimisticLock` call, and every raw UI `buildOptimisticLockHeader` site gets a record_locks decision (enabled, or intentionally exempt with a documented reason).

**Concerns:**
- **Enterprise must be a strict superset of OSS safety, never a liability.** record_locks therefore *layers on* the always-on server-side OSS `updated_at` floor — it never *replaces* it. Enforcement is server-authoritative and **independent of the client widget**: removing/replacing the merge-dialog widget or editing the layout degrades UX (plain conflict bar) but can never open a no-lock hole; delegation is fail-closed to the OSS compare (S1/S5, risk register §"Widget removed / layout tampered").
- **1:1 command coverage with OSS.** OSS optimistic locking covers not just `makeCrudRoute` entities but every command-pattern write via `enforceCommandOptimisticLock` (audit update 2026-06-15: **34 direct call lines across 21 non-test files**, including `checkout` and `webhooks`). record_locks reaches them through an **additive async DI-aware seam** plus explicit call-site/wrapper migration, not by secretly changing the existing synchronous helper's behavior — Phase 6b.
- Avoiding **double conflict UX**: solved at the **surface** (one 409 shape returned; `surfaceRecordConflict` dedupes the dialog) — *not* by disabling a server guard (S3).
- The Deal screen uses a bespoke mutation pipeline (not `CrudForm.updateCrud`), so it needs more than a prop flip.
- Enterprise-only module extending OSS call sites **without** creating cross-module ORM coupling or breaking the OSS-only build: all integration flows through injection spots + DI seams, never `core → enterprise` imports.

## Overview

The enterprise `record_locks` module (`packages/enterprise/src/modules/record_locks/`, SPEC-ENT-003) provides collaborative-editing safety: a `record_locks` table tracking active pessimistic/optimistic locks, a `record_lock_conflicts` table, presence/heartbeat lifecycle APIs, action-log–based conflict detection, in-app notifications, and a 1,492-line injection widget that renders presence banners and a field-level merge dialog. It opts in automatically by injecting at three spots: `backend:record:current` (priority 600, page-load presence/acquire), `backend-mutation:global` (priority 500, custom mutation error handling), and `crud-form:*` (priority 400, form-scoped locking).

In parallel, the OSS `updated_at` optimistic-lock guard (SPEC `2026-05-25-oss-optimistic-locking`, `-05-28-coverage-completion`, `-05-29-all-crudforms`, SPEC-035 mutation-guard-mechanism) was rolled out **default-ON** across every `makeCrudRoute` entity and most CRUD UIs, with two regression guard tests (`optimistic-lock-editable-entities.test.ts`, `optimistic-lock-ui-coverage.test.ts`) enforcing coverage. The result: the platform now has **two locking systems**, and record_locks reaches only a subset of the sites the OSS guard covers.

This spec unifies them by **layering** record_locks on the OSS floor: where record_locks is enabled, the OSS `updated_at` compare still runs and record_locks can only add richer pessimistic/action-log detection plus a single conflict surface (merge dialog supersedes the conflict bar); where record_locks is disabled/absent, the OSS guard remains the behavior. CRUD coverage flows through the existing mutation-guard bridge/registry; command coverage needs a new async DI-aware seam because the current `enforceCommandOptimisticLock` helper is synchronous and has no container parameter. The rollout then extends that layered guard to every OSS lock site, CRM v2 first.

> **Market Reference**: Studied **Atlassian Jira/Confluence** (optimistic save + edit-conflict dialog + presence avatars), **Salesforce record locking** (pessimistic record lock with admin force-unlock), and **MediaWiki edit conflicts** (3-way merge view). We **adopt** their presence-indicator + last-writer-guard + field-level merge-dialog model (already implemented in record_locks). We **reject** full operational-transform / CRDT real-time co-editing (Google Docs style) as disproportionate for back-office CRUD — the existing acquire/heartbeat + action-log diff is the right altitude.

## Problem Statement

> **Correction (2026-06-09):** an earlier draft claimed "no core page renders `backend:record:current`." That is wrong. `AppShell` renders that spot **once, globally, on every backend page** (`packages/ui/src/backend/AppShell.tsx:1362`) with `context={{ path, query }}` (built at `AppShell.tsx:557`). The record_locks widget is therefore always mounted; it resolves *which* record it is on from a **hardcoded URL-path allowlist** in `resolveResourceKind`/`resolveResourceId` (`record_locks/widgets/injection/record-locking/widget.client.tsx:337-430`) — or from explicit `resourceKind`/`entityId`/`personId|companyId|dealId` context when a host supplies it. The allowlist matches exactly `/backend/customers/{people,companies,deals}/<id>` and `/backend/sales/{orders,quotes,documents}/<id>`. That — not a missing mount — is why enterprise locks already work on those screens and nowhere else. The problem statements below are restated against this mechanism.

1. **CRM v2 person/company pages have no page-load presence.** The widget's path allowlist checks `parts[2] === 'people'` / `'companies'`, but the live v2 detail pages are served from `people-v2/[id]` and `companies-v2/[id]` — so `/backend/customers/people-v2/<id>` **does not match** (`people-v2` ≠ `people/`). They pass `injectionSpotId="customers.person|company"`, so only the *save-time* `crud-form:*` widget mounts (a save conflict can surface), but the global record mount can't resolve the resource → no page-load acquire/heartbeat, no "Jane is editing this record" banner, no pessimistic pre-acquire. **Fix = supply explicit `resourceKind`/`resourceId`/`updatedAt` context to the global mount on these screens** (or add the `*-v2` routes to the resolver), not "render the spot."
2. **The Deal page shows presence but its writes are unguarded.** The deal route `/backend/customers/deals/<id>` **is** in the allowlist, so the global mount resolves `customers.deal` + id and presence/acquire **does** start. The gaps are downstream: `DealForm` (`components/detail/DealForm.tsx`) wraps `CrudForm` with a custom `useDealMutationContext`/`runMutationWithContext` pipeline and passes **no** `injectionSpotId`, so the save-time `crud-form:customers.deal` widget never mounts; and stage-change / Won-Lost closure go through **custom command endpoints** that send no lock headers and have no server-side guard. Presence is visible, yet a concurrent save or stage change can still clobber.
3. **Two parallel systems, partial overlap.** record_locks and the OSS `updated_at` guard can both produce a 409 for the same save, yielding a double conflict surface (conflict bar + merge dialog). There is no single decision point for "which guard owns this resource."
4. **Coverage gap vs. OSS.** The OSS guard is wired (and regression-tested) across customers, sales documents + sub-resource sections, catalog, settings dialogs, and delete flows. record_locks reaches only the auto-injected `crud-form:*` subset. Sites that guard at the command layer (sales document aggregates) or via raw `useGuardedMutation` are invisible to record_locks today.

## Proposed Solution

### S1 — Layered-guard model (Q1 revised: supersede the *surface*, never the server *floor*)
**Safety-first principle (revises the original "replace" decision).** record_locks must never be a *substitute* for the OSS guard — only an *enrichment* on top of it. The OSS server-side `updated_at` version check is the **always-on floor**; record_locks adds richer action-log conflict detection and better UX above it. The original Q1 ("replace via DI seam") is narrowed: record_locks supersedes the **conflict surface** (merge dialog instead of conflict bar, S3) and **augments detection**, but the server-side OSS compare is **never removed**. This guarantees that if record_locks is misconfigured, its guard throws, the resource isn't resolvable, or — critically — **the client widget was never mounted / was removed from the layout**, the mutation still hits the OSS floor and a concurrent edit still 409s. Enterprise = OSS safety **plus** more, never less. The detailed fail-safe rules are in **S5**.

record_locks already registers `crudMutationGuardService` in its `di.ts`, overriding the OSS CRUD-layer guard for all `makeCrudRoute` paths when the module is active. The CRUD guard already covers **update *and* delete** — `createRecordLockCrudMutationGuardService` maps `operation === 'delete'` → `DELETE` (`record_locks/lib/crudMutationGuardService.ts:13`) and `validateMutation` emits `record_locks.record.deleted` — so for every `makeCrudRoute`/`CrudForm` entity, delete parity already exists once the resource is enabled. **No per-entity delete work is required at the CRUD layer.**

The gap is the **command layer**, and it is bigger than a DI override. The OSS command guard is the standalone helper **`enforceCommandOptimisticLock`** (`packages/shared/src/lib/crud/optimistic-lock-command.ts`), and call sites invoke that helper directly (audit update 2026-06-15: **34 direct call lines across 21 non-test files** under `packages/core`, `packages/checkout`, and `packages/webhooks`). The companion `createCommandOptimisticLockGuardService({ resolveExpected })` factory exists but is **not registered in any `di.ts` and is resolved by nobody today**.

There is also a critical implementation constraint: `enforceCommandOptimisticLock` is **synchronous** and takes no container, while an enterprise record_locks resolver is DI-backed and async. Therefore the seam MUST NOT be implemented by silently making the existing helper async or by firing an un-awaited Promise. That would be a hidden behavior break: stale writes could continue before the enterprise check resolves.

**Recommended mechanism (revised): add an async command-guard seam and migrate call sites/wrappers to await it.**
- Keep `enforceCommandOptimisticLock(input): void` as the OSS floor helper for backward compatibility. It remains synchronous and behaves exactly as today for external callers.
- Add an additive async helper/service runner, e.g. `enforceCommandOptimisticLockWithGuards(container, input): Promise<void>` (final name during implementation), that:
  1. runs the existing OSS compare first (or delegates to the default `createCommandOptimisticLockGuardService()` behavior);
  2. resolves optional `commandOptimisticLockGuardService` from the request container;
  3. awaits enterprise enrichment when registered;
  4. fails closed to the OSS compare if the enterprise service is absent, throws, or times out.
- Migrate shared wrappers first (`enforceSalesDocumentOptimisticLock`, package route helpers), then direct command/route call sites to `await` the async seam. This is deliberate churn, but it is safer than pretending a synchronous helper can intercept async enterprise work.
- Add a command-coverage guard that fails when a new direct `enforceCommandOptimisticLock` call is added without either migrating to the async seam or documenting an OSS-only exemption.

Rejected mechanism: "make the current helper resolve DI automatically." It has no container, no request scope, and no async return contract, so it cannot safely execute record_locks logic.

**Cooperation, not replacement (the binding contract).** Today record_locks' `crudMutationGuardService` *replaces* the OSS check — `createRecordLockCrudMutationGuardService` calls `validateMutation` **only**, with no `updated_at` compare anywhere in the file (verified, 88 lines). `validateMutation` is driven by lock **tokens**, **conflict-ids**, and the action log — all supplied by the client widget — so a **tokenless** write (widget removed, plain API/CLI client) can pass a stale write through. That is a safety **regression** vs OSS and is forbidden by S5/H2. Both the CRUD override and the command seam MUST therefore be **decorators that call through to the OSS guard**, never substitutes:

```
record_locks guard (decorator)
   ├─ 1. run OSS updated_at compare (the floor — always, regardless of token/widget)
   │       └─ stale? → 409 (record_lock shape if record_locks owns the surface, else OSS shape)
   └─ 2. record_locks enabled & resolvable? → run validateMutation (pessimistic + action-log)
           └─ conflict? → record_lock_conflict 409
   (both pass → allow)
```

So record_locks can only **add** blocks, never remove the floor. The same applies to the command path through the new async seam: the OSS compare runs **unconditionally first**, then the optional record_locks `commandOptimisticLockGuardService` is awaited for enrichment. The existing synchronous helper remains the OSS floor and is not weakened.

**Enablement-switch parity.** OSS is gated by `OM_OPTIMISTIC_LOCK` (env, default ON, allowlist by `resourceKind`); record_locks enrichment is gated by tenant settings via `isRecordLockingEnabledForResource(settings, resourceKind)`. These are **layered, not alternative**: the **floor** is governed solely by `OM_OPTIMISTIC_LOCK` (so `=off` disables *all* locking, OSS and enterprise, identically — the single global kill switch); record_locks enrichment additionally requires the floor to be on **and** the resource enabled in settings. record_locks' guard MUST short-circuit to a pure floor pass-through when `OM_OPTIMISTIC_LOCK=off`, so it can never re-enable locking the operator turned off. The **operation set reaching parity is update, delete, and custom/status-transition** (status changes, conversions) — not just update.

### S2 — Reusable presence context, decoupled from CrudForm
The presence/acquire/heartbeat lifecycle must run on page load with the **real record**, independent of any form. The `backend:record:current` spot is **already mounted globally by `AppShell` (`AppShell.tsx:1362`)** — but it only receives `{ path, query }`, so the widget falls back to a hardcoded URL-path allowlist (customers people/companies/deals, sales orders/quotes/documents) and gets no `updatedAt`/record `data`.

**Core (OSS) pages cannot import enterprise**, so the fix is **context transport, not an enterprise component**. Implementation must account for the real tree shape: the AppShell spot renders **before** page `children`, so a page cannot simply pass props "up" to that existing `<InjectionSpot>`. Add a UI/core transport first:
- `AppShell` owns a `currentRecordInjectionContext` state and merges it with the base `{ path, query }` injection context passed to `backend:record:current`.
- `AppShell` provides a `BackendRecordInjectionContextProvider` / hook to page children.
- Detail pages render a small page-side publisher (or server-to-client bridge) that calls `setCurrentRecordInjectionContext(buildRecordInjectionContext({ resourceKind, resourceId, data, updatedAt, path }))` after the record loads and clears it on unmount/navigation.
- The record_locks widget reacquires/releases when that context changes. Tests must prove no stale context leaks across route transitions or rapid record switches.

This is the reusable primitive every Phase 2+ site adopts: one context object, no enterprise dependency, no second `<InjectionSpot>`. Screens whose route the allowlist already matches — deals, orders, quotes — get some presence today; they still adopt this transport to supply `updatedAt`/`data`, to cover the `*-v2` routes the heuristic misses, and to avoid a growing path-allowlist.

### S3 — Single conflict *surface* (dedupe at render, not by disabling a server guard)
The dedupe that prevents a double conflict UX happens at the **rendering layer**, never by switching off a server check. The server emits **one** 409 shape per request (record_locks short-circuits and returns `record_lock_conflict` when it owns the resource and resolves a conflict; otherwise the OSS `optimistic_lock_conflict` is returned by the floor). On the client, `surfaceRecordConflict(err, t)` **defers** to the merge dialog when a `record_lock_conflict` payload is present, else renders the OSS conflict bar. **Key safety property:** if the merge-dialog widget is absent (removed/overridden), `surfaceRecordConflict` still renders the OSS conflict bar for *any* 409 — so a conflict is always surfaced to the user; the worst case is plainer UX, never a silently-swallowed conflict. Where record_locks is disabled, behavior is exactly as OSS today.

### S4 — Module-by-module rollout using S2 + S1
Every OSS lock site is converted by (a) ensuring its resource is record-lock enabled, (b) supplying page-load record context to the global `backend:record:current` mount where a presence experience is wanted (S2), and (c) confirming its write path flows through either the CRUD guard (auto) or the command guard seam (S1). The OSS regression guard tests are extended with a parallel **record_locks coverage** assertion (CRUD *and* command layer) so new sites can't silently skip locking.

### S5 — Hardening: enterprise locking is a strict superset of OSS safety
The whole point of an enterprise feature is to be **safer**, never a liability. record_locks must satisfy every rule below; each is testable.

- **H1 — Server-authoritative, widget-independent enforcement.** Conflict *prevention* lives entirely server-side in the guard service (`crudMutationGuardService`) and the async command-guard seam. It MUST NOT depend on any client widget having mounted, acquired a lock, or sent record-lock headers. The `backend:record:current` / `crud-form:*` / merge-dialog widget provides **UX only** (presence banner, heartbeat, field-level merge). Unmounting it degrades UX; it can never open a write hole.
- **H2 — OSS floor never removed (defense in depth).** When record_locks is active and resolves a conflict → return `record_lock_conflict`. When record_locks is active but **cannot resolve** (no acquired lock / no client token / no action-log base — e.g. widget absent, or a non-widget API client) → the guard MUST **fall through to the OSS `updated_at` compare**, never pass the write through. The server derives the expected version from authoritative state it already holds (`resolveExpected` reads the latest action log; the record's own `updated_at` is the ultimate base), so it can always run *at least* the OSS check without any client cooperation beyond the version header CrudForm/commands already send.
- **H3 — Fail-closed delegation.** The async command seam / `crudMutationGuardService` delegation to record_locks MUST be wrapped so that if the record_locks service is unregistered, throws, or times out, control **falls back to the OSS compare** — never to "skip the guard." A broken enterprise guard degrades to OSS protection, not to zero. (Mirrors the existing fail-closed contract for interceptors.)
- **H4 — Layout/registration tamper resilience.** Because the widget is mounted by `AppShell` and is reachable by component-replacement / custom layouts, the design assumes it **can** be removed or replaced by a third party. Server protection is unaffected by H1–H3. A regression test MUST prove it: with the record-lock **widget unmounted**, two concurrent edits to the same record still produce a server 409 (OSS floor), and with the widget present they produce the `record_lock_conflict` + merge dialog. Removing the widget changes only which surface renders.
- **H5 — Pessimistic lock is advisory UX, never the sole gate.** The pessimistic "someone is editing" block is a courtesy to reduce collisions; the **authoritative** gate is the optimistic version/action-log check on write. A failed/absent/expired pessimistic acquire (heartbeat death, force-release, widget gone) therefore can never let a stale write land — the write-time check still runs server-side.
- **H6 — No new bypass vs OSS.** Anything OSS guards today (every `makeCrudRoute` entity + every `enforceCommandOptimisticLock` site) MUST remain guarded with record_locks active. The coverage guard tests (CRUD + command parity lists, Phase 6b/7) fail if a site that was OSS-protected loses protection under record_locks. `OM_OPTIMISTIC_LOCK=off` remains the only intentional disable, and it disables **both** layers identically.

### Design Decisions
| Decision | Rationale |
|----------|-----------|
| Reuse `crudMutationGuardService` + add an async command-guard seam | Preserves the OSS floor while allowing enterprise enrichment to be awaited safely; avoids hidden async behavior changes in the legacy helper (S1) |
| Presence context = AppShell-owned context transport feeding the global injection mount, not an enterprise component import | Keeps `core` build enterprise-free; honors module isolation; works with the real AppShell-before-children tree shape (S2) |
| **Layered guard (OSS floor always on) + single *surface*** — not replace | Eliminates double-409 UX **without** ever creating a no-lock hole; enterprise ⊇ OSS safety (S1/S3/S5) |
| Server-authoritative enforcement; widget is UX-only | Removing/replacing the widget degrades UX, never protection (H1/H4) |
| Fail-closed delegation to record_locks | A broken/absent enterprise guard degrades to OSS protection, never to zero (H3) |
| No new tables / no schema change | record_locks entities already model everything; lowers migration risk |
| `disableOptimisticLock` stays the per-form escape hatch | Sites guarded at command layer keep suppressing the CRUD-layer header as today |

### Alternatives Considered
| Alternative | Why Rejected |
|-------------|-------------|
| Rebuild record_locks to consume `updated_at` instead of action logs | Discards richer field-level diff + presence; large rewrite for no user gain |
| Make core pages import an enterprise `<RecordLockMount>` component | Breaks OSS-only build + module isolation (`core → enterprise` forbidden) |
| Coexistence with de-dup heuristics | Fragile; two 409 shapes, two surfaces, ordering-dependent UX |

## User Stories / Use Cases
- **A sales rep** editing a Deal **sees a banner** when a colleague opens the same Deal, so they avoid clobbering each other.
- **A CRM manager** who changes a Deal's stage while someone else edited it **gets a merge dialog** (accept incoming / keep mine) instead of a silent overwrite.
- **An admin** can **force-release** a stale lock on any company/person/deal (existing `record_locks.force_release` feature) from the presence banner.
- **A developer** adding a new detail screen publishes **one record context** to the AppShell-owned injection spot and gets presence + conflict handling for free.

## Architecture

### Guard layering (per resource, evaluated server-side — chain, never replace)
```
Mutation request (CRUD route OR command endpoint)
        │
        ▼
 OM_OPTIMISTIC_LOCK = off ? ── yes ──▶ proceed (single global kill switch; OSS + enterprise both off)
        │ no
        ▼
 [FLOOR — ALWAYS RUNS]  OSS updated_at compare           ← independent of any client widget / token
        │
  stale? ── yes ──▶ 409  (record_lock shape if record_locks owns the surface, else optimistic_lock_conflict)
        │ no
        ▼
 record_locks enabled for resourceKind (settings) ? ── no ──▶ proceed
        │ yes
        ▼
 [ENRICHMENT]  record_locks.validateMutation (pessimistic lock + action-log diff)   ← fail-closed: throws ⇒ treat as floor-pass
        │
  conflict / locked? ── yes ──▶ 409 record_lock_conflict (+ conflict payload)
        │ no
        ▼
      proceed
```
The enterprise guard is a **decorator** around the OSS floor: the floor runs on every request regardless of widget/token state; record_locks can only **add** a 409. Removing the widget, an unregistered/throwing enterprise service, or a tokenless API client all degrade to *at least* OSS protection — never to zero (S5/H1–H3).

### Client context + conflict resolution (per detail screen)
```
AppShell renders the existing global:
  <InjectionSpot spotId="backend:record:current" context={base + currentRecordContext} />
        ▲
Detail page publishes:
  setCurrentRecordInjectionContext(buildRecordInjectionContext({...}))
        │ (enterprise widget injected globally, pri 600)
        ▼
  acquire → presence banner + heartbeat loop
        │
  on save 409 (record_lock_conflict) → widget merge dialog (accept incoming / keep mine / keep editing)
        │
  surfaceRecordConflict(err, t) defers when record_locks payload present (single surface)
```

### Resource-kind resolution
The widget's existing `resolveResourceKind(context)` already supports `context.resourceKind`, `personId`/`companyId`/`dealId`, `entityId` with `:`, and `/backend/customers/{people|companies|deals}/…` path fallbacks. Phase 1 guarantees `resourceKind` + `resourceId` are **explicit** in the AppShell-published injection context for all three screens (no reliance on path heuristics).

### Commands & Events (existing — reused, not redefined)
- **Commands**: `record_locks.conflict.accept_incoming`, `record_locks.conflict.accept_mine`.
- **Events**: `record_locks.lock.acquired|released|force_released|contended`, `record_locks.participant.joined|left`, `record_locks.conflict.detected|resolved`, `record_locks.record.deleted`, `record_locks.incoming_changes.available`.
- **Deal command endpoints** (stage change, closure) accept the existing `x-om-record-lock-*` headers; no new event/command IDs are introduced.

## Data Models
**No schema changes.** Phase work reuses existing entities:
- `RecordLock` (`record_locks` table) — id, resource_kind, resource_id, token, strategy, status, locked_by_user_id, locked_at, last_heartbeat_at, expires_at, released_*, tenant_id, organization_id, base_action_log_id, timestamps.
- `RecordLockConflict` (`record_lock_conflicts` table) — conflict lifecycle, resolution, base/incoming action-log ids.

All CRM v2 entities already expose `updated_at` (camel + snake in API responses), satisfying both the OSS guard fallback and the action-log base resolution.

## API Contracts
**No new HTTP endpoints.** Reuse existing `/api/record_locks/{acquire|heartbeat|release|validate|force-release|settings}`. New behavior is server-side guard wiring plus UI context transport:
- Deal custom command endpoints (stage-change, closure) — read `x-om-record-lock-*` (and OSS `x-om-ext-optimistic-lock-expected-updated-at`) headers and route through the command guard seam; on conflict return the same `409` shapes already defined (`record_lock_conflict` when record_locks active, else `optimistic_lock_conflict`).
- Add an exported async command-guard helper/service runner (name finalized during implementation) while keeping `enforceCommandOptimisticLock(input): void` unchanged.
- `commandOptimisticLockGuardService` — enterprise registers a DI service that derives the expected base from the latest action log for the resource (parity with `validateMutation`) and is awaited by the async seam.

## Internationalization (i18n)
- Reuse existing record_locks i18n keys (presence, conflict dialog, force-release) in en/de/es/pl.
- Any new banner/affordance strings added in core detail screens route through `useT('customers.*')` / framework keys; no hardcoded user-facing strings. Internal-only `throw`/`toast` prefixed `[internal]`.

## UI/UX
- **Presence banner**: existing record_locks widget banner, mounted via `backend:record:current` on each CRM v2 screen (header zone). Uses semantic status tokens + `StatusBadge`/`Alert` primitives (no hardcoded colors).
- **Merge dialog**: existing widget dialog (field-level `ChangedFieldsTable`, "Accept incoming" / "Keep my changes" / "Keep editing"), `Cmd/Ctrl+Enter` submit, `Escape` cancel.
- **Deal**: banner in `detail:customers.deal:header` zone via the standardized mount; stage-change/closure controls surface the merge dialog on 409.
- **Boy Scout**: any touched lines on v2 pages migrated to semantic tokens / shared primitives.

## Implementation Plan

> Each step results in a working, testable app. **Phase 0 is a hard prerequisite for every other phase** — it makes the two systems cooperate so no later phase can introduce a no-lock hole. Phase 1 ships the full CRM v2 experience; Phase 2+ adds one module/lock-site per phase (customers-first per Q4).

### Phase 0 — Foundational: make OSS + record_locks cooperate (prerequisite, ship before any rollout)
This phase has **no per-module work** — it hardens the two shared chokepoints so that enabling record_locks for any resource in later phases is safe by construction.
1. **CRUD guard chaining.** Refactor `createRecordLockCrudMutationGuardService` (`packages/enterprise/src/modules/record_locks/lib/crudMutationGuardService.ts`) into a **decorator** that (a) first runs the OSS `updated_at` compare (resolve/call the default OSS `crudMutationGuardService` it overrides, or the shared OSS compare directly), and (b) then runs `validateMutation`. record_locks may only **add** a 409, never skip the OSS floor. Today it calls `validateMutation` only — this is the fix for the H2 regression.
2. **Command seam without hidden async breakage.** Implement S1's revised option in `packages/shared/src/lib/crud/optimistic-lock-command.ts`: keep `enforceCommandOptimisticLock(input): void` as the legacy synchronous OSS helper, and add an async DI-aware helper/service runner (final name during implementation, e.g. `enforceCommandOptimisticLockWithGuards(container, input): Promise<void>`). The async seam runs the OSS compare **unconditionally first**, resolves optional `commandOptimisticLockGuardService` from the request container, awaits enrichment, and wraps enterprise delegation **fail-closed** (try/catch/timeout → OSS-only). record_locks registers that service in its `di.ts`; command call sites/wrappers migrate to `await` the new seam.
3. **Enablement parity.** Gate the floor on `OM_OPTIMISTIC_LOCK` (unchanged); make record_locks' guard short-circuit to a pure floor pass-through when `OM_OPTIMISTIC_LOCK=off`, and require both env-on **and** `isRecordLockingEnabledForResource` for enrichment. One global kill switch; no asymmetry.
4. **Server-authoritative base resolution.** Ensure record_locks' `resolveExpected` / `validateMutation` derive the expected version from authoritative server state (latest action log; the record's own `updated_at`) and never *require* a client lock token to detect a stale write — the floor (step 1/2) already guarantees detection, but record_locks' own path must not silently pass tokenless writes either.
5. **Presence context transport.** Add the AppShell-owned provider/publisher described in S2, then move page work to "publish context" instead of "render another `backend:record:current` spot." Include cleanup on unmount/path change and a stale-context regression test.
6. **Fail-safe regression tests (H1–H4):** (a) record_locks enabled + **widget unmounted** → two concurrent edits still 409 (proves server floor, H1/H4); (b) record_locks service **throws** → mutation degrades to OSS 409, not pass-through (H3); (c) `OM_OPTIMISTIC_LOCK=off` → both layers off (parity); (d) tokenless API client → stale write still 409; (e) a migrated command call awaits the async seam before mutating, while an intentionally legacy direct helper remains OSS-only and is reported by the coverage guard.

### Phase 1 — CRM v2 (deal, company, person): full locking
1. **Core: standardized presence context.** Use the Phase-0 AppShell provider/publisher + `buildRecordInjectionContext(...)` helper (UI/core) on `people-v2/[id]/page.tsx`, `companies-v2/[id]/page.tsx`, and `deals/[id]/page.tsx`, with explicit `resourceKind` (`customers.person|company|deal`), `resourceId`, `updatedAt`, record `data`, and `path`. Do not render a second `backend:record:current` spot.
2. **Core: Deal form injection.** Pass `injectionSpotId="customers.deal"` (and resource/version context) from `DealForm` to its embedded `CrudForm` so the `crud-form:customers.deal` widget mounts with a resolvable resource.
3. **Core: Deal command headers.** Wrap stage-change and Won/Lost closure calls (`useDealPipeline` / `useDealClosure`) in `withScopedApiRequestHeaders(buildOptimisticLockHeader(dealUpdatedAt), …)` and route 409s through `surfaceRecordConflict(err, t, { onRefresh })`.
4. **Core: Deal command server guard.** Guard the deal stage-change/closure command handlers with the async command seam (parity with sales `enforceSalesDocumentOptimisticLock` after that wrapper migrates), reading the lock headers; default OSS behavior preserved when record_locks disabled.
5. **Enterprise: command guard service.** Register `commandOptimisticLockGuardService` with a `resolveExpected` backed by the action log, scoped to enabled resources, so migrated command endpoints defer to record_locks conflict detection through the async seam (S1).
6. **Enterprise/UI: unified conflict surface.** Teach `surfaceRecordConflict` to defer when a `record_lock_conflict` payload is present so only the merge dialog shows (S3); verify `crudMutationGuardService` override already covers the three CRUD routes.
7. **Tests:** integration TC-LOCK-CRM-{person,company,deal} (presence on load, contended lock, save conflict → merge dialog, force-release); unit tests for the command guard seam + `surfaceRecordConflict` deferral.
8. **i18n + DS pass** on all touched screens.

> **Module coverage contract:** Phases 2–6 must collectively cover **every module audited by `optimistic-lock-editable-entities.test.ts`** — `customers`, `sales`, `catalog`, `auth`, `directory`, `staff`, `resources`, `dictionaries`, `currencies`, `workflows`, `feature_toggles`, `business_rules` — plus any module added to that audit after this spec. Each entity ends in one of two states: **record-lock enabled** (presence + unified guard) or **intentionally exempt** (append-only logs, junction/assignment rows, sub-resources guarded by a parent aggregate, state-machine rows) with a one-line reason in the coverage guard test.

> **How to read the per-phase manifests below.** Each phase lists the exact sites to touch, grouped by the three kinds of work this spec defines:
> - **Presence context** — the `backend:record:current` spot is **already mounted globally by `AppShell` (`AppShell.tsx:1362`) on every backend page**, but with only `{ path, query }` context, so the record_locks widget resolves the record from a **hardcoded URL-path allowlist** (`/backend/customers/{people,companies,deals}/<id>`, `/backend/sales/{orders,quotes,documents}/<id>`) or from explicit context a host passes. The per-screen work below labelled "presence mount" therefore means **publish explicit page-load context** — `resourceKind`, `resourceId`, `updatedAt`, record `data` — to the AppShell-owned global mount (S2) for screens the heuristic doesn't recognize: **every module beyond customers/sales, the `*-v2` routes, and any custom command pipeline**. It is *not* about adding a second `<InjectionSpot>`. **Subforms inherit** the parent screen's context — they never supply their own.
> - **Guard wiring** — ensure the write path runs the unified guard: `<CrudForm>` hosts and `makeCrudRoute` entities are **auto-covered** by `crudMutationGuardService` once the resource is record-lock enabled; **custom** mutation paths (raw `apiCall`, `useGuardedMutation`, command/action endpoints) need the header on the client and the command-guard seam (S1) on the server, then route their 409 to the merge dialog via `surfaceRecordConflict` (S3).
> - **Decision** — every audited entity ends **enabled** (presence + unified guard) or **exempt** (documented reason). Junction/assignment add-remove, reorder/position writes, append-only logs, derived documents, and sub-resource lines guarded by a parent aggregate are the standard exempt classes.
>
> Paths are relative to repo root. `entityId` is the `makeCrudRoute` `indexer.entityType` (also the `crud-form:<entityId>` spot suffix). `resourceKind` is the `record_locks` resource key (`<module>.<entity>`).

### Phase 2 — Customers: subforms, links, config entities, deletes (customers-first)

Phase 1 already mounts presence and guards the header/commands on the three CRM v2 screens. Phase 2 finishes the module: the subforms those screens embed, the link/role/config entities, and every delete.

**Presence mounts:** none new — all customers subforms render inside the Phase-1 person/company/deal detail screens and inherit their `backend:record:current` mount. (Legacy v1 pages `backend/customers/people/[id]/page.tsx` and `companies/[id]/page.tsx` use custom inline `savePerson`/`saveCompany` writes that already send the OSS header; decide per Q whether to retire them or mount presence — default: **retire-track, no new mount** since v2 supersedes them.)

**Guard wiring (custom write paths — already flow through `runMutationWithContext`; add the merge-dialog surface + confirm the command guard covers the entity):**
- **Activities / interactions** — UI `components/detail/ActivitiesSection.tsx`, `ActivityForm.tsx`, `ActivityDialog.tsx`, `ScheduleActivityDialog.tsx`; commands `commands/interactions.ts`, `commands/activities.ts`; routes `api/interactions/route.ts`, `api/activities/route.ts`. State-action endpoints `api/interactions/complete/route.ts`, `api/interactions/cancel/route.ts`, `api/interactions/[id]/visibility/route.ts` are **status transitions** → guard via the command seam or mark exempt (state-machine).
- **Tasks / todos** — `components/detail/TasksSection.tsx`, `TaskForm.tsx`, `TaskDialog.tsx`; command `commands/todos.ts`; route `api/todos/route.ts`.
- **Notes** — `components/detail/notesAdapter.ts`; command `commands/comments.ts`; route `api/comments/route.ts`.
- **Addresses** — `components/detail/AddressesSection.tsx`; command `commands/addresses.ts`; route `api/addresses/route.ts`.

**Links & roles (mostly exempt; only role *attribute* edits guard against the parent entity version):**
- `components/detail/PersonCompaniesSection.tsx`, `CompanyPeopleSection.tsx`, `RolesSection.tsx`, `RoleAssignmentRow.tsx`, `AssignRoleDialog.tsx`, `DealLinkedEntitiesTab.tsx`; commands `commands/personCompanyLinks.ts`, `commands/entity-roles.ts`; routes `api/people/[id]/companies/route.ts`, `api/companies/[id]/people/route.ts`, `api/people/[id]/roles/route.ts`, `api/companies/[id]/roles/route.ts`, `api/deals/[id]/people/route.ts`, `api/deals/[id]/companies/route.ts`.
- Bulk endpoints `api/deals/bulk-update-stage/route.ts`, `api/deals/bulk-update-owner/route.ts` — multi-row writes: apply per-row skip-if-changed or mark exempt with a documented bulk policy.

**Config entities (auto-covered by CRUD guard once enabled; assignment writes exempt):**
- Tags `customers:customer_tag` — `commands/tags.ts`, `api/tags/route.ts`, UI `ManageTagsDialog.tsx`/`EntityTagsDialog.tsx`; `api/tags/assign|unassign` = junction (exempt).
- Labels `customers:customer_label` — `commands/labels.ts`, custom `api/labels/route.ts` (already uses `validateCrudMutationGuard`) + `api/labels/assign|unassign` (exempt).
- Pipelines `customers:customer_pipeline` — `commands/pipelines.ts`, `api/pipelines/route.ts`.
- Pipeline stages `customers:customer_pipeline_stage` — `commands/pipeline-stages.ts`, `api/pipeline-stages/route.ts`; `api/pipeline-stages/reorder/route.ts` = position write (exempt).

**Deletes:** person/company/deal deletes already send the header (Phase 1); confirm activity/task/address/note deletes surface the `record_locks.record.deleted` conflict state.

| Site | Files | entityId / command | Work | Decision |
|------|-------|--------------------|------|----------|
| Activities/interactions | `components/detail/ActivitiesSection.tsx`,`ActivityForm.tsx`; `commands/interactions.ts`,`activities.ts`; `api/interactions/route.ts`,`api/activities/route.ts` | `customers:customer_interaction` / `customers:customer_activity` | merge-dialog surface; status endpoints via command seam | enabled (status txn exempt) |
| Tasks | `components/detail/TasksSection.tsx`,`TaskForm.tsx`; `commands/todos.ts`; `api/todos/route.ts` | `customers:customer_todo_link` | merge-dialog surface | enabled |
| Notes | `components/detail/notesAdapter.ts`; `commands/comments.ts`; `api/comments/route.ts` | `customers:customer_comment` | merge-dialog surface | enabled |
| Addresses | `components/detail/AddressesSection.tsx`; `commands/addresses.ts`; `api/addresses/route.ts` | `customers:customer_address` | merge-dialog surface | enabled |
| Person↔company links / roles | `PersonCompaniesSection.tsx`,`CompanyPeopleSection.tsx`,`RolesSection.tsx`; `commands/personCompanyLinks.ts`,`entity-roles.ts` | role assignment routes | role-attribute edits guard vs parent | exempt (link add/remove); enabled (role fields) |
| Tags / Labels | `commands/tags.ts`,`labels.ts`; `api/tags/route.ts`,`api/labels/route.ts` | `customers:customer_tag`,`customers:customer_label` | enable on entity edit | enabled; assignment exempt |
| Pipelines / stages | `commands/pipelines.ts`,`pipeline-stages.ts`; `api/pipelines/route.ts`,`api/pipeline-stages/route.ts` | `customers:customer_pipeline`,`customers:customer_pipeline_stage` | reorder exempt | enabled; reorder exempt |

Extend the record_locks coverage guard assertion for `customers`; integration TC-LOCK-CUST-{activities,tasks,notes,tags,pipeline}.

### Phase 3 — Sales: documents, sub-resources, config dialogs, deletes

Sales is command-pattern, not `CrudForm`. The order/quote aggregate version is already enforced for most writes by `enforceSalesDocumentOptimisticLock` (in `packages/core/src/modules/sales/commands/shared.ts`, with `SALES_RESOURCE_KIND_ORDER='sales.order'` / `SALES_RESOURCE_KIND_QUOTE='sales.quote'`). The work is (a) migrate that wrapper to await the async record_locks command guard seam (S1), (b) publish presence context from the document screen, and (c) **close the two verified command-guard gaps**.

**Presence context:**
- `backend/sales/documents/[id]/page.tsx` (the shared order/quote detail host; `orders/[id]/page.tsx` and `quotes/[id]/page.tsx` delegate to it) — publish AppShell record context with `resourceKind` `sales.order`/`sales.quote` resolved from the document kind, `resourceId` = document id, `updatedAt`, and document `data`. Sub-resource sections (`components/documents/ItemsSection.tsx`, `AdjustmentsSection.tsx`, `PaymentsSection.tsx`, `ShipmentsSection.tsx`, `ReturnsSection.tsx`) inherit it.

**Guard wiring:**
- Bridge `enforceSalesDocumentOptimisticLock` → the async command seam (S1) so the aggregate check awaits record_locks' action-log diff when the resource is enabled. Already-guarded commands (verified): `commands/documents.ts` (quotes.update, quote→order convert, order/quote line upsert+delete, order/quote adjustment upsert+delete) and `commands/returns.ts` (return create).
- **Gap A — `commands/payments.ts`:** verified **zero** `enforceSalesDocumentOptimisticLock` calls. Wrap payment create/update/delete to guard the parent order's aggregate version.
- **Gap B — `commands/shipments.ts`:** verified **zero** calls. Wrap shipment create/update/delete to guard the parent order.
- **Confirm** `sales.orders.update` header update and derived `invoices`/`credit_memos` writes guard the parent; if a header path is unguarded, add it (or document derived docs as exempt).
- Sub-resource section components already build the OSS lock header on their custom `apiCall` writes (`components/documents/optimisticLock.tsx` `handleSectionMutationError`); ensure their 409 routes to the merge dialog under S3.

**Config dialogs (auto-covered `makeCrudRoute`; add no presence — they are list/dialog editors, not detail screens):**
- Channels `sales:sales_channel` (`api/channels/route.ts`; `components/channels/*`), payment methods `sales:sales_payment_method` (`api/payment-methods/route.ts`), shipping methods `sales:sales_shipping_method` (`api/shipping-methods/route.ts`), tax rates `sales:sales_tax_rate` (`api/tax-rates/route.ts`), delivery windows `sales:sales_delivery_window`, order/payment/shipment statuses + adjustment kinds (status-config routes). Enable record_locks on the three audited config entities (`SalesChannel`, `SalesPaymentMethod`, `SalesShippingMethod`); the rest are small single-admin config — **enable or exempt with reason** per the coverage guard.

| Site | Files | entityId / resourceKind | Work | Decision |
|------|-------|-------------------------|------|----------|
| Order/Quote document | `backend/sales/documents/[id]/page.tsx`; `commands/shared.ts`,`documents.ts` | `sales.order` / `sales.quote` | presence mount + S1 seam bridge | enabled |
| Lines / adjustments | `components/documents/ItemsSection.tsx`,`AdjustmentsSection.tsx`; `commands/documents.ts` | aggregate-guarded | route 409 → merge dialog | enabled (via parent aggregate) |
| Payments | `components/documents/PaymentsSection.tsx`; `commands/payments.ts` | parent `sales.order` | **add aggregate guard (Gap A)** | enabled |
| Shipments | `components/documents/ShipmentsSection.tsx`; `commands/shipments.ts` | parent `sales.order` | **add aggregate guard (Gap B)** | enabled |
| Returns | `components/documents/ReturnsSection.tsx`; `commands/returns.ts` | parent `sales.order` | route 409 → merge dialog | enabled |
| Invoices / credit memos | `commands/documents.ts` | derived | confirm parent guard | exempt (derived) or enabled |
| Config dialogs | `api/channels|payment-methods|shipping-methods|tax-rates/route.ts`; `components/*Settings.tsx` | `sales:sales_channel`/`…payment_method`/`…shipping_method` | enable on CRUD route | enabled; status enums exempt |

Extend coverage guard for `sales`; integration TC-LOCK-SALES-{order,quote,payment,shipment,channel}.

### Phase 4 — Catalog

`CrudForm`-hosted (auto-covered) entities plus one custom dialog editor and a bulk-delete worker.

**Presence mounts (top-level detail/edit screens):**
- Product — `backend/catalog/products/[id]/page.tsx` (already `crud-form:catalog.product`; add `backend:record:current`).
- Variant — `backend/catalog/products/[productId]/variants/[variantId]/page.tsx` (+ create page); **also add missing `injectionSpotId`** so `crud-form:catalog.variant` mounts.
- Category — `backend/catalog/categories/[id]/edit/page.tsx` (+ create); **add missing `injectionSpotId`** for `crud-form:catalog.product_category`.

**Guard wiring:**
- Auto-covered `makeCrudRoute` entities: products `catalog:catalog_product` (`api/products/route.ts`), variants `catalog:catalog_product_variant` (`api/variants/route.ts`), categories `catalog:catalog_product_category` (`api/categories/route.ts`), prices `catalog:catalog_product_price` (`api/prices/route.ts`), offers `catalog:catalog_offer` (`api/offers/route.ts`), price kinds `catalog:catalog_price_kind` (`api/price-kinds/route.ts`), option-schema templates `catalog:catalog_option_schema_template` (`api/option-schemas/route.ts`).
- **Custom dialog (not CrudForm):** `components/PriceKindSettings.tsx` — Dialog + raw `apiCall` POST/PUT/DELETE to `/api/catalog/price-kinds`. Ensure it sends the lock header and routes its 409 to the merge dialog.
- **Custom routes:** `api/bulk-delete/route.ts` (+ worker `workers/catalog-product-bulk-delete.ts`, `lib/bulkDelete.ts`) and `api/product-media/route.ts` — neither uses the CRUD guard contract today. Bulk delete loops `catalog.products.delete` per item: apply per-item skip-if-changed or document bulk exemption; media upload/delete = attachment side-table (exempt).

**Prices / offers / option-schemas** have no dedicated detail screen (managed inline in the product/variant forms or API-only): presence is inherited from the product screen; the entity itself stays record-lock enabled at the CRUD route.

| Site | Files | entityId | Work | Decision |
|------|-------|----------|------|----------|
| Product | `backend/catalog/products/[id]/page.tsx`; `api/products/route.ts` | `catalog:catalog_product` | presence mount | enabled |
| Variant | `backend/catalog/products/[productId]/variants/[variantId]/page.tsx`; `api/variants/route.ts` | `catalog:catalog_product_variant` | presence + add `injectionSpotId` | enabled |
| Category | `backend/catalog/categories/[id]/edit/page.tsx`; `api/categories/route.ts` | `catalog:catalog_product_category` | presence + add `injectionSpotId` | enabled |
| Price kinds | `components/PriceKindSettings.tsx`; `api/price-kinds/route.ts` | `catalog:catalog_price_kind` | header on custom dialog + 409 surface | enabled |
| Prices / offers / option schemas | `api/prices|offers|option-schemas/route.ts` | `catalog:catalog_product_price`/`…offer`/`…option_schema_template` | inherit product presence | enabled |
| Bulk delete / media | `api/bulk-delete/route.ts`,`api/product-media/route.ts` | — | per-item skip-if-changed | exempt (bulk/side-table) |

Extend coverage guard for `catalog`; integration TC-LOCK-CAT-{product,variant,category,price-kind}.

### Phase 5 — Identity & org modules: auth, directory, staff, resources

All four are `CrudForm`-hosted (directly or via thin wrappers) and auto-covered by the CRUD guard. Work is presence mounts on the edit screens + confirming custom action endpoints.

**auth** — User `auth:user` (`backend/users/[id]/edit/page.tsx`, `api/users/route.ts`), Role `auth:role` (`backend/roles/[id]/edit/page.tsx`, `api/roles/route.ts`). Presence mount on both edit pages. **Custom:** `api/users/acl/route.ts`, `api/roles/acl/route.ts` carry their **own** `updatedAt` versioning — keep separate (do not double-lock); `resend-invite`/`consents` = no entity mutation (exempt).

**directory** — Organization `directory:organization` (`backend/directory/organizations/[id]/edit/page.tsx`, `api/organizations/route.ts`), Tenant `directory:tenant` (`backend/directory/tenants/[id]/edit/page.tsx`, `api/tenants/route.ts`). Presence mounts; `organization-switcher` = UX state (exempt).

**staff** — Team `staff:staff_team` (`components/TeamForm.tsx`, `api/teams.ts`), team-member `staff:staff_team_member` (`components/TeamMemberForm.tsx`, `api/team-members.ts`), team-role `staff:staff_team_role` (`components/TeamRoleForm.tsx`, `api/team-roles.ts`), leave-request `staff:staff_leave_request` (`components/LeaveRequestForm.tsx`, `api/leave-requests.ts`). Presence mounts on edit/detail pages under `backend/staff/{teams,team-members,team-roles,leave-requests}/`. **Custom:** `api/leave-requests/accept|reject/route.ts` = approve/reject status transitions → guard via command seam (decision-state) or exempt with reason; `api/team-members/tags/assign|unassign`, `api/resources/.../tags/*` = junction (exempt). *Note:* the audit table lists `StaffTeam`/`StaffTeamRole`; team-member/leave-request edits are field edits and should be enabled too.

**resources** — ResourcesResource `resources:resources_resource` (`components/ResourceCrudForm.tsx`, `api/resources.ts`), ResourcesResourceType `resources:resources_resource_type` (`components/ResourceTypeCrudForm.tsx`, `api/resource-types.ts`). Presence mounts on `backend/resources/{resources,resource-types}/` edit screens; tag assign/unassign exempt.

| Module | Entity | Edit screen | entityId | Decision |
|--------|--------|-------------|----------|----------|
| auth | User, Role | `backend/users/[id]/edit`, `backend/roles/[id]/edit` | `auth:user`,`auth:role` | enabled; ACL routes separate |
| directory | Organization, Tenant | `backend/directory/{organizations,tenants}/[id]/edit` | `directory:organization`,`directory:tenant` | enabled |
| staff | Team, TeamRole, TeamMember, LeaveRequest | `backend/staff/{teams,team-roles,team-members,leave-requests}/…` | `staff:staff_team`,`…team_role`,`…team_member`,`…leave_request` | enabled; accept/reject = status txn |
| resources | Resource, ResourceType | `backend/resources/{resources,resource-types}/…` | `resources:resources_resource`,`…resource_type` | enabled; tags exempt |

Extend coverage guard per module; integration TC-LOCK-{AUTH-role,DIR-org,STAFF-team,RES-resource}.

### Phase 6 — Platform-config modules: dictionaries, currencies, workflows, feature_toggles, business_rules

Mixed: some custom inline/dialog editors and a bespoke visual editor that need explicit header + merge-dialog wiring.

**dictionaries** — Dictionary `dictionaries:dictionary`, DictionaryEntry `dictionaries:dictionary_entry`. **No `[id]` detail page** — editing is inline in `components/DictionariesManager.tsx` + `DictionaryEntriesEditor.tsx` (`DictionaryForm.tsx` hosts a CrudForm in a dialog). Routes: `api/route.ts` (dictionary), `api/[dictionaryId]/entries/route.ts` (entries). **Custom:** `api/[dictionaryId]/entries/reorder/route.ts` (position — exempt), `set-default/route.ts` (single-flag toggle — exempt or guard). Presence: dialog-scoped — mount `backend:record:current` on the manager when a dictionary is open, or rely on the `crud-form:` widget (decide during impl).

**currencies** — Currency `currencies:currency` (`backend/currencies/[id]/page.tsx`, `api/currencies/route.ts`), ExchangeRate `currencies:exchange_rate` (`backend/exchange-rates/[id]/page.tsx`, `api/exchange-rates/route.ts`). Both are CrudForm detail pages already sending the OSS header; add presence mounts. List-row deletes in `backend/currencies/page.tsx` / `exchange-rates/page.tsx` use raw `apiCall` with the header — route their 409 to the merge dialog.

**workflows** — WorkflowDefinition `workflows:workflow_definition`. **Two edit paths:** (1) form detail `backend/definitions/[id]/page.tsx` (CrudForm); (2) **custom visual editor** `backend/definitions/visual-editor/page.tsx` — React-Flow graph saving via raw `apiCall` PUT with a hand-built `buildOptimisticLockHeader`. Route `api/definitions/[id]/route.ts` already uses `validateCrudMutationGuard` + a generic optimistic-lock reader. Presence mount on **both** edit screens; ensure the visual editor's 409 surfaces the merge dialog (it is the highest-value record_locks target — long-lived edits). Custom `api/definitions/[id]/customize/route.ts`, `reset-to-code/route.ts` = override toggles → guard or exempt.

**feature_toggles** — FeatureToggle `feature_toggles:feature_toggle` (`backend/feature-toggles/global/[id]/edit/page.tsx`, `api/global/route.ts`) — CrudForm, auto-covered; **global (non-tenant) entity, superadmin-only** → record_locks scope must handle the null-tenant case or this stays OSS-guarded only. Overrides `api/global/[id]/override/route.ts` = per-tenant junction (exempt). Presence mount optional (single-admin surface) — **document the decision**.

**business_rules** — BusinessRule `business_rules:business_rule` (`backend/rules/[id]/page.tsx`), RuleSet `business_rules:rule_set` (`backend/sets/[id]/page.tsx`). Both pages use CrudForm but the routes (`api/rules/route.ts`, `api/rules/[id]/route.ts`, `api/sets/route.ts`, `api/sets/[id]/route.ts`) already call `enforceCommandOptimisticLock` — so they bridge to the command seam (S1) cleanly. Presence mounts on both detail pages. `RuleSetMembers.tsx` + `api/sets/[id]/members/route.ts` = junction (exempt); `api/execute/*` = read/eval (exempt).

| Module | Entity | Edit surface | entityId | Custom path | Decision |
|--------|--------|--------------|----------|-------------|----------|
| dictionaries | Dictionary, DictionaryEntry | inline `DictionariesManager`/`DictionaryEntriesEditor` | `dictionaries:dictionary`,`…dictionary_entry` | `api/route.ts`,`api/[dictionaryId]/entries/route.ts` | enabled; reorder/set-default exempt |
| currencies | Currency, ExchangeRate | `backend/currencies/[id]`,`exchange-rates/[id]` | `currencies:currency`,`…exchange_rate` | list-row raw `apiCall` delete | enabled |
| workflows | WorkflowDefinition | `definitions/[id]` + `visual-editor` | `workflows:workflow_definition` | visual editor raw PUT | enabled (visual editor = key target) |
| feature_toggles | FeatureToggle | `feature-toggles/global/[id]/edit` | `feature_toggles:feature_toggle` | global/non-tenant scope | enabled or OSS-only (scope note) |
| business_rules | BusinessRule, RuleSet | `backend/rules/[id]`,`sets/[id]` | `business_rules:business_rule`,`…rule_set` | routes already `enforceCommandOptimisticLock` | enabled; members/execute exempt |

Extend coverage guard per module; integration TC-LOCK-{DICT-entry,CUR-currency,WF-visual-editor,BR-rule}.

### Phase 6b — Command-layer guard seam + every `enforceCommandOptimisticLock` site (incl. modules outside the entity audit)

This phase makes the spec's command-layer promise real and **covers the operations/commands OSS guards that record_locks misses today**. It is the highest-leverage phase, but it is not zero-churn: the current helper is synchronous, so implementation must add an async seam and migrate wrappers/call sites to await it.

**Step 1 — Wire the seam (additive, async).** Implement S1's revised option: add an async DI-aware command guard runner while preserving the existing `enforceCommandOptimisticLock(input): void` helper. record_locks registers `commandOptimisticLockGuardService` in its `di.ts` alongside `crudMutationGuardService`. OSS-only builds register nothing and migrated call sites still get the OSS compare. The old helper remains available for external callers and explicitly OSS-only paths.

**Step 2 — Per-site enable + decision.** Audit update 2026-06-15: repo-wide grep finds **34 direct `enforceCommandOptimisticLock` call lines across 21 non-test files** after excluding docs/tests/integration specs. Sites already inside Phases 1–6 (sales, customers interactions, business_rules, dictionaries, workflows) migrate their wrappers/routes to the async seam. The rest belong to modules/packages the entity audit never lists and were silently missing from this spec — each needs a record_locks decision:

| Module | Command-guard site(s) | Operations | record_locks decision |
|--------|-----------------------|------------|-----------------------|
| sales | `commands/{documents,returns,shared}.ts` | update, delete, status, convert | enabled (Phase 3; rides seam) |
| customers | `commands/interactions.ts` | update, status | enabled (Phase 2; rides seam) |
| business_rules | `api/{rules,sets}/route.ts` | update, delete | enabled (Phase 6; rides seam) |
| dictionaries | `api/[dictionaryId]/route.ts`, `…/entries/[entryId]/route.ts` | update, delete | enabled (Phase 6; rides seam) |
| workflows | `api/definitions/[id]/route.ts` | update, delete | enabled (Phase 6; rides seam) |
| **entities** | `api/records.ts` | update, delete | enabled — EAV custom-entity records; high concurrent-edit value. **Was missing from this spec.** |
| **staff** | `commands/job-histories.ts` | update, delete | decide: enabled (employment record edits) vs exempt (append-only history). **Was missing.** |
| **feature_toggles** | `api/overrides/route.ts` | update, delete | **enabled** — per-tenant override values. **Spec Phase 6 wrongly marked overrides exempt; corrected here.** |
| **customer_accounts** | `api/admin/users/[id].ts`, `api/admin/roles/[id].ts` | update, delete | enabled — portal admin users/roles (parity with auth). **Was missing.** |
| **inbox_ops** | `api/settings/route.ts` | update | command-seam parity; presence optional (single-admin config). **Was missing.** |
| **data_sync** | `lib/sync-schedule-service.ts` | update | command-seam parity; enabled or config-exempt. **Was missing.** |
| **auth** | `api/roles/acl/route.ts`, `api/users/acl/route.ts` | update | enabled — ACL edits are real concurrent-edit surfaces (Phase 5 treated these as "separate"; they are OSS command-guarded and must reach parity). **Sidebar prefs** `api/sidebar/preferences/route.ts` = per-user single-owner preference → **exempt**. |
| **perspectives** | `services/perspectiveService.ts` | update, delete | decide: enabled (shared saved views) vs exempt (per-owner views). **Was missing.** |
| **webhooks** | `packages/webhooks/src/modules/webhooks/api/webhooks/[id]/route.ts` | update, delete | enabled — webhook endpoint config is tenant/org scoped, encrypted-secret adjacent, and already OSS command-guarded. **Was missing from the spec and outside core UI scan.** |
| **checkout** | `packages/checkout/src/modules/checkout/commands/{links,templates}.ts` | update, delete | enabled for admin pay-link/template edits. Public pay/transaction status flows remain server-authoritative/idempotent and are not collaborative-edit surfaces. **Was missing from the spec and outside core UI scan.** |

**Step 3 — Coverage guard.** Add a **command-guard parity test** that scans all workspace packages, not just `packages/core`, and fails when a new direct-helper call site appears without one of:
- migrated async seam usage;
- an explicit `record_locks` enabled/exempt decision in the parity map;
- a documented OSS-only reason.

**Step 4 — raw UI header-helper sites outside both audits.** `attachments` and `translations` were the first two missed examples: they send OSS lock headers via UI helpers (`buildOptimisticLockHeader` / raw `apiCall` PUT), not `makeCrudRoute` and not `enforceCommandOptimisticLock`, so neither entity nor command audits catch them:
- **attachments** — `components/AttachmentPartitionSettings.tsx` → custom routes under `api/partitions/`. Decision: config surface; enable record_locks or document single-admin exempt. Floor covers it once Phase 0 lands (it already sends the header).
- **translations** — `components/TranslationManager.tsx` (a **cross-entity injected widget**, `crud-form:<entityId>:fields`) → raw `PUT /api/translations/[entityType]/put`. The translation rows belong to the **host entity** being edited. Decision: **inherit the host entity's version** (guard against the host's `updated_at`, like custom-field values) rather than a separate `translations` resource — so editing a product's translations participates in the product's lock. Confirm during impl.

**Step 5 — workspace-wide raw-helper sweep.** Extend the raw-mutation/header audit beyond `packages/core/src/modules` (the current `optimistic-lock-ui-coverage.test.ts` root) to all module packages. At minimum, this sweep must cover:
- `planner` availability rule sets/rules (`AvailabilityRuleSetForm`, `AvailabilityRulesEditor`, `AvailabilitySchedule`) — currently OSS header-helper protected but absent from the matrix.
- `api_keys` list-row delete — OSS header-helper protected; decide enabled vs security-config exempt.
- `integrations` state/credentials/bundle toggles — several sites send a header; bundle routes currently use `buildOptimisticLockHeader(undefined)` due a TODO, which is a **scanner false positive** and must be fixed or explicitly exempted.
- `webhooks` admin list/detail UI — package-level header helper + command guard.
- `checkout` `LinkTemplateForm` — package-level header helper + command guard for links/templates.
- `customer_accounts` domain mappings and admin user/role pages — header helpers plus command guards.
- `attachments` and `translations` from Step 4.

The coverage test must not treat a bare reference to `buildOptimisticLockHeader(undefined)` as protected unless an inline exempt reason explains why the write is intentionally tokenless. Otherwise the scan can pass while the request sends no version header.

> **Scope note:** these command-guard + header-helper modules/packages (`entities`, `staff/job-histories`, `feature_toggles/overrides`, `customer_accounts`, `inbox_ops`, `data_sync`, `auth` ACL/sidebar prefs, `perspectives`, `webhooks`, `checkout`, `planner`, `api_keys`, `integrations`, `attachments`, `translations`) sit **outside** `optimistic-lock-editable-entities.test.ts` because that audit is entity-`updated_at`-shaped; OSS locking (command helper + UI header helpers) is broader. This spec's done-definition therefore covers **all three** surfaces: every editable entity (CRUD layer), every command-helper site (command layer), and every raw UI header-helper site across workspace packages.

### Phase 7 — Cross-cutting delete sweep + completeness verdict
1. Sweep all remaining delete flows across the modules/packages above that send the OSS lock header but were not yet routed through the unified guard/merge surface (workspace-wide `MUTATION` scan: every file matching `deleteCrud(` / `method:'DELETE'`). Confirm each enabled resource's delete surfaces `record_locks.record.deleted`.
2. Final alignment of the OSS guard tests (`optimistic-lock-editable-entities.test.ts`, `optimistic-lock-ui-coverage.test.ts`) plus new command/raw-helper workspace scans with the new record_locks coverage assertion — add a parallel `record_locks` decision map (enabled vs exempt+reason) keyed by editable entities, command-helper call sites, and raw UI header-helper files so a new OSS lock site cannot ship without a record_locks decision.
3. Produce the coverage matrix below as the spec's done-definition.

### Coverage Matrix (done-definition — every audited entity has a record_locks decision)
| Module | Entity (audited) | Phase | record_locks decision |
|--------|------------------|-------|-----------------------|
| customers | CustomerEntity (person/company) | 1 | enabled (presence + unified guard) |
| customers | CustomerDeal | 1 | enabled (form + command guard) |
| customers | CustomerInteraction | 2 | enabled (status txn exempt) |
| customers | CustomerTag, CustomerLabel | 2 | enabled (entity); assignment exempt |
| customers | CustomerPipeline, CustomerPipelineStage | 2 | enabled; reorder exempt |
| sales | SalesOrder, SalesQuote | 3 | enabled (aggregate command guard) |
| sales | SalesChannel, SalesPaymentMethod, SalesShippingMethod | 3 | enabled (CRUD route) |
| catalog | CatalogProduct, CatalogProductVariant, CatalogProductCategory | 4 | enabled (presence + CRUD guard) |
| catalog | CatalogProductPrice, CatalogOffer, CatalogPriceKind, CatalogOptionSchemaTemplate | 4 | enabled (CRUD guard; inherit product presence) |
| auth | User, Role | 5 | enabled (ACL routes versioned separately) |
| directory | Organization, Tenant | 5 | enabled |
| staff | StaffTeam, StaffTeamRole | 5 | enabled (team-member/leave-request also enabled) |
| resources | ResourcesResource, ResourcesResourceType | 5 | enabled |
| dictionaries | Dictionary, DictionaryEntry | 6 | enabled; reorder/set-default exempt |
| currencies | Currency | 6 | enabled (+ ExchangeRate enabled) |
| workflows | WorkflowDefinition | 6 | enabled (form + visual editor) |
| feature_toggles | FeatureToggle | 6 | enabled or OSS-only (global/non-tenant scope note) |
| business_rules | BusinessRule, RuleSet | 6 | enabled (routes already command-guarded) |
| entities | EAV records (`api/records.ts`) | 6b | enabled (command seam) |
| staff | job-histories | 6b | enabled vs exempt (append-only) — decide |
| feature_toggles | FeatureToggleOverride | 6b | enabled (was wrongly exempt) |
| customer_accounts | admin User, Role | 6b | enabled (command seam) |
| inbox_ops | settings | 6b | command-seam parity; presence optional |
| data_sync | sync schedule | 6b | command-seam parity; enabled vs config-exempt |
| auth | Role ACL, User ACL | 6b | enabled (command-guarded); sidebar prefs exempt |
| perspectives | saved views | 6b | enabled (shared) vs exempt (per-owner) — decide |
| attachments | partitions | 6b | config; enabled vs single-admin exempt |
| translations | translation rows | 6b | inherit host entity version (like custom-field values) |
| planner | AvailabilityRuleSet, AvailabilityRule | 6b | enabled or scheduling-config exempt; raw-helper protected today |
| api_keys | ApiKey row delete/edit surfaces | 6b | enabled vs security-config exempt; raw-helper protected today |
| integrations | Integration state/credentials/bundle toggles | 6b | enabled; fix `buildOptimisticLockHeader(undefined)` false-positive sites or document exemption |
| webhooks | Webhook endpoint | 6b | enabled (package command + UI header sites) |
| checkout | CheckoutLink, CheckoutLinkTemplate | 6b | enabled for admin edits; public transaction/pay flows exempt |
| customer_accounts | domain mappings | 6b | enabled vs single-admin config exempt; raw-helper protected today |

### File Manifest (Phase 0 — shared foundational seam)
| File | Action | Purpose |
|------|--------|---------|
| `packages/enterprise/src/modules/record_locks/lib/crudMutationGuardService.ts` | Modify | Decorator: run OSS `updated_at` compare first, then `validateMutation` (H2 chaining) |
| `packages/shared/src/lib/crud/optimistic-lock-command.ts` | Modify | Keep synchronous `enforceCommandOptimisticLock` unchanged; add async DI-aware command seam that runs OSS compare, then awaits optional `commandOptimisticLockGuardService` (fail-closed) |
| `packages/enterprise/src/modules/record_locks/di.ts` | Modify | Register `commandOptimisticLockGuardService` (record_locks impl) |
| `packages/enterprise/src/modules/record_locks/lib/recordLockService.ts` | Modify | `validateMutation`/`resolveExpected` derive base from server state; never pass tokenless stale writes |
| `packages/ui/src/backend/AppShell.tsx` + `packages/ui/src/backend/injection/` | Modify/Create | AppShell-owned record-context provider/publisher; global `backend:record:current` context merges `{ path, query }` with page-published record context |
| `packages/enterprise/src/modules/record_locks/__integration__/` + `packages/shared/.../__tests__/` | Create | Fail-safe tests: widget-unmounted, service-throws, env-off, tokenless-client, awaited async command seam, stale-context cleanup (H1–H4) |
| `packages/core/src/__tests__/optimistic-lock-command-coverage.test.ts` | Create | Workspace command-parity coverage guard (new direct helper calls require async-seam migration or record_locks decision/exemption) |
| `packages/core/src/__tests__/optimistic-lock-ui-coverage.test.ts` or successor workspace scan | Modify/Create | Workspace raw-helper coverage guard; `buildOptimisticLockHeader(undefined)` is not "covered" without an inline exemption |

### File Manifest (Phase 1)
| File | Action | Purpose |
|------|--------|---------|
| `packages/ui/src/backend/conflicts/index.ts` (or `optimisticLock` util) | Modify | `surfaceRecordConflict` defers on `record_lock_conflict` payload |
| `packages/ui/src/backend/injection/` (helper) | Create | `buildRecordInjectionContext(...)` shared context builder + page-side publisher hook/component |
| `packages/core/src/modules/customers/backend/customers/people-v2/[id]/page.tsx` | Modify | Publish AppShell record context for person |
| `packages/core/src/modules/customers/backend/customers/companies-v2/[id]/page.tsx` | Modify | Publish AppShell record context for company |
| `packages/core/src/modules/customers/backend/customers/deals/[id]/page.tsx` | Modify | Publish AppShell record context for deal |
| `packages/core/src/modules/customers/components/detail/DealForm.tsx` | Modify | Pass `injectionSpotId` + resource/version context |
| `packages/core/src/modules/customers/components/detail/useDealPipeline.ts` / `useDealClosure.ts` | Modify | Send lock headers + surface conflicts |
| `packages/core/src/modules/customers/commands/*deal*` | Modify | Guard stage-change/closure via awaited async command seam |
| `packages/enterprise/src/modules/record_locks/di.ts` | Modify | Register `commandOptimisticLockGuardService` (`resolveExpected`) |
| `packages/core/src/__tests__/optimistic-lock-ui-coverage.test.ts` | Modify | Parallel record_locks coverage assertion |
| `packages/enterprise/src/modules/record_locks/__integration__/` | Create | TC-LOCK-CRM-{person,company,deal} |

### Testing Strategy
- **Fail-safe (Phase 0, the safety spine — MUST land first):**
  - **Widget-unmounted floor (H1/H4):** record_locks enabled, record-lock widget not mounted (simulate removed/overridden layout) → two concurrent edits still produce a server 409. Proves enforcement is server-side, not widget-dependent.
  - **Fail-closed delegation (H3):** record_locks guard service throws/unavailable → mutation degrades to the OSS 409, never a silent pass-through.
  - **Tokenless client:** a plain API/CLI client that sends only the OSS `updated_at` header (no record-lock token) → stale write still 409 (floor catches it).
  - **Enablement parity:** `OM_OPTIMISTIC_LOCK=off` disables both layers; settings-enabled + env-off → no locking; env-on + settings-off → OSS floor only.
  - **Awaited command seam:** a migrated command route awaits the async command seam before mutating; an enterprise-service conflict prevents the write, and an unregistered/throwing service falls back to the OSS compare.
  - **Presence context cleanup:** navigate record A → record B → non-detail page and verify the AppShell-published context reacquires/releases correctly and never heartbeats the stale record.
  - **No-double-409:** a single conflicting save returns exactly one 409 shape; client renders one surface (merge dialog with widget, conflict bar without).
- **Coverage guards (Phase 6b/7):** extend `optimistic-lock-ui-coverage.test.ts` or add a successor workspace scan + add `optimistic-lock-command-coverage.test.ts` so any new `makeCrudRoute` entity, direct command-helper site, or raw UI header site across `packages/*` must carry a record_locks decision (enabled/exempt). The raw-helper scan must flag `buildOptimisticLockHeader(undefined)` unless there is an inline exemption reason.
- **Unit**: the CRUD decorator chaining order (OSS floor runs before/independently of `validateMutation`), async command seam awaits enterprise service + fail-closed wrapper, legacy synchronous helper remains unchanged, `resolveExpected` server-state derivation, `surfaceRecordConflict` deferral, resource-kind resolution for deal.
- **Integration (Playwright)**: two concurrent sessions per enabled entity — presence banner appears, contended pessimistic lock blocks, optimistic save → merge dialog with field diff, accept-incoming/accept-mine resolution, force-release. Self-contained fixtures via API; teardown deletes created records.

## Risks & Impact Review

### Data Integrity Failures
- **Concurrent deal stage-change + form save**: two writes racing on the same deal. Mitigation: command guard (Step 1.4/1.5) makes the loser get a 409 → merge dialog; action-log base ensures the second writer sees the first's change.
- **Crash mid-save**: lock left active. Mitigation: existing heartbeat expiry + background cleanup (3-day lock sweep) + admin force-release.

### Cascading Failures & Side Effects
- record_locks emits events/notifications; subscriber failure must not block the mutation. Mitigation: existing subscriber model is async/persistent; guard validation is synchronous and independent of notification fan-out.

### Tenant & Data Isolation Risks
- All lock lookups are `tenant_id`-scoped (optional `organization_id`); the new command guard seam must pass the same scope. Mitigation: `resolveExpected` derives scope from the request ctx, never global.

### Migration & Deployment Risks
- **No schema migration.** Behavior change is guard-routing + AppShell context transport. OSS-only deployments (no enterprise module) are unaffected: seams fall back to OSS guard; `backend:record:current` simply renders nothing.

### Operational Risks
- **Heartbeat storm** as more screens acquire locks. Mitigation: existing `heartbeatSeconds` (default 30s) config; presence acquire only on detail screens, not lists.
- **Blast radius**: enterprise-only; OSS builds unchanged.

### Risk Register

#### Widget removed / layout tampered → loss of locking (the regression this spec must prevent)
- **Scenario**: A third party removes the record-lock widget via component replacement, ships a custom `AppShell`/layout that drops `backend:record:current`, or a non-widget API client mutates directly. If record_locks had *replaced* the OSS guard, locking would silently vanish — worse than OSS, which protects regardless of UI.
- **Severity**: Critical
- **Affected area**: All enabled resources; data integrity.
- **Mitigation**: **Layered, server-authoritative model (S1/S5).** The OSS `updated_at` floor always runs server-side (H2); record_locks delegation is fail-closed (H3); enforcement never depends on the widget (H1). The widget is UX-only. Regression test H4 proves concurrent edits still 409 with the widget unmounted.
- **Residual risk**: With the widget gone the user sees the plain OSS conflict bar instead of the merge dialog (degraded UX), but the write is still blocked. `OM_OPTIMISTIC_LOCK=off` is the only switch that disables protection, and it disables OSS too — no asymmetry.

#### Command-layer async seam implemented unsafely
- **Scenario**: The implementation makes `enforceCommandOptimisticLock` async without migrating callers to `await`, or fires an un-awaited DI service promise from the synchronous helper. The route mutates before record_locks can block, so enterprise conflict detection is illusory.
- **Severity**: Critical
- **Affected area**: Every command-pattern write, especially package modules (`checkout`, `webhooks`) and routes outside `makeCrudRoute`.
- **Mitigation**: Preserve the synchronous helper as OSS-only; add a separate async seam; migrate wrappers/call sites to `await`; add unit tests proving mutation code is not reached until the seam resolves. Coverage guard fails on new direct-helper call sites without a decision.
- **Residual risk**: Existing external callers may continue using the legacy helper and remain OSS-only until they opt into the async seam; documented as backward-compatible behavior.

#### Command-layer coverage gap vs OSS
- **Scenario**: A direct command-helper site (e.g. `entities` EAV records, `feature_toggles` overrides, `customer_accounts` admin, `auth` ACL, `data_sync` schedule, `webhooks` endpoints, `checkout` links/templates) stays OSS-only while its CRUD siblings get record_locks, so concurrent command writes aren't covered by the enterprise guard.
- **Severity**: High
- **Affected area**: Modules/packages outside the editable-entity audit (Phase 6b).
- **Mitigation**: The async seam + per-site migration routes enabled command sites through record_locks; the workspace command-parity coverage test fails if a new direct-helper site ships without a decision.
- **Residual risk**: A site that bypasses both the helper and `makeCrudRoute` (hand-rolled write) — caught by the workspace raw-mutation/header scan.

#### Presence context leaks across routes
- **Scenario**: The AppShell-owned record context is not cleared when navigating away or switching records. The record_locks widget could heartbeat/acquire the previous resource while the user is on a different page, creating false contention or releasing the wrong lock.
- **Severity**: High
- **Affected area**: All screens using the S2 publisher.
- **Mitigation**: Publisher cleanup on unmount/path change; AppShell compares `path + resourceKind + resourceId`; integration test navigates A → B → list and asserts only the current record receives heartbeat/release calls.
- **Residual risk**: A short-lived stale banner during client navigation before the cleanup effect runs; acceptable if no stale heartbeat continues after route settle.

#### Raw-helper coverage false positive
- **Scenario**: A UI file references `buildOptimisticLockHeader` but passes `undefined` (or no current version), so the scanner marks it covered while the request sends no version header.
- **Severity**: High
- **Affected area**: Raw `apiCall` / `useGuardedMutation` paths, especially `integrations` bundle toggles and create/update hybrids.
- **Mitigation**: Workspace raw-helper scan must inspect `buildOptimisticLockHeader(undefined)` and require either a real `updatedAt` source or an inline `optimistic-lock-exempt` reason. Add regression fixtures for at least one true-positive and one exempt tokenless write.
- **Residual risk**: Dynamic token expressions may be hard to prove statically; human review required for allowlisted complex cases.

#### Double conflict surface
- **Scenario**: A save triggers both the OSS conflict bar and the record_locks merge dialog.
- **Severity**: High
- **Affected area**: All unified sites' conflict UX.
- **Mitigation**: Single *surface*, not single guard (S3) — the server emits one 409 shape per request; `surfaceRecordConflict` defers to the merge dialog on a `record_lock_conflict` payload, else the conflict bar. Server guards may both evaluate; only one 409 is returned.
- **Residual risk**: A misconfigured resource (record_locks enabled in settings but CRUD guard not overridden) could double-fire; covered by the coverage guard test.

#### `core → enterprise` coupling
- **Scenario**: A detail screen imports an enterprise component to mount presence, breaking the OSS build.
- **Severity**: High
- **Affected area**: Build integrity / module isolation.
- **Mitigation**: Mount is a core-rendered injection spot; enterprise injects via the registry. No direct import.
- **Residual risk**: None if the helper stays in UI/core.

#### Stale/false presence
- **Scenario**: A user with a dead tab keeps a lock, blocking others.
- **Severity**: Medium
- **Affected area**: CRM editing throughput.
- **Mitigation**: heartbeat expiry + force-release + background cleanup (all existing).
- **Residual risk**: Up to `timeoutSeconds` of false contention; acceptable and admin-overridable.

## Final Compliance Report — 2026-06-09

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/ui/AGENTS.md`
- `packages/shared/AGENTS.md`
- `packages/enterprise/AGENTS.md` (record_locks module)
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix
| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | Integration via injection spots + DI seams + FK ids only |
| root AGENTS.md | Filter by organization_id / tenant_id | Compliant | Lock lookups + `resolveExpected` carry request scope |
| root AGENTS.md | No `core → enterprise` imports | Compliant | Presence context transport lives in UI/core; enterprise only injects into existing spot |
| root AGENTS.md | Optimistic locking default-ON for editable entities | Compliant | record_locks **chains** the OSS guard (decorator) — floor always runs; enterprise only adds blocks (Phase 0/S1) |
| packages/ui/AGENTS.md | Use `apiCall`/`useGuardedMutation`, never raw fetch | Compliant | Deal commands wrapped via `withScopedApiRequestHeaders` |
| packages/ui/AGENTS.md | Single conflict surface (`surfaceRecordConflict`) | Compliant | Deferral logic added for record_locks payloads; conflict bar still renders if widget absent |
| DS rules | Semantic tokens, shared primitives, dialog Cmd+Enter/Esc | Compliant | Reuses existing widget UI; Boy Scout on touched lines |
| BACKWARD_COMPATIBILITY.md | No removal of contract surfaces | Compliant | Additive only — see Migration & Backward Compatibility below; keep `enforceCommandOptimisticLock(input): void` unchanged and add a new async seam |
| packages/core/AGENTS.md | Command guard via existing seam (#2232) | Compliant | New async command seam resolves optional `commandOptimisticLockGuardService`; migrated call sites await it; OSS compare runs unconditionally |
| S5 hardening | Enterprise ⊇ OSS safety; widget-independent; fail-closed | Compliant | Phase 0 chaining + H1–H6 tests; verified gap (current guard *replaces*) scheduled as the first task |

### Internal Consistency Check
| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | No new models/endpoints |
| API contracts match UI/UX | Pass | Existing record_locks APIs power the banner/dialog |
| Risks cover all write operations | Pass | CRUD + command + delete covered |
| Commands defined for all mutations | Pass | Reuses existing conflict commands |
| Guard coverage enforced by test | Pass | Coverage guard test extended to editable entities + workspace command/raw-helper sites |

### Non-Compliant Items
- **One verified defect, scheduled as Phase 0 (first task):** the current `crudMutationGuardService` override *replaces* the OSS `updated_at` compare instead of chaining it, so a tokenless write can pass a stale write through (H2 regression). This MUST be fixed (decorator chaining) before any resource is enabled in later phases. Until Phase 0 lands, the spec's safety guarantees are aspirational.
- **Previous command-seam plan was unsafe; now corrected in Phase 0/6b:** the existing helper is synchronous and containerless, so implementation MUST add an async seam and migrate call sites to `await`; it must not silently change the legacy helper's return contract.
- **Previous coverage matrix was core-biased; now corrected in Phase 6b/7:** package modules (`webhooks`, `checkout`) and raw-helper false positives (`buildOptimisticLockHeader(undefined)`) require workspace scans before the spec can claim "all OSS lock sites."

### Verdict
- **Compliant, conditional on Phase 0 + Phase 6b/7 coverage guards.** Approved for phased implementation **provided Phase 0 (guard cooperation + fail-safe tests + AppShell context transport) ships first** and the all-sites claim is not made until Phase 6b/7 covers workspace command/raw-helper sites.

## Migration & Backward Compatibility
Per `BACKWARD_COMPATIBILITY.md`, the command seam touches a STABLE shared helper surface and must be additive.
- **Do not change `enforceCommandOptimisticLock(input): void`.** It remains exported, synchronous, and behaviorally identical for existing callers. No hidden `Promise` return, no required container parameter, and no silent un-awaited enterprise work.
- **Additive new helper/service.** Add a new async DI-aware command guard runner (final exported name during implementation) and optional DI key `commandOptimisticLockGuardService`. Migrated platform call sites opt into it explicitly with `await`; external callers can keep using the legacy OSS helper.
- **No removal.** `createCommandOptimisticLockGuardService` remains exported; `enforceCommandOptimisticLock` remains exported; no event ID, command ID, API route, DI key, widget spot ID, or DB schema is removed or renamed. No migration.
- **New DI key (additive):** `commandOptimisticLockGuardService` (optional; absent by default). Documented in RELEASE_NOTES.md when implemented.
- **OSS-only build unaffected.** record_locks lives in `@open-mercato/enterprise`; with it absent, nothing registers the service and migrated async-seam calls run only the OSS compare.
- **Deprecation protocol:** N/A for this spec as written (no surface deprecated). If a future release wants to deprecate direct `enforceCommandOptimisticLock` usage in internal code, it must add `@deprecated` JSDoc, bridge for at least one minor, and document in RELEASE_NOTES.md.

## Changelog
### 2026-06-15 (pre-implementation gap hardening)
- **Command seam corrected for async/BC reality.** Re-audited `enforceCommandOptimisticLock` and found the old low-churn helper-seam plan was unsafe: the helper is synchronous, takes no container, and currently has **34 direct call lines across 21 non-test files** under `packages/core`, `packages/checkout`, and `packages/webhooks`. The spec now requires an additive async DI-aware seam, explicit `await` migration for wrappers/call sites, and preservation of `enforceCommandOptimisticLock(input): void` for backward compatibility.
- **Presence context transport made implementable.** The old "page feeds context to global mount" wording ignored that `AppShell` renders `backend:record:current` before page children. The spec now requires an AppShell-owned context provider/publisher, page-side cleanup on unmount/navigation, and stale-context tests.
- **All-sites coverage expanded beyond the core entity audit.** Added missing package/raw-helper surfaces: `webhooks`, `checkout`, `planner`, `api_keys`, `integrations`, `customer_accounts` domain mappings, plus workspace-wide command/raw-helper scans. The raw-helper scan must not treat `buildOptimisticLockHeader(undefined)` as covered without an inline exemption.
- **BC and risk analysis updated.** Migration section now forbids hidden async changes to the legacy helper; risk register now covers un-awaited command guards, stale AppShell context, and scanner false positives.
### 2026-06-09 (cooperation model + gap fills)
- **Cooperation, not replacement (the core fix).** Verified the current `crudMutationGuardService` *replaces* the OSS compare (calls `validateMutation` only; no `updated_at` compare in the 88-line file) and `validateMutation` is token/conflict-id/action-log driven — so a tokenless write can pass a stale write. Rewrote S1 to mandate the enterprise guard be a **decorator that chains the OSS floor** (run OSS compare first, then `validateMutation`; enterprise only *adds* blocks). Added **Phase 0** (foundational, ships before any rollout) implementing the CRUD-guard chaining, command-layer hardening, enablement parity, server-authoritative base resolution, and the H1–H4 fail-safe tests. Logged the current replace-behavior as a **verified defect** in the compliance report (conditional verdict: Phase 0 first).
- **Enablement-switch parity.** Defined the interaction of `OM_OPTIMISTIC_LOCK` (env floor) and `isRecordLockingEnabledForResource` (settings enrichment): one global kill switch (`=off` disables both), enrichment requires env-on **and** settings-on; record_locks short-circuits to floor-only when env-off.
- **Filled the out-of-scope modules.** Added `attachments` (partition settings) and `translations` (cross-entity `TranslationManager` → inherit host-entity version) — both send OSS lock headers via UI helpers and were caught by neither audit. Coverage matrix now lists all Phase-6b modules.
- **Stale sections fixed + BC added.** Compliance matrix updated ("replaces" → "chains"); Testing Strategy now lists the fail-safe + command-parity coverage tests as first-class; added a **Migration & Backward Compatibility** section and **Phase 0 + Phase 6b file manifests**. The command-seam mechanism in this 2026-06-09 entry was later corrected by the 2026-06-15 hardening entry above.
### 2026-06-09 (command parity + safety hardening)
- **Command-layer 1:1 parity with OSS.** This revision correctly identified that command-pattern writes were outside the CRUD entity audit and that `createCommandOptimisticLockGuardService` was **not DI-registered anywhere**, but its low-churn helper-seam mechanism was later superseded by the 2026-06-15 audit. The current plan is the additive async DI-aware seam plus explicit awaited migration described in S1 and Phase 6b above. Clarified the parity operation set: update, **delete**, and status-transition (record_locks' CRUD guard already maps delete; the gap was the command layer).
- **Safety hardening — enterprise ⊇ OSS, never a liability.** Replaced the "single-guard (replace)" model with a **layered, server-authoritative, fail-safe** model (new **S5**, revised S1/S3, Design Decisions, two new Risk Register entries). Core guarantees: (H1) enforcement is server-side and **independent of the client widget**; (H2) the OSS `updated_at` floor is **never removed** — record_locks that can't resolve falls through to it; (H3) delegation is **fail-closed** (broken enterprise guard degrades to OSS, not to zero); (H4) a regression test proves concurrent edits still 409 with the **widget unmounted / layout tampered**; (H5) pessimistic lock is advisory UX, the optimistic write-time check is authoritative; (H6) no site OSS-protects today may lose protection under record_locks. Dedupe of the double-409 UX moved to the **surface** (S3), not by disabling a server guard.
### 2026-06-09 (mechanism correction)
- **Corrected a factual error** in Problem Statement #1/#2, S2, and the phase preamble. An earlier draft said "no core page renders `backend:record:current`." In fact `AppShell` mounts that spot **globally on every backend page** (`AppShell.tsx:1362`) with `{ path, query }` context; the widget resolves the record from a hardcoded URL-path allowlist (`widget.client.tsx:337-430`) limited to `customers/{people,companies,deals}` and `sales/{orders,quotes,documents}` — which is why enterprise locks already work on those screens. Restated the real gaps: (a) the `*-v2` person/company routes miss the allowlist so get no page-load presence; (b) the Deal page *does* get presence but its `DealForm` save path (no `injectionSpotId`) and custom stage/closure command endpoints are unguarded; (c) all other modules get no presence because their path isn't recognized and no explicit context is supplied. The Phase 2+ "presence mount" work is therefore **supplying explicit `resourceKind`/`resourceId`/`updatedAt`/`data` context to the existing global mount**, not rendering a new spot.
### 2026-06-09 (deepening)
- Expanded Phases 2–7 from high-level bullets into **file-level manifests** grounded in a full codebase audit of every editable-entity lock site. Each phase now enumerates the exact presence mounts to add, the custom write paths / command-guard seams to wire, the auto-covered `makeCrudRoute` entities (with `entityId`s), and a per-entity enabled/exempt decision.
- Verified facts baked into that revision included CRM v2 person/company passing `injectionSpotId`, `DealForm` lacking it, sales `enforceSalesDocumentOptimisticLock` already guarding `documents.ts`/`returns.ts` while **`commands/payments.ts` and `commands/shipments.ts` had zero guard calls (Gap A/B)**, catalog category/variant edit pages missing `injectionSpotId`, workflows having a bespoke visual-editor save path, and business_rules routes already calling `enforceCommandOptimisticLock`. The earlier "no core page renders `backend:record:current`" statement was later corrected in the mechanism-correction entry above.
- Added a how-to-read preamble distinguishing **presence mount** vs **guard wiring** vs **decision**, and a **Coverage Matrix** done-definition listing a record_locks decision for every entity audited by `optimistic-lock-editable-entities.test.ts`.
### 2026-06-09
- Initial specification. Open Questions resolved at the time: single-guard via DI seam (Q1, later replaced by the layered async-seam plan above), full Phase-1 experience (Q2), guard Deal form + command endpoints (Q3), customers-first Phase 2+ ordering (Q4).
- Tracking issue: #2187 (CRM ↔ enterprise record-locking). Related: #2232 (command-level pessimistic locking seam), SPEC-ENT-003 (record-locking module), SPEC-035 (mutation-guard mechanism), `2026-05-25/28/29` OSS optimistic-locking specs.
