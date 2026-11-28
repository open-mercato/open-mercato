# 🔍 Pre-implementation analysis: Availability Contract — Phase 3 (Reservations), eComm Release 5

**Readiness: no-go.** The revised spec settles A1–A21 in substance, but it still mis-describes the codebase in three places that a re-land PR will be reviewed against. If you build step 0 and step 2 from the text as written, you get a gate that disagrees with `wms`'s own allocator about staging and dock stock, a lock-order claim that is false, and cache invalidation wired to an event nobody listens for. All three are one-paragraph spec fixes.

Spec: `.ai/specs/2026-08-14-availability-contract.md` (Phase 3: §4.1–§4.4, §5.3, §7, §9, §10, §12, §13 Phase 3, §15) · audited 2026-11-19 against `BACKWARD_COMPATIBILITY.md` (14 categories), built-in template (no spec template in `.ai/specs/`) · code baseline: worktree `feat/r5-spec-revision` on `origin/main` `5d93cbd8bf`, whose `wms`, `availability` and `shared/lib/availability` files are byte-identical to merge-base `b7b5309ccc` · reference: `refs/remotes/pr/8268` = `bdb747c36a`.

Evidence abbreviations, all at `bdb747c36a` unless marked *main*:
- **S**: `packages/core/src/modules/wms/lib/wmsReservationService.ts`
- **IA**: `packages/core/src/modules/wms/commands/inventory-actions.ts`
- **RC**: `packages/core/src/modules/availability/lib/reservationCommands.ts`
- **SW**: `packages/core/src/modules/availability/lib/reservationSweep.ts`
- **AC**: `packages/core/src/modules/wms/lib/availabilityCalculation.ts`

## ⛔ Blocking before implementation

