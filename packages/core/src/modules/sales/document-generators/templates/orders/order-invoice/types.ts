export const ORDER_INVOICE_LABEL_KEYS = [
  'title',
  'number',
  'date',
  'dueDate',
  'client',
  'seller',
  'item',
  'quantity',
  'unitPrice',
  'total',
  'subtotal',
  'discount',
  'shipping',
  'surcharge',
  'tax',
  'grandTotal',
  'paid',
  'outstanding',
  'notes',
] as const

export type OrderInvoiceLabelKey = (typeof ORDER_INVOICE_LABEL_KEYS)[number]

export type OrderInvoiceLabels = Record<OrderInvoiceLabelKey, string>

export interface OrderInvoiceLine {
  title: string
  description?: string
  quantity: number
  unitPrice: number
  total: number
  currency: string
}

export interface OrderInvoiceData {
  locale: string
  labels: OrderInvoiceLabels
  document: {
    id: string
    number: string
    date: string
    dueDate?: string
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
  lines: OrderInvoiceLine[]
  totals: {
    subtotal: number
    discount: number
    shipping: number
    surcharge: number
    tax: number
    total: number
    paid: number
    outstanding: number
    currency: string
  }
  notes?: string
}
