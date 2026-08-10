/** Fully loaded quote data fetched from the database by fetchData. */
export interface QuoteRecord {
  id: string
  quoteNumber: string
  currencyCode: string
  validFrom: Date | null
  validUntil: Date | null
  comments: string | null
  grandTotalNetAmount: string
  grandTotalGrossAmount: string
  taxTotalAmount: string
  customerSnapshot: string | Record<string, unknown> | null
  billingAddressSnapshot: string | Record<string, unknown> | null
  lines: QuoteLineItem[]
}

export interface QuoteLineItem {
  id: string
  name: string | null
  description: string | null
  quantity: string
  unitPriceNet: string
  unitPriceGross: string
  totalNetAmount: string
  totalGrossAmount: string
  taxRate: string
  currencyCode: string
}

export type EntityCtor<T extends object> = new (...args: unknown[]) => T

export interface SalesQuoteRow {
  id: string
  tenantId: string
  organizationId: string
  quoteNumber: string
  currencyCode: string
  validFrom: Date | null
  validUntil: Date | null
  comments: string | null
  grandTotalNetAmount: string
  grandTotalGrossAmount: string
  taxTotalAmount: string
  customerSnapshot: string | Record<string, unknown> | null
  billingAddressSnapshot: string | Record<string, unknown> | null
  customerEntityId: string | null
  lines: { getItems(): SalesQuoteLineRow[] }
}

export interface SalesQuoteLineRow {
  id: string
  name: string | null
  description: string | null
  quantity: string
  unitPriceNet: string
  unitPriceGross: string
  totalNetAmount: string
  totalGrossAmount: string
  taxRate: string
  currencyCode: string
}

export interface CustomerAddressRow {
  entity: string
  isPrimary: boolean
  addressLine1: string
  addressLine2: string | null
  city: string | null
  region: string | null
  postalCode: string | null
  country: string | null
}
