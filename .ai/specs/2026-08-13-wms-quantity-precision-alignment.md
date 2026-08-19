# WMS Quantity Precision and Profile Alignment

## TLDR

P1.3b aligns WMS storage and arithmetic with the exact normalized quantity produced by P1.3a. It widens WMS quantity capacity without narrowing existing values, replaces ledger-critical JavaScript-number arithmetic with the shared exact-decimal utility, and prevents new or changed WMS inventory profiles from disagreeing with the Catalog base unit.

It is independently deployable: WMS becomes safer for all inventory consumers even before immutable per-movement UoM evidence and correlated reversal arrive in P1.3c.

## Overview and Status

**Status:** Design complete — readiness review pending.

**Roadmap classification:** P1.3b, WMS-owned backlog. It resolves an existing inconsistency and is non-critical for current WMS operation, Site, draft BOM/routing, kernel, and non-stock order work. It is mandatory before P1.8 freezes stock-posting payloads or P1.11 enables stock-affecting production.

**Dependency:** Accepted P1.3a exact decimal and Catalog resolver contract in `2026-08-13-catalog-quantity-normalization.md`.

**Successor:** `2026-08-13-wms-quantity-evidence-reversal.md`.

## Problem Statement

WMS currently stores balance, reservation, movement, reorder, safety-stock, and capacity quantities as `numeric(16,4)` while Catalog/Sales normalization supports six fractional digits and conversion factors support twelve. WMS validators accept finite JavaScript numbers but do not reject excess scale before persistence. Commands convert database decimals to `number`, calculate with ordinary addition/subtraction and epsilon comparisons, then serialize with `String(number)`.

Consequences include silent database rounding, cumulative fractional drift, unstable comparisons, and a profile `defaultUom` that can differ from the Catalog base unit even though stock quantities are implicitly interpreted in that unit.

## Scope

### In scope

- A complete inventory and data-distribution audit of WMS quantity columns and arithmetic paths.
- Non-narrowing precision widening for inventory quantities.
- Canonical decimal-string validators and compatibility adapters for existing numeric API fields.
- Exact arithmetic on balance, reservation, allocation, movement, import, reconciliation, and cycle-count paths.
- Catalog validation of new or changed WMS profile `defaultUom` and product/variant identity.
- Degraded reporting for ambiguous legacy profile mismatches.
- Migrations, API/OpenAPI compatibility, unit tests, integration tests, and operational evidence.

### Out of scope

- Quantity/UoM snapshots on individual reservations or movements.
- `reversalOfMovementId`, remaining-reversible accounting, or production movement semantics.
- New movement/reference enums for issue, output, scrap, or backflush.
- Catalog/Sales normalization behavior, owned by P1.3a.
- Site, BOM, production order, or MES behavior.

## Current State Audit

| Surface | Current state | Evidence | Gap |
|---|---|---|---|
| Inventory profile | `defaultUom` required text; UI usually copies Catalog `defaultUnit` | `wms/data/entities.ts`; `widgets/injection/catalog-inventory-profile/widget.ts` | Direct API permits mismatch |
| Profile commands | Store provided string and enforce only WMS-table uniqueness/configuration | `wms/commands/configuration.ts` | No canonical Catalog validation |
| Balance | on-hand/reserved/allocated/available `numeric(16,4)` | `wms/data/entities.ts`; `Migration20260707180000.ts` | Narrower than accepted normalized contract |
| Reservation/movement | quantity `numeric(16,4)` | `wms/data/entities.ts`; `Migration20260428110546.ts` | Same mismatch |
| Inputs | `z.coerce.number().finite()` plus sign checks | `wms/data/validators.ts` | No exact scale/overflow guard |
| Commands | `Number`, arithmetic operators, `Math.min`, epsilon, `String(number)` | `wms/commands/inventory-actions.ts`; `commands/shared.ts` | Binary drift |
| Import/reconciliation | Number parsing and arithmetic | `wms/lib/inventoryImportService.ts`; `inventoryReconciliation.ts` | Bypass exact ledger rules |
| Integrity foundation | Transactions, row locking, idempotency keys | `inventory-actions.ts`; `lib/inventoryIdempotency.ts` | Reuse |

