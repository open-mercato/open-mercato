export type SalesOfferLabels = {
  salesOffer: string
  cooperationProposal: string
  quote: string
  client: string
  email: string
  validUntil: string
  item: string
  quantity: string
  unitPrice: string
  total: string
  net: string
  tax: string
  amountDue: string
  notes: string
}

export interface PdfDocumentData {
  locale: string
  labels: SalesOfferLabels
  document: {
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
  seller: {
    name: string
    company: string
    email: string
    phone?: string
  }
  lines: Array<{
    title: string
    description?: string
    quantity: number
    unitPrice: number
    total: number
    currency: string
  }>
  totals: {
    subtotal: number
    tax: number
    total: number
    currency: string
  }
  notes?: string
}
