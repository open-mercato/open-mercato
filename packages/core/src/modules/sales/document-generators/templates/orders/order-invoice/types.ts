export type OrderInvoiceLabels = {
  invoice: string
  invoiceNumber: string
  date: string
  dueDate: string
  billTo: string
  seller: string
  company: string
  email: string
  address: string
  items: string
  description: string
  details: string
  quantity: string
  unitPrice: string
  amount: string
  subtotal: string
  tax: string
  amountDue: string
  notes: string
  due: string
  payByBankTransfer: string
  paymentInstructions: string
  bankName: string
  routingNumber: string
  accountNumber: string
  swiftCode: string
}

export interface OrderInvoiceData {
  locale: string
  labels: OrderInvoiceLabels
  document: {
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
  paymentDetails?: {
    bankName?: string
    routingNumber?: string
    accountNumber?: string
    swiftCode?: string
  }
}