## Proposed Solution

### Precision decision

WMS must store at least the normalized envelope accepted by P1.3a. The starting candidate is `numeric(18,6)`, but the implementation audit selects the final widening after measuring existing integer magnitude and scale. The chosen type must:

- provide at least six fractional digits;
- preserve or increase the current 12 integer digits available in `numeric(16,4)`;
- accommodate existing rows without rounding;
- use the same envelope for balances, reservations, movements, reorder points, safety stock, relevant capacities, imports, and reconciliation values that share inventory quantity semantics.

Unrelated weight/capacity fields are classified explicitly and changed only when they participate in the same quantity invariant.

### Exact arithmetic boundary

- Domain values are canonical decimal strings.
- Compatibility adapters accept existing JSON numbers only on already published fields.
- Zod validation rejects exponent form, invalid scale, and overflow before a command mutates state.
- All addition, subtraction, comparison, minimum, sign, and zero checks use the P1.3a shared exact-decimal utility.
- Database-returned numeric strings stay strings through the command path.
- No epsilon is used for authoritative quantity equality.
- A previously normalized quantity is never rounded again.

Every converted path retains current command, transaction, row-lock, idempotency, audit, event, and cache behavior.

### Inventory profile integrity

For create/update of a WMS product inventory profile:

1. Reload the Catalog product and optional variant using scoped service/query contracts.
2. Verify variant-to-product ownership.
3. Resolve the canonical product base unit through the P1.3a Catalog contract.
4. Canonicalize `defaultUom` and require equality with the base unit.
5. Persist the canonical value or return a translated field error.

The injected Catalog form remains a convenience, not a security boundary. Direct WMS API writes perform the same validation.

Legacy mismatches remain readable and are surfaced as degraded configuration. Deterministic aliases such as `qty -> pc` may be proposed by the audit, but ambiguous values are never silently rewritten.

### Cross-module boundary

WMS already requires Catalog; P1.3b does not introduce a new dependency. It consumes a DI-resolved Catalog service or an existing sanctioned scoped query boundary, never a cross-module ORM relationship. P1.1 separately removes the unrelated hard requirement on Sales.

## Migration and Backward Compatibility

Before generating the migration, a dry-run report records for every affected column:

- row count and null count;
- minimum and maximum;
- maximum integer and fractional digits actually used;
- values outside the candidate target envelope;
- profile unit aliases, invalid codes, and Catalog mismatches.

Migration rules:

1. Widen column types only; never narrow or reinterpret stored values.
2. Preserve exact before/after string values and compare checksums/counts.
3. Update ORM metadata and the WMS migration snapshot together.
4. Keep existing API URLs, methods, fields, and meanings.
5. Existing numeric inputs remain accepted within the explicit envelope.
6. Invalid/excess values now fail with `422` rather than relying on database rounding.
7. Legacy profile mismatches do not block reads or unrelated stock operations until an administrator edits the profile.
8. Do not run `yarn db:migrate` without explicit user approval.

If an online type alteration is unsafe at measured volume, use a staged additive column/backfill/swap compatibility plan and queue/progress for more than 1,000 rows. Any swap must respect the additive-only schema contract and retain deprecated columns for the compatibility window.

## API and Errors

| Error | Status | Meaning |
|---|---|---|
| `wms.quantity_invalid` | `422` | Not a canonical or compatible decimal input |
| `wms.quantity_precision_overflow` | `422` | Value exceeds accepted integer/fractional capacity |
| `wms.uom_profile_mismatch` | `422` | Profile unit differs from Catalog base unit |
| `wms.catalog_product_not_found` | `404` | Product/variant is absent or outside caller scope |

OpenAPI documents exact string additions and legacy numeric compatibility. Existing responses remain stable; additive exact-string fields may be introduced where current serialization loses representation.

## Implementation Tasks

