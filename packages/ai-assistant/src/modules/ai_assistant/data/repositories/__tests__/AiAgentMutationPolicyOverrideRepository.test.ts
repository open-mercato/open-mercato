import { AiAgentMutationPolicyOverrideRepository } from '../AiAgentMutationPolicyOverrideRepository'
import { AiAgentMutationPolicyOverride } from '../../entities'

type Row = {
  id: string
  tenantId: string
  organizationId: string | null
  agentId: string
  mutationPolicy: string
  notes: string | null
  createdByUserId: string | null
  createdAt: Date
  updatedAt: Date
}

let idCounter = 0

function mockEm() {
  const store: Row[] = []

  const find = async (_entity: unknown, where: any): Promise<Row[]> => {
    return store.filter((row) => {
      if (where?.agentId && row.agentId !== where.agentId) return false
      if (where?.tenantId && row.tenantId !== where.tenantId) return false
      if (where && 'organizationId' in where) {
        const expected = where.organizationId ?? null
        if ((row.organizationId ?? null) !== expected) return false
      }
      return true
    })
  }

  const em: any = {
    find,
    findOne: async (_entity: unknown, where: any, options?: any) => {
      const rows = await find(_entity, where, options)
      return rows[0] ?? null
    },
    create: (_entity: unknown, data: any) => {
      idCounter += 1
      const row: Row = {
        id: `row-${idCounter}`,
        tenantId: data.tenantId,
        organizationId: data.organizationId ?? null,
        agentId: data.agentId,
        mutationPolicy: data.mutationPolicy,
        notes: data.notes ?? null,
        createdByUserId: data.createdByUserId ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      return row
    },
    persistAndFlush: async (row: Row) => {
      const existingIndex = store.findIndex((r) => r.id === row.id)
      if (existingIndex >= 0) {
        store[existingIndex] = row
        return
      }
      store.push(row)
    },
    removeAndFlush: async (row: Row) => {
      const index = store.findIndex((r) => r.id === row.id)
      if (index >= 0) store.splice(index, 1)
    },
    transactional: async (fn: (tx: any) => Promise<unknown>) => fn(em),
    __store: store,
  }

  return em
}

describe('AiAgentMutationPolicyOverrideRepository', () => {
  it('set + get round-trip returns the persisted row', async () => {
    const em = mockEm()
    const repo = new AiAgentMutationPolicyOverrideRepository(em)
    const ctx = { tenantId: 't1', organizationId: null }

    await repo.set(
      { agentId: 'catalog.assistant', mutationPolicy: 'read-only', notes: 'lock it down' },
      ctx,
    )

    const row = await repo.get('catalog.assistant', ctx)
    expect(row).not.toBeNull()
    expect(row!.mutationPolicy).toBe('read-only')
    expect(row!.notes).toBe('lock it down')
  })

  it('set replaces the existing row (one override per tenant+org+agent)', async () => {
    const em = mockEm()
    const repo = new AiAgentMutationPolicyOverrideRepository(em)
    const ctx = { tenantId: 't1', organizationId: null }

    await repo.set(
      { agentId: 'catalog.assistant', mutationPolicy: 'read-only' },
      ctx,
    )
    await repo.set(
      { agentId: 'catalog.assistant', mutationPolicy: 'destructive-confirm-required' },
      ctx,
    )

    const row = await repo.get('catalog.assistant', ctx)
    expect(row).not.toBeNull()
    expect(row!.mutationPolicy).toBe('destructive-confirm-required')
    // Only one row exists for this tuple.
    expect(em.__store.length).toBe(1)
  })

  it('clear returns null on subsequent get', async () => {
    const em = mockEm()
    const repo = new AiAgentMutationPolicyOverrideRepository(em)
    const ctx = { tenantId: 't1', organizationId: null }

    await repo.set(
      { agentId: 'catalog.assistant', mutationPolicy: 'read-only' },
      ctx,
    )
    const cleared = await repo.clear('catalog.assistant', ctx)
    expect(cleared).toBe(true)

    const row = await repo.get('catalog.assistant', ctx)
    expect(row).toBeNull()
  })

  it('clear returns false when no override exists', async () => {
    const em = mockEm()
    const repo = new AiAgentMutationPolicyOverrideRepository(em)
    const cleared = await repo.clear('catalog.assistant', {
      tenantId: 't1',
      organizationId: null,
    })
    expect(cleared).toBe(false)
  })

  it('scopes per tenant — get for a different tenant returns null', async () => {
    const em = mockEm()
    const repo = new AiAgentMutationPolicyOverrideRepository(em)

    await repo.set(
      { agentId: 'catalog.assistant', mutationPolicy: 'read-only' },
      { tenantId: 't1', organizationId: null },
    )
    const rowA = await repo.get('catalog.assistant', {
      tenantId: 't1',
      organizationId: null,
    })
    const rowB = await repo.get('catalog.assistant', {
      tenantId: 't2',
      organizationId: null,
    })
    expect(rowA?.mutationPolicy).toBe('read-only')
    expect(rowB).toBeNull()
  })

  it('throws when tenantId is missing on set', async () => {
    const em = mockEm()
    const repo = new AiAgentMutationPolicyOverrideRepository(em)
    await expect(
      repo.set(
        { agentId: 'catalog.assistant', mutationPolicy: 'read-only' },
        { tenantId: '', organizationId: null } as any,
      ),
    ).rejects.toThrow(/tenantId/)
  })

  it('returns an AiAgentMutationPolicyOverride-shaped payload', async () => {
    const em = mockEm()
    const repo = new AiAgentMutationPolicyOverrideRepository(em)
    const saved = await repo.set(
      { agentId: 'catalog.assistant', mutationPolicy: 'read-only', notes: 'note' },
      { tenantId: 't1', organizationId: 'o1', userId: 'u1' },
    )
    expect(saved.agentId).toBe('catalog.assistant')
    expect(saved.mutationPolicy).toBe('read-only')
    expect(saved.organizationId).toBe('o1')
    expect(saved.createdByUserId).toBe('u1')
    expect(saved.notes).toBe('note')
    void AiAgentMutationPolicyOverride
  })
})
