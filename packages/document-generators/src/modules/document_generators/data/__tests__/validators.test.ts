import { generateSchema, listDocumentsSchema, listTemplatesSchema } from '../validators'

describe('generateSchema', () => {
  it('accepts template_id and data', () => {
    const r = generateSchema.safeParse({ template_id: 'sample-report', data: { id: 'abc' } })
    expect(r.success).toBe(true)
  })

  it('strips client-supplied resource identity so it remains server-derived', () => {
    const r = generateSchema.parse({
      template_id: 'sample-report',
      data: { id: 'abc' },
      resource_kind: 'example.record',
      resource_id: 'record-1',
      resource_label: 'spoofed label',
    })

    expect(r).not.toHaveProperty('resource_kind')
    expect(r).not.toHaveProperty('resource_id')
    expect(r).not.toHaveProperty('resource_label')
  })

  it('rejects a missing template_id', () => {
    expect(generateSchema.safeParse({ data: { id: 'abc' } }).success).toBe(false)
  })

  it('rejects an empty template_id', () => {
    expect(generateSchema.safeParse({ template_id: '', data: { id: 'abc' } }).success).toBe(false)
  })

  it('rejects a missing data object', () => {
    expect(generateSchema.safeParse({ template_id: 'sample-report' }).success).toBe(false)
  })
})

describe('listDocumentsSchema', () => {
  it('applies defaults for page and pageSize', () => {
    const r = listDocumentsSchema.parse({})
    expect(r).toMatchObject({ page: 1, pageSize: 20, sort: 'generated_at', sort_direction: 'desc' })
  })

  it('coerces numeric query strings', () => {
    const r = listDocumentsSchema.parse({ page: '3', pageSize: '50' })
    expect(r).toMatchObject({ page: 3, pageSize: 50 })
  })

  it('keeps optional resource filters', () => {
    const r = listDocumentsSchema.parse({ resource_kind: 'example.record', resource_id: 'record-1' })
    expect(r).toMatchObject({ resource_kind: 'example.record', resource_id: 'record-1' })
  })

  it('coerces history filters and keeps supported sorting', () => {
    const r = listDocumentsSchema.parse({
      template_id: 'sample-report',
      generated_by: '5b59688c-7101-4fe7-b4b7-23c8ab83bb01',
      generated_from: '2026-08-01T00:00:00.000Z',
      generated_to: '2026-08-14T23:59:59.999Z',
      sort: 'template_label',
      sort_direction: 'asc',
    })

    expect(r).toMatchObject({
      template_id: 'sample-report',
      generated_by: '5b59688c-7101-4fe7-b4b7-23c8ab83bb01',
      generated_from: new Date('2026-08-01T00:00:00.000Z'),
      generated_to: new Date('2026-08-14T23:59:59.999Z'),
      sort: 'template_label',
      sort_direction: 'asc',
    })
  })

  it('rejects an inverted generation date range', () => {
    expect(listDocumentsSchema.safeParse({
      generated_from: '2026-08-15T00:00:00.000Z',
      generated_to: '2026-08-14T23:59:59.999Z',
    }).success).toBe(false)
  })

  it('rejects unsupported sort fields and invalid generator ids', () => {
    expect(listDocumentsSchema.safeParse({ sort: 'id' }).success).toBe(false)
    expect(listDocumentsSchema.safeParse({ generated_by: 'not-a-uuid' }).success).toBe(false)
  })

  it('rejects pageSize above the cap', () => {
    expect(listDocumentsSchema.safeParse({ pageSize: '500' }).success).toBe(false)
  })

  it('rejects a non-positive page', () => {
    expect(listDocumentsSchema.safeParse({ page: '0' }).success).toBe(false)
  })
})

describe('listTemplatesSchema', () => {
  it('keeps optional template metadata filters', () => {
    expect(listTemplatesSchema.parse({
      resource_kind: 'example.record',
      document_type: 'invoice',
      format: 'pdf',
      tags: ['customer', 'accounting'],
    })).toEqual({
      resource_kind: 'example.record',
      document_type: 'invoice',
      format: 'pdf',
      tags: ['customer', 'accounting'],
    })
  })

  it('allows an unfiltered catalogue request', () => {
    expect(listTemplatesSchema.parse({})).toEqual({})
  })

  it('rejects empty filter values', () => {
    expect(listTemplatesSchema.safeParse({
      resource_kind: '',
      document_type: '',
      format: '',
      tags: [''],
    }).success).toBe(false)
  })
})
