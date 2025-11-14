import { normalizeAttributeSchema, resolveAttributeSchema } from '../attributeSchemas'

describe('catalog attribute schema helpers', () => {
  it('normalizes schema by deep cloning input', () => {
    const schema = { definitions: [{ id: 'color', type: 'text' as const }] }
    const normalized = normalizeAttributeSchema(schema)

    expect(normalized).toEqual(schema)
    expect(normalized).not.toBe(schema)

    normalized!.definitions![0].id = 'size'
    expect(schema.definitions![0].id).toBe('color')
  })

  it('prefers override definitions over base schema', () => {
    const base = { definitions: [{ id: 'color', label: 'Color' }] }
    const override = { definitions: [{ id: 'material', label: 'Material' }] }

    const resolved = resolveAttributeSchema(base as any, override as any)

    expect(resolved).toEqual(override)
    expect(resolved).not.toBe(override)
  })

  it('falls back to base schema when override missing', () => {
    const base = { definitions: [{ id: 'size', label: 'Size' }] }

    const resolved = resolveAttributeSchema(base as any, null)

    expect(resolved).toEqual(base)
    expect(resolved).not.toBe(base)
  })
})
