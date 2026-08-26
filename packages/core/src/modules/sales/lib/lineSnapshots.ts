import type { SalesOrderLine, SalesQuoteLine } from '../data/entities'
import { cloneJson } from '../commands/shared'
import type { SalesLineSnapshot } from './types'

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
