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
  channel: 'agent' | 'mcp' | 'tools-api'
  apiKeyId: string | null
  correlationId: string | null
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
  if (where.toolName && row.toolName !== where.toolName) return false
  if (where.createdByUserId && row.createdByUserId !== where.createdByUserId) return false
  if (typeof where.channel === 'string' && row.channel !== where.channel) return false
  if (where.channel && typeof where.channel === 'object' && '$ne' in where.channel) {
    if (row.channel === where.channel.$ne) return false
  }
  if (Array.isArray(where.$or)) {
    if (!where.$or.some((clause: any) => rowMatchesWhere(row, clause))) return false
  }
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
    const offset = typeof options?.offset === 'number' ? options.offset : 0
    if (typeof options?.limit === 'number') rows = rows.slice(offset, offset + options.limit)
    return rows
  }

  const em: any = {
    find,
    findAndCount: async (_entity: unknown, where: any, options?: any) => {
      const total = store.filter((row) => rowMatchesWhere(row, where)).length
      const rows = await find(_entity, where, options)
      return [rows, total]
    },
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
        channel: data.channel ?? 'agent',
        apiKeyId: data.apiKeyId ?? null,
        correlationId: data.correlationId ?? null,
      }
      return row
    },
    persist: (row: Row) => {
      em.__pendingPersist = row
      return em
    },
    remove: (row: Row) => {
      em.__pendingRemove = row
      return em
    },
    flush: async () => {
      if (em.__pendingRemove) {
        const row = em.__pendingRemove as Row
        const idx = store.findIndex((candidate) => candidate.id === row.id)
        if (idx >= 0) store.splice(idx, 1)
        em.__pendingRemove = null
      }
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

    const { row, reused } = await repo.create(
      baseInput({ now, ttlSeconds: 900 }),
      ctx,
    )

    expect(reused).toBe(false)
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

    const { row: first } = await repo.create(baseInput({ idempotencyKey: 'idem-42' }), ctx)
    const { row: second, reused } = await repo.create(
      baseInput({
        idempotencyKey: 'idem-42',
        normalizedInput: { productId: 'p-1', patch: { name: 'different-call' } },
      }),
      ctx,
    )

    expect(reused).toBe(true)
    expect(second.id).toBe(first.id)
    // the repo MUST NOT mutate the existing row from the second call
    expect(second.normalizedInput).toEqual(first.normalizedInput)
    expect(em.__store).toHaveLength(1)
  })

  it('after a terminal status, same idempotencyKey mints a NEW row (new id) and re-keys the stale one', async () => {
    const em = mockEm()
    const repo = new AiPendingActionRepository(em)
    const ctx = { tenantId: tenantAlpha, organizationId: null, userId: 'u-1' }

    const { row: first } = await repo.create(baseInput({ idempotencyKey: 'idem-9' }), ctx)
    await repo.setStatus(first.id, 'cancelled', ctx, { resolvedByUserId: 'u-1' })

    const { row: second, reused } = await repo.create(baseInput({ idempotencyKey: 'idem-9' }), ctx)
    expect(reused).toBe(false)
    expect(second.id).not.toBe(first.id)
    expect(second.status).toBe('pending')
    expect(second.idempotencyKey).toBe('idem-9')
    // The repo re-keys stale terminal rows (cancelled/failed/expired) instead
    // of deleting them — so the unique-key constraint stays satisfied for the
    // "Fix with AI" retry flow, AND the stale row's own card keeps resolving
    // to its terminal state via GET-by-id instead of 404ing (issue #7550).
    expect(em.__store).toHaveLength(2)
    const stale = em.__store.find((candidate) => candidate.id === first.id)
    expect(stale).toBeDefined()
    expect(stale!.status).toBe('cancelled')
    expect(stale!.idempotencyKey).toBe(`idem-9:superseded:${first.id}`)
    const fresh = em.__store.find((candidate) => candidate.id === second.id)
    expect(fresh!.idempotencyKey).toBe('idem-9')
  })

  it('a confirmed row is returned as-is on retry — no second row, no unique-index collision', async () => {
    const em = mockEm()
    const repo = new AiPendingActionRepository(em)
    const ctx = { tenantId: tenantAlpha, organizationId: null, userId: 'u-1' }

    const { row: first } = await repo.create(baseInput({ idempotencyKey: 'idem-confirmed' }), ctx)
    await repo.setStatus(first.id, 'confirmed', ctx, { resolvedByUserId: 'u-1' })

    const { row: second, reused } = await repo.create(
      baseInput({ idempotencyKey: 'idem-confirmed' }),
      ctx,
    )

    expect(reused).toBe(true)
    expect(second.id).toBe(first.id)
    expect(second.status).toBe('confirmed')
    expect(em.__store).toHaveLength(1)
  })

  it('an executing row is returned as-is on retry — no second row, no unique-index collision', async () => {
    const em = mockEm()
    const repo = new AiPendingActionRepository(em)
    const ctx = { tenantId: tenantAlpha, organizationId: null, userId: 'u-1' }

    const { row: first } = await repo.create(baseInput({ idempotencyKey: 'idem-executing' }), ctx)
    await repo.setStatus(first.id, 'confirmed', ctx, { resolvedByUserId: 'u-1' })
    await repo.setStatus(first.id, 'executing', ctx)

    const { row: second, reused } = await repo.create(
      baseInput({ idempotencyKey: 'idem-executing' }),
      ctx,
    )

    expect(reused).toBe(true)
    expect(second.id).toBe(first.id)
    expect(second.status).toBe('executing')
    expect(em.__store).toHaveLength(1)
  })

  it('a confirmed row is still reused just before its dedupe window elapses (now < expiresAt)', async () => {
    const em = mockEm()
    const repo = new AiPendingActionRepository(em)
    const ctx = { tenantId: tenantAlpha, organizationId: null, userId: 'u-1' }
    const createdAt = new Date('2026-04-18T12:00:00.000Z')

    const { row: first } = await repo.create(
      baseInput({ idempotencyKey: 'idem-window', now: createdAt, ttlSeconds: 900 }),
      ctx,
    )
    await repo.setStatus(first.id, 'confirmed', ctx, { resolvedByUserId: 'u-1' })

    const justBeforeExpiry = new Date(first.expiresAt.getTime() - 1)
    const { row: second, reused } = await repo.create(
      baseInput({ idempotencyKey: 'idem-window', now: justBeforeExpiry }),
      ctx,
    )

    expect(reused).toBe(true)
    expect(second.id).toBe(first.id)
    expect(second.status).toBe('confirmed')
    expect(em.__store).toHaveLength(1)
  })

  it('a confirmed row past its dedupe window is re-keyed and a fresh pending row is minted', async () => {
    const em = mockEm()
    const repo = new AiPendingActionRepository(em)
    const ctx = { tenantId: tenantAlpha, organizationId: null, userId: 'u-1' }
    const createdAt = new Date('2026-04-18T12:00:00.000Z')

    const { row: first } = await repo.create(
      baseInput({ idempotencyKey: 'idem-stale-confirmed', now: createdAt, ttlSeconds: 900 }),
      ctx,
    )
    await repo.setStatus(first.id, 'confirmed', ctx, { resolvedByUserId: 'u-1' })

    const afterExpiry = new Date(first.expiresAt.getTime() + 1)
    const { row: second, reused } = await repo.create(
      baseInput({ idempotencyKey: 'idem-stale-confirmed', now: afterExpiry }),
      ctx,
    )

    expect(reused).toBe(false)
    expect(second.id).not.toBe(first.id)
    expect(second.status).toBe('pending')
    expect(second.idempotencyKey).toBe('idem-stale-confirmed')
    expect(em.__store).toHaveLength(2)
    const stale = em.__store.find((candidate) => candidate.id === first.id)
    expect(stale!.status).toBe('confirmed')
    expect(stale!.idempotencyKey).toBe(`idem-stale-confirmed:superseded:${first.id}`)
  })

  it('an executing row past its dedupe window is re-keyed and a fresh pending row is minted', async () => {
    const em = mockEm()
    const repo = new AiPendingActionRepository(em)
    const ctx = { tenantId: tenantAlpha, organizationId: null, userId: 'u-1' }
    const createdAt = new Date('2026-04-18T12:00:00.000Z')

    const { row: first } = await repo.create(
      baseInput({ idempotencyKey: 'idem-stale-executing', now: createdAt, ttlSeconds: 900 }),
      ctx,
    )
    await repo.setStatus(first.id, 'confirmed', ctx, { resolvedByUserId: 'u-1' })
    await repo.setStatus(first.id, 'executing', ctx)

    // a process dying mid-execution leaves this row stuck in `executing`
    // forever — the dedupe window is what lets a later retry proceed
    // instead of being told to "wait for the result" indefinitely.
    const afterExpiry = new Date(first.expiresAt.getTime() + 1)
    const { row: second, reused } = await repo.create(
      baseInput({ idempotencyKey: 'idem-stale-executing', now: afterExpiry }),
      ctx,
    )

    expect(reused).toBe(false)
    expect(second.id).not.toBe(first.id)
    expect(second.status).toBe('pending')
    expect(em.__store).toHaveLength(2)
    const stale = em.__store.find((candidate) => candidate.id === first.id)
    expect(stale!.status).toBe('executing')
    expect(stale!.idempotencyKey).toBe(`idem-stale-executing:superseded:${first.id}`)
  })

  it('setStatus rejects illegal transitions (e.g. confirmed → pending) with AiPendingActionStateError', async () => {
    const em = mockEm()
    const repo = new AiPendingActionRepository(em)
    const ctx = { tenantId: tenantAlpha, organizationId: null, userId: 'u-1' }

    const { row } = await repo.create(baseInput({ idempotencyKey: 'idem-illegal' }), ctx)
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

    const { row } = await repo.create(baseInput({ idempotencyKey: 'idem-expire' }), ctx)
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

    const { row } = await repo.create(baseInput({ idempotencyKey: 'idem-iso' }), ctxAlpha)
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

    const { row: first } = await repo.create(
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

  it('defaults channel to agent and stores null api key / correlation ids', async () => {
    const em = mockEm()
    const repo = new AiPendingActionRepository(em)
    const ctx = { tenantId: tenantAlpha, organizationId: null, userId: 'u-1' }

    const { row } = await repo.create(baseInput({ idempotencyKey: 'chan-default' }), ctx)

    expect(row.channel).toBe('agent')
    expect(row.apiKeyId).toBeNull()
    expect(row.correlationId).toBeNull()
  })

  it('persists channel, apiKeyId and correlationId and keeps idempotency for non-agent rows', async () => {
    const em = mockEm()
    const repo = new AiPendingActionRepository(em)
    const ctx = { tenantId: tenantAlpha, organizationId: 'org-1', userId: 'u-1' }

    const { row: first } = await repo.create(
      baseInput({
        idempotencyKey: 'chan-mcp',
        agentId: 'ai_assistant.raw_tool',
        channel: 'mcp',
        apiKeyId: 'key-1',
        correlationId: 'corr-1',
      }),
      ctx,
    )
    const { row: second } = await repo.create(
      baseInput({ idempotencyKey: 'chan-mcp', channel: 'mcp', correlationId: 'corr-2' }),
      ctx,
    )

    expect(first.channel).toBe('mcp')
    expect(first.apiKeyId).toBe('key-1')
    expect(first.correlationId).toBe('corr-1')
    expect(second.id).toBe(first.id)
    expect(em.__store).toHaveLength(1)
  })

  describe('caller visibility', () => {
    const scope = { tenantId: tenantAlpha, organizationId: 'org-1' }

    async function seedRows() {
      const em = mockEm()
      const repo = new AiPendingActionRepository(em)
      const base = new Date('2026-10-22T10:00:00.000Z').getTime()
      const { row: ownChat } = await repo.create(
        baseInput({ idempotencyKey: 'own-chat', createdByUserId: 'owner', now: new Date(base) }),
        { ...scope, userId: 'owner' },
      )
      const { row: ownMcp } = await repo.create(
        baseInput({
          idempotencyKey: 'own-mcp',
          createdByUserId: 'owner',
          channel: 'mcp',
          toolName: 'customers.people.update',
          now: new Date(base + 1000),
        }),
        { ...scope, userId: 'owner' },
      )
      const { row: otherChat } = await repo.create(
        baseInput({ idempotencyKey: 'other-chat', createdByUserId: 'other', now: new Date(base + 2000) }),
        { ...scope, userId: 'other' },
      )
      const { row: otherToolsApi } = await repo.create(
        baseInput({
          idempotencyKey: 'other-tools',
          createdByUserId: 'other',
          channel: 'tools-api',
          now: new Date(base + 3000),
        }),
        { ...scope, userId: 'other' },
      )
      const { row: foreignOrg } = await repo.create(
        baseInput({ idempotencyKey: 'foreign-org', createdByUserId: 'owner', channel: 'mcp' }),
        { tenantId: tenantAlpha, organizationId: 'org-2', userId: 'owner' },
      )
      const { row: foreignTenant } = await repo.create(
        baseInput({ idempotencyKey: 'foreign-tenant', createdByUserId: 'owner', channel: 'mcp' }),
        { tenantId: tenantBeta, organizationId: 'org-1', userId: 'owner' },
      )
      return { repo, ownChat, ownMcp, otherChat, otherToolsApi, foreignOrg, foreignTenant }
    }

    it('getByIdForApprover returns own rows regardless of channel', async () => {
      const { repo, ownChat, ownMcp } = await seedRows()
      const viewer = { userId: 'owner', canApproveAny: false }

      expect((await repo.getByIdForApprover(ownChat.id, scope, viewer))?.id).toBe(ownChat.id)
      expect((await repo.getByIdForApprover(ownMcp.id, scope, viewer))?.id).toBe(ownMcp.id)
    })

    it('getByIdForApprover exposes non-agent rows only to approvers and never chat rows of others', async () => {
      const { repo, otherChat, otherToolsApi } = await seedRows()
      const approver = { userId: 'owner', canApproveAny: true }
      const plainUser = { userId: 'owner', canApproveAny: false }

      expect((await repo.getByIdForApprover(otherToolsApi.id, scope, approver))?.id).toBe(otherToolsApi.id)
      expect(await repo.getByIdForApprover(otherToolsApi.id, scope, plainUser)).toBeNull()
      expect(await repo.getByIdForApprover(otherChat.id, scope, approver)).toBeNull()
      expect(await repo.getByIdForApprover(otherChat.id, scope, plainUser)).toBeNull()
    })

    it('getByIdForApprover never crosses tenant or organization scope', async () => {
      const { repo, foreignOrg, foreignTenant } = await seedRows()
      const approver = { userId: 'owner', canApproveAny: true }

      expect(await repo.getByIdForApprover(foreignOrg.id, scope, approver)).toBeNull()
      expect(await repo.getByIdForApprover(foreignTenant.id, scope, approver)).toBeNull()
    })

    it('listForCaller returns only own rows for a non-approver, newest first', async () => {
      const { repo, ownChat, ownMcp } = await seedRows()

      const result = await repo.listForCaller(
        scope,
        { userId: 'owner', canApproveAny: false },
        {},
        { page: 1, pageSize: 50 },
      )

      expect(result.total).toBe(2)
      expect(result.items.map((row) => row.id)).toEqual([ownMcp.id, ownChat.id])
    })

    it('listForCaller adds non-agent rows of others for approvers but never their chat rows', async () => {
      const { repo, ownChat, ownMcp, otherToolsApi } = await seedRows()

      const result = await repo.listForCaller(
        scope,
        { userId: 'owner', canApproveAny: true },
        {},
        { page: 1, pageSize: 50 },
      )

      expect(result.total).toBe(3)
      expect(result.items.map((row) => row.id)).toEqual([otherToolsApi.id, ownMcp.id, ownChat.id])
    })

    it('listForCaller honours mine, channel, toolName and status filters', async () => {
      const { repo, ownMcp, otherToolsApi } = await seedRows()
      const approver = { userId: 'owner', canApproveAny: true }
      const page = { page: 1, pageSize: 50 }

      const mine = await repo.listForCaller(scope, approver, { mine: true }, page)
      expect(mine.items.every((row) => row.createdByUserId === 'owner')).toBe(true)
      expect(mine.total).toBe(2)

      const toolsApi = await repo.listForCaller(scope, approver, { channel: 'tools-api' }, page)
      expect(toolsApi.items.map((row) => row.id)).toEqual([otherToolsApi.id])

      const byTool = await repo.listForCaller(scope, approver, { toolName: 'customers.people.update' }, page)
      expect(byTool.items.map((row) => row.id)).toEqual([ownMcp.id])

      const cancelled = await repo.listForCaller(scope, approver, { status: 'cancelled' }, page)
      expect(cancelled.total).toBe(0)
    })

    it('listForCaller paginates and reports the full total', async () => {
      const { repo, ownChat, ownMcp, otherToolsApi } = await seedRows()
      const approver = { userId: 'owner', canApproveAny: true }

      const first = await repo.listForCaller(scope, approver, {}, { page: 1, pageSize: 2 })
      const second = await repo.listForCaller(scope, approver, {}, { page: 2, pageSize: 2 })

      expect(first.total).toBe(3)
      expect(first.items.map((row) => row.id)).toEqual([otherToolsApi.id, ownMcp.id])
      expect(second.items.map((row) => row.id)).toEqual([ownChat.id])
    })
  })
})
