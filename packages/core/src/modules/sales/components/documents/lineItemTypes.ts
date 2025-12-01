export type SalesLineRecord = {
  id: string
  name: string | null
  productId: string | null
  productVariantId: string | null
  quantity: number
  currencyCode: string | null
  unitPriceNet: number
  unitPriceGross: number
  taxRate: number
  totalNet: number
  totalGross: number
  priceMode: 'net' | 'gross'
  metadata: Record<string, unknown> | null
  catalogSnapshot: Record<string, unknown> | null
  customFieldSetId?: string | null
  customFields?: Record<string, unknown> | null
  status?: string | null
  statusEntryId?: string | null
}
