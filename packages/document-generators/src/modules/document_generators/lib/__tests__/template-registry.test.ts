import type { ComponentType } from 'react'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { DuplicateTemplateError, TemplateRegistry, UnknownTemplateError } from '../template-registry'
import type { TemplateEntry } from '@open-mercato/shared/modules/document-generators'

// Minimal React-PDF-like component stand-in — the registry only stores and returns it.
const FakeComponent: ComponentType<{ data: Record<string, unknown> }> = () => null

function makeEntry(overrides: Partial<TemplateEntry> = {}): TemplateEntry {
  return {
    id: 'sample-report',
    label: 'Sample Report',
    description: 'Report for a record',
    module: 'example',
    resourceKind: 'example.record',
    documentType: 'report',
    format: 'pdf',
    tags: ['example', 'report'],
    note: undefined,
    fromRecord: (data: unknown) => data as Record<string, unknown>,
    filename: () => 'report.pdf',
    resourceId: () => 'record-1',
    load: async () => ({ type: 'react-pdf', component: FakeComponent }),
    ...overrides,
  }
}

const translate = ((key: string, fallback?: string | Record<string, string | number>) => (
  key === 'document.label' ? 'translated:document.label' : (typeof fallback === 'string' ? fallback : key)
)) as TranslateFn
const ctx = { container: {} as AppContainer, auth: null as AuthContext | null, locale: 'en', translate }
let templateRegistry: TemplateRegistry

beforeEach(() => {
  templateRegistry = new TemplateRegistry()
})

describe('templateRegistry.listTemplates', () => {
  it('lists templates from multiple registrations and strips runtime handlers', () => {
    templateRegistry.register([makeEntry({ id: 'first' })])
    templateRegistry.register([makeEntry({ id: 'second', module: 'custom' })])

    const templates = templateRegistry.listTemplates()

    expect(templates.map((template) => template.id)).toEqual(['first', 'second'])
    // Runtime handlers must not leak into the UI-facing metadata.
    expect(templates[0]).not.toHaveProperty('fromRecord')
    expect(templates[0]).not.toHaveProperty('filename')
    expect(templates[0]).not.toHaveProperty('resourceId')
    expect(templates[0]).not.toHaveProperty('resourceLabel')
    expect(templates[0]).not.toHaveProperty('load')
    expect(templates[0]).not.toHaveProperty('fetchData')
    expect(templates[0]).toMatchObject({
      id: 'first',
      label: 'Sample Report',
      module: 'example',
      resourceKind: 'example.record',
      documentType: 'report',
      format: 'pdf',
    })
  })

  it('returns an empty list when nothing is registered', () => {
    expect(templateRegistry.listTemplates()).toEqual([])
  })

  it('localizes listing metadata with the provided translator', () => {
    templateRegistry.register([makeEntry({
      label: 'document.label',
      description: 'document.description',
    })])

    const templates = templateRegistry.listTemplates(undefined, translate)

    expect(templates[0]).toMatchObject({
      label: 'translated:document.label',
      description: 'document.description',
    })
  })

  it('filters templates by metadata without changing the unfiltered catalogue', () => {
    templateRegistry.register([
      makeEntry({ id: 'record-pdf', resourceKind: 'example.record', documentType: 'report', format: 'pdf', tags: ['record', 'detailed'] }),
      makeEntry({ id: 'record-markdown', resourceKind: 'example.record', documentType: 'summary', format: 'md', tags: ['record'] }),
      makeEntry({ id: 'report-pdf', resourceKind: 'example.report', documentType: 'report', format: 'pdf', tags: ['report'] }),
    ])

    expect(templateRegistry.listTemplates({ resourceKind: 'example.record' }).map((template) => template.id))
      .toEqual(['record-pdf', 'record-markdown'])
    expect(templateRegistry.listTemplates({ resourceKind: 'example.record', format: 'pdf' }).map((template) => template.id))
      .toEqual(['record-pdf'])
    expect(templateRegistry.listTemplates({ documentType: 'summary' }).map((template) => template.id))
      .toEqual(['record-markdown'])
    expect(templateRegistry.listTemplates({ tags: ['report', 'detailed'] }).map((template) => template.id))
      .toEqual(['record-pdf', 'report-pdf'])
    expect(templateRegistry.listTemplates().map((template) => template.id))
      .toEqual(['record-pdf', 'record-markdown', 'report-pdf'])
  })

  it('returns sorted unique options without exposing template metadata', () => {
    templateRegistry.register([
      makeEntry({ id: 'report-pdf', resourceKind: 'example.report', format: 'pdf' }),
      makeEntry({ id: 'record-markdown', resourceKind: 'example.record', format: 'md' }),
      makeEntry({ id: 'record-pdf', resourceKind: 'example.record', format: 'pdf' }),
    ])

    expect(templateRegistry.listTemplateFilterOptions()).toEqual({
      resourceKinds: ['example.record', 'example.report'],
      formats: ['md', 'pdf'],
    })
  })

  it('rejects a duplicate ID without partially registering the batch', () => {
    templateRegistry.register([makeEntry({ id: 'existing' })])

    expect(() => templateRegistry.register([
      makeEntry({ id: 'new' }),
      makeEntry({ id: 'existing', module: 'third_party' }),
    ])).toThrow(
      '[internal] Duplicate template ID "existing": already registered by module "example", attempted by module "third_party". Template IDs must be globally unique and module-namespaced.',
    )
    expect(templateRegistry.listTemplates().map((template) => template.id)).toEqual(['existing'])
  })

  it('rejects re-registering the same entry so duplicate bootstrap registration fails fast', () => {
    const entry = makeEntry({ id: 'example.sample-report' })
    templateRegistry.register([entry])

    expect(() => templateRegistry.register([entry])).toThrow(DuplicateTemplateError)
    expect(templateRegistry.listTemplates().map((template) => template.id)).toEqual([
      'example.sample-report',
    ])
  })

  it('rejects duplicate IDs within one batch', () => {
    expect(() => templateRegistry.register([
      makeEntry({ id: 'duplicate' }),
      makeEntry({ id: 'duplicate', module: 'custom' }),
    ])).toThrow(
      '[internal] Duplicate template ID "duplicate": already registered by module "example", attempted by module "custom". Template IDs must be globally unique and module-namespaced.',
    )
    expect(templateRegistry.listTemplates()).toEqual([])
  })
})

