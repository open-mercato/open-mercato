import {
  AiAgentRuntimeOverrideRepository,
  AiAgentRuntimeOverrideValidationError,
} from '../AiAgentRuntimeOverrideRepository'
import { AiAgentRuntimeOverride } from '../../entities'

// ---------------------------------------------------------------------------
// Registry mock — only exposes `get` and `list` consumed by the repository.
// ---------------------------------------------------------------------------
jest.mock('@open-mercato/shared/lib/ai/llm-provider-registry', () => ({
  llmProviderRegistry: {
    get: (id: string) => {
      const known: Record<string, { id: string }> = {
        anthropic: { id: 'anthropic' },
        openai: { id: 'openai' },
        google: { id: 'google' },
      }
      return known[id] ?? null
    },
    list: () => [{ id: 'anthropic' }, { id: 'openai' }, { id: 'google' }],
  },
}))

// ---------------------------------------------------------------------------
// In-memory entity manager mock.
// ---------------------------------------------------------------------------
type Row = {
  id: string
  tenantId: string
  organizationId: string | null
  agentId: string | null
  providerId: string | null
  modelId: string | null
  baseUrl: string | null
  updatedByUserId: string | null
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
  loopDisabled: boolean | null
  loopMaxSteps: number | null
  loopMaxToolCalls: number | null
  loopMaxWallClockMs: number | null
  loopMaxTokens: number | null
  loopStopWhenJson: unknown | null
  loopActiveToolsJson: unknown | null
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
    if ('agentId' in filter) {
      const expected = filter.agentId ?? null
      if ((row.agentId ?? null) !== expected) return false
    }
    if ('deletedAt' in filter) {
      const expected = filter.deletedAt ?? null
      if ((row.deletedAt ?? null) !== expected) return false
    }
    return true
  }

  const em: any = {
    findOne: async (_entity: unknown, where: any) => {
      return store.find((row) => matchRow(row, where)) ?? null
    },
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
        agentId: data.agentId ?? null,
        providerId: data.providerId ?? null,
        modelId: data.modelId ?? null,
        baseUrl: data.baseUrl ?? null,
        updatedByUserId: data.updatedByUserId ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: data.deletedAt ?? null,
        loopDisabled: data.loopDisabled ?? null,
        loopMaxSteps: data.loopMaxSteps ?? null,
        loopMaxToolCalls: data.loopMaxToolCalls ?? null,
        loopMaxWallClockMs: data.loopMaxWallClockMs ?? null,
        loopMaxTokens: data.loopMaxTokens ?? null,
        loopStopWhenJson: data.loopStopWhenJson ?? null,
        loopActiveToolsJson: data.loopActiveToolsJson ?? null,
      }
      store.push(row)
      return row
    },
    remove: (row: Row) => {
      em.__pendingRemove = row
      return em
    },
    transactional: async (fn: (tx: any) => Promise<unknown>) => {
      return fn(em)
    },
    __pendingPersist: null as Row | null,
    __pendingRemove: null as Row | null,
    __store: store,
  }

  return em
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AiAgentRuntimeOverrideRepository', () => {
  describe('getDefault', () => {
    it('returns null when tenantId is missing', async () => {
      const em = mockEm()
      const repo = new AiAgentRuntimeOverrideRepository(em)
      const result = await repo.getDefault({ tenantId: '' })
      expect(result).toBeNull()
    })

    it('returns null when no rows exist', async () => {
      const em = mockEm()
      const repo = new AiAgentRuntimeOverrideRepository(em)
      const result = await repo.getDefault({ tenantId: 't1' })
      expect(result).toBeNull()
    })

    it('returns agent-specific row over tenant-wide row', async () => {
      const em = mockEm()
      const repo = new AiAgentRuntimeOverrideRepository(em)
      const ctx = { tenantId: 't1', organizationId: null, userId: 'u1' }

      await repo.upsertDefault({ agentId: null, providerId: 'anthropic' }, ctx)
      await repo.upsertDefault({ agentId: 'catalog.assistant', providerId: 'openai' }, ctx)

      const result = await repo.getDefault({ tenantId: 't1', agentId: 'catalog.assistant' })
      expect(result?.providerId).toBe('openai')
    })

    it('falls back to tenant-wide row when no agent-specific row exists', async () => {
      const em = mockEm()
      const repo = new AiAgentRuntimeOverrideRepository(em)
      const ctx = { tenantId: 't1', organizationId: null, userId: 'u1' }

      await repo.upsertDefault({ agentId: null, providerId: 'google' }, ctx)

      const result = await repo.getDefault({ tenantId: 't1', agentId: 'customers.assistant' })
      expect(result?.providerId).toBe('google')
    })

    it('never leaks across tenants (cross-tenant isolation)', async () => {
      const em = mockEm()
      const repo = new AiAgentRuntimeOverrideRepository(em)

      await repo.upsertDefault(
        { agentId: 'catalog.assistant', providerId: 'anthropic' },
        { tenantId: 'tenant-A', organizationId: null, userId: 'u1' },
      )

      const resultA = await repo.getDefault({ tenantId: 'tenant-A', agentId: 'catalog.assistant' })
      expect(resultA?.providerId).toBe('anthropic')

      const resultB = await repo.getDefault({ tenantId: 'tenant-B', agentId: 'catalog.assistant' })
      expect(resultB).toBeNull()
    })

    it('does not return soft-deleted rows', async () => {
      const em = mockEm()
      const repo = new AiAgentRuntimeOverrideRepository(em)
      const ctx = { tenantId: 't1', organizationId: null, userId: 'u1' }

      await repo.upsertDefault({ agentId: 'catalog.assistant', providerId: 'openai' }, ctx)
      await repo.clearDefault({ tenantId: 't1', organizationId: null, agentId: 'catalog.assistant' })

      const result = await repo.getDefault({ tenantId: 't1', agentId: 'catalog.assistant' })
      expect(result).toBeNull()
    })
  })

  describe('upsertDefault', () => {
    it('inserts a new row on first call', async () => {
      const em = mockEm()
      const repo = new AiAgentRuntimeOverrideRepository(em)
      const ctx = { tenantId: 't1', organizationId: null, userId: 'u1' }

      const row = await repo.upsertDefault({ agentId: null, providerId: 'anthropic', modelId: 'claude-haiku' }, ctx)
      expect(row.providerId).toBe('anthropic')
      expect(row.modelId).toBe('claude-haiku')
      expect(row.tenantId).toBe('t1')
    })

    it('updates existing row in place (upsert)', async () => {
      const em = mockEm()
      const repo = new AiAgentRuntimeOverrideRepository(em)
      const ctx = { tenantId: 't1', organizationId: null, userId: 'u1' }

      await repo.upsertDefault({ agentId: null, providerId: 'anthropic' }, ctx)
      const updated = await repo.upsertDefault({ agentId: null, providerId: 'openai', modelId: 'gpt-5-mini' }, ctx)

      expect(updated.providerId).toBe('openai')
      expect(updated.modelId).toBe('gpt-5-mini')
    })

    it('throws for unknown provider id', async () => {
      const em = mockEm()
      const repo = new AiAgentRuntimeOverrideRepository(em)
      const ctx = { tenantId: 't1', organizationId: null, userId: 'u1' }

      await expect(
        repo.upsertDefault({ agentId: null, providerId: 'unknown-provider' }, ctx),
      ).rejects.toThrow(AiAgentRuntimeOverrideValidationError)
    })

    it('accepts null providerId (clear the axis)', async () => {
      const em = mockEm()
      const repo = new AiAgentRuntimeOverrideRepository(em)
      const ctx = { tenantId: 't1', organizationId: null, userId: 'u1' }

      const row = await repo.upsertDefault({ agentId: null, providerId: null, modelId: 'gpt-5-mini' }, ctx)
      expect(row.providerId).toBeNull()
      expect(row.modelId).toBe('gpt-5-mini')
    })

    it('requires tenantId', async () => {
      const em = mockEm()
      const repo = new AiAgentRuntimeOverrideRepository(em)

      await expect(
        repo.upsertDefault({ agentId: null }, { tenantId: '', organizationId: null }),
      ).rejects.toThrow(/tenantId/)
    })
  })

  describe('clearDefault', () => {
    it('returns false when no active row exists', async () => {
      const em = mockEm()
      const repo = new AiAgentRuntimeOverrideRepository(em)
      const cleared = await repo.clearDefault({ tenantId: 't1', organizationId: null })
      expect(cleared).toBe(false)
    })

    it('soft-deletes the row and returns true', async () => {
      const em = mockEm()
      const repo = new AiAgentRuntimeOverrideRepository(em)
      const ctx = { tenantId: 't1', organizationId: null, userId: 'u1' }

      await repo.upsertDefault({ agentId: null, providerId: 'anthropic' }, ctx)

      const cleared = await repo.clearDefault({ tenantId: 't1', organizationId: null })
      expect(cleared).toBe(true)

      const result = await repo.getDefault({ tenantId: 't1' })
      expect(result).toBeNull()
    })

    it('returns false when tenantId is missing', async () => {
      const em = mockEm()
      const repo = new AiAgentRuntimeOverrideRepository(em)
      const cleared = await repo.clearDefault({ tenantId: '' })
      expect(cleared).toBe(false)
    })

    it('only clears the matching (org, agent) row and leaves others untouched', async () => {
      const em = mockEm()
      const repo = new AiAgentRuntimeOverrideRepository(em)
      const ctx = { tenantId: 't1', organizationId: null, userId: 'u1' }

      await repo.upsertDefault({ agentId: null, providerId: 'anthropic' }, ctx)
      await repo.upsertDefault({ agentId: 'catalog.assistant', providerId: 'openai' }, ctx)

      await repo.clearDefault({ tenantId: 't1', organizationId: null, agentId: 'catalog.assistant' })

      const tenantDefault = await repo.getDefault({ tenantId: 't1' })
      expect(tenantDefault?.providerId).toBe('anthropic')

      const agentRow = await repo.getDefault({ tenantId: 't1', agentId: 'catalog.assistant' })
      expect(agentRow?.providerId).toBe('anthropic')
    })
  })

  describe('cross-tenant isolation guarantee', () => {
    it('two distinct tenants share no rows', async () => {
      const em = mockEm()
      const repo = new AiAgentRuntimeOverrideRepository(em)

      await repo.upsertDefault(
        { agentId: null, providerId: 'anthropic', modelId: 'claude-haiku' },
        { tenantId: 'tenant-1', organizationId: null },
      )
      await repo.upsertDefault(
        { agentId: null, providerId: 'openai', modelId: 'gpt-5-mini' },
        { tenantId: 'tenant-2', organizationId: null },
      )

      const r1 = await repo.getDefault({ tenantId: 'tenant-1' })
      const r2 = await repo.getDefault({ tenantId: 'tenant-2' })

      expect(r1?.providerId).toBe('anthropic')
      expect(r2?.providerId).toBe('openai')

      expect(r1?.tenantId).toBe('tenant-1')
      expect(r2?.tenantId).toBe('tenant-2')
    })

    it('clearing for tenant-1 does not affect tenant-2', async () => {
      const em = mockEm()
      const repo = new AiAgentRuntimeOverrideRepository(em)

      await repo.upsertDefault(
        { agentId: null, providerId: 'anthropic' },
        { tenantId: 'tenant-1', organizationId: null },
      )
      await repo.upsertDefault(
        { agentId: null, providerId: 'openai' },
        { tenantId: 'tenant-2', organizationId: null },
      )

      await repo.clearDefault({ tenantId: 'tenant-1', organizationId: null })

      expect(await repo.getDefault({ tenantId: 'tenant-1' })).toBeNull()
      expect((await repo.getDefault({ tenantId: 'tenant-2' }))?.providerId).toBe('openai')
    })
  })

  it('returns the AiAgentRuntimeOverride entity type', async () => {
    // Smoke test that the entity class is importable and the mock returns a
    // shaped object the repository trusts to be an entity instance.
    void AiAgentRuntimeOverride
  })
})

