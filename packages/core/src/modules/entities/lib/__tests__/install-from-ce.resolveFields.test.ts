import { resolveFields } from '../install-from-ce'

describe('resolveFields (#4378)', () => {
  it('keeps declaration order instead of sorting alphabetically', () => {
    const resolved = resolveFields([
      {
        entity: 'crm:company',
        fields: [
          { key: 'tax_id', kind: 'text' },
          { key: 'annual_revenue', kind: 'integer' },
          { key: 'billing_notes', kind: 'text' },
        ],
      },
    ] as never)

    expect(resolved.map((field) => field.key)).toEqual(['tax_id', 'annual_revenue', 'billing_notes'])
    expect(resolved.map((field) => field.priority)).toEqual([0, 1, 2])
  })

  it('honors an explicit priority over declaration order', () => {
    const resolved = resolveFields([
      {
        entity: 'crm:company',
        fields: [
          { key: 'first_declared', kind: 'text', priority: 30 },
          { key: 'second_declared', kind: 'text', priority: 10 },
          { key: 'third_declared', kind: 'text', priority: 20 },
        ],
      },
    ] as never)

    expect(resolved.map((field) => field.key)).toEqual(['second_declared', 'third_declared', 'first_declared'])
    expect(resolved.map((field) => field.priority)).toEqual([10, 20, 30])
  })

  it('keeps declaration order when explicit and derived priorities tie', () => {
    const resolved = resolveFields([
      {
        entity: 'crm:company',
        fields: [
          { key: 'zeta', kind: 'text' },
          { key: 'alpha', kind: 'text', priority: 0 },
          { key: 'omega', kind: 'text', priority: 0 },
        ],
      },
    ] as never)

    expect(resolved.map((field) => field.key)).toEqual(['zeta', 'alpha', 'omega'])
    expect(resolved.map((field) => field.priority)).toEqual([0, 0, 0])
  })

  it('merges field sets by key while keeping the first declaration position', () => {
    const resolved = resolveFields([
      {
        entity: 'crm:company',
        fields: [
          { key: 'tax_id', kind: 'text' },
          { key: 'notes', kind: 'text' },
        ],
      },
      {
        entity: 'crm:company',
        fields: [{ key: 'tax_id', kind: 'text', label: 'Tax identifier' }],
      },
    ] as never)

    expect(resolved.map((field) => field.key)).toEqual(['tax_id', 'notes'])
    expect(resolved[0].label).toBe('Tax identifier')
  })
})