describe('templateRegistry.load', () => {
  it('runs fetchData, normalization and derived metadata and returns the resolved template', async () => {
    const calls: string[] = []
    const fetchData = jest.fn(async ({ data }: { data: unknown }) => {
      calls.push('fetchData')
      return { ...(data as object), enriched: true }
    })
    const fromRecord = jest.fn((data: unknown, { locale, translate: contextTranslate }: { locale: string; translate: TranslateFn }) => {
      calls.push('fromRecord')
      return { normalized: true, locale, label: contextTranslate('document.label'), ...(data as object) }
    })
    const filename = jest.fn(() => {
      calls.push('filename')
      return 'report-42.pdf'
    })
    const resourceId = jest.fn(() => {
      calls.push('resourceId')
      return 'record-42'
    })
    const resourceLabel = jest.fn(() => {
      calls.push('resourceLabel')
      return 'RECORD-42'
    })
    const load = jest.fn(async () => {
      calls.push('load')
      return { type: 'react-pdf' as const, component: FakeComponent }
    })
    templateRegistry.register([makeEntry({ fetchData, fromRecord, filename, resourceId, resourceLabel, load })])

    const result = await templateRegistry.load({ id: 'sample-report', data: { id: 'abc' } }, ctx)

    expect(calls).toEqual(['fetchData', 'load', 'fromRecord', 'filename', 'resourceId', 'resourceLabel'])
    expect(result.render.source).toEqual({ type: 'react-pdf', component: FakeComponent })
    expect(result.render.format).toBe('pdf')
    expect(result.render.data).toMatchObject({ normalized: true, locale: 'en', label: 'translated:document.label', id: 'abc', enriched: true })
    expect(fromRecord).toHaveBeenCalledWith(expect.anything(), { locale: 'en', translate })
    expect(result.filename).toBe('report-42.pdf')
    expect(result.template).toEqual({ id: 'sample-report', label: 'Sample Report' })
    expect(result.resource).toEqual({ kind: 'example.record', id: 'record-42', label: 'RECORD-42' })
  })

  it('uses the request translator for the template label persisted by generate', async () => {
    const requestTranslate = ((key: string, fallback?: string | Record<string, string | number>) => (
      key === 'example.templates.sample.label' ? 'Localized report' : (typeof fallback === 'string' ? fallback : key)
    )) as TranslateFn
    templateRegistry.register([makeEntry({ label: 'example.templates.sample.label' })])

    const result = await templateRegistry.load(
      { id: 'sample-report', data: {} },
      { ...ctx, translate: requestTranslate },
    )

    expect(result.template.label).toBe('Localized report')
  })

  it('passes the request-scoped container and auth context to fetchData', async () => {
    const fetchData = jest.fn(async ({ data }: { data: unknown }) => data)
    const auth = { tenantId: 't1', orgId: 'o1' } as unknown as AuthContext
    const container = { resolve: () => undefined } as unknown as AppContainer
    templateRegistry.register([makeEntry({ fetchData })])

    await templateRegistry.load({ id: 'sample-report', data: { id: 'abc' } }, { container, auth, locale: 'de', translate })

    expect(fetchData).toHaveBeenCalledWith({ data: { id: 'abc' } }, { container, auth })
  })

  it('passes raw data straight to fromRecord when the template has no fetchData', async () => {
    const fromRecord = jest.fn((data: unknown) => data as Record<string, unknown>)
    templateRegistry.register([makeEntry({ fetchData: undefined, fromRecord })])

    await templateRegistry.load({ id: 'sample-report', data: { id: 'raw' } }, ctx)

    expect(fromRecord).toHaveBeenCalledWith({ id: 'raw' }, { locale: 'en', translate })
  })

  it('stops loading and normalization when fetchData rejects', async () => {
    const failure = new Error('record not accessible')
    const fetchData = jest.fn(async () => Promise.reject(failure))
    const load = jest.fn(async () => ({ type: 'react-pdf' as const, component: FakeComponent }))
    const fromRecord = jest.fn((data: unknown) => data as Record<string, unknown>)
    templateRegistry.register([makeEntry({ fetchData, load, fromRecord })])

    await expect(
      templateRegistry.load({ id: 'sample-report', data: { id: 'untrusted' } }, ctx),
    ).rejects.toBe(failure)

    expect(load).not.toHaveBeenCalled()
    expect(fromRecord).not.toHaveBeenCalled()
  })

  it('resolves templates registered by modules', async () => {
    templateRegistry.register([makeEntry({ id: 'custom-report', module: 'my_module' })])

    const result = await templateRegistry.load({ id: 'custom-report', data: {} }, ctx)

    expect(result.render.source).toEqual({ type: 'react-pdf', component: FakeComponent })
  })

  it('loads a Markdown source as a Markdown template', async () => {
    const render = jest.fn(() => '# Document')
    templateRegistry.register([makeEntry({
      id: 'sample-report-markdown',
      format: 'md',
      filename: () => 'report.md',
      load: async () => ({ type: 'markdown', render }),
    })])

    const result = await templateRegistry.load({ id: 'sample-report-markdown', data: {} }, ctx)

    expect(result.render.format).toBe('md')
    expect(result.filename).toBe('report.md')
    expect(result.render.source).toEqual({ type: 'markdown', render })
  })

  it('forwards extensible formats without interpreting the source type', async () => {
    const source = { type: 'docx', document: { title: 'Document' } }
    templateRegistry.register([makeEntry({
      id: 'custom-document',
      format: 'docx',
      filename: () => 'document.docx',
      load: async () => source,
    })])

    const result = await templateRegistry.load({ id: 'custom-document', data: {} }, ctx)

    expect(result.render.format).toBe('docx')
    expect(result.render.source).toBe(source)
    expect(result.filename).toBe('document.docx')
  })

  it('throws "Unknown template" for an unregistered id', async () => {
    templateRegistry.register([makeEntry({ id: 'sample-report' })])

    await expect(
      templateRegistry.load({ id: 'does-not-exist', data: {} }, ctx),
    ).rejects.toBeInstanceOf(UnknownTemplateError)
  })
})
