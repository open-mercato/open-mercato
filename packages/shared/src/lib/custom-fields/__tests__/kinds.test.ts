import {
  buildCustomFieldKindIndex,
  createCustomFieldKindMapResolver,
  emptyCustomFieldKindIndex,
  mergeCustomFieldKindIndexes,
  resolveCustomFieldKind,
  selectCustomFieldKindMap,
} from '../kinds'

const ORG_A = '11111111-1111-4111-8111-111111111111'
const ORG_B = '22222222-2222-4222-8222-222222222222'
const TENANT = '33333333-3333-4333-8333-333333333333'

const kindMap = (rows: Parameters<typeof buildCustomFieldKindIndex>[0], orgId: string | null = null, tenantId: string | null = null) =>
  selectCustomFieldKindMap(buildCustomFieldKindIndex(rows), orgId, tenantId)

describe('custom-fields/kinds', () => {
  it('indexes a definition under both its authored key and its sanitized alias', () => {
    expect(kindMap([{ key: 'order-ref', kind: 'text' }])).toEqual({ 'order-ref': 'text', order_ref: 'text' })
  })

  it('lets an authored key win over an alias another definition sanitizes to', () => {
    const aliasFirst = kindMap([
      { key: 'order-ref', kind: 'text' },
      { key: 'order_ref', kind: 'integer' },
    ])
    const authoredFirst = kindMap([
      { key: 'order_ref', kind: 'integer' },
      { key: 'order-ref', kind: 'text' },
    ])

    expect(aliasFirst.order_ref).toBe('integer')
    expect(authoredFirst.order_ref).toBe('integer')
  })

  it('normalizes rows with blank, non-string, or missing values', () => {
    const map = kindMap([
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

  describe('scope resolution', () => {
    // custom_field_defs has no unique constraint on (entity_id, key): an organization may
    // override an inherited definition, and POST /definitions does not force the override's
    // kind to match. Typing a value by the wrong scope's definition would turn an integer
    // custom field into a string on read — the exact regression #5968 set out to avoid.
    const collidingDefs = [
      { key: 'code', kind: 'integer', organizationId: ORG_A, tenantId: TENANT },
      { key: 'code', kind: 'text', organizationId: ORG_B, tenantId: TENANT },
      { key: 'code', kind: 'boolean', organizationId: null, tenantId: null },
    ]

    it('types a key by the definition of the row\'s own organization', () => {
      expect(kindMap(collidingDefs, ORG_A, TENANT).code).toBe('integer')
      expect(kindMap(collidingDefs, ORG_B, TENANT).code).toBe('text')
    })

    it('is not decided by the order rows came back in', () => {
      const reversed = collidingDefs.slice().reverse()

      expect(kindMap(reversed, ORG_A, TENANT).code).toBe('integer')
      expect(kindMap(reversed, ORG_B, TENANT).code).toBe('text')
    })

    it('prefers a tenant-scoped definition over a global one when no organization matches', () => {
      const defs = [
        { key: 'code', kind: 'boolean', organizationId: null, tenantId: null },
        { key: 'code', kind: 'float', organizationId: null, tenantId: TENANT },
      ]

      expect(kindMap(defs, null, TENANT).code).toBe('float')
    })

    it('falls back to the global definition for an organization that defines none', () => {
      const unknownOrg = '44444444-4444-4444-8444-444444444444'

      expect(kindMap(collidingDefs, unknownOrg, TENANT).code).toBe('boolean')
    })

    it('breaks a same-scope tie deterministically rather than by row order', () => {
      const defs = [
        { key: 'code', kind: 'integer', organizationId: ORG_A, tenantId: TENANT, configJson: { priority: 5 } },
        { key: 'code', kind: 'text', organizationId: ORG_A, tenantId: TENANT, configJson: { priority: 1 } },
      ]

      expect(kindMap(defs, ORG_A, TENANT).code).toBe('text')
      expect(kindMap(defs.slice().reverse(), ORG_A, TENANT).code).toBe('text')
    })

    it('applies the same scope rule to a sanitized alias as to an authored key', () => {
      const defs = [
        { key: 'order-ref', kind: 'integer', organizationId: ORG_A, tenantId: TENANT },
        { key: 'order-ref', kind: 'text', organizationId: ORG_B, tenantId: TENANT },
      ]

      expect(kindMap(defs, ORG_A, TENANT).order_ref).toBe('integer')
      expect(kindMap(defs, ORG_B, TENANT).order_ref).toBe('text')
    })
  })

  describe('createCustomFieldKindMapResolver', () => {
    const index = buildCustomFieldKindIndex([
      { key: 'code', kind: 'integer', organizationId: ORG_A, tenantId: TENANT },
      { key: 'code', kind: 'text', organizationId: ORG_B, tenantId: TENANT },
    ])

    it('gives each organization its own map', () => {
      const resolve = createCustomFieldKindMapResolver(index)

      expect(resolve(ORG_A, TENANT).code).toBe('integer')
      expect(resolve(ORG_B, TENANT).code).toBe('text')
    })

    it('reuses the map for a repeated scope', () => {
      const resolve = createCustomFieldKindMapResolver(index)

      expect(resolve(ORG_A, TENANT)).toBe(resolve(ORG_A, TENANT))
      expect(resolve(ORG_A, TENANT)).not.toBe(resolve(ORG_B, TENANT))
    })

    it('yields an empty map for an absent index', () => {
      expect(createCustomFieldKindMapResolver(null)(ORG_A, TENANT)).toEqual({})
    })
  })

  describe('mergeCustomFieldKindIndexes', () => {
    it('lets the earliest source win when several define the same key', () => {
      // The query engine reads a cf value with `coalesce(source0, source1, ...)`, so the kind
      // has to come from the same source the value did.
      const base = buildCustomFieldKindIndex([{ key: 'code', kind: 'text' }])
      const joined = buildCustomFieldKindIndex([
        { key: 'code', kind: 'integer' },
        { key: 'extra', kind: 'boolean' },
      ])

      expect(selectCustomFieldKindMap(mergeCustomFieldKindIndexes([base, joined]), null, null))
        .toEqual({ code: 'text', extra: 'boolean' })
      expect(selectCustomFieldKindMap(mergeCustomFieldKindIndexes([joined, base]), null, null))
        .toEqual({ code: 'integer', extra: 'boolean' })
    })

    it('keeps the earlier source winning per scope, not just for the default one', () => {
      const base = buildCustomFieldKindIndex([
        { key: 'code', kind: 'text', organizationId: ORG_A, tenantId: TENANT },
      ])
      const joined = buildCustomFieldKindIndex([
        { key: 'code', kind: 'integer', organizationId: ORG_A, tenantId: TENANT },
      ])

      expect(selectCustomFieldKindMap(mergeCustomFieldKindIndexes([base, joined]), ORG_A, TENANT).code).toBe('text')
      expect(selectCustomFieldKindMap(mergeCustomFieldKindIndexes([joined, base]), ORG_A, TENANT).code).toBe('integer')
    })

    it('ignores absent sources when merging', () => {
      const index = buildCustomFieldKindIndex([{ key: 'code', kind: 'text' }])

      expect(selectCustomFieldKindMap(
        mergeCustomFieldKindIndexes([null, index, undefined, emptyCustomFieldKindIndex()]), null, null,
      )).toEqual({ code: 'text' })
      expect(selectCustomFieldKindMap(mergeCustomFieldKindIndexes([]), null, null)).toEqual({})
    })

    it('keeps a null kind from an earlier source instead of falling through', () => {
      const base = buildCustomFieldKindIndex([{ key: 'code' }])
      const joined = buildCustomFieldKindIndex([{ key: 'code', kind: 'integer' }])

      expect(selectCustomFieldKindMap(mergeCustomFieldKindIndexes([base, joined]), null, null).code).toBeNull()
    })
  })

  describe('resolveCustomFieldKind', () => {
    it('resolves both index-document key shapes', () => {
      const map = kindMap([{ key: 'note', kind: 'multiline' }])

      expect(resolveCustomFieldKind(map, 'cf:note')).toBe('multiline')
      expect(resolveCustomFieldKind(map, 'cf_note')).toBe('multiline')
    })

    it('resolves a sanitized document key back to its authored definition', () => {
      const map = kindMap([{ key: 'order-ref', kind: 'text' }])

      expect(resolveCustomFieldKind(map, 'cf_order_ref')).toBe('text')
      expect(resolveCustomFieldKind(map, 'cf:order-ref')).toBe('text')
    })

    it('returns null for an unknown key, an absent map, or a bare prefix', () => {
      const map = kindMap([{ key: 'note', kind: 'text' }])

      expect(resolveCustomFieldKind(map, 'cf:missing')).toBeNull()
      expect(resolveCustomFieldKind(null, 'cf:note')).toBeNull()
      expect(resolveCustomFieldKind(undefined, 'cf:note')).toBeNull()
      expect(resolveCustomFieldKind(map, 'cf:')).toBeNull()
    })
  })
})