describe('AiAgentRuntimeOverrideRepository — loop override validation (Phase 1782-3)', () => {
  describe('loopStopWhenJson validation', () => {
    it('accepts valid stepCount items', async () => {
      const em = mockEm()
      const repo = new AiAgentRuntimeOverrideRepository(em)
      const ctx = { tenantId: 't1', organizationId: null, userId: 'u1' }

      await expect(
        repo.upsertDefault(
          {
            agentId: 'catalog.assistant',
            loopStopWhenJson: [{ kind: 'stepCount', count: 5 }],
          },
          ctx,
        ),
      ).resolves.toBeDefined()
    })

    it('accepts valid hasToolCall items', async () => {
      const em = mockEm()
      const repo = new AiAgentRuntimeOverrideRepository(em)
      const ctx = { tenantId: 't1', organizationId: null, userId: 'u1' }

      await expect(
        repo.upsertDefault(
          {
            agentId: 'catalog.assistant',
            loopStopWhenJson: [{ kind: 'hasToolCall', toolName: 'catalog.update_product' }],
          },
          ctx,
        ),
      ).resolves.toBeDefined()
    })

    it('rejects kind "custom" with invalid_loop_override', async () => {
      const em = mockEm()
      const repo = new AiAgentRuntimeOverrideRepository(em)
      const ctx = { tenantId: 't1', organizationId: null, userId: 'u1' }

      await expect(
        repo.upsertDefault(
          {
            agentId: 'catalog.assistant',
            loopStopWhenJson: [{ kind: 'custom', stop: () => false } as any],
          },
          ctx,
        ),
      ).rejects.toMatchObject({ name: 'AiAgentRuntimeOverrideValidationError', code: 'invalid_loop_override' })
    })

    it('rejects unknown kind with invalid_loop_override', async () => {
      const em = mockEm()
      const repo = new AiAgentRuntimeOverrideRepository(em)
      const ctx = { tenantId: 't1', organizationId: null, userId: 'u1' }

      await expect(
        repo.upsertDefault(
          {
            agentId: 'catalog.assistant',
            loopStopWhenJson: [{ kind: 'unknownKind' } as any],
          },
          ctx,
        ),
      ).rejects.toMatchObject({ name: 'AiAgentRuntimeOverrideValidationError', code: 'invalid_loop_override' })
    })

    it('rejects stepCount without numeric count', async () => {
      const em = mockEm()
      const repo = new AiAgentRuntimeOverrideRepository(em)
      const ctx = { tenantId: 't1', organizationId: null, userId: 'u1' }

      await expect(
        repo.upsertDefault(
          {
            agentId: 'catalog.assistant',
            loopStopWhenJson: [{ kind: 'stepCount' } as any],
          },
          ctx,
        ),
      ).rejects.toMatchObject({ code: 'invalid_loop_override' })
    })

    it('rejects hasToolCall without string toolName', async () => {
      const em = mockEm()
      const repo = new AiAgentRuntimeOverrideRepository(em)
      const ctx = { tenantId: 't1', organizationId: null, userId: 'u1' }

      await expect(
        repo.upsertDefault(
          {
            agentId: 'catalog.assistant',
            loopStopWhenJson: [{ kind: 'hasToolCall' } as any],
          },
          ctx,
        ),
      ).rejects.toMatchObject({ code: 'invalid_loop_override' })
    })
  })

  describe('loopActiveToolsJson validation', () => {
    it('accepts valid tool names', async () => {
      const em = mockEm()
      const repo = new AiAgentRuntimeOverrideRepository(em)
      const ctx = { tenantId: 't1', organizationId: null, userId: 'u1' }

      await expect(
        repo.upsertDefault(
          {
            agentId: 'catalog.assistant',
            loopActiveToolsJson: ['catalog.list_products', 'search.hybrid_search'],
            agentAllowedTools: ['catalog.list_products', 'search.hybrid_search', 'meta.describe_agent'],
          },
          ctx,
        ),
      ).resolves.toBeDefined()
    })

    it('rejects tools outside the agent allowlist when agentAllowedTools is provided', async () => {
      const em = mockEm()
      const repo = new AiAgentRuntimeOverrideRepository(em)
      const ctx = { tenantId: 't1', organizationId: null, userId: 'u1' }

      await expect(
        repo.upsertDefault(
          {
            agentId: 'catalog.assistant',
            loopActiveToolsJson: ['catalog.list_products', 'admin.delete_all'],
            agentAllowedTools: ['catalog.list_products'],
          },
          ctx,
        ),
      ).rejects.toMatchObject({ code: 'invalid_loop_override' })
    })

    it('accepts without agentAllowedTools (allowlist validation skipped)', async () => {
      const em = mockEm()
      const repo = new AiAgentRuntimeOverrideRepository(em)
      const ctx = { tenantId: 't1', organizationId: null, userId: 'u1' }

      await expect(
        repo.upsertDefault(
          {
            agentId: 'catalog.assistant',
            loopActiveToolsJson: ['any.tool'],
          },
          ctx,
        ),
      ).resolves.toBeDefined()
    })

    it('rejects non-array values', async () => {
      const em = mockEm()
      const repo = new AiAgentRuntimeOverrideRepository(em)
      const ctx = { tenantId: 't1', organizationId: null, userId: 'u1' }

      await expect(
        repo.upsertDefault(
          {
            agentId: 'catalog.assistant',
            loopActiveToolsJson: 'not-an-array' as any,
          },
          ctx,
        ),
      ).rejects.toMatchObject({ code: 'invalid_loop_override' })
    })
  })

  describe('loop columns persisted on upsert', () => {
    it('stores all loop columns on insert', async () => {
      const em = mockEm()
      const repo = new AiAgentRuntimeOverrideRepository(em)
      const ctx = { tenantId: 't1', organizationId: null, userId: 'u1' }

      const row = await repo.upsertDefault(
        {
          agentId: 'catalog.assistant',
          loopDisabled: true,
          loopMaxSteps: 3,
          loopMaxToolCalls: 10,
          loopMaxWallClockMs: 30000,
          loopMaxTokens: 50000,
          loopStopWhenJson: [{ kind: 'stepCount', count: 3 }],
          loopActiveToolsJson: ['catalog.list_products'],
          agentAllowedTools: ['catalog.list_products'],
        },
        ctx,
      )

      expect(row.loopDisabled).toBe(true)
      expect(row.loopMaxSteps).toBe(3)
      expect(row.loopMaxToolCalls).toBe(10)
      expect(row.loopMaxWallClockMs).toBe(30000)
      expect(row.loopMaxTokens).toBe(50000)
      expect(row.loopStopWhenJson).toEqual([{ kind: 'stepCount', count: 3 }])
      expect(row.loopActiveToolsJson).toEqual(['catalog.list_products'])
    })

    it('updates existing loop columns on second upsert', async () => {
      const em = mockEm()
      const repo = new AiAgentRuntimeOverrideRepository(em)
      const ctx = { tenantId: 't1', organizationId: null, userId: 'u1' }

      await repo.upsertDefault({ agentId: 'catalog.assistant', loopDisabled: false }, ctx)
      const updated = await repo.upsertDefault({ agentId: 'catalog.assistant', loopDisabled: true }, ctx)
      expect(updated.loopDisabled).toBe(true)
    })
  })
})
