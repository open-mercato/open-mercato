import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import type { OrderInvoiceLabels } from './types'

const key = (name: keyof OrderInvoiceLabels) => `sales.documents.templates.orderInvoice.${name}`

export function buildOrderInvoiceLabels(translate?: TranslateFn): OrderInvoiceLabels {
  const resolve = translate ?? ((translationKey: string) => translationKey)
  return {
    invoice: resolve(key('invoice')),
    invoiceNumber: resolve(key('invoiceNumber')),
    date: resolve(key('date')),
    dueDate: resolve(key('dueDate')),
    billTo: resolve(key('billTo')),
    seller: resolve(key('seller')),
    company: resolve(key('company')),
    email: resolve(key('email')),
    address: resolve(key('address')),
    items: resolve(key('items')),
    description: resolve(key('description')),
    details: resolve(key('details')),
    quantity: resolve(key('quantity')),
    unitPrice: resolve(key('unitPrice')),
    amount: resolve(key('amount')),
    subtotal: resolve(key('subtotal')),
    tax: resolve(key('tax')),
    amountDue: resolve(key('amountDue')),
    notes: resolve(key('notes')),
    due: resolve(key('due')),
    payByBankTransfer: resolve(key('payByBankTransfer')),
    paymentInstructions: resolve(key('paymentInstructions')),
    bankName: resolve(key('bankName')),
    routingNumber: resolve(key('routingNumber')),
    accountNumber: resolve(key('accountNumber')),
    swiftCode: resolve(key('swiftCode')),
  }
}
