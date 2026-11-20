import type { SalesLineUomSnapshot } from '../../lib/types'

export type SalesLineRecord = {
  id: string
  name: string | null
  description?: string | null
  productId: string | null
  productVariantId: string | null
  quantity: number
  quantityUnit: string | null
  normalizedQuantity: number
  normalizedUnit: string | null
  currencyCode: string | null
  unitPriceNet: number
  unitPriceGross: number
  /** Exact decimal string of `unitPriceNet`; prefer it for display and edits. */
  unitPriceNetExact?: string | null
  /** Exact decimal string of `unitPriceGross`; prefer it for display and edits. */
  unitPriceGrossExact?: string | null
  /** Resolved discount for the whole line, not per unit. */
  discountAmount?: number
  /** Exact decimal string of `discountAmount`. */
  discountAmountExact?: string | null
  /** Percentage the discount was requested as, if it was requested that way. */
  discountPercent?: number
  taxRate: number
  totalNet: number
  totalGross: number
  /** Exact decimal string of `totalNet`. */
  totalNetExact?: string | null
  /** Exact decimal string of `totalGross`. */
  totalGrossExact?: string | null
  priceMode: 'net' | 'gross'
  uomSnapshot: SalesLineUomSnapshot | null
  metadata: Record<string, unknown> | null
  catalogSnapshot: Record<string, unknown> | null
  customFieldSetId?: string | null
  customFields?: Record<string, unknown> | null
  status?: string | null
  statusEntryId?: string | null
}
