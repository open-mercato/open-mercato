import { buildCustomFieldFiltersFromQuery, splitCustomFieldPayload } from '../custom-fields'

const mockEntityManager = (defs: any[]) => ({
  find: jest.fn().mockResolvedValue(defs),
})

describe('buildCustomFieldFiltersFromQuery', () => {
  const definitions = [
    {
      id: 'def-fashion-color',
      key: 'color',
      kind: 'text',
      entityId: 'catalog:product',
      configJson: { fieldset: 'fashion' },
    },
    {
      id: 'def-shared-material',
      key: 'material',
      kind: 'text',
      entityId: 'catalog:product',
      configJson: {},
    },
  ]

  it('generates filters for matching definitions regardless of fieldset when none specified', async () => {
    const em = mockEntityManager(definitions)
    const filters = await buildCustomFieldFiltersFromQuery({
      entityIds: ['catalog:product'],
      query: { cf_color: 'blue' },
      em: em as any,
      tenantId: 'tenant-1',
    })
    expect(em.find).toHaveBeenCalled()
    expect(filters).toEqual({ 'cf:color': 'blue' })
  })

  it('restricts filters to the requested fieldset code', async () => {
    const em = mockEntityManager(definitions)
    const filters = await buildCustomFieldFiltersFromQuery({
      entityIds: ['catalog:product'],
      query: { cf_color: 'blue' },
      em: em as any,
      tenantId: 'tenant-1',
      fieldset: 'fashion',
    })
    expect(filters).toEqual({ 'cf:color': 'blue' })
    const emptyFilters = await buildCustomFieldFiltersFromQuery({
      entityIds: ['catalog:product'],
      query: { cf_color: 'blue', cf_material: 'cotton' },
      em: em as any,
      tenantId: 'tenant-1',
      fieldset: 'tech',
    })
    expect(emptyFilters).toEqual({})
  })
})

describe('splitCustomFieldPayload', () => {
  it('pulls values from customValues map', () => {
    const raw = {
      name: 'Channel',
      customValues: {
        api_url: 'https://example.dev',
        priority: 5,
      },
    }
    expect(splitCustomFieldPayload(raw)).toEqual({
      base: { name: 'Channel' },
      custom: { api_url: 'https://example.dev', priority: 5 },
    })
  })

  it('maps array based customFields entries', () => {
    const raw = {
      customFields: [
        { key: 'api_url', value: 'https://example.dev' },
        { key: '', value: 'ignored' },
        { key: 'notes', value: null },
      ],
      code: 'demo',
    }
    expect(splitCustomFieldPayload(raw)).toEqual({
      base: { code: 'demo' },
      custom: {
        api_url: 'https://example.dev',
        notes: null,
      },
    })
  })
})
