# Expose custom fields on shipment items and payment allocations

**Status:** implemented
**Issue:** #8068
**PR:** #10904

## Problem

`sales_shipment_item` and `sales_payment_allocation` are registered as custom entities in
`sales/ce.ts`, but the nested `items[]` schema on `shipmentCreateSchema` and the nested
`allocations[]` schema on `paymentCreateSchema` never accepted a `customFields` payload, and
`commands/shipments.ts` / `commands/payments.ts` never wrote, snapshotted, or restored child
custom field values — unlike order/quote lines, which already support this via
`replaceOrderLines`/`replaceQuoteLines`.

## Changes

- `data/validators.ts`: `customFields: z.record(z.string(), z.unknown()).optional()` is added to
  the shipment-item and payment-allocation nested object schemas (additive, optional field —
  existing payloads remain valid). Each child entry is also preprocessed through a local
  normalizer (`normalizeChildCustomFieldsInput`) so `customFields` (object or `{key,value}[]`),
  `customValues`, and `cf_*`/`cf:*` keys are all folded into the same `customFields` shape before
  Zod strips unknown keys — matching the normalization the route layer already applies to the
  parent payload, and reached by every caller of these schemas (route or direct command dispatch).
- `commands/shipments.ts` / `commands/payments.ts`: each child's custom fields are written via
  `setRecordCustomFields` right after the child row is created, matching the existing order-line
  pattern. Every lifecycle path that removes a child row (full-replace on update, delete, and
  create-undo) now also purges that child's `CustomFieldValue` rows, scoped by tenant the same way
  `setRecordCustomFields` itself reconciles (its own tenant, or the instance-global `NULL` tenant —
  never another tenant's). `ShipmentSnapshot` gained `itemCustomFields` (keyed by item id) and
  `PaymentAllocationSnapshot` gained `customFields` so audit/undo/redo restore child custom fields.
  Allocation rows get an explicit `id` at creation time so restore can recreate them under their
  original id.
- Parent-order optimistic-lock enforcement (`enforceSalesDocumentOptimisticLock` on create/update/
  delete of shipments and payments) is unchanged — still guards the parent order's aggregate
  version before any child write.

### Scope note — replace semantics, not retained-child identity

Shipment items and payment allocations use a full "replace" write model on update (every update
deletes all existing children and recreates them from the submitted array) — the same model
order/quote lines already use for their bulk `lines[]` replace. This change keeps that model and
matches it exactly: a child's custom fields are written when supplied and left untouched when
omitted, because there is no previous row to retain across a replace — consistent with how
order/quote line custom fields already behave. Introducing identity-preserving partial upserts for
shipment items/allocations (so a retained child's omitted custom fields explicitly preserve its
prior values across an update) would be a separate, larger behavior change beyond custom-field
exposure, and is left as a follow-up if that stronger guarantee is wanted.

### Scope note — per-child custom-field writes, not batched

Each child write calls `setRecordCustomFields` once per item/allocation, which loads its own scoped
field-definition set and flushes per call. This mirrors the existing `replaceOrderLines`/
`replaceOrderAdjustments` pattern used for order lines and adjustments today — no "replace children"
write path in this module batches these calls. Introducing a genuinely batched multi-record
custom-field writer (shared definition lookup once per entity/scope, a single multi-row write) is a
cross-cutting change to `packages/core/src/modules/entities/lib/helpers.ts` that would also apply to
order lines and adjustments, not just these two new child types — tracked separately as a follow-up
rather than folded into this additive fix.

## Migration & Backward Compatibility

All changes are additive and pass the `BACKWARD_COMPATIBILITY.md` contract-surface checks:

| Surface | Change | Classification |
|---|---|---|
| API request schema (`shipmentCreateSchema.items[]`, `paymentCreateSchema.allocations[]`) | New optional `customFields` field, plus payload normalization for existing supported forms (`customValues`, `cf_*`, `cf:*`) | ✓ ADDITIVE — existing payloads that omit `customFields` continue to validate and behave exactly as before |
| Exported type (`ShipmentSnapshot`) | New optional `itemCustomFields?: Record<string, Record<string, unknown>> \| null` | ✓ ADDITIVE (optional field) |
| Exported type (`PaymentAllocationSnapshot`) | New optional `customFields?: Record<string, unknown> \| null` | ✓ ADDITIVE (optional field) |
| Database schema | None — custom field values are stored in the existing `CustomFieldValue` EAV table under the existing `sales_shipment_item` / `sales_payment_allocation` entity ids | ✓ NO CHANGE |
| Command IDs, event IDs, route URLs | Unchanged | ✓ NO CHANGE |

No deprecation protocol applies — no existing contract is narrowed, renamed, or removed.