1. **C1 — §4.2 / §13 step 0: the "one SQL builder" leaves out the staging/dock exclusion that `main` already applies on reserve, and the gate cannot run that SQL anyway.** Fix: add the location-type rule to §4.2 and replace "one SQL builder" with "one sellable computation". [C1](#c1)
2. **C2 — §4.1b "Deadlocks": the claim that every other `wms` writer locks in id order is false.** `main` locks by `(createdAt, id)`, so the "no lock cycle" argument does not hold. Fix: choose one global order, or specify a 40P01 retry. [C2](#c2)
3. **C3 — §4.1b / §6 / A19: the cache invalidation is said to ride on `wms.inventory.reserved`.** The subscriber listens to `wms.inventory_balance.*`, and the reference's `emitSideEffects` emits only CRUD side effects. Fix: describe the real mechanism and say what happens to the `wms.inventory.*` domain events. [C3](#c3)

## ⚠️ Decisions for the spec owner

| # | Question | Recommended answer | Trade-off |
|---|---|---|---|
| O1 | Order inside `availability.reserve`: hold row first (§4.1b step 1) or gate first (reference RC:530-568)? | Hold first, as the spec says; the reference must change. | With gate first, a same-key race blocks on the balance `FOR UPDATE`. The loser can then return `reserved:false` and emit `availability.shortfall.detected` (RC:573-594) instead of replaying the winner, which breaks A15. Hold first costs a savepoint and an extra replay read. |
| O2 | Confirmed-first path (§4.4): keep the spec's design (read `E.sales.sales_order_line`, release on key collision, public `quantity` on `wms.inventory.release`) or adopt the reference's protocol? The reference uses an advisory lock per (org, source, order, variant), covering `order` rows, `sourceTargetQuantity` on the automation, a `\|converted\|<id>` key suffix, and private `shrinkReservationBuckets` (S:391-422, 571-628, 1046-1191). | Adopt the reference protocol and rewrite §4.4 and §15 to it. It survived three review rounds (R8, R18, `d32d849c44`, `bb8cdf27be`). Drop the public `quantity` input from §15. | The reference adds contract to `wms.inventory.reserve` (`sourceTargetQuantity`, `sourceHeldQuantity`, `409 source_reservation_busy`) and an advisory lock on every automation reserve for all wms tenants. |
| O3 | `stock_lost`: should the hold become terminal? At the reference it stays `expired`/`released` (RC:961-985), so every repeated `commit` re-gates and re-notifies. | Add a terminal `stock_lost` marker, either a `status_reason` value or a status, so a repeat returns `stock_lost` without a second notification. | Without it, each checkout retry sends ops another notification. |
| O4 | Commit recovery quantity: the reference re-reserves `heldQuantity` in `exact` mode even for backorder lines, and never nets out `order` rows the automation already holds (RC:885-896; #9398, author's known gap). | Re-gate `heldQuantity` in `exact` mode (spec text is wrong to say "same per-line rules"), and subtract active `order` rows for the order under the conversion lock. | Netting needs the advisory lock from O2. |
| O5 | `'checkout'` rows in staff UI. The reference rejects release of `'checkout'` rows with `400 checkout_reservation_is_system_only` (IA:671-673), and the spec is silent on this. `wms.inventory.allocate` still accepts them. | Keep the release rejection, hide release and allocate for `'checkout'` rows in `WmsInventoryConsolePage`, and state both in §4.4. | If staff may release them instead, drift (a) closes the hold within the hour. |
| O6 | Policy store scope at reserve: the reference always resolves policies with `storeId: null` (RC:465-476), and the reserve input has no `storeId`. | Add an optional `storeId` to the `reserve` input (additive) and have checkout pass the session's store. | Without it, a store-level `allow_backorder` or `is_stock_managed=false` row applies at browse but not at submit, so the buyer sees a shortfall on an item the PDP called backorderable. |

## 📋 Readiness gate

| # | Item | Result | Evidence / fix |
|---|---|---|---|
| R1 | Declared status | ✅ | "Specification (… Phase 3 pending, revised 2026-10-26)". No repo template defines ready values; Phases 1–2 were implemented from the same status. |
| R2 | No blocking open questions | ✅ | §14 Q1/Q3/Q4/Q6 are deferred, Q2 is narrowed and Q5 is closed. None blocks Phase 3. No `⚠ NEEDS HUMAN CONFIRMATION` entries. |
| R3 | Traceability | ✅ (with gaps) | §12 names an oracle per behaviour. Missing: that the real-Postgres suites actually run in CI (I11), and a step-0 oracle for staging/dock (C1). |
| R4 | Contracts defined | ✅ (with gaps) | Commands, validation and events are specified. Error codes are incomplete (I4). §4.1b signatures do not match what will be frozen (I19). |
| R5 | Phases deliverable | ✅ | Step 0/1/2 each have a gate. The re-land plan splits them further (W1, W1b, W2, AV1, AV2a, AV2b, AV3); see N8. |
| R6 | Grounded in the codebase | ❌ | C1, C2 and C3 mis-describe `main`. |

## 💥 Backward compatibility

| # | Surface (BC doc) | Step | Change | Severity | Migration path |
|---|---|---|---|---|---|
| B1 | 9 DI Service Names | 1–2 | New key `wmsReservationService`. §4.1b/§15 freeze five methods "as specified", but the real shapes take `ctx`, return no `WmsWriteResult`, add `findReservationsByIds`/`listActiveReservationsBySourceType`, and the options `sourceTargetQuantity`/`rejectSourceTypes` (S:770, 941, 1046, 1209, 1331, 1363, 1392). | Warning | Rewrite §4.1b/§15 to the real signatures before step 1 freezes them (I19). Mark the two list/find helpers internal or freeze them too. |
| B2 | 3 Signatures / 7 API (command and route input) | 2 (AV2b) | `wms.inventory.reserve` gains an optional `sourceTargetQuantity`, an optional `sourceHeldQuantity` in its result, and a new `409 source_reservation_busy`. The HTTP route strips the input (reference `wms/data/validators.ts`, `inventoryReservationCreateCommandSchema`; IA:111-132, 638; S:138). None of this is in §15. | Warning | Add to §15 as additive, plus an `UPGRADE_NOTES.md` line (redelivery on `source_reservation_busy` affects every wms tenant). |
| B3 | 7 API Route URLs (behaviour) | 1 (W1b) | `POST /api/wms/inventory/release` on a non-`active` row becomes a no-op. *main* decrements again or throws `balance_integrity_violation`. A lost insert race on reserve now replays from a savepoint (`f0cbc792a6`, `f048f6dd08`). §13 step 1 says "no behaviour change". | Warning | Name both as deliberate fixes in §13 step 1 / §15 and `UPGRADE_NOTES.md`. |
| B4 | 7 API Route URLs | AV1 | `'checkout'` is refused with `400` on reserve and release. The reference widens the shared zod enum and rejects in the command (IA:593-600, 671-673), so the OpenAPI request schema advertises `checkout`. The spec says the route schema narrows the enum and mentions only reserve. | Warning | Choose one (spec text or command guard); document the release rejection; if the guard is kept, mark the value system-only in the OpenAPI doc. |
| B5 | 2 Types | AV1 | `InventoryReservationSourceType` adds `'checkout'`. §15 files this under category 8; it is category 2 (exported union) plus a `text` column with no migration. | Warning (label only) | Fix the category; the `UPGRADE_NOTES.md` entry is already planned. |
| B6 | 5 Event IDs | AV2a–AV3 | New `availability.reservation.*` and `availability.shortfall.detected` are additive. The existing `wms.inventory.reserved` / `.released` / `.low_stock` are not emitted for checkout holds (S:1392-1421). Nothing breaks, but a consumer that counts these events misses checkout traffic. | Warning | See C3 / I8. |
| — | 8 DB, 11 Notification, 1 Auto-discovery, 14 Generated | 2 | New table `availability_reservations`, notification `availability.stock_lost_after_payment`, new `commands/`, `notifications.ts` and `workers/` files. All additive. | OK | — |
| — | 4, 6, 10, 12, 13 | — | Untouched. Phase 3 adds no ACL feature, route, CLI command or spot id. | OK | — |

§15 exists and covers most surfaces. B1–B4 are its missing lines.

## 📝 Spec completeness

| Section | Missing / incomplete | Impact | What to add |
|---|---|---|---|
| §4.1 errors | 403 on a caller/input scope mismatch (RC:428-431, `shared/lib/commands/scope.ts`), `404 reservation_not_found` on `commit` (RC:795, which checkout treats as a no-op), and `409 commit_conflict` (RC:938, 948) are undefined. | Checkout and the reviewers depend on these codes. | An error table per command. |
| §4.1b composition | No word on `ctx.transactionalEm` (#8414 fix `44c3d8ef7e`, RC:446) or on when events fire under a caller-owned transaction. | See I3. | A "called inside a caller transaction" subsection. |
| §10 | No schedule registration for existing tenants (#8822), no per-hold failure isolation, and no reported-only drift case (committed hold with released rows, SW:268-280). | Stock leaks on upgraded tenants; one poison hold stops expiry for the tenant. | I12, I13, N9. |
| §12 | No requirement that the PG suites are selected by a CI runner, and no pool-sized-to-concurrency test. | Review history: five rounds where the suites never ran. | I11. |
| §5.3 | `status_reason` example says `expired`, while §10 and the code use `ttl` (SW:77). `expires_at` is nullable in the migration. The hold stores no `warehouseIds`, so recovery uses `null` (RC:926). | Minor drift. | N2, N5. |

## 🔍 Repo-rule compliance

| Rule (source) | Spec location | Fix | Severity |
|---|---|---|---|
| A catch that records an error MUST also `reportError` (AGENTS Task Router, logging/error-reporting) | §4.1 "never fails silently"; the reference notification catch swallows errors (RC:763-765) | Port with `reportError` + log. | Important |
| Never hard-code user-facing strings (AGENTS Never) | §16 i18n row; reference `buildLog` uses English `actionLabel`s and drops the audited `reason` (`availability/commands/reservations.ts:47-56`) | i18n label keys; put `reason` in the log context. | Important |
| Nothing under a row/advisory lock may take a second pool connection; use `em.execute()` on the transactional em, never `em.getConnection().execute()` (review-history invariant 2; #8414) | §4.1b/§4.2 "one `SELECT … FOR UPDATE` statement", "one SQL builder"; *main* AC:101 uses `getConnection().execute` | State the invariant in §4.1b; the gate reads with `lockMode: PESSIMISTIC_WRITE` through the trx (S:259-265). | Important |
| Error contracts across a DI boundary use `isCrudHttpError`, not `instanceof` (review R1 Blocker; TC-WMS-002/021/027) | §13 step 1 gate | Add to step 1 deliverables and gate (I9). | Important |
| Module schedules: `seedDefaults` misses existing tenants; the scheduler rebuilds `scope`; deterministic ids must pass `z.uuid()` (lessons `module-schedules-can-only-target-workers-owned-by-the-same-module`, `deterministic-schedule-ids-must-pass-scheduler-validators`) | §10 "schedules registered in `setup.ts`", payload `{ tenantId }` | Add the configs upgrade action and assert the tenant reaches the worker through the scheduler scope (I12). | Important |
| New encryption map needs a `buildEncryptionMapBackfillSql` migration (`packages/core/AGENTS.md` Encryption; #8893) | §5.3 | Not triggered: the hold holds no personal data and the reference adds no `encryption.ts`. Say so in §5.3 (N6). | Nice-to-have |
| Optimistic locking on new user-editable entities (AGENTS Always) | §5.3 | Compliant: not user-editable, CAS-fenced, stated. | — |

## ⚠️ Risks

| Risk | Level | Impact | Mitigation |
|---|---|---|---|
| Pool exhaustion under parallel last-unit submits (#8414, still failing in QA round 4) | High | 500s on concurrent checkout | Pass `transactionalEm`; no second connection under lock; pool = concurrency PG suite (`reservationCommands.pool-exhaustion.integration.test.ts`) wired into CI (I3, I11). |
| Lock-order inversion between the gate (id order) and `wms.inventory.reserve` / automation (`createdAt, id`) | High | Postgres 40P01 aborts one side: a failed submit or a redelivered automation event | C2. |
| Confirmed-first conversion or recovery over-reserves (#9183, #9398, R18) | High | An order holds more than it needs | O2, O4; port `confirmedFirstConversion.concurrency.pg.test.ts`. |
| Browse/gate drift on staging/dock and lots | High | PDP shows stock that submit refuses, or a raw `409` escapes instead of a structured shortfall | C1. |
| Real-PG suites skip silently without the env var (review: five rounds) | High | AV2a merges with zero executed coverage; reserve/release have no mocked suite | I11. |
| Events emitted before the caller's commit, then the outer transaction rolls back | Medium | Phantom `availability.reservation.created` and index updates for a hold that never existed | I3. |
| One failing hold aborts the expiry tick (SW:73, no per-hold catch) | Medium | Abandoned holds stay held for the whole tenant | I13. |
| Recovery leaves `wms_reservation_ids` stale (RC:930-934) | Medium | `hold_committed_wms_released_or_missing` fires every hour for every recovered hold | I6. |
| Checkout submit reachable before the expiry worker lands | Medium | Only checkout's own recovery frees abandoned holds | I18. |
| Exhaustive `switch` over the widened union | Low | Compile error for third parties | `UPGRADE_NOTES.md` (planned). |

## 🔍 Gaps

<a id="c1"></a>
- **Critical C1 — §4.2 / §13 step 0 / R13.** §4.2 says ineligible lots are excluded "matching `wms.inventory.reserve`" and that "one SQL builder" serves the read provider and the gate.
  - Since WMS Phase 2 (#5621), *main*'s reserve also drops staging/dock balances: `isBalanceLocationReservable` (`wms/lib/inventoryPolicy.ts:28`, *main* IA:515-534).
  - The §4.2 SQL and *main*'s read path have no location join (*main* AC:82-101).
  - The gate cannot run that SQL either. It must read locked rows through the transaction. *main* AC:101 uses `em.getConnection().execute`, outside it. The reference therefore aggregates client-side (S:362-369) and shares only `computeSellableQuantities` (S:1242).
  - The reference excludes staging in the gate (S:277) but not on the read path. That is the R1 Major "gate and reserve location sets differ" (`f048f6dd08`), which made shortfalls escape as a raw `409`.
  - **Fix.** §4.2:
    - add `JOIN wms_locations` and exclude `type IN ('staging','dock')` (and soft-deleted locations), matching `isBalanceLocationReservable`, on both paths;
    - define "one computation" as one shared function over aggregated rows, with the read path's SQL and the gate's locked ORM read as two inputs;
    - add a step-0 test "staging/dock stock is not sellable".
  - **Classification.** (a) for the spec, (b) for the reference read path.

<a id="c2"></a>
- **Critical C2 — §4.1b "Deadlocks".** The spec claims every `wms` writer locks "ordered by id" and that the gate's single id-ordered statement therefore makes a cycle impossible.
  - *main* `listCandidateBalances` locks `orderBy: { createdAt: 'asc', id: 'asc' }` (*main* IA:519-523; reference S:655). UUID order and creation order are unrelated.
  - So a gate transaction and a concurrent `wms.inventory.reserve` on the same `(warehouse, variant)` can lock the same rows in opposite orders.
  - **Fix.** Either lock the gate in `(createdAt, id)` order within a variant, with variants ordered by variant id, which is what makes the orders compatible; or keep id order and add 40P01 (deadlock) and 55P03 to the failure-mode table with one bounded retry.
  - **Classification.** (a) spec, (b) reference (S:259-265 orders by id).

<a id="c3"></a>
- **Critical C3 — §4.1b "after the commit", §6, R15, A19.** The text says `emitSideEffects` runs "the `wms.inventory.reserved` event, so the existing `invalidate-availability-cache` subscriber fires".
  - That subscriber listens to `wms.inventory_balance.*` (*main* `wms/subscribers/invalidate-availability-cache.ts:15`).
  - The reference `emitSideEffects` emits only CRUD side effects for reservations and balances (S:1392-1421). It emits no `wms.inventory.reserved`/`.released` and runs no low-stock check; only the command wrappers do (IA:619, 678).
  - Followed literally, the spec wires invalidation to an event the cache does not hear.
  - **Fix.** State that invalidation comes from the balance CRUD side effects, and decide whether the service path also emits `wms.inventory.reserved/released` and `emitLowStockEventIfNeeded` (I8).
  - **Classification.** (a).
- **Important I1 — §4.1b order (O1).** (b): the reference inserts the hold last (RC:556-568).
- **Important I2 — §4.1 `not_tracked` row (D-R5-18).** The tenant's selected provider is never checked; only `!wmsService || !isStockManaged` (RC:264). A tenant on `catalog-only` with `wms` installed browses as `not_tracked` but gets stock held at submit. (b)
- **Important I3 — composition with a caller transaction.**
  - The reference uses `callerCtx?.transactionalEm ?? em.fork()` (RC:446, 670, 786; checkout `submit.ts:279, 760`), so its "after commit" emits (RC:607, 720, 842) run before the caller's commit.
  - *main* provides `onTransactionLifetimeComplete` (`packages/shared/src/lib/commands/transaction-lifetime.ts:49`) and `ctx.transactionLifetime`.
  - **Fix.** Add to §4.1b: with `transactionalEm`, defer `emitSideEffects` and the module events to the owner's commit callback and drop them on rollback.
  - **Classification.** (a) + (b).
- **Important I4 — error codes.** Add `403` (scope), `404 reservation_not_found`, `409 commit_conflict` and `409 idempotency_key_mismatch` per command to §4.1. (a)
- **Important I5 — §4.4 confirmed-first protocol (O2).** The text describes a design the reference replaced. (a)
- **Important I6 — commit recovery.** Unspecified behaviours at the reference:
  - it releases leftover active checkout rows first (RC:900-919);
  - a `not_convertible` result on a still-`active` hold goes to recovery (RC:824, 834-839);
  - `wms_reservation_ids` is not rewritten to the new `order` rows (RC:930-934), which produces false drift reports (SW:268-280);
  - automation rows are not netted (O4).

  Classification: (a) for the first two, (b) for the last two.
- **Important I7 — `stock_lost` repeatability (O3).** (c)
- **Important I8 — the gate path skips the `wms.inventory.reserved`/`.released` domain events and the low-stock check** (S:1392-1421 vs IA:619, 678). A checkout that drops stock below the reorder point raises no `wms.inventory.low_stock`. Fix: call the same post-commit emits as the command wrappers. (b), or (c) if left out deliberately.
- **Important I9 — §13 step 1 "no behaviour change".** The later steps need two deliberate changes to the existing commands:
  - savepoint replay of a raced insert (`f0cbc792a6`);
  - non-`active` release as a no-op (`f048f6dd08`; *main* has no guard; A21, the expiry sweep and drift (a) depend on it).

  The step is also unsafe without `isCrudHttpError` at the six `wms/api` catch sites plus the automation predicates (`f1e42b6d02`; review R1 Blocker). Fix: list these as step 1 (or W1b) deliverables and make TC-WMS-002/021/027 part of the gate. (a)
- **Important I10 — `'checkout'` system-only scope (O5, B4).** (c)
- **Important I11 — real-Postgres execution.** §12 must require:
  - PG suites for the race cases, the product pool, pool exhaustion and confirmed-first;
  - a CI runner that selects them. *main*'s `test:pg-integration` regex (`packages/core/package.json:11`) has no `availability`, and there is no `test:pg-concurrency` or `postgres-availability` service yet (`.github/workflows/ci.yml`);
  - a `jest --listTests` check.

  Evidence: review rounds R4, R6, R11, R23 and R27; #9183. (a)
- **Important I12 — schedules for existing tenants.** Add the upgrade action `availability.register-reservation-sweep-schedules` (reference `configs/lib/upgrade-actions.ts:242-256`, version `'0.10.0'` against *main* `0.11.0`) to §10/§15 and `UPGRADE_NOTES.md`, as `cart.register-sweeper-schedules` already does (*main* `configs/lib/upgrade-actions.ts:215`). #8822 lists AV3 as an owner. (a)
- **Important I13 — expiry failure isolation.** Wrap each hold in try/catch with `reportError`, continue the batch, and keep a poison hold from starving the tenant (SW:73-94). (b)
- **Important I14 — `storeId` at reserve (O6).** (a)/(c)
- **Important I15 — dependency on F1.** RC:25 imports `buildTrustedCommandContext` from `@open-mercato/shared/lib/commands/trusted-context`, which does not exist on *main* (`packages/shared/src/lib/commands/` listing). §13 step 2 must name F1 as a prerequisite. (a)
- **Important I16 — rule violations at the reference** (compliance table): silent notification catch; English audit labels; `reason` not audited. (b)
- **Important I17 — quantity type.** The reserve input accepts any positive number, but the item snapshot requires an integer `requested` (reference `availability/data/validators.ts:107` vs `:129`). `warehouseIds: []` has no defined meaning (`:154`), and the issue key `availability.reservations.errors.duplicateLine` is in no locale file (`:144`). Fix: define integer-or-decimal (wms quantities are numeric) and `[]`, and align the schemas. (a) + (b)
- **Important I18 — landing order.** Checkout submit (CH4) must not reach `main` before the expiry worker (AV3). Otherwise only checkout's own recovery frees abandoned holds. State this in §13. (a)
- **Important I19 — §4.1b names and shapes (B1).**
  - The file is `wms/lib/wmsReservationService.ts`, not `reservationService.ts`.
  - The methods take `(trx, ctx, input)`; `emitSideEffects(ctx, sideEffects)`.
  - Release returns `quantity: string`; `convertInTransaction` returns `outcome: converted | already_converted | covered_released | not_convertible`.

  (a)
- **Nice-to-have N1.** §15 category for the union is 2, not 8.
- **Nice-to-have N2.** `status_reason` is `ttl`; `expires_at` is nullable; the reference adds a redundant `availability_reservations_scope_idx` (entities:127, migration:11) and has no `down()`.
- **Nice-to-have N3.** §9 says the notification "names the lines"; the reference sends a line count, `sellableCount` (RC:756). Locales are en/pl/de/es/ko, while the spec says en/pl.
- **Nice-to-have N4.** Checkout uses release reason `'quote'` (checkout spec line 466), §4.1/§12 say `'quote_outcome'`. The `availability.release` reason allows 200 characters, while the public `wms.inventory.release` caps it at 120 (*main* `wms/data/validators.ts:250`); the service path does not re-validate.
- **Nice-to-have N5.** The hold does not store `warehouseIds`, so the commit recovery re-gate ignores them (RC:926).
- **Nice-to-have N6.** State in §5.3 that the table holds no personal data, so it needs no encryption map and no `buildEncryptionMapBackfillSql` (#8893 does not apply).
- **Nice-to-have N7.** §12 claims a route-level `400` test, but the reference tests the `400` only at command level. Add an API test.
- **Nice-to-have N8.** Align §13 Phase 3 with the seven re-land slices (W1, W1b, W2, AV1, AV2a, AV2b, AV3) so each PR has a spec gate.
- **Nice-to-have N9.** In §10, drift is also reported through telemetry `reportError` codes. Drift (b) is tenant-wide. Add the report-only case "committed hold, rows released or missing".

## Spec vs. reference implementation

| # | Spec § | Spec says | Reference `bdb747c36a` | Class |
|---|---|---|---|---|
| 1 | §4.2, §13 step 0 | One SQL builder, both paths; lot rule only | Gate aggregates locked rows client-side (S:362-369) and shares `computeSellableQuantities` (S:1242). Gate excludes staging/dock (S:277); read path does not (AC `loadBalanceAggregates`). | (a) spec + (b) read path |
| 2 | §4.1b | One `SELECT … FOR UPDATE`, id order | ORM `PESSIMISTIC_WRITE`, `orderBy id` (S:259-265), plus per-warehouse re-lock by `createdAt, id` (S:655) | (a) wording; C2 is (b) |
| 3 | §4.1b steps 1–5 | Hold row first | Gate first, hold inserted last (RC:530-568); unique-violation replay outside the trx (RC:596-603) | (b) (O1) |
| 4 | §4.1b, §15 | `reservationService.ts`, no `ctx`, `WmsWriteResult`, 5 methods | `wmsReservationService.ts`, `ctx` arg, own result types, 7 methods (S:770-1392) | (a) |
| 5 | §4.1b, A19 | `emitSideEffects` runs `wms.inventory.reserved` | CRUD side effects only (S:1392-1421) | (a) text; (b) if domain events are wanted (I8) |
| 6 | §4.1 table, D-R5-18 | Selected provider ≠ `wms` → `not_tracked` | Not checked (RC:264) | (b) |
| 7 | §4.1 Scope | Scope by (tenant, org, key) | Also `ensureTenantScope`/`ensureOrganizationScope` on the caller ctx → 403 (RC:428-431) | (a) add |
| 8 | §4.1b | — | `transactionalEm` reuse (RC:446); events before the outer commit | (a) + (b) (I3) |
| 9 | §4.1 Commit | "not-found command error" | `404 reservation_not_found` (RC:795), `409 commit_conflict` (RC:938, 948) | (a) |
| 10 | §4.1 Commit recovery | "same per-line rules", `stock_lost` | `heldQuantity`, `exact` (RC:885-896); releases leftover checkout rows (RC:900-919); `not_convertible` → recovery (RC:824); `wms_reservation_ids` stale (RC:930-934); no automation netting (#9398); `stock_lost` not terminal (RC:961-985) | (a) / (b) / (c) (I6, O3, O4) |
| 11 | §4.4 pt 2–3, §15 | Read sales lines through the query engine; release on key collision; public `quantity` on `wms.inventory.release` | Covering `order` rows under an advisory lock (S:1098-1150), `sourceTargetQuantity` in the automation, `\|converted\|<id>` suffix (S:1182), private newest-first shrink (S:391-422), no `quantity` input (reference `wms/data/validators.ts:260-265`) | (a) (O2) |
| 12 | §15 | — | `sourceTargetQuantity`, `sourceHeldQuantity`, `409 source_reservation_busy`, 5 retries (IA:111-132, 638; S:138, 817-819) | (a) (B2) |
| 13 | §4.4 A16 | Route schema narrows the enum; reserve only | Enum widened; command rejects reserve (IA:593-600) **and** release (IA:671-673) | (c) (O5, B4) |
| 14 | §13 step 1 | No behaviour change | Savepoint replay, idempotent release, `isCrudHttpError` at 6 routes + automation | (a) (I9) |
| 15 | §4.1 Validation | positive number | positive non-integer accepted; snapshot requires an integer; `warehouseIds: []` undefined; missing i18n key | (a) + (b) (I17) |
| 16 | §4.1 / §5.2 | Same policy chain as the read path | `storeId: null` always (RC:465-476) | (c) (O6) |
| 17 | §5.3 | `status_reason` `expired`; `expires_at` not null | `ttl` (SW:77); nullable; extra scope index | (a) |
| 18 | §9 | Notification names the lines; en/pl | Line count (RC:756); 5 locales; silent catch (RC:763) | (a) wording/locales; (b) catch |
| 19 | §10 | Schedules in `setup.ts` | `seedDefaults` + upgrade action `0.10.0` (`configs/lib/upgrade-actions.ts:242-256`) | (a) (I12); version is (c) |
| 20 | §10 | Per-hold transaction | Per-hold transaction, but no per-hold catch (SW:73-94) | (b) (I13) |
| 21 | §10 drift | (a)(b)(c) | Plus report-only "committed, rows released or missing" (SW:268-280); (c) skips `not_convertible` silently (SW:302) | (a) |
| 22 | §16 command row | Audited, reason recorded | `buildLog` drops `reason`, English labels (`commands/reservations.ts:47-56`) | (b) |
| 23 | §13 step 2 | — | Imports F1 `trusted-context` (RC:25), absent from *main* | (a) dependency |

## Findings A1–A21 of `ANALYSIS-2026-10-26-availability-release-5.md`

| Finding | Status in the revised spec | Residual |
|---|---|---|
| A1 one transaction via a `wms` service | Resolved (§4.1b) | Signature drift (I19); caller-transaction composition (I3); lock order (C2) |
| A2 Phase 2 alignment first | Partly resolved (step 0) | Staging/dock rule and "one builder" are unbuildable as written (C1) |
| A3 hold entity | Resolved (§5.3) | Minor column drift (N2) |
| A4 scope on release/commit | Resolved | Caller-ctx check and 403 not stated (I4) |
| A5 commit before payment | Resolved (D-R5-8) | Recovery details (I6, O3, O4) |
| A6 per-line outcomes | Resolved (D-R5-9) | Selected-provider rule not in the reference (I2) |
| A7 warehouse allocation | Resolved | — |
| A8 confirmed-first path | Partly resolved | Spec mechanism differs from the reference that survived review (O2, I5) |
| A9 quote release | Resolved | Reason string differs from checkout (N4) |
| A10 roadmap R5 | Resolved (roadmap line 578, changelog line 618) | — |
| A11 expiry job | Resolved | Existing-tenant schedules (I12), failure isolation (I13) |
| A12 drift check | Resolved | Report-only case and false reports after recovery (I6, N9) |
| A13 events and payloads | Resolved | Domain `wms.*` events on the service path (I8) |
| A14 undo | Resolved (D-R5-10) | — |
| A15 key mismatch | Resolved | Gate-first reference breaks it under same-key races (O1) |
| A16 system-only `'checkout'` | Partly resolved | Mechanism and release/allocate scope (O5, B4) |
| A17 TTL bounds | Resolved | — |
| A18 admin list out of scope | Resolved (D-R5-34) | — |
| A19 cache invalidation | Partly resolved | Mechanism mis-described (C3) |
| A20 coverage | Resolved (§12) | CI runner requirement (I11) |
| A21 idempotent release | Resolved for `availability.release` | Depends on the `wms` release guard that step 1 says it won't add (I9) |

Summary: 17 resolved (A1, A3–A7, A9–A15, A17, A18, A20, A21; some with residuals listed above), 4 partly resolved (A2, A8, A16, A19), none unaddressed.

## 📋 Remediation plan

1. **Before implementation (spec edits)**
   - C1, C2 and C3.
   - Record O1–O6.
   - Rewrite §4.4 and §15 for O2/B2; fix §4.1b signatures (I19); add the §4.1 error table (I4) and the caller-transaction subsection (I3).
   - Step 1 deliverables (I9).
   - §10 upgrade action (I12); §12 PG-runner requirement (I11); F1 and AV3-before-CH4 ordering in §13 (I15, I18).
2. **During implementation (add to each slice plan)**
   - W1: `isCrudHttpError` sites.
   - W1b: savepoint replay and release guard.
   - W2: staging/dock on the read path.
   - AV1: decide the release/allocate UI for `'checkout'` rows.
   - AV2a:
     - hold-first ordering;
     - selected-provider check;
     - deferred post-commit emits;
     - PG suites wired into CI;
     - pool-exhaustion proof.
   - AV2b: recovery rewrites `wms_reservation_ids` and nets automation rows; terminal `stock_lost`; `reportError` in the notification catch.
   - AV3: per-hold isolation and the upgrade action.
   - All slices: i18n audit labels and `reason` in the log.
3. **After implementation (follow-up)**
   - N1–N9.
   - Store-to-warehouse mapping (Open Question 2).
   - Move the spec to `implemented/` after AV3.

## 🧪 Audit limits

- Read in full: the spec; `ANALYSIS-2026-10-26-availability-release-5.md`; the D-R5 rows 8/9/10/18/20/31/32/34; `BACKWARD_COMPATIBILITY.md` §2–§14; the skill references.
- Read: the slice analysis `analysis/slices-wms-availability.md`, the review history (availability, wms and cross-cutting invariants), and appendix B of the issues.
- Verified on *main*: `wms/commands/inventory-actions.ts`, `wms/data/{entities,validators}.ts`, `wms/lib/{availabilityCalculation,inventoryPolicy,primaryWarehousePolicy}.ts`, `wms/subscribers/*`, `shared/lib/commands/{types,transaction-lifetime}.ts`, `configs/lib/upgrade-actions.ts`, `packages/core/package.json`, and the `ci.yml` diff since the merge-base (scoping only, no PG wiring).
- Verified at the reference: two read-only sub-agents extracted and read S, IA, RC, SW, the commands, entities, validators, events, notifications, workers, setup, scheduling, the migration and the upgrade actions. I spot-checked RC:258-270, 440-450, 526-570 and 880-935; S:1388-1421; SW:58-96.
- Not done: nothing was built, type-checked or run. The deadlock in C2 is inferred from the lock orders, not reproduced. Whether #9398's double-hold reproduces was not tested. The tracker was not queried; issue states come from the appendix as of 2026-11-19. No suspected prompt injection was found.
