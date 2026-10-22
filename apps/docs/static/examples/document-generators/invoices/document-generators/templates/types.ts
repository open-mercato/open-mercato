export interface InvoiceTemplateData {
  locale: string
  isDraft: boolean
  labels: {
    title: string
    number: string
    total: string
    draftWatermark: string
  }
  document: { id: string; number: string }
  totals: { total: number; currency: string }
}
