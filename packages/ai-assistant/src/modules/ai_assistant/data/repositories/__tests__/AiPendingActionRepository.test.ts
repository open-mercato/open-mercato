import { AiPendingActionRepository } from '../AiPendingActionRepository'
import { AiPendingAction } from '../../entities'
import {
  AiPendingActionStateError,
  type AiPendingActionStatus,
} from '../../../lib/pending-action-types'

type Row = {
  id: string
  tenantId: string
  organizationId: string | null
  agentId: string
  toolName: string
  conversationId: string | null
  targetEntityType: string | null
  targetRecordId: string | null
  normalizedInput: Record<string, unknown>
  fieldDiff: Array<{ field: string; before: unknown; after: unknown }>
  records: Array<Record<string, unknown>> | null
  failedRecords: Array<Record<string, unknown>> | null
  sideEffectsSummary: string | null
  recordVersion: string | null
  attachmentIds: string[]
  idempotencyKey: string
  createdByUserId: string
  status: AiPendingActionStatus
  queueMode: 'inline' | 'stack'
  executionResult: Record<string, unknown> | null
  createdAt: Date
  expiresAt: Date
  resolvedAt: Date | null
  resolvedByUserId: string | null
}

let idCounter = 0

function rowMatchesWhere(row: Row, where: any): boolean {
  if (!where) return true
  if (where.id && row.id !== where.id) return false
  if (where.tenantId && row.tenantId !== where.tenantId) return false
  if ('organizationId' in where) {
    const expected = where.organizationId ?? null
    if ((row.organizationId ?? null) !== expected) return false
  }
  if (where.agentId && row.agentId !== where.agentId) return false
  if (where.idempotencyKey && row.idempotencyKey !== where.idempotencyKey) {
    return false
  }
  if (where.status && row.status !== where.status) return false
  if (where.expiresAt && typeof where.expiresAt === 'object') {
    if ('$lt' in where.expiresAt) {
      if (!(row.expiresAt.getTime() < (where.expiresAt.$lt as Date).getTime())) {
        return false
      }
    }
  }
  return true
}

function applyOrder(rows: Row[], orderBy: any): Row[] {
  if (!orderBy) return rows
  if (orderBy.createdAt === 'desc') {
    return [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  }
  if (orderBy.createdAt === 'asc') {
    return [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  }
  if (orderBy.expiresAt === 'asc') {
    return [...rows].sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime())
  }
  if (orderBy.expiresAt === 'desc') {
    return [...rows].sort((a, b) => b.expiresAt.getTime() - a.expiresAt.getTime())
  }
  return rows
}

function mockEm() {
  const store: Row[] = []

  const find = async (_entity: unknown, where: any, options?: any): Promise<Row[]> => {
    let rows = store.filter((row) => rowMatchesWhere(row, where))
    rows = applyOrder(rows, options?.orderBy)
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
        toolName: data.toolName,
        conversationId: data.conversationId ?? null,
        targetEntityType: data.targetEntityType ?? null,
        targetRecordId: data.targetRecordId ?? null,
        normalizedInput: data.normalizedInput ?? {},
        fieldDiff: Array.isArray(data.fieldDiff) ? data.fieldDiff : [],
        records: data.records ?? null,
        failedRecords: data.failedRecords ?? null,
        sideEffectsSummary: data.sideEffectsSummary ?? null,
        recordVersion: data.recordVersion ?? null,
        attachmentIds: Array.isArray(data.attachmentIds) ? data.attachmentIds : [],
        idempotencyKey: data.idempotencyKey,
        createdByUserId: data.createdByUserId,
        status: data.status ?? 'pending',
        queueMode: data.queueMode ?? 'inline',
        executionResult: data.executionResult ?? null,
        createdAt: data.createdAt instanceof Date ? data.createdAt : new Date(),
        expiresAt: data.expiresAt instanceof Date ? data.expiresAt : new Date(),
        resolvedAt: data.resolvedAt ?? null,
        resolvedByUserId: data.resolvedByUserId ?? null,
      }
      return row
    },
    persist: (row: Row) => {
      em.__pendingPersist = row
      return em
    },
    flush: async () => {
      if (em.__pendingPersist) {
        const row = em.__pendingPersist as Row
        const idx = store.findIndex((candidate) => candidate.id === row.id)
        if (idx >= 0) store[idx] = row
        else store.push(row)
        em.__pendingPersist = null
      }
    },
    transactional: async (fn: (tx: any) => Promise<unknown>) => {
      return fn(em)
    },
    __pendingPersist: null as Row | null,
    __store: store,
  }

  return em
}

