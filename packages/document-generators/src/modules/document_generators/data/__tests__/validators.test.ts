import {
  generateSchema,
  listDocumentsSchema,
  listTemplatesSchema,
  previewSchema,
  searchParamsToObject,
} from '../validators'

const uuid = '3f6c1a2e-8b1d-4c53-9a0e-1d2f3a4b5c6d'

describe('previewSchema / generateSchema', () => {
  it.each([['preview', previewSchema], ['generate', generateSchema]])('%s trims template_id and keeps data', (_name, schema) => {
    const parsed = schema.parse({ template_id: '  sales.offer ', data: { id: 'o-1', nested: { a: 1 } } })
    expect(parsed).toEqual({ template_id: 'sales.offer', data: { id: 'o-1', nested: { a: 1 } } })
  })

  it.each([['preview', previewSchema], ['generate', generateSchema]])('%s rejects invalid bodies', (_name, schema) => {
    expect(schema.safeParse({ template_id: '', data: {} }).success).toBe(false)
    expect(schema.safeParse({ template_id: '   ', data: {} }).success).toBe(false)
    expect(schema.safeParse({ data: {} }).success).toBe(false)
    expect(schema.safeParse({ template_id: 'a' }).success).toBe(false)
    expect(schema.safeParse({ template_id: 'a', data: [] }).success).toBe(false)
    expect(schema.safeParse({ template_id: 'a', data: 'x' }).success).toBe(false)
    expect(schema.safeParse({ template_id: 'a', data: null }).success).toBe(false)
  })

  it.each(['resource_kind', 'resource_id', 'resource_label'])('generate rejects top-level %s', (field) => {
    expect(generateSchema.safeParse({ template_id: 'a', data: {}, [field]: 'x' }).success).toBe(false)
    expect(previewSchema.safeParse({ template_id: 'a', data: {}, [field]: 'x' }).success).toBe(false)
  })
})

describe('listTemplatesSchema', () => {
  it('accepts an empty query', () => {
    expect(listTemplatesSchema.parse({})).toEqual({})
  })

  it('normalizes a single tag to an array and keeps repeated tags', () => {
    expect(listTemplatesSchema.parse({ tags: 'a' }).tags).toEqual(['a'])
    expect(listTemplatesSchema.parse({ tags: ['a', 'b'] }).tags).toEqual(['a', 'b'])
  })

  it('rejects empty filter values', () => {
    expect(listTemplatesSchema.safeParse({ resource_kind: '' }).success).toBe(false)
    expect(listTemplatesSchema.safeParse({ document_type: '  ' }).success).toBe(false)
    expect(listTemplatesSchema.safeParse({ format: '' }).success).toBe(false)
    expect(listTemplatesSchema.safeParse({ tags: '' }).success).toBe(false)
    expect(listTemplatesSchema.safeParse({ tags: ['a', ''] }).success).toBe(false)
    expect(listTemplatesSchema.safeParse({ tags: [] }).success).toBe(false)
  })

  it('parses URLSearchParams with repeated tags', () => {
    const raw = searchParamsToObject(new URLSearchParams('format=pdf&tags=a&tags=b&tags='))
    expect(raw).toEqual({ format: 'pdf', tags: ['a', 'b', ''] })
    expect(listTemplatesSchema.safeParse(raw).success).toBe(false)
    expect(listTemplatesSchema.parse(searchParamsToObject(new URLSearchParams('tags=a&tags=b'))).tags).toEqual(['a', 'b'])
  })
})

describe('listDocumentsSchema', () => {
  it('applies defaults', () => {
    expect(listDocumentsSchema.parse({})).toEqual({
      page: 1,
      pageSize: 20,
      sort: 'generated_at',
      sort_direction: 'desc',
    })
  })

  it('coerces numeric strings and accepts full filters', () => {
    const parsed = listDocumentsSchema.parse({
      page: '2',
      pageSize: '100',
      resource_kind: 'sales.order',
      resource_id: 'o-1',
      template_id: 'sales.order',
      generated_by: uuid,
      generated_from: '2026-01-01T00:00:00.000Z',
      generated_to: '2026-01-02T00:00:00.000Z',
      sort: 'template_label',
      sort_direction: 'asc',
    })
    expect(parsed.page).toBe(2)
    expect(parsed.pageSize).toBe(100)
    expect(parsed.sort).toBe('template_label')
  })

  it.each([
    ['sort=resource_label', { sort: 'resource_label' }],
    ['unknown sort', { sort: 'nope' }],
    ['bad direction', { sort_direction: 'up' }],
    ['non-uuid generated_by', { generated_by: 'user-1' }],
    ['inverted range', { generated_from: '2026-02-01T00:00:00Z', generated_to: '2026-01-01T00:00:00Z' }],
    ['non-ISO date', { generated_from: 'yesterday' }],
    ['pageSize 101', { pageSize: '101' }],
    ['pageSize 0', { pageSize: '0' }],
    ['page 0', { page: '0' }],
    ['fractional page', { page: '1.5' }],
    ['lone resource_kind', { resource_kind: 'sales.order' }],
    ['lone resource_id', { resource_id: 'o-1' }],
    ['empty resource_kind', { resource_kind: '', resource_id: 'o-1' }],
    ['empty template_id', { template_id: '' }],
  ])('rejects %s', (_name, query) => {
    expect(listDocumentsSchema.safeParse(query).success).toBe(false)
  })

  it('accepts an equal date range', () => {
    const at = '2026-01-01T00:00:00Z'
    expect(listDocumentsSchema.safeParse({ generated_from: at, generated_to: at }).success).toBe(true)
  })
})
