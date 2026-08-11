export interface PdfDocumentData {
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
