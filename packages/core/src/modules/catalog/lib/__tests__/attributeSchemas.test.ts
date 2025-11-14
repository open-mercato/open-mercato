import { normalizeAttributeSchema, resolveAttributeSchema } from '../attributeSchemas'

describe('catalog attribute schema helpers', () => {
  it('normalizes schema by deep cloning input', () => {
    const schema = { definitions: [{ key: 'color', kind: 'text' as const }] }
    const normalized = normalizeAttributeSchema(schema)

    expect(normalized).toEqual(schema)
    expect(normalized).not.toBe(schema)

    normalized!.definitions![0].key = 'size'
    expect(schema.definitions![0].key).toBe('color')
  })

  it('prefers override definitions over base schema', () => {
    const base = { definitions: [{ key: 'color', label: 'Color', kind: 'text' }] }
    const override = { definitions: [{ key: 'material', label: 'Material', kind: 'text' }] }

    const resolved = resolveAttributeSchema(base as any, override as any)

    expect(resolved).toEqual(override)
    expect(resolved).not.toBe(override)
  })

  it('falls back to base schema when override missing', () => {
    const base = { definitions: [{ key: 'size', label: 'Size', kind: 'text' }] }

    const resolved = resolveAttributeSchema(base as any, null)

    expect(resolved).toEqual(base)
    expect(resolved).not.toBe(base)
  })
})
