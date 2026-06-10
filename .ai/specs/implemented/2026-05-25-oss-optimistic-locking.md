# SPEC — OSS Opt-In Optimistic Locking (`updated_at`-based)

**Scope:** OSS
**Status:** Approved (recommended options confirmed by user 2026-05-25)
**Tracking issue:** [#1981](https://github.com/open-mercato/open-mercato/issues/1981)
**Run folder:** `.ai/runs/2026-05-25-oss-optimistic-locking.md`
**Related enterprise module:** `packages/enterprise/src/modules/record_locks/` (pre-existing pessimistic locking with acquire/release/heartbeat; this spec is its OSS-side complementary layer)

---

## TLDR

Ship an **additive, default-ON** optimistic-locking guard in OSS that
prevents silent lost updates on concurrent CRUD edits. The guard:

- Uses the existing `updated_at` common column as the version token — no new
  column, no migration, no entity fork.
- Hooks into the existing `crudMutationGuardService` DI service (the
  container-bound bridge), **not** the static `data/guards.ts` registry —
  because a stateful optimistic check needs DB access and the static
  `MutationGuard.validate(input)` only receives `MutationGuardInput`
  (no `em` / container).
- Is **default ON** as of Phase 14 (2026-05-27). Activated automatically
  for every CRUD entity behind `makeCrudRoute`. Operators opt out via
  `OM_OPTIMISTIC_LOCK=off` (or `false` / `0` / `no` / `disabled` /
  `none`). Existing clients that do not send the expected-`updated_at`
  header continue to pass through unchanged.
- Returns **HTTP 409** with a structured body that the enterprise
  `record_locks` module can extend (today: optimistic check; tomorrow:
  full merge / pessimistic acquire).
- Surfaces the 409 through `useGuardedMutation` as a built-in
  "record modified — refresh and retry" flash. `CrudForm` round-trips the
  expected `updatedAt` automatically when the loaded record exposes it.

Read models / detail / list APIs that participate in writes must expose
`updatedAt` (most already do via `serializeEntity` helpers).

---

## 1. Problem Statement

Two users opening and editing the same record concurrently produces silent
last-write-wins. The first user's changes are overwritten without a 409 or
any UI signal. Today, OSS has only point pessimistic `SELECT ... FOR UPDATE`
locks on specific financial flows (sales/payments/quotes/shipments/returns/
workflows); **no generic protection for ordinary CRUD edits**. From the
user's point of view, edits silently disappear.

This affects any entity that can be edited concurrently — customers,
products, deals, notes, orders. The default behavior across the platform is
silent last-write-wins.

### Why a separate OSS spec when enterprise `record_locks` exists?

The enterprise `record_locks` module (under
`packages/enterprise/src/modules/record_locks/`) ships pessimistic locks
with acquire/release/heartbeat/force-release APIs, ACL features
(`record_locks.*`), per-tenant `enabledResources` config, presence widgets,
and a notifications channel. It is the right place for the heavyweight
"user X is editing now" UX.

But:

1. The enterprise module requires a network round-trip to *acquire* a lock
   before the user can edit. That latency cost is acceptable for
   high-stakes financial flows; it is overkill for the bulk of platform
   CRUD.
2. The enterprise module is paid. OSS users who edit concurrently today
   get **nothing** — silent overwrites.
3. The fix for (2) is cheap, additive, and can ship without a migration:
   compare `updated_at` at write time. That is what this spec defines.

When both layers are active, the enterprise pessimistic acquire runs at a
**higher** guard priority (smaller number) than the OSS optimistic check, so
the enterprise behavior dominates. With enterprise disabled, the OSS
optimistic check still catches the "two browsers, same form, second save
wins" scenario — which is the most common production failure mode.

---

## 2. Goal

Protect users against silent lost updates on concurrent edits,
platform-wide, without changing existing behavior by default.

### Acceptance criteria (mirrors issue #1981)

| # | Criterion | Phase landing |
|---|-----------|---------------|
| AC-1 | Opt-in `updated_at`-based optimistic check in core, default OFF, one flag enables platform-wide | Phase 2 |
| AC-2 | Default 409 "record modified, refresh" UX via `useGuardedMutation` | Phase 3 |
| AC-3 | Read models expose `updatedAt`; client round-trips it | Phase 3 + 4 |
| AC-4 | Complete, copy-pasteable reference implementation: (a) optimistic via `updated_at`, (b) pessimistic via DI service | Phase 4 + this spec's §3 |
| AC-5 | Documentation states clearly which mechanism to use for read-current-state checks (static `data/guards.ts` → no DB; `crudMutationGuardService` → has DB) | Phase 5 docs page + this spec's §3.1 |
| AC-6 | Task Router row in root `AGENTS.md` + a real docs page | Phase 5 |
| AC-7 | Integration test so the reference does not rot | Phase 4 |
| AC-8 | Spec under `.ai/specs/` per repo conventions | This document |

---

## 3. Architecture

### 3.1 Static `data/guards.ts` vs DI `crudMutationGuardService` — pick the right tool

Open Mercato exposes **two** registration paths for mutation guards. They are
not interchangeable.

| | Static `data/guards.ts` | DI `crudMutationGuardService` |
|---|---|---|
| Registration site | `packages/<x>/src/modules/<m>/data/guards.ts` exports a `MutationGuard[]` array. Auto-discovered via `mutation-guard-store.ts`. | `packages/<x>/src/modules/<m>/di.ts` registers the service. Bridged into the runner via `bridgeLegacyGuard(container)`. |
| Receives `MutationGuardInput`? | Yes | Yes |
| Has access to `em` / container / DB? | **No.** Pure-function `validate(input)`. | **Yes.** Service is container-bound; can resolve `em`, `entityManager`, repositories. |
| Right for stateless checks (rate limit per request, payload validation, header presence) | ✅ | ✅ (but heavier) |
| Right for stateful checks that need current DB state (optimistic version check, "lock table lookup") | ❌ — cannot read DB | ✅ — the only correct path |

This spec uses the **DI** path because an optimistic check inherently needs
to read the current entity's `updated_at` from the DB.

> **Rule for future implementers:** if your guard needs to compare the
> request against current DB state, register via `crudMutationGuardService`
> in `di.ts`, **not** via `data/guards.ts`. The docs page added in Phase 5
> states this verbatim.

### 3.2 Wire format

Client → server: extension header per the existing convention in
`packages/shared/src/lib/umes/extension-headers.ts`:

```
x-om-ext-optimistic-lock-expected-updated-at: 2026-05-25T08:42:18.123Z
```

- Header name follows `x-om-ext-<moduleId>-<key>`. ModuleId is
  `optimistic_lock` (snake_case per project convention).
- Value is an ISO-8601 timestamp with millisecond precision (UTC, `Z`
  suffix). Parsed server-side with `Date.parse(...)`.
- Missing header = "client did not opt in for this request" = guard SKIPS.
  This keeps the guard non-disruptive when an older client or non-form
  caller (e.g. CLI, integration) issues a request.

Why not `If-Unmodified-Since`? It is HTTP-standards-compliant but loses
sub-second precision (HTTP-date format is second-granular). A burst of
writes within the same second would silently bypass the check. The
extension header is millisecond-precise.

### 3.3 409 response shape

```json
{
  "error": "record_modified",
  "code": "optimistic_lock_conflict",
  "currentUpdatedAt": "2026-05-25T08:42:18.500Z",
  "expectedUpdatedAt": "2026-05-25T08:42:18.123Z"
}
```

- `error`: human-readable token suitable for i18n key lookup
  (`ui.forms.flash.recordModified`).
- `code`: stable machine-readable code that the enterprise `record_locks`
  module can match on to upgrade the UI to a merge dialog.
- `currentUpdatedAt`: what the DB has right now (so a merge UI can show
  "their version" without another round-trip).
- `expectedUpdatedAt`: echo of the client-sent header (so the merge UI can
  show "what you started from").

This is the contract the enterprise module relies on. Future enterprise
extensions MAY add fields (additive only) — the OSS guard MUST emit these
four.

### 3.4 Env configuration

```
# (unset)                              → default ON — every CRUD entity
OM_OPTIMISTIC_LOCK=all                 → explicit ON (same as default)
OM_OPTIMISTIC_LOCK=customers.company,sales.order → allow-list (narrow scope)
OM_OPTIMISTIC_LOCK=off                 → opt out completely
OM_OPTIMISTIC_LOCK=false / 0 / no / disabled / none → also opt out (mirrors parseBooleanToken)
```

Parse rules (implemented in `parseOptimisticLockEnv(raw: string | undefined)`):

| Input | Result |
|---|---|
| `undefined`, `null`, `''`, `'  '` | **All entities (default ON) — `{ mode: 'all' }`** |
| `'off'`, `'false'`, `'0'`, `'no'`, `'disabled'`, `'none'` (single token, case-insensitive) | OFF — `{ mode: 'off' }` |
| Any off-token mixed with other entries (e.g. `'off,customers.company'`) | OFF wins (invalid input, fail-safe) |
| `'all'` (case-insensitive, trimmed) | All entities — `{ mode: 'all' }` |
| `'customers.company,sales.order'` | Allow-list — `{ mode: 'allowlist', entities: Set(...) }` |
| `'all,customers.company'` | All entities (`all` wins) |
| Whitespace + duplicates | Trimmed, deduped, lowercased on entityType |

Reading the env happens **once at module load** (`process.env.OM_OPTIMISTIC_LOCK`)
to keep the per-request hot path cheap. Tests use `jest.isolateModules` to
reload with different values.

> **Why default ON?** Phase 14 (2026-05-27) flipped the default. The
> previous behavior — silent last-write-wins — caused real user pain
> the moment two operators opened the same form, and the guard is
> strictly additive at runtime: clients that do not send the
> `x-om-ext-optimistic-lock-expected-updated-at` header continue to pass
> through unchanged. The only client surface that automatically sends
> the header is `CrudForm` with the `optimisticLockUpdatedAt` prop set,
> which is explicit opt-in on every page that wires it. Default ON
> therefore turns coverage on without forcing pages to start sending
> 409s before they're ready.

### 3.5 Server algorithm

For each `update` or `delete` mutation reaching `makeCrudRoute`:

```
1. Resolve config = parseOptimisticLockEnv(process.env.OM_OPTIMISTIC_LOCK)
2. If config.mode === 'off' → PASS.
3. If config.mode === 'allowlist' && !config.entities.has(input.resourceKind) → PASS.
4. Read expected = parseHeader(input.requestHeaders, OPTIMISTIC_LOCK_HEADER_NAME)
5. If expected === null → PASS (client did not opt in).
6. Read current = em.findOne(entity, { id: input.resourceId }, { fields: ['id', 'updated_at'] })
7. If !current → PASS (entity already gone; let the CRUD path's own 404 fire).
8. If current.updated_at.toISOString() === expected.toISOString() → PASS.
9. Otherwise → FAIL with 409 + structured body.
```

Implementation: `OptimisticLockGuardService.validateMutation(input)` returns
the `CrudMutationGuardValidationResult` shape that the existing legacy
bridge in `mutation-guard.ts` already understands.

### 3.5.1 Reader registry — auto-coverage for every CRUD entity (Phase 13)

The guard reads the current `updated_at` through a reader function keyed
by `resourceKind`. There are two ways a reader gets into the registry:

| Path | Where it lands | Use when |
|------|----------------|----------|
| **Auto-registered generic** | `makeCrudRoute` calls `registerOptimisticLockReaderIfAbsent({ [resourceKind]: createGenericOptimisticLockReader({ entity, idField, tenantField, orgField, softDeleteField }) })` at module-load time. | Default for every CRUD route. No per-module wiring needed. Covers all 64+ core routes the moment `OM_OPTIMISTIC_LOCK=all` is set. |
| **Hand-wired specific** | Module's `di.ts` calls `registerOptimisticLockReaders({ … })` during DI bootstrap (before any route file is imported). | The entity needs a discriminator beyond `id` + tenant + org + soft-delete — e.g. a polymorphic table like `customer_entities` with a `kind` column. Hand-wired readers WIN because they register first and the auto-registration uses the `IfAbsent` helper. |

The generic reader projects only `updatedAt` (no PII materializes) and
**fails open** on schema mismatch: if `em.findOne` throws (the entity
has no `updated_at` column, a migration is in flight), the reader
returns `null`, which the guard treats as "entity already gone" and
SKIPS the optimistic check. A request never 500s because of a missing
column; the existing CRUD path runs unchanged.

### 3.6 Client wiring

**`useGuardedMutation`** (`packages/ui/src/backend/injection/useGuardedMutation.ts`):

When `operation()` throws and the underlying response was a 409 with
`code: 'optimistic_lock_conflict'`, emit a default flash via the i18n key
`ui.forms.flash.recordModified` ("This record was modified by someone else.
Refresh and try again."). The existing `retryLastMutation` is left intact —
after the user refreshes, they can resave.

**`CrudForm`** (`packages/ui/src/backend/CrudForm.tsx`):

When `values.updatedAt` is present on the loaded record, automatically
inject the `x-om-ext-optimistic-lock-expected-updated-at` header on every
`PUT`/`PATCH`/`DELETE` request issued through the form. Implemented via
`withScopedApiRequestHeaders(...)` so existing call sites do not change.

Both behaviors are **silent additive** — pages that do not opt in (no
`OM_OPTIMISTIC_LOCK` env, no `updatedAt` on the record) see zero behavior
change.

### 3.7 Enterprise extension contract

The enterprise `record_locks` module remains responsible for:

- Acquiring and releasing pessimistic locks.
- Presence/heartbeat.
- Force-release.
- Merge UI on 409.

It hooks into the OSS optimistic guard via two mechanisms:

1. **Priority composition.** Enterprise registers its pessimistic check at
   priority `40`; the OSS optimistic check defaults to priority `50`. Lower
   priority runs first. If enterprise acquires the lock for this user, the
   pessimistic check passes; if it fails (`recordLocks.heldByOther`), the
   guard runner short-circuits and the OSS check never runs.
2. **`resolveExpectedUpdatedAt(input)` extension point** (added in Phase 2,
   but not used by OSS — reserved). Allows the enterprise module to
   override how the expected token is resolved (e.g. read it from the
   enterprise lock record instead of the request header), without forking
   the OSS guard.

This composition is documented in the docs page in Phase 5 — but the
enterprise-side implementation of #2 is **not part of this PR**.

---

## 4. Backward Compatibility

| Surface | Impact |
|---|---|
| Database schema | None. No new column, no migration. |
| API request shape | Additive: clients MAY send the new extension header. Servers ignore it when the guard is OFF. |
| API response shape | Additive: 409 with the structured body **only** fires when the guard is opted in AND the client sends the header AND the timestamps mismatch. Pre-existing 409 emitters (validation errors) keep their existing body shape. |
| `MutationGuard` contract | None. We use the existing `crudMutationGuardService` DI service, which is the documented public extension point. |
| Event IDs | None added. |
| Widget spot IDs | None added. |
| ACL features | None added in OSS. Enterprise `record_locks` module already owns `record_locks.*`. |
| `i18n` keys | Additive: `ui.forms.flash.recordModified`. |
| Env vars | `OM_OPTIMISTIC_LOCK` is now **default ON** (Phase 14, 2026-05-27). Absent / empty → `{ mode: 'all' }`. Opt out with `OM_OPTIMISTIC_LOCK=off` (or `false` / `0` / `no` / `disabled` / `none`). The runtime stays strictly additive: requests that omit the `x-om-ext-optimistic-lock-expected-updated-at` header continue to pass through; only clients that opt into the header (e.g. `CrudForm` with `optimisticLockUpdatedAt`) can receive a 409. |
| `CrudForm` behavior | Strictly additive: header injection only fires when `values.updatedAt` is present AND the guard is enabled server-side. |

No deprecations. No removals. No renames. Full additive.

---

## 5. Testing strategy

### 5.1 Unit tests (this PR)

`packages/shared/src/lib/crud/__tests__/optimistic-lock.test.ts`:

- `parseOptimisticLockEnv`: 8+ cases — `undefined`, `''`, `'all'`,
  `'  all  '`, allow-list, allow-list with whitespace and dupes,
  `'all,customers.company'`, non-string fallback.
- Header parser: missing, malformed (non-ISO), valid (`2026-05-25T08:42:18.123Z`).
- Mismatch detection: equal, off by 1 ms, off by 1 second, current
  newer than expected, current older than expected (rare but possible
  with clock skew — still treated as conflict).
- Service `validateMutation`: returns `ok: true` when mode is `'off'`;
  returns `ok: true` when no header sent; returns `ok: false` with
  status 409 + the structured body on mismatch.

`packages/ui/src/backend/injection/__tests__/useGuardedMutation-optimistic.test.tsx`:

- When `operation()` throws with a 409 + `optimistic_lock_conflict` code,
  `flash('ui.forms.flash.recordModified', 'error')` is called.
- Other errors do NOT trigger the new flash.

### 5.2 Integration test (this PR)

`packages/core/src/modules/customers/__integration__/TC-LOCK-OSS-001.spec.ts`:

1. Fixture-create one company.
2. Snapshot `updatedAt` after the create.
3. Issue an `UPDATE` request **without** the optimistic header → expect
   `200` (guard skips when header absent).
4. Re-fetch the company; snapshot the new `updatedAt` (call it `T1`).
5. Issue an `UPDATE` request **with** the header set to `T1` →
   expect `200`. Re-fetch; capture `T2`.
6. Issue an `UPDATE` request **with** the header still set to `T1`
   (now stale) → expect `409` with body
   `{ error: 'record_modified', code: 'optimistic_lock_conflict',
   currentUpdatedAt: T2, expectedUpdatedAt: T1 }`.
7. Teardown deletes the company.

Run under `OM_OPTIMISTIC_LOCK=customers.company` set in the test
environment (the integration runner already supports per-spec env via
`playwright.config.ts`).

### 5.3 Follow-up integration tests (next PR — Phase 5.3)

- `TC-LOCK-OSS-002.spec.ts` for `customers.person` — same shape.
- `TC-LOCK-OSS-003.spec.ts` for `sales.order` — same shape.

---

## 6. Phases (1:1 with the run plan)

See `.ai/runs/2026-05-25-oss-optimistic-locking.md` for the executable plan
with Progress checklist. Summary:

1. Phase 1: Spec + run scaffolding (this document + run plan).
2. Phase 2: Core guard service in `@open-mercato/shared`.
3. Phase 3: Client wiring (`useGuardedMutation` + `CrudForm` + i18n).
4. Phase 4: Reference entity wiring (`customers.company`) + integration test.
5. Phase 5: Docs page + Task Router row. Follow-up wiring for
   `customers.person` + `sales.order` deferred to the next PR.
6. Phase 6: Validation gate + PR + decision-matrix comment.

---

## 7. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Guard registration conflicts with enterprise `record_locks` legacy bridge | Use guard priorities (OSS=50, enterprise=40). Enterprise runs first and short-circuits the runner on its own failures. |
| Client clock skew causes spurious 409s | Header value is **echoed** by the client from the last server response (not the client's wall clock). Server is the only timestamp authority. The CrudForm wiring in Phase 3.2 enforces this — we never inject `Date.now().toISOString()`. |
| Older clients (no `CrudForm`, no `useGuardedMutation`) miss the header | Guard PASSES when header is absent. This is intentional opt-in semantics. Such clients keep last-write-wins behavior, just as today. |
| Non-`CrudForm` write paths (e.g. raw `apiCall` in custom components) miss protection | Same as above — additive opt-in. Documented in the docs page. Future improvement: a `useGuardedMutation` helper that reads the header from a `useOptimisticLockToken()` hook. Out of scope. |
| `updated_at` is not always sub-second-monotonic when bulk operations occur within the same DB transaction | The optimistic guard runs **after** the entity write, so the DB-emitted `updated_at` is what's compared. Same-transaction updates would not race through HTTP. |
| Boy Scout / DS rule — we touch `CrudForm.tsx` and `useGuardedMutation.ts` | Both files already comply. We only add a small effect / a small branch. Boy Scout migration scope = nil. |

---

## 8. Decision matrix (recorded for the architectural log)

For the record, here are the options considered for each open question
and which one was selected (recommended). The full matrix is also posted as
the first comment on the PR.

| Q | Options | Selected |
|---|---------|----------|
| Q1 wire transport | A: `If-Unmodified-Since` (HTTP std, second-precision) / B: `x-om-ext-optimistic-lock-expected-updated-at` (ms-precision) / C: inline JSON field | **B** |
| Q2 409 shape | A: generic `{ error }` / B: structured `{ error, code, currentUpdatedAt, expectedUpdatedAt }` / C: B + full current payload | **B** |
| Q3 env syntax | A: keyword `all` only / B: allow-list only / C: both | **C** |
| Q7 default state | A: opt-in (default OFF) / B: default ON for every CRUD entity / C: default ON with explicit `off` opt-out tokens | **C** — landed via Phase 14 (2026-05-27). Default flipped to ON; `off` / `false` / `0` / `no` / `disabled` / `none` opt out. Strict-additive runtime contract preserved (clients that do not send the header still pass). |
| Q4 enterprise hook | A: priority composition / B: token-resolution hook / C: both | **C** |
| Q5 reference entities | A: 1 (`customers.company`) / B: 3 (`customers.company` + `customers.person` + `sales.order`) / C: platform-wide via `makeCrudRoute` auto-registration | **C** — landed via Phase 13 of this spec; B-tier entities keep their hand-wired readers as polymorphic-table overrides. |
| Q6 integration test count | A: 1 pair / B: 1 pair per reference entity / C: B + 1 spec on a non-reference entity (`customers.deal`) to prove the generic path | **C** — `TC-LOCK-OSS-001..003` cover the 3 hand-wired references, `TC-LOCK-OSS-004` covers `customers.deal` via the auto-registered generic reader. |

---

## 9. Glossary

- **Optimistic locking**: Detect-conflict-at-write strategy. Cheap; surfaces
  conflicts only when they actually collide.
- **Pessimistic locking**: Prevent-conflict-by-acquire strategy. Heavier
  (acquire round-trip, lock record, heartbeat); appropriate for high-stakes
  workflows.
- **Version token**: The `updated_at` value the client received with the
  read; sent back on the next write.
- **Static guard**: `MutationGuard` registered via `data/guards.ts`. No DB
  access.
- **DI guard**: `crudMutationGuardService` registered via `di.ts`. Container-
  bound, has DB access.
- **Command-level check**: `enforceCommandOptimisticLock` (see §10). Same
  `updated_at` comparison, invoked directly inside a Command-pattern handler
  for writes that don't reach `makeCrudRoute`.

## 10. Command-level extension (`enforceCommandOptimisticLock`)

The CRUD guard (§3) only covers mutations that flow through `makeCrudRoute` and
expose a top-level `id` to the factory. Domain writes implemented via the
Command pattern — sales document sub-resources (lines, adjustments, returns),
status transitions, quote→order conversion — run their own logic in a command
handler and may mutate an **aggregate** the CRUD guard never sees. The
generalist primitive `enforceCommandOptimisticLock(...)`
(`@open-mercato/shared/lib/crud/optimistic-lock-command`) closes that gap.

- Signature: `{ resourceKind, resourceId, current, expected?, request? }`.
  It resolves the expected version from the explicit `expected` override or the
  request header, normalizes both sides with the same `normalizeIsoToken` the
  CRUD guard uses, and throws `CrudHttpError(409, OptimisticLockConflictBody)`
  on mismatch. No-op when env-disabled / no expected / no current — strictly
  additive; honors `OM_OPTIMISTIC_LOCK`.
- **Granularity — document-aggregate.** For an aggregate (a sales order/quote),
  the command guards the aggregate root, not each child row: the client sends
  the parent document's `updated_at`. Sub-resource commands recalc the document
  totals, which dirties the parent so its `updated_at` advances on flush — so
  concurrent sub-edits conflict. Do NOT apply this to a route that already runs
  the `makeCrudRoute` row-level guard (one exposing a top-level `id`); the two
  would compare different versions against the single header and false-409.
- **Sales reference.** `enforceSalesDocumentOptimisticLock(ctx, document, kind)`
  in `packages/core/src/modules/sales/commands/shared.ts`, wired into order/quote
  lines + adjustments, return create, and quote conversion (closes the #2114
  accept/convert race). Payments/shipments stay on their existing row-level
  guard (flat command input keeps the factory `candidateId`). Full coverage
  matrix + remaining deferrals: `.ai/specs/2026-05-28-optimistic-locking-coverage-completion.md`.