const tenantAlpha = 't-alpha'
const tenantBeta = 't-beta'

function baseInput(overrides: Partial<any> = {}) {
  return {
    agentId: 'catalog.merchandising_assistant',
    toolName: 'catalog.products.update',
    idempotencyKey: overrides.idempotencyKey ?? 'idem-1',
    createdByUserId: 'u-1',
    normalizedInput: { productId: 'p-1', patch: { name: 'new' } },
    fieldDiff: [{ field: 'name', before: 'old', after: 'new' }],
    targetEntityType: 'catalog.product',
    targetRecordId: 'p-1',
    recordVersion: 'v-1',
    ...overrides,
  }
}

describe('AiPendingActionRepository', () => {
  it('creates a row in status=pending with TTL-derived expiresAt and empty attachmentIds default', async () => {
    const em = mockEm()
    const repo = new AiPendingActionRepository(em)
    const now = new Date('2026-04-18T12:00:00.000Z')
    const ctx = { tenantId: tenantAlpha, organizationId: null, userId: 'u-1' }

    const row = await repo.create(
      baseInput({ now, ttlSeconds: 900 }),
      ctx,
    )

    expect(row.status).toBe('pending')
    expect(row.tenantId).toBe(tenantAlpha)
    expect(row.attachmentIds).toEqual([])
    expect(row.expiresAt.getTime()).toBe(now.getTime() + 900 * 1000)
    expect(row.queueMode).toBe('inline')
    expect(row.executionResult).toBeNull()
    expect(row.resolvedAt).toBeNull()
    expect(row.resolvedByUserId).toBeNull()
  })

  it('is idempotent: second create with same (tenant, org, idempotencyKey) returns the same row while pending', async () => {
    const em = mockEm()
    const repo = new AiPendingActionRepository(em)
    const ctx = { tenantId: tenantAlpha, organizationId: null, userId: 'u-1' }

    const first = await repo.create(baseInput({ idempotencyKey: 'idem-42' }), ctx)
    const second = await repo.create(
      baseInput({
        idempotencyKey: 'idem-42',
        normalizedInput: { productId: 'p-1', patch: { name: 'different-call' } },
      }),
      ctx,
    )

    expect(second.id).toBe(first.id)
    // the repo MUST NOT mutate the existing row from the second call
    expect(second.normalizedInput).toEqual(first.normalizedInput)
    expect(em.__store).toHaveLength(1)
  })

  it('after a terminal status, same idempotencyKey mints a NEW row (new id)', async () => {
    const em = mockEm()
    const repo = new AiPendingActionRepository(em)
    const ctx = { tenantId: tenantAlpha, organizationId: null, userId: 'u-1' }

    const first = await repo.create(baseInput({ idempotencyKey: 'idem-9' }), ctx)
    await repo.setStatus(first.id, 'cancelled', ctx, { resolvedByUserId: 'u-1' })

    const second = await repo.create(baseInput({ idempotencyKey: 'idem-9' }), ctx)
    expect(second.id).not.toBe(first.id)
    expect(second.status).toBe('pending')
    expect(em.__store).toHaveLength(2)
  })

  it('setStatus rejects illegal transitions (e.g. confirmed → pending) with AiPendingActionStateError', async () => {
    const em = mockEm()
    const repo = new AiPendingActionRepository(em)
    const ctx = { tenantId: tenantAlpha, organizationId: null, userId: 'u-1' }

    const row = await repo.create(baseInput({ idempotencyKey: 'idem-illegal' }), ctx)
    await repo.setStatus(row.id, 'confirmed', ctx, { resolvedByUserId: 'u-1' })

    await expect(
      repo.setStatus(row.id, 'pending', ctx),
    ).rejects.toBeInstanceOf(AiPendingActionStateError)
    await expect(
      repo.setStatus(row.id, 'cancelled', ctx),
    ).rejects.toBeInstanceOf(AiPendingActionStateError)
  })

  it('setStatus to expired sets resolvedAt and resolvedByUserId: null', async () => {
    const em = mockEm()
    const repo = new AiPendingActionRepository(em)
    const ctx = { tenantId: tenantAlpha, organizationId: null, userId: 'u-1' }

    const row = await repo.create(baseInput({ idempotencyKey: 'idem-expire' }), ctx)
    const expiredAt = new Date('2026-04-18T13:00:00.000Z')
    const expired = await repo.setStatus(row.id, 'expired', ctx, { now: expiredAt })

    expect(expired.status).toBe('expired')
    expect(expired.resolvedAt).toEqual(expiredAt)
    expect(expired.resolvedByUserId).toBeNull()
  })

  it('listExpired returns rows with status=pending and expiresAt < now, capped by limit, tenant-isolated', async () => {
    const em = mockEm()
    const repo = new AiPendingActionRepository(em)
    const ctxAlpha = { tenantId: tenantAlpha, organizationId: null, userId: 'u-1' }
    const ctxBeta = { tenantId: tenantBeta, organizationId: null, userId: 'u-2' }

    const baseNow = new Date('2026-04-18T12:00:00.000Z')
    for (let i = 0; i < 4; i += 1) {
      await repo.create(
        baseInput({
          idempotencyKey: `alpha-${i}`,
          now: new Date(baseNow.getTime() + i * 1000),
          ttlSeconds: 60,
        }),
        ctxAlpha,
      )
    }
    // a beta-tenant row that is also expired (MUST NOT appear in alpha's listExpired)
    await repo.create(
      baseInput({
        idempotencyKey: 'beta-0',
        now: baseNow,
        ttlSeconds: 60,
      }),
      ctxBeta,
    )

    // an alpha row that is still in the future
    await repo.create(
      baseInput({
        idempotencyKey: 'alpha-future',
        now: new Date(baseNow.getTime() + 3600 * 1000),
        ttlSeconds: 3600,
      }),
      ctxAlpha,
    )

    const cleanupNow = new Date(baseNow.getTime() + 120 * 1000)
    const alphaExpired = await repo.listExpired(ctxAlpha, cleanupNow, 2)
    expect(alphaExpired).toHaveLength(2)
    for (const row of alphaExpired) {
      expect(row.tenantId).toBe(tenantAlpha)
      expect(row.status).toBe('pending')
      expect(row.expiresAt.getTime()).toBeLessThan(cleanupNow.getTime())
    }

    const betaExpired = await repo.listExpired(ctxBeta, cleanupNow, 10)
    expect(betaExpired.map((r) => r.idempotencyKey)).toEqual(['beta-0'])
  })

  it('getById is tenant-scoped: another tenant returns null', async () => {
    const em = mockEm()
    const repo = new AiPendingActionRepository(em)
    const ctxAlpha = { tenantId: tenantAlpha, organizationId: null, userId: 'u-1' }

    const row = await repo.create(baseInput({ idempotencyKey: 'idem-iso' }), ctxAlpha)
    const sameTenant = await repo.getById(row.id, ctxAlpha)
    expect(sameTenant?.id).toBe(row.id)

    const otherTenant = await repo.getById(row.id, {
      tenantId: tenantBeta,
      organizationId: null,
    })
    expect(otherTenant).toBeNull()

    // sanity: the entity class is importable from both paths
    void AiPendingAction
  })

  it('listPendingForAgent returns only pending rows for the requested agent and tenant', async () => {
    const em = mockEm()
    const repo = new AiPendingActionRepository(em)
    const ctx = { tenantId: tenantAlpha, organizationId: null, userId: 'u-1' }

    const first = await repo.create(
      baseInput({ idempotencyKey: 'p-1', agentId: 'catalog.assistant' }),
      ctx,
    )
    await repo.create(
      baseInput({ idempotencyKey: 'p-2', agentId: 'catalog.assistant' }),
      ctx,
    )
    await repo.create(
      baseInput({ idempotencyKey: 'p-3', agentId: 'customers.assistant' }),
      ctx,
    )
    await repo.setStatus(first.id, 'cancelled', ctx, { resolvedByUserId: 'u-1' })

    const pending = await repo.listPendingForAgent('catalog.assistant', ctx)
    expect(pending).toHaveLength(1)
    expect(pending[0].idempotencyKey).toBe('p-2')
  })
})
