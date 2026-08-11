import { renderOrderInvoiceMarkdown } from '..'

describe('renderOrderInvoiceMarkdown', () => {
  it('renders order invoice metadata, line items and totals', () => {
    const markdown = renderOrderInvoiceMarkdown({
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
})