| Task | Deliverable | Evidence |
|---|---|---|
| B1 | Machine-readable WMS quantity surface/data inventory | All columns, routes, commands, imports, reports classified |
| B2 | Final precision decision | Approved envelope with real-data magnitude/scale report |
| B3 | ORM and additive widening migration | Reviewed SQL, snapshot update, before/after proof |
| B4 | Exact input adapters and validators | Boundary, scale, malformed, and legacy-number tests |
| B5 | Exact ledger arithmetic | Balance/reserve/allocate/release/receive/move/adjust/count tests |
| B6 | Import and reconciliation convergence | Same exact results as command paths |
| B7 | Profile Catalog validation | UI and direct API parity, variant ownership, scope tests |
| B8 | Compatibility/decoupling gate | Existing API regressions plus WMS without Sales after P1.1 |

## Acceptance Tests

- Every pre-migration WMS value reads back byte-equivalent in decimal meaning.
- Values with six fractional digits persist without narrowing.
- One more fractional/integer digit than supported fails before database mutation.
- Repeated fractional reserve/allocate/release cycles produce the exact starting balance.
- Concurrent fractional reservations cannot over-reserve or lose an update.
- Import, manual action, and reconciliation produce the same exact delta.
- New/updated profile units equal the scoped Catalog base unit.
- Direct API cannot bypass product/variant ownership validation.
- Legacy mismatches remain visible with a translated warning and can be corrected.
- Existing integer and four-decimal API clients retain behavior.
- Tests create and clean scoped fixtures without seeded/demo data.

P1.3b completes when WMS cannot silently narrow an accepted normalized quantity and all authoritative inventory arithmetic is exact. It unblocks P1.3c but does not by itself provide immutable per-operation evidence.

## Performance, Security, and Cache

- Existing row-locking and transaction boundaries remain unchanged.
- Exact arithmetic must meet an agreed command latency budget against representative batch sizes.
- Profile validation is a bounded point lookup; list routes do not add per-row Catalog calls.
- Any cache is DI-resolved, scoped by tenant/org/product, and invalidated on Catalog product/conversion changes.
- Every query filters tenant and organization; foreign IDs fail without disclosure.
- Quantity/UoM data is non-PII; encryption changes are N/A.
- Inputs use zod and parameterized ORM/query-engine access.
- Logs record error codes and scoped IDs, not full payloads.

## Risks and Impact Review

| Severity | Scenario | Mitigation | Residual risk |
|---|---|---|---|
| Critical | Migration rounds or overflows existing balance | Data audit, widening-only rule, before/after comparison | Low |
| Critical | Cross-tenant product validates a profile | Scoped lookup and adversarial integration test | Low |
| High | One arithmetic path remains on `number` | Complete inventory and named regression matrix | Medium until conversion ends |
| High | Type alteration locks a large table | Volume probe and staged online plan when needed | Medium |
| Medium | Strict validation rejects formerly accepted excess precision | Explicit `422`, release notes, compatibility tests | Medium |
| Medium | Legacy profile mismatch remains operational | Degraded reporting and administrator correction | Medium |
| Low | Exact arithmetic adds latency | Benchmarks and batch operations | Low |

## Validation and Compliance

Documentation validation uses `git diff --check` and `yarn agents:check-budget`. Implementation uses `yarn generate`, `yarn db:generate`, relevant shared/core tests, core build, and self-contained WMS integration tests. Migration application requires approval.

- One capability: safe WMS quantity storage/arithmetic and current profile alignment.
- P1.3c evidence/reversal is explicitly excluded.
- No cross-module ORM relationships.
- Migration is widening/additive and API behavior is preserved.
- Commands, guards, tenant scope, OpenAPI, audit, idempotency, and cache mechanisms remain canonical.
- No new UI except translated degraded-state feedback on the existing profile surface.

**Verdict:** Design complete as WMS-owned non-critical backlog, pending P1.3a and pre-implementation readiness audit; mandatory before stock-affecting production.

## Changelog

- 2026-08-13: Created P1.3b from the audited WMS precision/profile portion of the original quantity proposal.

### Review — 2026-08-13

- **Reviewer:** Agent
- **Security:** Passed.
- **Performance:** Passed with migration-volume gate.
- **Cache:** Passed.
- **Commands:** Passed.
- **Risks:** Passed.
- **Verdict:** Approved as design; implementation remains gated.
