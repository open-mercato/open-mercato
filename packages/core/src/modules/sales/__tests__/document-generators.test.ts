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
})
