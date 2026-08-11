import { createTranslator } from '@open-mercato/shared/lib/i18n/translate'
import en from '../../../../../../i18n/en.json'
import { buildOrderInvoiceLabels } from '../../labels'
import { renderOrderInvoiceMarkdown } from '..'

const labels = buildOrderInvoiceLabels(createTranslator(en))

describe('renderOrderInvoiceMarkdown', () => {
  it('renders order invoice metadata, line items and totals', () => {
    const markdown = renderOrderInvoiceMarkdown({
      labels,
      document: { number: 'ORD-7', date: '08/11/2026', dueDate: '08/18/2026' },
      client: { name: 'Beta GmbH', email: 'buyer@beta.test' },
      seller: { name: '', company: 'Open Mercato', email: '' },
      lines: [{
        title: 'Gadget',
        description: 'Premium | edition',
        quantity: 2,
        unitPrice: 50,
        total: 100,
        currency: 'EUR',
      }],
      totals: { subtotal: 100, tax: 23, total: 123, currency: 'EUR' },
      notes: 'Thank you.',
    })

    expect(markdown).toContain('# Invoice ORD-7')
    expect(markdown).toContain('Gadget | Premium \\| edition | 2 | 50.00 EUR | 100.00 EUR')
    expect(markdown).toContain('**Amount due:** 123.00 EUR')
    expect(markdown).toContain('## Notes')
  })

  it('uses the labels supplied in template data without hardcoded replacements', () => {
    const markdown = renderOrderInvoiceMarkdown({
      labels: {
        ...labels,
        invoice: 'CUSTOM INVOICE',
        amountDue: 'CUSTOM TOTAL',
        notes: 'CUSTOM NOTES',
      },
      document: { number: 'ORD-8', date: '08/11/2026' },
      client: { name: 'Beta GmbH' },
      seller: { name: '', company: '', email: '' },
      lines: [],
      totals: { subtotal: 100, tax: 0, total: 100, currency: 'EUR' },
      notes: 'Thank you.',
    })

    expect(markdown).toContain('# CUSTOM INVOICE ORD-8')
    expect(markdown).toContain('**CUSTOM TOTAL:** 100.00 EUR')
    expect(markdown).toContain('## CUSTOM NOTES')
  })
})
