import { createContainer } from 'awilix'
import type { TemplateEntry } from '@open-mercato/shared/modules/document-generators'
import { DuplicateTemplateError, TemplateRegistry, UnknownTemplateError, templateRegistry } from '../template-registry'

function makeEntry(overrides: Partial<TemplateEntry> = {}): TemplateEntry {
  return {
    id: 'sales.offer', label: 'sales.offer.label', description: 'A literal description',
    module: 'sales', resourceKind: 'sales.quote', documentType: 'offer', format: 'pdf', tags: ['sales'],
    requiredFeatures: ['sales.quotes.view'],
    fromRecord: () => ({ id: 'server-id', label: 'Server label' }),
    resourceId: ({ data }) => String(data.id), resourceLabel: ({ data }) => String(data.label),
    filename: () => 'offer.pdf', load: async () => ({ type: 'test' }),
    ...overrides,
  }
}

const context = { container: createContainer(), auth: { sub: 'user', tenantId: 'tenant', orgId: 'org' }, locale: 'pl' }

describe('TemplateRegistry', () => {
  it('rejects duplicates atomically, including repeated registration of the same object', () => {
    const registry = new TemplateRegistry()
    const original = makeEntry()
    registry.register([original])
    expect(() => registry.register([makeEntry({ id: 'sales.new' }), original])).toThrow(DuplicateTemplateError)
    expect(registry.listTemplates().map((entry) => entry.id)).toEqual(['sales.offer'])
    expect(() => new TemplateRegistry().register([original, original])).toThrow(/sales.*sales.*module-prefixed/)
  })

  it('filters by metadata and any matching tag while returning only defensive projections', () => {
    const registry = new TemplateRegistry()
    const entry = makeEntry()
    registry.register([entry, makeEntry({ id: 'sales.invoice', resourceKind: 'sales.order', format: 'md', tags: ['invoice'] })])
    entry.tags.push('private')
    const filtered = registry.listTemplates({ resourceKind: 'sales.quote', format: 'pdf', documentType: 'offer', tags: ['missing', 'sales'] })
    expect(filtered).toHaveLength(1)
    expect(filtered[0]).not.toHaveProperty('fetchData')
    expect(filtered[0]).not.toHaveProperty('load')
    filtered[0].tags.push('changed')
    filtered[0].requiredFeatures?.push('changed')
    expect(registry.getTemplateMetadata(entry.id).tags).toEqual(['sales'])
    expect(registry.getTemplateMetadata(entry.id).requiredFeatures).toEqual(['sales.quotes.view'])
    expect(registry.listTemplates({ tags: ['private'] })).toEqual([])
  })

  it('localizes labels and preserves external literal fallback values', () => {
    const registry = new TemplateRegistry()
    registry.register([makeEntry()])
    const translate = (key: string, fallback?: string) => key === 'sales.offer.label' ? 'Oferta' : fallback ?? key
    expect(registry.getTemplateMetadata('sales.offer', translate)).toMatchObject({ label: 'Oferta', description: 'A literal description' })
  })

  it('derives facets only from the explicitly supplied authorized subset', () => {
    const registry = new TemplateRegistry()
    registry.register([makeEntry(), makeEntry({ id: 'private.one', resourceKind: 'private.record', format: 'secret' })])
    expect(registry.listTemplateFilterOptions(registry.listTemplates({ resourceKind: 'sales.quote' }))).toEqual({ resourceKinds: ['sales.quote'], formats: ['pdf'] })
    expect(registry.listTemplateFilterOptions([])).toEqual({ resourceKinds: [], formats: [] })
  })

  it('reloads and normalizes source data before deriving canonical identity and loading its source', async () => {
    const registry = new TemplateRegistry()
    const calls: string[] = []
    const fetchData = jest.fn(async () => { calls.push('fetch'); return { id: 'canonical' } })
    registry.register([makeEntry({
      fetchData,
      fromRecord: (data, options) => { calls.push('normalize'); expect(options.locale).toBe('pl'); return { ...data as Record<string, unknown>, label: 'Trusted' } },
      load: async () => { calls.push('load'); return { type: 'test' } },
    })])
    const loaded = await registry.load({ id: 'sales.offer', data: { id: 'untrusted', label: 'forged' } }, context)
    expect(calls).toEqual(['fetch', 'normalize', 'load'])
    expect(fetchData).toHaveBeenCalledWith({ data: { id: 'untrusted', label: 'forged' } }, context)
    expect(loaded.resource).toEqual({ kind: 'sales.quote', id: 'canonical', label: 'Trusted' })
    expect(loaded.render.data).toBe(loaded.data)
  })

  it('propagates failed source fetches without loading or falling back to browser data', async () => {
    const registry = new TemplateRegistry()
    const load = jest.fn()
    registry.register([makeEntry({ fetchData: async () => { throw new Error('denied') }, load })])
    await expect(registry.load({ id: 'sales.offer', data: {} }, context)).rejects.toThrow('denied')
    expect(load).not.toHaveBeenCalled()
    expect(() => registry.getTemplateMetadata('missing')).toThrow(UnknownTemplateError)
    await expect(registry.load({ id: 'missing', data: {} }, context)).rejects.toThrow(UnknownTemplateError)
  })

  it('shares singleton state across isolated module instances', () => {
    jest.isolateModules(() => {
      const reloaded = jest.requireActual<typeof import('../template-registry')>('../template-registry')
      expect(reloaded.templateRegistry).toBe(templateRegistry)
    })
  })
})
