export const SALES_OFFER_LABEL_KEYS = [
  'title',
  'number',
  'date',
  'validUntil',
  'client',
  'seller',
  'item',
  'quantity',
  'unitPrice',
  'total',
  'subtotal',
  'adjustments',
  'tax',
  'grandTotal',
  'notes',
  'draftWatermark',
] as const

export type SalesOfferLabelKey = (typeof SALES_OFFER_LABEL_KEYS)[number]

export type SalesOfferLabels = Record<SalesOfferLabelKey, string>

export interface SalesOfferLine {
  title: string
  description?: string
  quantity: number
  unitPrice: number
  total: number
  currency: string
}

export interface SalesOfferData {
  locale: string
  isDraft: boolean
  labels: SalesOfferLabels
  document: {
    id: string
    number: string
    date: string
    validUntil?: string
  }
  client: {
    name: string
    email?: string
    company?: string
    address?: string
  }
  seller?: {
    name: string
    email?: string
    phone?: string
  }
  lines: SalesOfferLine[]
  totals: {
    subtotal: number
    adjustments: number
    tax: number
    total: number
    currency: string
  }
  notes?: string
}
