import type { ComponentType } from 'react'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { templateRegistry, UnknownTemplateError } from '../template-registry'
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

// The registry is a singleton — reset both lists before each test so cases don't leak.
const translate = ((key: string) => `translated:${key}`) as TranslateFn
const ctx = { container: {} as AppContainer, auth: null as AuthContext | null, locale: 'en', translate }

beforeEach(() => {
  templateRegistry.registerInternal([])
  templateRegistry.registerExternal([])
})

describe('templateRegistry.listTemplates', () => {
  it('groups templates by source and strips runtime handlers to metadata only', () => {
    templateRegistry.registerInternal([makeEntry({ id: 'internal-1' })])
    templateRegistry.registerExternal([makeEntry({ id: 'external-1', module: 'custom' })])

    const { internal, external } = templateRegistry.listTemplates()

    expect(internal.map((t) => t.id)).toEqual(['internal-1'])
    expect(external.map((t) => t.id)).toEqual(['external-1'])
    // Runtime handlers must not leak into the UI-facing metadata.
    expect(internal[0]).not.toHaveProperty('fromRecord')
    expect(internal[0]).not.toHaveProperty('filename')
    expect(internal[0]).not.toHaveProperty('resourceId')
    expect(internal[0]).not.toHaveProperty('resourceLabel')
    expect(internal[0]).not.toHaveProperty('load')
    expect(internal[0]).not.toHaveProperty('fetchData')
    expect(internal[0]).toMatchObject({
      id: 'internal-1',
      label: 'Sample Report',
      module: 'example',
      resourceKind: 'example.record',
      documentType: 'report',
      format: 'pdf',
    })
  })

  it('returns empty groups when nothing is registered', () => {
    expect(templateRegistry.listTemplates()).toEqual({ internal: [], external: [] })
  })

  it('replaces (not appends) entries on re-registration', () => {
    templateRegistry.registerInternal([makeEntry({ id: 'first' })])
    templateRegistry.registerInternal([makeEntry({ id: 'second' })])

    expect(templateRegistry.listTemplates().internal.map((t) => t.id)).toEqual(['second'])
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
    templateRegistry.registerInternal([makeEntry({ fetchData, fromRecord, filename, resourceId, resourceLabel, load })])

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

  it('passes the request-scoped container and auth context to fetchData', async () => {
    const fetchData = jest.fn(async ({ data }: { data: unknown }) => data)
    const auth = { tenantId: 't1', orgId: 'o1' } as unknown as AuthContext
    const container = { resolve: () => undefined } as unknown as AppContainer
    templateRegistry.registerInternal([makeEntry({ fetchData })])

    await templateRegistry.load({ id: 'sample-report', data: { id: 'abc' } }, { container, auth, locale: 'de', translate })

    expect(fetchData).toHaveBeenCalledWith({ data: { id: 'abc' } }, { container, auth })
  })

  it('passes raw data straight to fromRecord when the template has no fetchData', async () => {
    const fromRecord = jest.fn((data: unknown) => data as Record<string, unknown>)
    templateRegistry.registerInternal([makeEntry({ fetchData: undefined, fromRecord })])

    await templateRegistry.load({ id: 'sample-report', data: { id: 'raw' } }, ctx)

    expect(fromRecord).toHaveBeenCalledWith({ id: 'raw' }, { locale: 'en', translate })
  })

  it('stops loading and normalization when fetchData rejects', async () => {
    const failure = new Error('record not accessible')
    const fetchData = jest.fn(async () => Promise.reject(failure))
    const load = jest.fn(async () => ({ type: 'react-pdf' as const, component: FakeComponent }))
    const fromRecord = jest.fn((data: unknown) => data as Record<string, unknown>)
    templateRegistry.registerInternal([makeEntry({ fetchData, load, fromRecord })])

    await expect(
      templateRegistry.load({ id: 'sample-report', data: { id: 'untrusted' } }, ctx),
    ).rejects.toBe(failure)

    expect(load).not.toHaveBeenCalled()
    expect(fromRecord).not.toHaveBeenCalled()
  })

  it('resolves templates registered by external modules', async () => {
    templateRegistry.registerExternal([makeEntry({ id: 'custom-report', module: 'my_module' })])

    const result = await templateRegistry.load({ id: 'custom-report', data: {} }, ctx)

    expect(result.render.source).toEqual({ type: 'react-pdf', component: FakeComponent })
  })

  it('loads a Markdown source as a Markdown template', async () => {
    const render = jest.fn(() => '# Document')
    templateRegistry.registerInternal([makeEntry({
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

  it('rejects metadata that disagrees with the loaded source format', async () => {
    templateRegistry.registerInternal([makeEntry({
      id: 'invalid-markdown',
      format: 'pdf',
      load: async () => ({ type: 'markdown', render: () => '# Document' }),
    })])

    await expect(templateRegistry.load({ id: 'invalid-markdown', data: {} }, ctx))
      .rejects.toThrow('declares pdf but loads md')
  })

  it('throws "Unknown template" for an unregistered id', async () => {
    templateRegistry.registerInternal([makeEntry({ id: 'sample-report' })])

    await expect(
      templateRegistry.load({ id: 'does-not-exist', data: {} }, ctx),
    ).rejects.toBeInstanceOf(UnknownTemplateError)
  })
})
