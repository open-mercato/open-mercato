import { createContainer } from 'awilix'
import { createTranslator } from '../../../lib/i18n/translate'
import {
  BaseDocumentService,
  type DocumentDataInput,
  type DocumentFetchContext,
  type DocumentTemplateEntry,
  type TemplateNormalizationInput,
} from '../../document-generators'

class ExampleDocumentService extends BaseDocumentService {
  readonly id = 'example-records'
  readonly label = 'Example records'
  readonly module = 'example'
  readonly resourceKind = 'example.record'

  constructor(entries: DocumentTemplateEntry[] = []) {
    super()
    entries.forEach((entry) => this.registerTemplate(entry))
  }

  toTemplateData({ data, locale, translate }: TemplateNormalizationInput) {
    return { id: data, locale, title: translate('example.title', this.label) }
  }

  resourceId({ data }: DocumentDataInput) {
    return `${this.id}:${String(data.id)}`
  }
}

const context: DocumentFetchContext = {
  container: createContainer(),
  auth: { sub: 'actor', tenantId: 'tenant', orgId: 'organization' },
}

function template(format: string): DocumentTemplateEntry {
  return {
    id: `example.record.${format}`,
    label: `Example ${format}`,
    description: 'Example template',
    documentType: 'record',
    format,
    tags: ['example'],
    requiredFeatures: ['example.view'],
    filename: ({ data }) => `${String(data.id)}.${format}`,
    load: jest.fn(async () => ({ type: format })),
  }
}

describe('BaseDocumentService', () => {
  it('binds detached normalization and resource identity to the owning service', () => {
    const service = new ExampleDocumentService([template('pdf')])
    const { fromRecord, resourceId, resourceLabel } = service.getEntries()[0]
    const translate = createTranslator({ 'example.title': 'Przykład' })
    const data = fromRecord('record-1', { locale: 'pl', translate })

    expect(data).toEqual({ id: 'record-1', locale: 'pl', title: 'Przykład' })
    expect(resourceId({ data })).toBe('example-records:record-1')
    expect(resourceLabel?.({ data })).toBeUndefined()
    expect(fromRecord('record-2', { locale: 'en' }).title).toBe('Example records')
  })

  it('forwards the original input and request context to a bound fetch override', async () => {
    class FetchingService extends ExampleDocumentService {
      override async fetchData({ data }: { data: unknown }, request: DocumentFetchContext) {
        expect(request).toBe(context)
        return { id: data, service: this.id, tenantId: request.auth?.tenantId, orgId: request.auth?.orgId }
      }

      override resourceLabel({ data }: DocumentDataInput) {
        return `${this.label} ${String(data.id)}`
      }
    }
    const service = new FetchingService([template('pdf')])
    const { fetchData, resourceLabel } = service.getEntries()[0]

    await expect(fetchData?.({ data: 'record-1' }, context)).resolves.toEqual({
      id: 'record-1', service: 'example-records', tenantId: 'tenant', orgId: 'organization',
    })
    expect(resourceLabel?.({ data: { id: 'record-1' } })).toBe('Example records record-1')
  })

  it('preserves the original data by default without fetching or normalization', async () => {
    const service = new ExampleDocumentService([template('pdf')])
    const input = { id: 'record-1', title: 'Original' }
    await expect(service.getEntries()[0].fetchData?.({ data: input }, context)).resolves.toBe(input)
  })

  it('keeps each format filename and lazy loader separate from shared service metadata', async () => {
    const pdf = template('pdf')
    const markdown = template('markdown')
    const service = new ExampleDocumentService([pdf, markdown])
    const entries = service.getEntries()

    expect(pdf.load).not.toHaveBeenCalled()
    expect(markdown.load).not.toHaveBeenCalled()
    expect(entries.map((entry) => entry.filename({ data: { id: 'record-1' } })))
      .toEqual(['record-1.pdf', 'record-1.markdown'])
    for (const entry of entries) {
      expect(entry.module).toBe('example')
      expect(entry.resourceKind).toBe('example.record')
      await expect(entry.load()).resolves.toEqual({ type: entry.format })
    }
    expect(pdf.load).toHaveBeenCalledTimes(1)
    expect(markdown.load).toHaveBeenCalledTimes(1)
  })

  it('isolates services and metadata snapshots from caller mutations', () => {
    const input = template('pdf')
    const service = new ExampleDocumentService([input])
    input.tags.push('changed')
    input.requiredFeatures?.push('changed')
    input.label = 'Changed'
    const entries = service.getEntries()
    entries[0].tags.push('changed again')
    entries[0].requiredFeatures?.push('changed again')
    entries[0].label = 'Changed again'
    entries.pop()

    expect(service.getEntries()).toEqual([
      expect.objectContaining({ tags: ['example'], requiredFeatures: ['example.view'], label: 'Example pdf' }),
    ])
    expect(new ExampleDocumentService().getEntries()).toEqual([])
  })

  it('binds archived template versions without sharing mutable state', async () => {
    const archived = { version: '1', load: async () => ({ type: 'v1' }) }
    const service = new ExampleDocumentService([{ ...template('pdf'), version: '2', archivedVersions: [archived] }])
    const [entry] = service.getEntries()
    expect(entry.version).toBe('2')
    expect(entry.archivedVersions?.map((source) => source.version)).toEqual(['1'])
    expect(entry.archivedVersions?.[0]).not.toBe(archived)
    await expect(entry.archivedVersions?.[0].load()).resolves.toEqual({ type: 'v1' })
  })
})
