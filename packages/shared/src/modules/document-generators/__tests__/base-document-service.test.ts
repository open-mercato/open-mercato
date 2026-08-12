import type { ComponentType } from 'react'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { BaseDocumentService, type DocumentTemplateEntry } from '@open-mercato/shared/modules/document-generators'

const FakeComponent: ComponentType<{ data: Record<string, unknown> }> = () => null

function makeTemplate(overrides: Partial<DocumentTemplateEntry> = {}): DocumentTemplateEntry {
  return {
    id: 'sample-report',
    label: 'Sample Report',
    description: 'Sample document',
    documentType: 'report',
    format: 'pdf',
    tags: ['example', 'report'],
    note: undefined,
    load: async () => ({ type: 'react-pdf', component: FakeComponent }),
    ...overrides,
  }
}

// Concrete service exercising the extension points a real module overrides.
class TestDocumentService extends BaseDocumentService {
  readonly id = 'test'
  readonly label = 'Test'
  readonly module = 'example'
  readonly resourceKind = 'example.record'

  toTemplateData({ data, locale, translate }: { data: unknown; locale: string; translate: TranslateFn }): Record<string, unknown> {
    const { id } = data as { id: string }
    return { document: { number: id }, locale, label: translate('test.label') }
  }

  // Reads the *unwrapped* normalized data — this is exactly what C4 broke.
  override filename({ data }: { data: Record<string, unknown> }): string {
    const num = (data.document as { number?: string } | undefined)?.number
    return num ? `report-${num}.pdf` : 'report.pdf'
  }

  override resourceLabel({ data }: { data: Record<string, unknown> }): string | undefined {
    return (data.document as { number?: string } | undefined)?.number
  }

  override resourceId({ data }: { data: Record<string, unknown> }): string {
    return (data.document as { id: string }).id
  }
}

const ctx = { container: {} as AppContainer, auth: null as AuthContext | null }
const translate = ((key: string) => `translated:${key}`) as TranslateFn

describe('BaseDocumentService.getEntries', () => {
  it('maps registered templates to registry entries with module and resourceKind bound', () => {
    const service = new TestDocumentService()
    service.registerTemplate(makeTemplate({ id: 'sample-report', documentType: 'report' }))

    const [entry] = service.getEntries()

    expect(entry).toMatchObject({
      id: 'sample-report',
      label: 'Sample Report',
      module: 'example',
      resourceKind: 'example.record',
      documentType: 'report',
      format: 'pdf',
      tags: ['example', 'report'],
    })
    expect(typeof entry.fromRecord).toBe('function')
    expect(typeof entry.filename).toBe('function')
    expect(typeof entry.resourceId).toBe('function')
    expect(typeof entry.resourceLabel).toBe('function')
    expect(typeof entry.fetchData).toBe('function')
    expect(entry.load).toBe(service['templates_'].get('sample-report')!.load)
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

    expect(entry.filename({ data: { document: { number: '42' } } })).toBe('report-42.pdf')
  })

  it('uses a template-specific filename when one is registered', () => {
    const service = new TestDocumentService()
    service.registerTemplate(makeTemplate({
      format: 'md',
      filename: ({ data }) => `report-${String((data.document as { number: string }).number)}.md`,
    }))

    const [entry] = service.getEntries()

    expect(entry.format).toBe('md')
    expect(entry.filename({ data: { document: { number: '42' } } })).toBe('report-42.md')
  })

  it('falls back to the default filename only when the number is absent', () => {
    const service = new TestDocumentService()
    service.registerTemplate(makeTemplate())

    const [entry] = service.getEntries()

    expect(entry.filename({ data: {} })).toBe('report.pdf')
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

    expect(entry.resourceId({ data: { document: { id: 'record-42' } } })).toBe('record-42')
  })

  it('binds fromRecord to the service toTemplateData', () => {
    const service = new TestDocumentService()
    service.registerTemplate(makeTemplate())

    const [entry] = service.getEntries()

    expect(entry.fromRecord({ id: '7' }, { locale: 'de', translate })).toEqual({
      document: { number: '7' },
      locale: 'de',
      label: 'translated:test.label',
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
    readonly module = 'example'
    readonly resourceKind = 'example.record'
    resourceId(): string {
      return 'minimal-1'
    }
    toTemplateData({ data }: { data: unknown; locale: string; translate: TranslateFn }): Record<string, unknown> {
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

  it('returns the raw data unchanged from the default fetchData', async () => {
    const service = new MinimalService()
    const input = { data: { id: 'abc' } }
    await expect(service.fetchData(input, ctx)).resolves.toEqual({ id: 'abc' })
  })
})
