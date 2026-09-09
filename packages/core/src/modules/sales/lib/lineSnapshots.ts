import type { SalesOrderLine, SalesQuoteLine } from '../data/entities'
import { cloneJson } from './json'
import type { SalesLineDiscountBasis, SalesLineSnapshot } from './types'

function toNumeric(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function mapPersistedLine(line: SalesOrderLine | SalesQuoteLine): SalesLineSnapshot {
  return {
    id: line.id,
    lineNumber: line.lineNumber,
    kind: line.kind,
    productId: line.productId ?? null,
    productVariantId: line.productVariantId ?? null,
    name: line.name ?? null,
    description: line.description ?? null,
    comment: line.comment ?? null,
    quantity: toNumeric(line.quantity),
    quantityUnit: line.quantityUnit ?? null,
    normalizedQuantity: toNumeric(line.normalizedQuantity ?? line.quantity),
    normalizedUnit: line.normalizedUnit ?? line.quantityUnit ?? null,
    uomSnapshot: line.uomSnapshot ? cloneJson(line.uomSnapshot) : null,
    currencyCode: line.currencyCode,
    unitPriceNet: toNumeric(line.unitPriceNet),
    unitPriceGross: toNumeric(line.unitPriceGross),
    discountAmount: toNumeric(line.discountAmount),
    // The persisted column holds the discount for the whole line, so the
    // calculation engine must not multiply it out by quantity again. This flag
    // is the only thing standing between a round trip and a compounding
    // re-inflation, and it is why mappers must never set `discountAmountBasis`
    // instead — that one means "a caller asserted this".
    discountAmountFromStoredRow: true,
    discountPercent: toNumeric(line.discountPercent),
    taxRate: toNumeric(line.taxRate),
    taxAmount: toNumeric(line.taxAmount),
    // The totals below are the engine's own previous output read back off the
    // row, not something a caller asserted, so they are not reconciled against
    // the recomputed net (#5644) — on a legacy row that divergence is the
    // discount contract healing itself, not a caller mistake.
    totalsFromStoredRow: true,
    totalNetAmount: toNumeric(line.totalNetAmount),
    totalGrossAmount: toNumeric(line.totalGrossAmount),
    configuration: line.configuration ? cloneJson(line.configuration) : null,
    promotionCode: line.promotionCode ?? null,
    metadata: line.metadata ? cloneJson(line.metadata) : null,
    customFieldSetId: line.customFieldSetId ?? null,
  }
}

/**
 * Rebuild a calculation snapshot from a persisted order line.
 *
 * Shared by `commands/documents.ts` and `commands/returns.ts` on purpose: the
 * two files used to carry byte-identical copies, and that duplication is why
 * the return flows kept the discount defect after the order flows were fixed.
 */
export function mapOrderLineEntityToSnapshot(line: SalesOrderLine): SalesLineSnapshot {
  return mapPersistedLine(line)
}

export function mapQuoteLineEntityToSnapshot(line: SalesQuoteLine): SalesLineSnapshot {
  return mapPersistedLine(line)
}

type UpsertDiscountFields = Pick<
  SalesLineSnapshot,
  'discountAmount' | 'discountAmountBasis' | 'discountAmountFromStoredRow'
>

/**
 * Decide the discount fields of an upsert payload one operand at a time.
 *
 * A line upsert can source its amount from two places with opposite meanings: a
 * caller value, which is per unit unless the caller says otherwise, and the
 * stored row, which is always a line total. Collapsing them into a single
 * `caller ?? stored` expression means whichever origin the merged result is
 * tagged with is wrong half the time — and the half that breaks is the
 * upsert-existing path, which then re-inflates by a further factor of quantity
 * while looking perfectly correct.
 *
 * Keeping `null` rather than `0` for "nothing supplied" is deliberate too: the
 * column cannot represent that distinction, but the payload can, and the
 * calculation engine needs it to tell a suppressing zero from an absent value.
 */
export function resolveUpsertDiscountFields(
  callerAmount: number | null | undefined,
  callerBasis: SalesLineDiscountBasis | null | undefined,
  existingSnapshot: Pick<SalesLineSnapshot, 'discountAmount'> | null | undefined,
): UpsertDiscountFields {
  if (callerAmount !== null && callerAmount !== undefined) {
    return { discountAmount: callerAmount, discountAmountBasis: callerBasis ?? 'unit' }
  }
  return {
    discountAmount: existingSnapshot?.discountAmount ?? null,
    discountAmountFromStoredRow: existingSnapshot != null,
  }
}

/**
 * Decide whether the `totalNetAmount` an upsert payload ends up carrying is a
 * caller assertion or a value that came back off the stored row.
 *
 * The upsert merges caller input over the existing snapshot, so the merged
 * total has two possible origins and only the caller one is worth reconciling
 * against the recomputed net (#5644): a value read back off the row is what the
 * engine itself wrote last time, and on a legacy row it is exactly what
 * recalculation is supposed to heal.
 */
export function resolveUpsertTotalsOrigin(
  callerTotalNetAmount: number | null | undefined,
  existingSnapshot: Pick<SalesLineSnapshot, 'totalNetAmount'> | null | undefined,
): Pick<SalesLineSnapshot, 'totalsFromStoredRow'> {
  if (callerTotalNetAmount !== null && callerTotalNetAmount !== undefined) return {}
  return existingSnapshot != null ? { totalsFromStoredRow: true } : {}
}
