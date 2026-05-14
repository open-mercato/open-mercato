import { AiTenantModelAllowlistRepository } from '../AiTenantModelAllowlistRepository'

type Row = {
  id: string
  tenantId: string
  organizationId: string | null
  allowedProviders: string[] | null
  allowedModelsByProvider: Record<string, string[]>
  updatedByUserId: string | null
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
}

let idCounter = 0

function mockEm() {
  const store: Row[] = []

  function matchRow(row: Row, filter: Record<string, unknown>): boolean {
    if ('tenantId' in filter && row.tenantId !== filter.tenantId) return false
    if ('organizationId' in filter) {
      const expected = filter.organizationId ?? null
      if ((row.organizationId ?? null) !== expected) return false
    }
    if ('deletedAt' in filter) {
      const expected = filter.deletedAt ?? null
      if ((row.deletedAt ?? null) !== expected) return false
    }
    return true
  }

  const em: any = {
    findOne: async (_entity: unknown, where: any) => store.find((row) => matchRow(row, where)) ?? null,
    persist: (row: Row) => {
      em.__pendingPersist = row
      return em
    },
    flush: async () => {
      if (em.__pendingPersist) {
        const existing = store.find((r) => r.id === em.__pendingPersist?.id)
        if (!existing) {
          store.push(em.__pendingPersist as Row)
        } else {
          Object.assign(existing, em.__pendingPersist)
        }
        em.__pendingPersist = null
      }
    },
    create: (_entity: unknown, data: any) => {
      idCounter += 1
      const row: Row = {
        id: `row-${idCounter}`,
        tenantId: data.tenantId,
        organizationId: data.organizationId ?? null,
        allowedProviders: data.allowedProviders ?? null,
        allowedModelsByProvider: data.allowedModelsByProvider ?? {},
        updatedByUserId: data.updatedByUserId ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: data.deletedAt ?? null,
      }
      store.push(row)
      return row
    },
    transactional: async (fn: (tx: any) => Promise<unknown>) => fn(em),
    __pendingPersist: null as Row | null,
    __store: store,
  }

  return em
}

describe('AiTenantModelAllowlistRepository', () => {
  it('getForTenant returns null when no row exists', async () => {
    const em = mockEm()
    const repo = new AiTenantModelAllowlistRepository(em)
    expect(await repo.getForTenant({ tenantId: 't1' })).toBeNull()
  })

  it('upsert creates a row with the given snapshot', async () => {
    const em = mockEm()
    const repo = new AiTenantModelAllowlistRepository(em)
    const row = await repo.upsert(
      {
        allowedProviders: ['openai'],
        allowedModelsByProvider: { openai: ['gpt-5-mini'] },
      },
      { tenantId: 't1', organizationId: null, userId: 'u1' },
    )
    expect(row.allowedProviders).toEqual(['openai'])
    expect(row.allowedModelsByProvider).toEqual({ openai: ['gpt-5-mini'] })
    expect(row.updatedByUserId).toBe('u1')
  })

  it('upsert updates an existing row in place', async () => {
    const em = mockEm()
    const repo = new AiTenantModelAllowlistRepository(em)
    await repo.upsert(
      { allowedProviders: ['openai'], allowedModelsByProvider: {} },
      { tenantId: 't1', userId: 'u1' },
    )
    const updated = await repo.upsert(
      {
        allowedProviders: ['openai', 'anthropic'],
        allowedModelsByProvider: { openai: ['gpt-5-mini'] },
      },
      { tenantId: 't1', userId: 'u2' },
    )
    expect(updated.allowedProviders).toEqual(['openai', 'anthropic'])
    expect(updated.allowedModelsByProvider).toEqual({ openai: ['gpt-5-mini'] })
    expect(updated.updatedByUserId).toBe('u2')
    expect(em.__store.length).toBe(1)
  })

  it('getSnapshot returns a JSON-friendly snapshot of the persisted row', async () => {
    const em = mockEm()
    const repo = new AiTenantModelAllowlistRepository(em)
    await repo.upsert(
      {
        allowedProviders: ['openai'],
        allowedModelsByProvider: { openai: ['gpt-5-mini'] },
      },
      { tenantId: 't1', userId: 'u1' },
    )
    const snapshot = await repo.getSnapshot({ tenantId: 't1' })
    expect(snapshot).toEqual({
      allowedProviders: ['openai'],
      allowedModelsByProvider: { openai: ['gpt-5-mini'] },
    })
  })

  it('clear soft-deletes the active row', async () => {
    const em = mockEm()
    const repo = new AiTenantModelAllowlistRepository(em)
    await repo.upsert(
      { allowedProviders: ['openai'], allowedModelsByProvider: {} },
      { tenantId: 't1', userId: 'u1' },
    )
    const cleared = await repo.clear({ tenantId: 't1' })
    expect(cleared).toBe(true)
    const after = await repo.getForTenant({ tenantId: 't1' })
    expect(after).toBeNull()
  })

  it('clear returns false when no row exists', async () => {
    const em = mockEm()
    const repo = new AiTenantModelAllowlistRepository(em)
    expect(await repo.clear({ tenantId: 't1' })).toBe(false)
  })

  it('isolates rows across tenants', async () => {
    const em = mockEm()
    const repo = new AiTenantModelAllowlistRepository(em)
    await repo.upsert(
      { allowedProviders: ['openai'], allowedModelsByProvider: {} },
      { tenantId: 't1', userId: 'u1' },
    )
    await repo.upsert(
      { allowedProviders: ['anthropic'], allowedModelsByProvider: {} },
      { tenantId: 't2', userId: 'u2' },
    )
    const t1 = await repo.getSnapshot({ tenantId: 't1' })
    const t2 = await repo.getSnapshot({ tenantId: 't2' })
    expect(t1?.allowedProviders).toEqual(['openai'])
    expect(t2?.allowedProviders).toEqual(['anthropic'])
  })

  it('null tenantId yields null without touching the store', async () => {
    const em = mockEm()
    const repo = new AiTenantModelAllowlistRepository(em)
    expect(await repo.getForTenant({ tenantId: '' })).toBeNull()
    await expect(
      repo.upsert(
        { allowedProviders: ['openai'], allowedModelsByProvider: {} },
        { tenantId: '', userId: 'u1' },
      ),
    ).rejects.toThrow(/tenantId/)
    expect(em.__store.length).toBe(0)
  })
})
