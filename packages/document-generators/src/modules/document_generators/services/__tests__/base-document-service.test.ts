import type { ComponentType } from 'react'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { BaseDocumentService, type DocumentTemplateEntry } from '../base-document-service'

const FakeComponent: ComponentType<{ data: Record<string, unknown> }> = () => null

function makeTemplate(overrides: Partial<DocumentTemplateEntry> = {}): DocumentTemplateEntry {
  return {
    id: 'sales-offer',
    label: 'Sales Offer',
    description: 'Offer document',
    documentType: 'offer',
    tags: ['sales', 'offer'],
    note: undefined,
    load: async () => ({ type: 'react-pdf', component: FakeComponent }),
    ...overrides,
  }
}

// Concrete service exercising the extension points a real module overrides.
class TestDocumentService extends BaseDocumentService {
  readonly id = 'test'
  readonly label = 'Test'
  readonly module = 'sales'
  readonly resourceKind = 'sales.quote'

  toTemplateData({ data, locale }: { data: unknown; locale: string }): Record<string, unknown> {
    const { id } = data as { id: string }
    return { document: { number: id }, locale }
  }

  // Reads the *unwrapped* normalized data — this is exactly what C4 broke.
  override filename({ data }: { data: Record<string, unknown> }): string {
    const num = (data.document as { number?: string } | undefined)?.number
    return num ? `offer-${num}.pdf` : 'offer.pdf'
  }

  override resourceLabel({ data }: { data: Record<string, unknown> }): string | undefined {
    return (data.document as { number?: string } | undefined)?.number
  }

  override resourceId({ data }: { data: Record<string, unknown> }): string | undefined {
    return (data.document as { id?: string } | undefined)?.id
  }
}

const ctx = { container: {} as AppContainer, auth: null as AuthContext | null }

describe('BaseDocumentService.getEntries', () => {
  it('maps registered templates to registry entries with module and resourceKind bound', () => {
    const service = new TestDocumentService()
    service.registerTemplate(makeTemplate({ id: 'sales-offer', documentType: 'offer' }))

    const [entry] = service.getEntries()

    expect(entry).toMatchObject({
      id: 'sales-offer',
      label: 'Sales Offer',
      module: 'sales',
      resourceKind: 'sales.quote',
      documentType: 'offer',
      tags: ['sales', 'offer'],
    })
    expect(typeof entry.fromRecord).toBe('function')
    expect(typeof entry.filename).toBe('function')
    expect(typeof entry.resourceId).toBe('function')
    expect(typeof entry.resourceLabel).toBe('function')
    expect(typeof entry.fetchData).toBe('function')
    expect(entry.load).toBe(service['templates_'].get('sales-offer')!.load)
  })

  it('returns one entry per registered template', () => {
    const service = new TestDocumentService()
    service.registerTemplate(makeTemplate({ id: 'a' }))
    service.registerTemplate(makeTemplate({ id: 'b' }))

    expect(service.getEntries().map((e) => e.id)).toEqual(['a', 'b'])
  })

  // Regression guard for C4: the filename binding used to double-wrap the argument
  // as { data: { data } }, so the override's `data.document` was always undefined
  // and every filename fell back to the default.
  it('binds filename so the override receives the unwrapped normalized data', () => {
    const service = new TestDocumentService()
    service.registerTemplate(makeTemplate())

    const [entry] = service.getEntries()

    expect(entry.filename({ data: { document: { number: '42' } } })).toBe('offer-42.pdf')
  })

  it('falls back to the default filename only when the number is absent', () => {
    const service = new TestDocumentService()
    service.registerTemplate(makeTemplate())

    const [entry] = service.getEntries()

    expect(entry.filename({ data: {} })).toBe('offer.pdf')
  })

  it('binds resourceLabel so the override receives the unwrapped normalized data', () => {
    const service = new TestDocumentService()
    service.registerTemplate(makeTemplate())

    const [entry] = service.getEntries()

    expect(entry.resourceLabel?.({ data: { document: { number: '42' } } })).toBe('42')
  })

  it('binds resourceId so the override receives the unwrapped normalized data', () => {
    const service = new TestDocumentService()
    service.registerTemplate(makeTemplate())

    const [entry] = service.getEntries()

    expect(entry.resourceId?.({ data: { document: { id: 'quote-42' } } })).toBe('quote-42')
  })

  it('binds fromRecord to the service toTemplateData', () => {
    const service = new TestDocumentService()
    service.registerTemplate(makeTemplate())

    const [entry] = service.getEntries()

    expect(entry.fromRecord({ id: '7' }, { locale: 'de' })).toEqual({
      document: { number: '7' },
      locale: 'de',
    })
  })

  it('binds fetchData to the service instance and forwards container + auth', async () => {
    const service = new TestDocumentService()
    const spy = jest.spyOn(service, 'fetchData')
    service.registerTemplate(makeTemplate())

    const [entry] = service.getEntries()
    await entry.fetchData!({ data: { id: 'x' } }, ctx)

    expect(spy).toHaveBeenCalledWith({ data: { id: 'x' } }, ctx)
  })
})

describe('BaseDocumentService defaults', () => {
  class MinimalService extends BaseDocumentService {
    readonly id = 'minimal'
    readonly label = 'Minimal'
    readonly module = 'sales'
    readonly resourceKind = 'sales.order'
    toTemplateData({ data }: { data: unknown; locale: string }): Record<string, unknown> {
      return data as Record<string, unknown>
    }
  }

  it('returns document.pdf as the default filename when not overridden', () => {
    const service = new MinimalService()
    expect(service.filename({ data: {} })).toBe('document.pdf')
  })

  it('returns no resource label by default', () => {
    const service = new MinimalService()
    expect(service.resourceLabel({ data: {} })).toBeUndefined()
  })

  it('returns no resource id by default', () => {
    const service = new MinimalService()
    expect(service.resourceId({ data: {} })).toBeUndefined()
  })

  it('returns the raw data unchanged from the default fetchData', async () => {
    const service = new MinimalService()
    const input = { data: { id: 'abc' } }
    await expect(service.fetchData(input, ctx)).resolves.toEqual({ id: 'abc' })
  })
})
