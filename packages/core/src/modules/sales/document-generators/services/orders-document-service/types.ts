export interface CustomerSnapshot {
  contact?: {
    firstName?: string
    lastName?: string
  }
  customer?: {
    displayName?: string
    primaryEmail?: string
    personProfile?: {
      firstName?: string
      lastName?: string
    }
    companyProfile?: {
      legalName?: string
      brandName?: string
    }
  }
}

export interface BillingAddressSnapshot {
  addressLine1?: string
  addressLine2?: string | null
  city?: string | null
  region?: string | null
  postalCode?: string | null
  country?: string | null
}

/** Fully loaded order data fetched from the database by fetchData. */
export interface OrderRecord {
  id: string
  orderNumber: string
  currencyCode: string
  placedAt: Date | null
  expectedDeliveryAt: Date | null
  comments: string | null
  grandTotalNetAmount: string
  grandTotalGrossAmount: string
  taxTotalAmount: string
  customerSnapshot: CustomerSnapshot | null
  billingAddressSnapshot: BillingAddressSnapshot | null
  lines: OrderLineItem[]
}

export interface OrderLineItem {
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

export interface SalesOrderRow {
  id: string
  tenantId: string
  organizationId: string
  orderNumber: string
  currencyCode: string
  placedAt: Date | null
  expectedDeliveryAt: Date | null
  comments: string | null
  grandTotalNetAmount: string
  grandTotalGrossAmount: string
  taxTotalAmount: string
  customerSnapshot: CustomerSnapshot | null
  billingAddressSnapshot: BillingAddressSnapshot | null
  customerEntityId: string | null
  lines: { getItems(): SalesOrderLineRow[] }
}

export interface SalesOrderLineRow {
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
