import { AiAgentPromptOverrideRepository } from '../AiAgentPromptOverrideRepository'
import { AiAgentPromptOverride } from '../../entities'

type Row = {
  id: string
  tenantId: string
  organizationId: string | null
  agentId: string
  version: number
  sections: Record<string, string>
  notes: string | null
  createdByUserId: string | null
  createdAt: Date
  updatedAt: Date
}

let idCounter = 0

function mockEm() {
  const store: Row[] = []

  const find = async (_entity: unknown, where: any, options?: any): Promise<Row[]> => {
    let rows = store.filter((row) => {
      if (where?.agentId && row.agentId !== where.agentId) return false
      if (where?.tenantId && row.tenantId !== where.tenantId) return false
      // organizationId supports null filter equivalence.
      if (where && 'organizationId' in where) {
        const expected = where.organizationId ?? null
        if ((row.organizationId ?? null) !== expected) return false
      }
      return true
    })
    const orderBy = options?.orderBy
    if (orderBy?.version === 'desc') {
      rows = [...rows].sort((a, b) => b.version - a.version)
    } else if (orderBy?.version === 'asc') {
      rows = [...rows].sort((a, b) => a.version - b.version)
    }
    if (typeof options?.limit === 'number') rows = rows.slice(0, options.limit)
    return rows
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
        version: data.version,
        sections: data.sections,
        notes: data.notes ?? null,
        createdByUserId: data.createdByUserId ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      return row
    },
    persistAndFlush: async (row: Row) => {
      store.push(row)
    },
    transactional: async (fn: (tx: any) => Promise<unknown>) => {
      return fn(em)
    },
    __store: store,
  }

  return em
}

describe('AiAgentPromptOverrideRepository', () => {
  it('allocates monotonic versions per (tenant, org, agent)', async () => {
    const em = mockEm()
    const repo = new AiAgentPromptOverrideRepository(em)
    const ctx = { tenantId: 't1', organizationId: null }

    const first = await repo.save(
      { agentId: 'catalog.assistant', sections: { role: 'A' } },
      ctx,
    )
    expect(first.version).toBe(1)

    const second = await repo.save(
      { agentId: 'catalog.assistant', sections: { role: 'B' } },
      ctx,
    )
    expect(second.version).toBe(2)

    // Different agent under same tenant starts at 1 again.
    const otherAgent = await repo.save(
      { agentId: 'customers.assistant', sections: { role: 'C' } },
      ctx,
    )
    expect(otherAgent.version).toBe(1)
  })

  it('scopes per tenant — getLatest for a different tenant returns null', async () => {
    const em = mockEm()
    const repo = new AiAgentPromptOverrideRepository(em)

    await repo.save(
      { agentId: 'catalog.assistant', sections: { role: 'A' } },
      { tenantId: 't1', organizationId: null },
    )
    const latestA = await repo.getLatest('catalog.assistant', {
      tenantId: 't1',
      organizationId: null,
    })
    const latestB = await repo.getLatest('catalog.assistant', {
      tenantId: 't2',
      organizationId: null,
    })
    expect(latestA?.version).toBe(1)
    expect(latestB).toBeNull()
  })

  it('listVersions returns rows newest first and caps by limit', async () => {
    const em = mockEm()
    const repo = new AiAgentPromptOverrideRepository(em)
    const ctx = { tenantId: 't1', organizationId: null }

    for (let i = 0; i < 5; i += 1) {
      await repo.save(
        { agentId: 'catalog.assistant', sections: { role: `v${i}` } },
        ctx,
      )
    }

    const versions = await repo.listVersions('catalog.assistant', ctx, 3)
    expect(versions.map((v) => v.version)).toEqual([5, 4, 3])
  })

  it('returns empty array when tenant/agent has no rows', async () => {
    const em = mockEm()
    const repo = new AiAgentPromptOverrideRepository(em)
    const rows = await repo.listVersions('catalog.assistant', {
      tenantId: 't1',
      organizationId: null,
    })
    expect(rows).toEqual([])
  })

  it('drops empty/whitespace-only override values before persisting', async () => {
    const em = mockEm()
    const repo = new AiAgentPromptOverrideRepository(em)
    const saved = await repo.save(
      {
        agentId: 'catalog.assistant',
        sections: { role: 'kept', scope: '   ', data: '' },
      },
      { tenantId: 't1', organizationId: null },
    )
    expect(Object.keys(saved.sections)).toEqual(['role'])
  })

  it('throws when tenantId is missing on save', async () => {
    const em = mockEm()
    const repo = new AiAgentPromptOverrideRepository(em)
    await expect(
      repo.save(
        { agentId: 'catalog.assistant', sections: { role: 'x' } },
        { tenantId: '', organizationId: null } as any,
      ),
    ).rejects.toThrow(/tenantId/)
  })

  it('returns an AiAgentPromptOverride-shaped payload', async () => {
    const em = mockEm()
    const repo = new AiAgentPromptOverrideRepository(em)
    const saved = await repo.save(
      { agentId: 'catalog.assistant', sections: { role: 'x' }, notes: 'note' },
      { tenantId: 't1', organizationId: 'o1', userId: 'u1' },
    )
    expect(saved.agentId).toBe('catalog.assistant')
    expect(saved.version).toBe(1)
    expect(saved.organizationId).toBe('o1')
    expect(saved.createdByUserId).toBe('u1')
    expect(saved.notes).toBe('note')
    // Entity class reference intact (mock returns a plain object but the
    // real repo path calls tx.create(AiAgentPromptOverride, data)).
    void AiAgentPromptOverride
  })
})
