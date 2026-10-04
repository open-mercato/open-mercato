import { render } from '../order-invoice-markdown'
import { ORDER_INVOICE_LABEL_KEYS, type OrderInvoiceData } from '../../types'

const labels = Object.fromEntries(ORDER_INVOICE_LABEL_KEYS.map((key) => [key, `L-${key}`])) as OrderInvoiceData['labels']

function build(overrides: Partial<OrderInvoiceData> = {}): Record<string, unknown> {
  const data: OrderInvoiceData = {
    locale: 'en',
    isDraft: false,
    labels,
    document: { id: 'id-1', number: 'O-100', date: '2026-01-02T10:00:00.000Z', dueDate: '2026-02-01T00:00:00.000Z' },
    client: { name: 'Acme Ltd', email: 'info@acme.test', company: 'Acme Billing', address: 'Main St 5, Warsaw' },
    seller: { name: 'Web shop', email: 'shop@example.test', phone: '+48 123' },
    lines: [{ title: 'Widget', description: 'Blue widget', quantity: 2, unitPrice: 50, total: 100, currency: 'EUR' }],
    totals: { subtotal: 100, discount: 10, shipping: 5, surcharge: 2, tax: 20.7, total: 117.7, paid: 50, outstanding: 67.7, currency: 'EUR' },
    notes: 'Thanks',
    ...overrides,
  }
  return data as unknown as Record<string, unknown>
}

describe('order invoice markdown', () => {
  it('renders all sections', () => {
    const md = render(build())
    expect(md).toContain('# L-title O-100')
    expect(md).toContain('## L-client')
    expect(md).toContain('## L-seller')
    expect(md).toContain('| L-item | L-quantity | L-unitPrice | L-total |')
    expect(md).toContain('| --- | ---: | ---: | ---: |')
    expect(md).toContain('Widget — Blue widget')
    for (const key of ['subtotal', 'discount', 'shipping', 'surcharge', 'tax', 'grandTotal', 'paid', 'outstanding', 'notes', 'dueDate']) {
      expect(md).toContain(`L-${key}`)
    }
    expect(md.endsWith('\n')).toBe(true)
  })

  it('omits the client section when the order has no customer data', () => {
    const md = render(build({ client: { name: '' } }))
    expect(md).not.toContain('L-client')
  })

  it('marks drafts with an escaped banner and leaves final documents unmarked', () => {
    expect(render(build({ isDraft: true }))).toContain('> **L-draftWatermark**')
    expect(render(build())).not.toContain('draftWatermark')
  })

  it('omits optional rows when zero or absent', () => {
    const md = render(
      build({
        seller: undefined,
        notes: undefined,
        document: { id: 'id-1', number: 'O-100', date: '2026-01-02T10:00:00.000Z' },
        totals: { subtotal: 100, discount: 0, shipping: 0, surcharge: 0, tax: 20, total: 120, paid: 0, outstanding: 120, currency: 'EUR' },
      }),
    )
    for (const key of ['seller', 'discount', 'shipping', 'surcharge', 'paid', 'outstanding', 'notes', 'dueDate']) {
      expect(md).not.toContain(`L-${key}`)
    }
  })

  it('escapes injected markup, pipes and newlines', () => {
    const hostile = '**bold** | [x](javascript:alert(1)) <script>'
    const md = render(
      build({
        client: { name: hostile },
        notes: 'line1\n\n# Heading\n| a | b |',
        lines: [{ title: hostile, description: 'x\ny', quantity: 1, unitPrice: 1, total: 1, currency: 'EUR' }],
      }),
    )
    expect(md).not.toContain('<script>')
    expect(md).toContain('&lt;script&gt;')
    expect(md).not.toContain('[x](')
    expect(md).toContain('\\[x\\](javascript:alert(1))')
    expect(md).toContain('\\*\\*bold\\*\\* \\|')
    expect(md).toContain('line1 # Heading \\| a \\| b \\|')
    const tableRows = md.split('\n').filter((line) => line.startsWith('|'))
    expect(tableRows).toHaveLength(3)
    for (const row of tableRows) {
      expect(row.split(/(?<!\\)\|/)).toHaveLength(6)
    }
  })
})
