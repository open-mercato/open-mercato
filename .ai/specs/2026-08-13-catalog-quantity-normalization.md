# Catalog Quantity Normalization Contract

## TLDR

P1.3a makes the existing Catalog UoM model authoritative and deterministic. It adds one Catalog-owned resolver over the existing base unit, product conversion, and rounding fields; moves exact decimal arithmetic into a pure shared utility; and makes Catalog pricing plus Sales normalization use the same result.

This capability does not change WMS storage or add inventory evidence. It is independently deployable and fixes current contradictions where configured rounding modes are ignored and successful normalization paths compute different results.

## Overview and Status

**Status:** Draft implementation specification based on the 2026-08-13 code audit.

**Wave 0 capability:** P1.3a, first part of the quantity/UoM/precision gate.

**Predecessor:** `implemented/SPEC-034-2026-02-18-units-of-measure-conversions.md`.

**Consumers:** P1.3b WMS precision alignment, P1.3c WMS quantity evidence/reversal, P1.7 released definitions, and P1.8 production postings.

## Problem Statement

Catalog already stores product base and sales units, `toBaseFactor numeric(24,12)`, rounding scale `0..6`, and rounding mode `half_up|down|up`. Sales already stores normalized quantities and immutable UoM snapshots. The runtime does not consistently honor that model:

- Catalog product-list pricing multiplies JavaScript numbers without applying the configured policy.
- Catalog price filtering applies `Math.round` and a scale but ignores the stored rounding mode.
- Sales always normalizes with hard-coded scale `6` and `half_up`, then writes those values into its snapshot.
- Missing conversions can fall back to raw quantity in pricing paths.
- Exact database decimal strings are converted to IEEE-754 numbers before business decisions.
- Variant inheritance and operational dictionary behavior are implicit.

The same product, quantity, and unit can therefore produce different results depending on the caller.

## Scope

### In scope

- Pure exact-decimal parse, canonicalize, compare, add, subtract, multiply, negate, and round operations in `@open-mercato/shared`.
- A Catalog DI service that resolves product policy and returns a provider-neutral immutable normalization snapshot.
- Product-level UoM inheritance for variants.
- Convergence of successful Catalog pricing and Sales line normalization paths.
- Compatibility adapters for existing numeric API inputs and existing Sales snapshots.
- Unit, contract, integration, scope, and backward-compatibility tests.

### Out of scope

- WMS column precision, profiles, balances, reservations, movements, or reversal.
- Variant-specific UoM overrides.
- A global conversion graph or dimensional-analysis engine.
- Purchasing/supplier UoM, catch weight, density, potency, yield, or process loss.
- New Catalog UoM configuration UI; the existing editor remains authoritative.

## Current State Audit

| Surface | Existing behavior | Evidence | Decision |
|---|---|---|---|
| Product policy | `defaultUnit`, `defaultSalesUnit`, quantity `numeric(18,6)`, rounding scale/mode | `packages/core/src/modules/catalog/data/entities.ts`; `data/validators.ts` | Reuse |
| Conversions | Product star topology, factor `numeric(24,12)`, scoped CRUD and undo | `catalog/data/entities.ts`; `commands/productUnitConversions.ts` | Reuse |
| Unit codes | Shared lowercase/trim canonicalization and `qty -> pc`; dictionary lookup may fall back when dictionary is absent | `packages/shared/src/lib/units/unitCodes.ts`; `catalog/lib/unitResolution.ts` | Preserve legacy CRUD; operational resolver fails closed without canonical base unit |
| Product pricing | Factor lookup and `quantity * factor`; no consistent policy rounding | `catalog/api/products/route.ts` | Delegate to resolver |
| Price filtering | Factor lookup plus `Math.round`; mode ignored | `catalog/api/prices/route.ts` | Delegate to resolver |
| Sales normalization | Fixed scale `6`, `Math.round`, snapshot states `half_up/6` | `sales/commands/documents.ts` | Delegate to resolver |
| Sales evidence | Entered/base unit and quantity, factor, rounding, source, normalized result | `sales/lib/types.ts`; `sales/data/entities.ts` | Preserve and bridge |

