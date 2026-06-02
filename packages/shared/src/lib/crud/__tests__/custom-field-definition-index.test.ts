import {
  buildCustomFieldDefinitionIndexFromRows,
  canReuseCustomFieldDefinitions,
  resolveCfDefIndexOrgCandidates,
  type CustomFieldDefinitionRow,
} from '../custom-field-definition-index'

const row = (overrides: Partial<CustomFieldDefinitionRow> & Pick<CustomFieldDefinitionRow, 'key' | 'entityId'>): CustomFieldDefinitionRow => ({
  kind: 'text',
  configJson: {},
  organizationId: null,
  tenantId: null,
  deletedAt: null,
  updatedAt: null,
  ...overrides,
})

describe('buildCustomFieldDefinitionIndexFromRows', () => {
  it('groups summaries by normalized key and summarizes config', () => {
    const index = buildCustomFieldDefinitionIndexFromRows([
      row({ key: 'Color', entityId: 'demo:entity', configJson: { label: 'Colour', multi: true, priority: 2 }, kind: 'select' }),
    ])
    expect(Array.from(index.keys())).toEqual(['color'])
    const summaries = index.get('color')!
    expect(summaries).toHaveLength(1)
    expect(summaries[0]).toMatchObject({ key: 'Color', label: 'Colour', kind: 'select', multi: true, priority: 2 })
  })

  it('sorts summaries within a key by priority, then recency, then key', () => {
    const index = buildCustomFieldDefinitionIndexFromRows([
      row({ key: 'color', entityId: 'demo:entity', tenantId: 't1', organizationId: 'o1', configJson: { priority: 5 } }),
      row({ key: 'color', entityId: 'demo:entity', tenantId: 't1', organizationId: 'o2', configJson: { priority: 1 } }),
    ], { organizationIds: ['o1', 'o2'] })
    const summaries = index.get('color')!
    expect(summaries.map((s) => s.organizationId)).toEqual(['o2', 'o1'])
  })

  it('excludes soft-deleted rows', () => {
    const index = buildCustomFieldDefinitionIndexFromRows([
      row({ key: 'color', entityId: 'demo:entity', deletedAt: new Date('2026-01-01T00:00:00Z') }),
      row({ key: 'size', entityId: 'demo:entity' }),
    ])
    expect(Array.from(index.keys()).sort()).toEqual(['size'])
  })

  it('keeps null-org rows and rows whose org is a candidate, drops foreign-org rows', () => {
    const index = buildCustomFieldDefinitionIndexFromRows([
      row({ key: 'global_field', entityId: 'demo:entity', organizationId: null }),
      row({ key: 'scoped_field', entityId: 'demo:entity', organizationId: 'org-allowed' }),
      row({ key: 'foreign_field', entityId: 'demo:entity', organizationId: 'org-other' }),
    ], { organizationIds: ['org-allowed'] })
    expect(Array.from(index.keys()).sort()).toEqual(['global_field', 'scoped_field'])
  })

  it('drops all explicit-org rows when no candidates are supplied', () => {
    const index = buildCustomFieldDefinitionIndexFromRows([
      row({ key: 'global_field', entityId: 'demo:entity', organizationId: null }),
      row({ key: 'scoped_field', entityId: 'demo:entity', organizationId: 'org-allowed' }),
    ], { organizationIds: [] })
    expect(Array.from(index.keys()).sort()).toEqual(['global_field'])
  })

  it('filters by fieldset membership', () => {
    const index = buildCustomFieldDefinitionIndexFromRows([
      row({ key: 'a', entityId: 'demo:entity', configJson: { fieldset: 'pack' } }),
      row({ key: 'b', entityId: 'demo:entity', configJson: { fieldsets: ['pack', 'other'] } }),
      row({ key: 'c', entityId: 'demo:entity', configJson: { fieldset: 'other' } }),
    ], { fieldset: 'pack' })
    expect(Array.from(index.keys()).sort()).toEqual(['a', 'b'])
  })
})

describe('resolveCfDefIndexOrgCandidates', () => {
  it('prefers explicit organization ids and drops blanks', () => {
    expect(resolveCfDefIndexOrgCandidates(['o1', '', null, 'o2'], 'fallback')).toEqual(['o1', 'o2'])
  })

  it('falls back to the singleton when no explicit ids are given', () => {
    expect(resolveCfDefIndexOrgCandidates(null, 'fallback')).toEqual(['fallback'])
    expect(resolveCfDefIndexOrgCandidates([], 'fallback')).toEqual(['fallback'])
  })

  it('returns an empty list when neither ids nor fallback resolve', () => {
    expect(resolveCfDefIndexOrgCandidates(null, null)).toEqual([])
    expect(resolveCfDefIndexOrgCandidates([], undefined)).toEqual([])
  })
})

describe('canReuseCustomFieldDefinitions', () => {
  const resolved = {
    index: new Map(),
    entityIds: ['demo:a', 'demo:b'],
    tenantId: 't1',
    organizationIds: ['o1'],
  }

  it('reuses when entity set, tenant, and org candidates all match (order-insensitive)', () => {
    expect(canReuseCustomFieldDefinitions(resolved, {
      entityIds: ['demo:b', 'demo:a'],
      tenantId: 't1',
      organizationIds: ['o1'],
    })).toBe(true)
  })

  it('does not reuse when tenant differs', () => {
    expect(canReuseCustomFieldDefinitions(resolved, {
      entityIds: ['demo:a', 'demo:b'],
      tenantId: 't2',
      organizationIds: ['o1'],
    })).toBe(false)
  })

  it('does not reuse when entity set differs', () => {
    expect(canReuseCustomFieldDefinitions(resolved, {
      entityIds: ['demo:a'],
      tenantId: 't1',
      organizationIds: ['o1'],
    })).toBe(false)
  })

  it('does not reuse when org candidates differ', () => {
    expect(canReuseCustomFieldDefinitions(resolved, {
      entityIds: ['demo:a', 'demo:b'],
      tenantId: 't1',
      organizationIds: ['o2'],
    })).toBe(false)
  })

  it('does not reuse when nothing was precomputed', () => {
    expect(canReuseCustomFieldDefinitions(undefined, {
      entityIds: ['demo:a'],
      tenantId: 't1',
      organizationIds: ['o1'],
    })).toBe(false)
  })
})
