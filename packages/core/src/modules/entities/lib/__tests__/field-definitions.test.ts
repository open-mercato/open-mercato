import { ensureCustomFieldDefinitions } from '../field-definitions'

type Where = Record<string, unknown>

function createMockEm(existing: Array<Record<string, unknown>> = []) {
  const persisted: Array<Record<string, unknown>> = []
  return {
    find: jest.fn(async (_entity: unknown, _where: Where) => existing),
    findOne: jest.fn(async () => null),
    create: jest.fn((_entity: unknown, data: Where) => ({ ...data })),
    persist: jest.fn((entity: Record<string, unknown>) => {
      persisted.push(entity)
    }),
    flush: jest.fn(async () => {}),
    persisted,
  }
}

const scope = { organizationId: 'org-1', tenantId: 'tenant-1' }

describe('ensureCustomFieldDefinitions (issue #1399)', () => {
  it('prefetches existing definitions once and flushes a single time for the whole batch', async () => {
    const em = createMockEm()
    const sets = [
      { entity: 'a:one', fields: [{ key: 'foo', kind: 'text' as const }, { key: 'bar', kind: 'integer' as const }] },
      { entity: 'b:two', fields: [{ key: 'baz', kind: 'boolean' as const }] },
    ]

    const result = await ensureCustomFieldDefinitions(em as any, sets, scope)

    expect(result).toEqual({ created: 3, updated: 0, unchanged: 0 })
    // One prefetch query covering every entity/key in the batch.
    expect(em.find).toHaveBeenCalledTimes(1)
    expect(em.find.mock.calls[0][1]).toMatchObject({
      entityId: { $in: ['a:one', 'b:two'] },
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      key: { $in: ['foo', 'bar', 'baz'] },
    })
    // No per-field point lookups, single flush for the batch.
    expect(em.findOne).not.toHaveBeenCalled()
    expect(em.flush).toHaveBeenCalledTimes(1)
    expect(em.persisted).toHaveLength(3)
  })

  it('updates prefetched matches in memory without per-field lookups', async () => {
    const existing = [
      { entityId: 'a:one', key: 'foo', kind: 'text', configJson: { label: 'Old' }, isActive: true, deletedAt: null },
    ]
    const em = createMockEm(existing)
    const sets = [
      { entity: 'a:one', fields: [
        { key: 'foo', kind: 'integer' as const, label: 'New' },
        { key: 'bar', kind: 'text' as const },
      ] },
    ]

    const result = await ensureCustomFieldDefinitions(em as any, sets, scope)

    expect(result).toEqual({ created: 1, updated: 1, unchanged: 0 })
    expect(existing[0].kind).toBe('integer')
    expect(em.findOne).not.toHaveBeenCalled()
    expect(em.flush).toHaveBeenCalledTimes(1)
  })

  it('passes a declared priority through to configJson (#4378)', async () => {
    const em = createMockEm()
    const sets = [
      {
        entity: 'a:one',
        fields: [
          { key: 'tax_id', kind: 'text' as const, priority: 5 },
          { key: 'notes', kind: 'text' as const },
        ],
      },
    ]

    await ensureCustomFieldDefinitions(em as any, sets, scope)

    const [taxId, notes] = em.persisted as Array<{ key: string; configJson: Record<string, unknown> }>
    expect(taxId.key).toBe('tax_id')
    expect(taxId.configJson.priority).toBe(5)
    expect(notes.configJson.priority).toBeUndefined()
  })

  it('does not query or flush on a dry run', async () => {
    const em = createMockEm()
    const sets = [{ entity: 'a:one', fields: [{ key: 'foo', kind: 'text' as const }] }]

    const result = await ensureCustomFieldDefinitions(em as any, sets, { ...scope, dryRun: true })

    expect(result).toEqual({ created: 1, updated: 0, unchanged: 0 })
    // Prefetch still runs (read-only) but nothing is persisted or flushed.
    expect(em.findOne).not.toHaveBeenCalled()
    expect(em.persist).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })
})