## Architecture and Contract

### Ownership

- Catalog owns product base unit, direct product conversion factors, and product rounding policy.
- Variants inherit all UoM policy from their parent product in P1.3a.
- Sales consumes the Catalog resolver and owns its document snapshots.
- Pure decimal operations live in `shared`; they contain no product, tenant, persistence, or module logic.
- Cross-module links remain scalar IDs. No new ORM relationship is introduced.

### Canonical decimal

Authoritative service inputs and outputs are base-10 strings. The canonical form:

- permits an optional `-`, digits, and optional fractional digits;
- rejects exponent notation, locale separators, whitespace, infinity, and `NaN`;
- removes redundant leading integer zeroes and trailing fractional zeroes;
- serializes zero as `"0"` and never `"-0"`.

Existing routes may continue accepting published JSON numbers, but compatibility adapters convert and validate them before domain arithmetic. Persistence and business comparisons do not use JavaScript `number`.

Implementation first evaluates existing repository exact-decimal code. A new production dependency requires separate approval.

### Rounding

- The existing product scale `0..6` remains authoritative.
- `half_up`, `down`, and `up` are all implemented and tested.
- Normalization performs exact multiplication, then rounds once to product scale.
- For signed values, the rounding policy applies to magnitude before restoring the sign. This makes negation deterministic for downstream reversals.
- Already normalized values are not re-rounded by consumers.
- Intermediate multiplication retains sufficient digits for an `18,6` entered quantity and `24,12` factor; overflow is checked before and after rounding.

### Catalog resolver

Catalog registers a DI service with a batch-capable additive interface conceptually equivalent to:

```ts
type QuantityNormalizationRequest = {
  tenantId: string
  organizationId: string
  productId: string
  productVariantId?: string | null
  enteredQuantity: string
  enteredUnitCode?: string | null
}

type QuantityNormalizationSnapshotV1 = {
  version: 1
  productId: string
  productVariantId: string | null
  baseUnitCode: string
  enteredUnitCode: string
  enteredQuantity: string
  toBaseFactor: string
  normalizedQuantity: string
  rounding: { mode: 'half_up' | 'down' | 'up'; scale: number }
  source: { conversionId: string | null; resolvedAt: string }
}
```

The final DI key and import path are frozen before publication. The service:

1. scopes every read by tenant and organization;
2. verifies that an optional variant belongs to the product;
3. requires a canonical product base unit;
4. defaults a missing entered unit to the base unit for operational calls;
5. resolves the implicit base factor `1` or exactly one active direct factor;
6. applies exact multiplication and product rounding once;
7. rejects invalid configuration and overflow;
8. returns canonical strings and immutable evidence.

Batch resolution groups requests by `(tenantId, organizationId, productId)` to avoid N+1 lookups.

### Failure contract

| Error | HTTP mapping when adapted | Meaning |
|---|---|---|
| `uom.unit_not_found` | `400` | Entered/base unit is not valid |
| `uom.default_unit_missing` | `422` | Product has no operational base unit |
| `uom.conversion_not_found` | `422` | No active direct factor exists |
| `uom.invalid_factor` | `422` | Factor is outside the accepted envelope |
| `uom.precision_overflow` | `422` | Input, intermediate, or result exceeds the contract |
| `uom.variant_product_mismatch` | `404` | Variant is unknown or not owned by the scoped product |

Operational resolution fails closed. Existing pricing routes may retain a documented legacy fallback only for requests that previously succeeded without an explicit alternate unit; an explicit unknown alternate unit must not silently select a raw-quantity tier.

## Data, API, and Compatibility

