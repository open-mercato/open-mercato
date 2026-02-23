import type { SalesLineUomSnapshot } from '../../lib/types'

export type SalesLineRecord = {
  id: string
  name: string | null
  productId: string | null
  productVariantId: string | null
  quantity: number
  quantityUnit: string | null
  normalizedQuantity: number
  normalizedUnit: string | null
  currencyCode: string | null
  unitPriceNet: number
  unitPriceGross: number
  taxRate: number
  totalNet: number
  totalGross: number
  priceMode: 'net' | 'gross'
  uomSnapshot: SalesLineUomSnapshot | null
  metadata: Record<string, unknown> | null
  catalogSnapshot: Record<string, unknown> | null
  customFieldSetId?: string | null
  customFields?: Record<string, unknown> | null
  status?: string | null
  statusEntryId?: string | null
}
