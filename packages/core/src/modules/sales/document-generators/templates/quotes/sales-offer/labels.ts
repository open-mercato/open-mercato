import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import type { SalesOfferLabels } from './types'

const key = (name: keyof SalesOfferLabels) => `sales.documents.templates.salesOffer.${name}`

export function buildSalesOfferLabels(translate?: TranslateFn): SalesOfferLabels {
  const resolve = translate ?? ((translationKey: string) => translationKey)
  return {
    salesOffer: resolve(key('salesOffer')),
    cooperationProposal: resolve(key('cooperationProposal')),
    quote: resolve(key('quote')),
    client: resolve(key('client')),
    email: resolve(key('email')),
    validUntil: resolve(key('validUntil')),
    item: resolve(key('item')),
    quantity: resolve(key('quantity')),
    unitPrice: resolve(key('unitPrice')),
    total: resolve(key('total')),
    net: resolve(key('net')),
    tax: resolve(key('tax')),
    amountDue: resolve(key('amountDue')),
    notes: resolve(key('notes')),
  }
}
