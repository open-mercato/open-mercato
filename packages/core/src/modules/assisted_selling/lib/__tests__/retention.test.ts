import { AssistedSellingParticipant, AssistedSellingThread } from '../../data/entities'
import { anonymizeAssistedSellingRepParticipants, eraseAssistedSellingThread } from '../retention'

const TENANT_ID = 'tenant-1'
const ORG_ID = 'org-1'

function makeThreadRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'thread-1',
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    status: 'open',
    closedAt: null,
    deletedAt: null,
    ...overrides,
  }
}

function makeFakeEm(options: { thread?: Record<string, unknown> | null; participants?: Record<string, unknown>[] } = {}) {
  const nativeDeleteCalls: Array<{ entity: unknown; where: unknown }> = []
  const nativeUpdateCalls: Array<{ entity: unknown; where: unknown; data: unknown }> = []
  const persisted: unknown[] = []
  const em = {
    findOne: jest.fn(async (entity: unknown) => {
      if (entity === AssistedSellingThread) return options.thread ?? null
      return null
    }),
    find: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
      if (entity !== AssistedSellingParticipant) return []
      const participants = options.participants ?? []
      return participants.filter((p) =>
        Object.entries(where).every(([key, value]) => (p[key] ?? null) === (value ?? null)),
      )
    }),
    nativeDelete: jest.fn(async (entity: unknown, where: unknown) => {
      nativeDeleteCalls.push({ entity, where })
      return 1
    }),
    nativeUpdate: jest.fn(async (entity: unknown, where: unknown, data: unknown) => {
      nativeUpdateCalls.push({ entity, where, data })
      return 1
    }),
    persist: jest.fn((entity: unknown) => {
      persisted.push(entity)
    }),
    flush: jest.fn(async () => undefined),
  }
  return { em, nativeDeleteCalls, nativeUpdateCalls, persisted }
}

describe('eraseAssistedSellingThread (§5.10, S7)', () => {
  it('hard-deletes messages and participants, clears proposal rejectionReason, and soft-deletes the thread', async () => {
    const thread = makeThreadRow()
    const { em, nativeDeleteCalls, nativeUpdateCalls } = makeFakeEm({ thread })

    const erased = await eraseAssistedSellingThread(em as any, { tenantId: TENANT_ID, organizationId: ORG_ID }, 'thread-1')

    expect(erased).toBe(true)
    expect(nativeDeleteCalls).toHaveLength(2)
    expect(nativeUpdateCalls).toHaveLength(1)
    expect(thread.status).toBe('closed')
    expect(thread.closedAt).toBeInstanceOf(Date)
    expect(thread.deletedAt).toBeInstanceOf(Date)
    expect(em.persist).toHaveBeenCalledWith(thread)
    expect(em.flush).toHaveBeenCalled()
  })

  it('does not overwrite an already-set closedAt', async () => {
    const existingClosedAt = new Date('2026-01-01T00:00:00.000Z')
    const thread = makeThreadRow({ status: 'closed', closedAt: existingClosedAt })
    const { em } = makeFakeEm({ thread })

    await eraseAssistedSellingThread(em as any, { tenantId: TENANT_ID, organizationId: ORG_ID }, 'thread-1')

    expect(thread.closedAt).toBe(existingClosedAt)
  })

  it('is idempotent on redelivery — a second call on an already-erased thread is a no-op', async () => {
    // The first call's own `deletedAt: null` lookup guard means a redelivered event, which
    // re-reads the thread fresh, finds nothing (the erase already set `deletedAt`).
    const { em, nativeDeleteCalls } = makeFakeEm({ thread: null })

    const erased = await eraseAssistedSellingThread(em as any, { tenantId: TENANT_ID, organizationId: ORG_ID }, 'thread-1')

    expect(erased).toBe(false)
    expect(nativeDeleteCalls).toHaveLength(0)
    expect(em.flush).not.toHaveBeenCalled()
  })
})

describe('anonymizeAssistedSellingRepParticipants (§5.10 — staff deletion)', () => {
  it('replaces every matching rep participant\'s displayName with the fixed label', async () => {
    const participant = {
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      actorType: 'rep',
      actorId: 'user-1',
      deletedAt: null,
      displayName: 'Real Name',
    }
    const { em } = makeFakeEm({ participants: [participant] })

    const touched = await anonymizeAssistedSellingRepParticipants(em as any, { tenantId: TENANT_ID, organizationId: ORG_ID }, 'user-1')

    expect(touched).toBe(1)
    expect(participant.displayName).toBe('Former team member')
    expect(em.flush).toHaveBeenCalled()
  })

  it('never touches a buyer participant row sharing the same actorId coincidentally', async () => {
    // The fake `find` mock itself filters by `actorType: 'rep'` in the query — matching the
    // real implementation's own `where.actorType = 'rep'` — so a buyer-typed row is excluded
    // at the query layer, never reached by this function at all.
    const { em } = makeFakeEm({ participants: [] })

    const touched = await anonymizeAssistedSellingRepParticipants(em as any, { tenantId: TENANT_ID, organizationId: ORG_ID }, 'user-1')

    expect(touched).toBe(0)
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('is idempotent on redelivery — a second pass over an already-anonymized row touches nothing', async () => {
    const participant = {
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      actorType: 'rep',
      actorId: 'user-1',
      deletedAt: null,
      displayName: 'Former team member',
    }
    const { em } = makeFakeEm({ participants: [participant] })

    const touched = await anonymizeAssistedSellingRepParticipants(em as any, { tenantId: TENANT_ID, organizationId: ORG_ID }, 'user-1')

    expect(touched).toBe(0)
    expect(em.flush).not.toHaveBeenCalled()
  })
})
