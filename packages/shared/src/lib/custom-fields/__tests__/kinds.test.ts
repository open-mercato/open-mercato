import { buildCustomFieldKindMap, resolveCustomFieldKind } from '../kinds'

describe('custom-fields/kinds', () => {
  it('indexes a definition under both its authored key and its sanitized alias', () => {
    const map = buildCustomFieldKindMap([{ key: 'order-ref', kind: 'text' }])

    expect(map).toEqual({ 'order-ref': 'text', order_ref: 'text' })
  })

  it('lets an authored key win over an alias another definition sanitizes to', () => {
    const aliasFirst = buildCustomFieldKindMap([
      { key: 'order-ref', kind: 'text' },
      { key: 'order_ref', kind: 'integer' },
    ])
    const authoredFirst = buildCustomFieldKindMap([
      { key: 'order_ref', kind: 'integer' },
      { key: 'order-ref', kind: 'text' },
    ])

    expect(aliasFirst.order_ref).toBe('integer')
    expect(authoredFirst.order_ref).toBe('integer')
  })

  it('normalizes rows with blank, non-string, or missing values', () => {
    const map = buildCustomFieldKindMap([
      { key: '  padded  ', kind: 'text' },
      { key: 'no-kind' },
      { key: 'null-kind', kind: null },
      { key: 'numeric-kind', kind: 7 },
      { key: '   ' },
      { key: null },
      { key: 123, kind: 'text' },
    ])

    expect(map.padded).toBe('text')
    expect(map['no-kind']).toBeNull()
    expect(map['null-kind']).toBeNull()
    expect(map['numeric-kind']).toBeNull()
    expect(map['123']).toBe('text')
    expect(Object.keys(map)).not.toContain('')
  })

  it('resolves both index-document key shapes', () => {
    const map = buildCustomFieldKindMap([{ key: 'note', kind: 'multiline' }])

    expect(resolveCustomFieldKind(map, 'cf:note')).toBe('multiline')
    expect(resolveCustomFieldKind(map, 'cf_note')).toBe('multiline')
  })

  it('resolves a sanitized document key back to its authored definition', () => {
    const map = buildCustomFieldKindMap([{ key: 'order-ref', kind: 'text' }])

    expect(resolveCustomFieldKind(map, 'cf_order_ref')).toBe('text')
    expect(resolveCustomFieldKind(map, 'cf:order-ref')).toBe('text')
  })

  it('returns null for an unknown key, an absent map, or a bare prefix', () => {
    const map = buildCustomFieldKindMap([{ key: 'note', kind: 'text' }])

    expect(resolveCustomFieldKind(map, 'cf:missing')).toBeNull()
    expect(resolveCustomFieldKind(null, 'cf:note')).toBeNull()
    expect(resolveCustomFieldKind(undefined, 'cf:note')).toBeNull()
    expect(resolveCustomFieldKind(map, 'cf:')).toBeNull()
  })
})
