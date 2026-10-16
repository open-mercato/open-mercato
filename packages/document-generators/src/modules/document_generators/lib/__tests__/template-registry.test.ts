import { createContainer } from 'awilix'
import type { TemplateEntry } from '@open-mercato/shared/modules/document-generators'
import { DuplicateTemplateError, UnknownTemplateError, UnknownTemplateVersionError } from '../template-errors'
import { TemplateRegistry, templateRegistry } from '../template-registry'

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
  it('rejects an ID claimed by another module atomically', () => {
    const registry = new TemplateRegistry()
    registry.register([makeEntry()])
    expect(() => registry.register([makeEntry({ id: 'crm.new', module: 'crm' }), makeEntry({ module: 'crm' })])).toThrow(DuplicateTemplateError)
    expect(registry.listTemplates().map((entry) => entry.id)).toEqual(['sales.offer'])
    expect(registry.getTemplateMetadata('sales.offer').module).toBe('sales')
  })

  it('rejects the same ID declared twice in one registration batch', () => {
    const original = makeEntry()
    expect(() => new TemplateRegistry().register([original, original])).toThrow(/sales.*sales.*module-prefixed/)
  })

  it('lets a repeated bootstrap re-register its own module templates without failing', () => {
    const registry = new TemplateRegistry()
    registry.register([makeEntry({ description: 'first' })])
    expect(() => registry.register([makeEntry({ description: 'second' })])).not.toThrow()
    expect(registry.listTemplates()).toHaveLength(1)
    expect(registry.getTemplateMetadata('sales.offer').description).toBe('second')
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

  it('projects the current version first and defaults to version 1', () => {
    const registry = new TemplateRegistry()
    registry.register([
      makeEntry(),
      makeEntry({ id: 'sales.versioned', version: '3', archivedVersions: [{ version: '2', load: async () => ({ type: 'v2' }) }] }),
    ])
    expect(registry.getTemplateMetadata('sales.offer')).toMatchObject({ version: '1', versions: ['1'] })
    expect(registry.getTemplateMetadata('sales.versioned')).toMatchObject({ version: '3', versions: ['3', '2'] })
  })

  it('renders the latest version by default and an archived version on explicit request', async () => {
    const registry = new TemplateRegistry()
    registry.register([makeEntry({
      version: '3',
      load: async () => ({ type: 'current' }),
      archivedVersions: [{ version: '2', load: async () => ({ type: 'archived' }) }],
    })])
    const latest = await registry.load({ id: 'sales.offer', data: { id: 'x' } }, context)
    expect(latest.template.version).toBe('3')
    expect(latest.render.source).toEqual({ type: 'current' })
    const archived = await registry.load({ id: 'sales.offer', data: { id: 'x' }, version: '2' }, context)
    expect(archived.template.version).toBe('2')
    expect(archived.render.source).toEqual({ type: 'archived' })
  })

  it('rejects an unknown version before fetching any source data', async () => {
    const fetchData = jest.fn()
    const registry = new TemplateRegistry()
    registry.register([makeEntry({ fetchData })])
    await expect(registry.load({ id: 'sales.offer', data: { id: 'x' }, version: '9' }, context)).rejects.toThrow(UnknownTemplateVersionError)
    expect(fetchData).not.toHaveBeenCalled()
  })

  it('rejects templates declaring duplicate versions at registration', () => {
    const registry = new TemplateRegistry()
    expect(() => registry.register([makeEntry({ version: '2', archivedVersions: [{ version: '2', load: async () => ({ type: 'x' }) }] })])).toThrow(/duplicate or empty versions/)
    expect(registry.listTemplates()).toEqual([])
  })

  it('shares singleton state across isolated module instances', () => {
    jest.isolateModules(() => {
      const reloaded = jest.requireActual<typeof import('../template-registry')>('../template-registry')
      expect(reloaded.templateRegistry).toBe(templateRegistry)
    })
  })
})