- No database migration is required for P1.3a.
- Existing Catalog fields and conversion rows retain their meaning.
- Existing Sales `uom_snapshot` version 1 remains readable and is not recalculated.
- New Sales writes use the Catalog result and map it losslessly into the existing snapshot.
- Existing API URLs, methods, and numeric request fields remain stable.
- New exact-decimal fields, if exposed, are additive strings.
- An optional HTTP normalization route may be added only if a real external/UI caller requires it; it must export `openApi`, use route metadata/feature guards, and remain read-only.
- Product/conversion writes invalidate resolver projections through tenant/org/product-scoped DI cache tags when caching is enabled.

## Implementation Tasks

| Task | Deliverable | Evidence |
|---|---|---|
| A1 | Complete inventory of Catalog/Sales normalization call sites | Reviewed list with no unclassified successful path |
| A2 | Pure shared exact-decimal utility | Unit tests for canonical form, signs, ties, scale `0..12`, overflow, negative zero |
| A3 | Catalog resolver and batch method | Scoped service contract tests and bounded query count |
| A4 | Product-list and price-filter convergence | Identical tier result for identical input/policy |
| A5 | Sales command convergence | Snapshot reflects actual product mode/scale and exact normalized value |
| A6 | Compatibility bridge | Existing numeric inputs and legacy snapshots pass regression tests |
| A7 | Cross-tenant and variant validation | Non-disclosing failures and no cross-scope data |

## Acceptance Tests

- Factor `1` returns the same canonical quantity.
- `2.5 box × 12 pc/box` returns `30 pc`.
- Half ties differ correctly under `half_up`, `down`, and `up`, including signed inputs.
- Twelve-decimal factors and scale `0..6` produce declared exact strings.
- Maximum accepted input persists; the next value fails before database use.
- Product listing, price filtering, and Sales line creation return the same normalization.
- Changing a factor after Sales line creation does not change the old snapshot.
- A variant inherits its product policy; a variant from another product/scope fails closed.
- Explicit missing/invalid conversion never falls back to raw quantity.
- Integration fixtures are created through APIs and cleaned in `finally`/teardown.

P1.3a is complete when one exact resolver governs every successful Catalog/Sales normalization path and compatibility tests show no unintended contract break. This unblocks P1.3b but does not by itself satisfy the Wave 0 quantity gate.

## Risks and Impact Review

| Severity | Scenario | Mitigation | Residual risk |
|---|---|---|---|
| Critical | Cross-scope factor is resolved | Scoped service and adversarial tests | Low |
| High | A caller retains independent `number` arithmetic | Call-site inventory and contract tests | Medium until migration completes |
| High | Changed rounding alters existing Sales results | Preserve old snapshots; regression corpus; explicit new-write behavior | Medium |
| Medium | Fail-closed behavior exposes invalid existing configuration | Compatibility telemetry and actionable errors | Medium |
| Medium | Shared utility absorbs business logic | Keep it pure; policy remains Catalog-owned | Low |
| Low | Batch resolver cache becomes stale | Request scope by default; tagged DI invalidation if longer-lived | Low |

## Validation and Compliance

Documentation validation:

```bash
git diff --check
yarn agents:check-budget
```

Implementation validation includes `yarn generate`, relevant shared/core unit tests, core build, and self-contained Catalog/Sales UoM integration tests. No migration is applied.

- One independently deployable capability: exact Catalog-owned normalization used by Catalog/Sales.
- No cross-module ORM relations; scalar IDs and DI service only.
- Tenant and organization scoping is mandatory.
- Existing contract surfaces are preserved or extended additively.
- Quantity data is non-PII; encryption changes are N/A.
- No new UI is introduced; existing UI remains translated and uses canonical primitives.

**Verdict:** Design complete, pending pre-implementation readiness audit.

## Changelog

- 2026-08-13: Created P1.3a from the audited Catalog/Sales portion of the original quantity/UoM/precision proposal.

### Review — 2026-08-13

- **Reviewer:** Agent
- **Security:** Passed.
- **Performance:** Passed; batch resolution and scoped caching are explicit.
- **Cache:** Passed.
- **Commands:** Passed; existing Sales writes remain command-driven.
- **Risks:** Passed.
- **Verdict:** Approved as design; implementation remains gated.
