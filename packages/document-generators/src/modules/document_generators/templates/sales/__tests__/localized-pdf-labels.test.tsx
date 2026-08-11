import { isValidElement, type ReactNode } from 'react'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'

jest.mock('@react-pdf/renderer', () => ({
  Document: 'Document',
  Page: 'Page',
  Text: 'Text',
  View: 'View',
  Svg: 'Svg',
  Path: 'Path',
  Defs: 'Defs',
  LinearGradient: 'LinearGradient',
  Stop: 'Stop',
  Rect: 'Rect',
  StyleSheet: { create: (styles: unknown) => styles },
  Font: { register: jest.fn(), registerHyphenationCallback: jest.fn() },
}))

import { OrderInvoiceDocument } from '../orders/order-invoice/pdf'
import { buildOrderInvoiceLabels } from '../orders/order-invoice/labels'
import { CoverPage } from '../quotes/sales-offer/pdf/CoverPage'
import { QuotePage } from '../quotes/sales-offer/pdf/QuotePage'
import { buildSalesOfferLabels } from '../quotes/sales-offer/labels'

const translate = ((key: string) => `localized:${key.split('.').at(-1)}`) as TranslateFn

function collectText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(collectText).join(' ')
  if (!isValidElement<{ children?: ReactNode }>(node)) return ''
  return collectText(node.props.children)
}

describe('localized PDF templates', () => {
  it('renders order-invoice labels from template data', () => {
    const document = OrderInvoiceDocument({
      data: {
        labels: buildOrderInvoiceLabels(translate),
        document: { number: 'ORD-7', date: '08/11/2026', dueDate: '08/18/2026' },
        client: { name: 'Beta GmbH' },
        seller: { name: 'Open Mercato', company: 'Open Mercato', email: 'seller@example.test' },
        lines: [{ title: 'Gadget', quantity: 1, unitPrice: 100, total: 100, currency: 'EUR' }],
        totals: { subtotal: 100, tax: 23, total: 123, currency: 'EUR' },
        notes: 'Thank you.',
        paymentDetails: { bankName: 'Test Bank', accountNumber: '123' },
      },
    })
    const text = collectText(document)

    expect(text).toContain('localized:invoice')
    expect(text).toContain('localized:invoiceNumber')
    expect(text).toContain('localized:amountDue')
    expect(text).toContain('localized:payByBankTransfer')
    expect(text).not.toContain('Invoice number')
    expect(text).not.toContain('Pay with ACH or wire transfer')
  })

  it('renders sales-offer labels from template data on both pages', () => {
    const data = {
      labels: buildSalesOfferLabels(translate),
      document: { number: 'Q-7', date: '08/11/2026', validUntil: '08/18/2026' },
      client: { name: 'Beta GmbH', email: 'buyer@example.test' },
      seller: { name: 'Open Mercato', company: 'Open Mercato', email: 'seller@example.test' },
      lines: [{ title: 'Gadget', quantity: 1, unitPrice: 100, total: 100, currency: 'EUR' }],
      totals: { subtotal: 100, tax: 23, total: 123, currency: 'EUR' },
      notes: 'Thank you.',
    }
    const text = `${collectText(CoverPage({ data }))} ${collectText(QuotePage({ data }))}`

    expect(text).toContain('localized:salesOffer')
    expect(text).toContain('localized:cooperationProposal')
    expect(text).toContain('localized:quote')
    expect(text).toContain('localized:amountDue')
    expect(text).not.toContain('Oferta handlowa')
    expect(text).not.toContain('Propozycja współpracy')
    expect(text).not.toContain('Wycena')
  })
})
