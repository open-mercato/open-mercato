jest.mock('@react-pdf/renderer', () => ({
  Document: 'Document',
  Page: 'Page',
  Text: 'Text',
  View: 'View',
  Image: 'Image',
  Link: 'Link',
  Svg: 'Svg',
  Path: 'Path',
  Rect: 'Rect',
  Circle: 'Circle',
  StyleSheet: { create: (styles: unknown) => styles },
}))

import { templates } from '../document-generators'

describe('sales document generators declaration', () => {
  it('declares exactly one sales.offer pdf template owned by quotes', () => {
    const offers = templates.filter((entry) => entry.id === 'sales.offer')
    expect(offers).toHaveLength(1)
    const [offer] = offers
    expect(offer.module).toBe('sales')
    expect(offer.resourceKind).toBe('sales.quote')
    expect(offer.format).toBe('pdf')
    expect(offer.requiredFeatures).toEqual(['sales.quotes.view'])
    expect(offer.label).toBe('sales.documents.templates.offer.label')
    expect(offer.description).toBe('sales.documents.templates.offer.description')
  })

  it('builds a sanitized pdf filename', () => {
    const [offer] = templates.filter((entry) => entry.id === 'sales.offer')
    const name = offer.filename({ data: { document: { number: 'Q-1/2026' } } } as never)
    expect(name.endsWith('.pdf')).toBe(true)
    expect(name).not.toContain('/')
  })

  it('loads a react-pdf source', async () => {
    const [offer] = templates.filter((entry) => entry.id === 'sales.offer')
    const source = await offer.load()
    expect(source.type).toBe('react-pdf')
    expect(typeof (source as { component: unknown }).component).toBe('function')
  })

  describe('order invoice templates', () => {
    const cases = [
      { id: 'sales.order-invoice', format: 'pdf', sourceType: 'react-pdf', ext: '.pdf' },
      { id: 'sales.order-invoice-markdown', format: 'md', sourceType: 'markdown', ext: '.md' },
    ]

    it('declares exactly three sales entries with unique ids', () => {
      const sales = templates.filter((entry) => entry.module === 'sales')
      expect(sales.map((entry) => entry.id).sort()).toEqual(
        ['sales.offer', 'sales.order-invoice', 'sales.order-invoice-markdown'].sort(),
      )
      expect(new Set(templates.map((entry) => entry.id)).size).toBe(templates.length)
    })

    it.each(cases)('declares $id owned by orders', async ({ id, format, sourceType, ext }) => {
      const [entry] = templates.filter((candidate) => candidate.id === id)
      expect(entry.resourceKind).toBe('sales.order')
      expect(entry.format).toBe(format)
      expect(entry.requiredFeatures).toEqual(['sales.orders.view'])
      const name = entry.filename({ data: { document: { number: 'O-1/2026' } } } as never)
      expect(name.endsWith(ext)).toBe(true)
      expect(name).not.toContain('/')
      const source = await entry.load()
      expect(source.type).toBe(sourceType)
    })
  })
})
