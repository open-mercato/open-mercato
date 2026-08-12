import { generateSchema, listDocumentsSchema } from '../validators'

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
    expect(r).toMatchObject({ page: 1, pageSize: 20 })
  })

  it('coerces numeric query strings', () => {
    const r = listDocumentsSchema.parse({ page: '3', pageSize: '50' })
    expect(r).toMatchObject({ page: 3, pageSize: 50 })
  })

  it('keeps optional resource filters', () => {
    const r = listDocumentsSchema.parse({ resource_kind: 'example.record', resource_id: 'record-1' })
    expect(r).toMatchObject({ resource_kind: 'example.record', resource_id: 'record-1' })
  })

  it('rejects pageSize above the cap', () => {
    expect(listDocumentsSchema.safeParse({ pageSize: '500' }).success).toBe(false)
  })

  it('rejects a non-positive page', () => {
    expect(listDocumentsSchema.safeParse({ page: '0' }).success).toBe(false)
  })
})
