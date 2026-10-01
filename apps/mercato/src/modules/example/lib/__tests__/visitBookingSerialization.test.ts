import { createVisitBookingSerializingCommandBus } from '../visitBookingSerialization'

const mockBookedVisitSubjects = jest.fn()

jest.mock('../visitBookings', () => ({
  bookedVisitSubjects: (...args: unknown[]) => mockBookedVisitSubjects(...args),
}))

const USER_ID = '11111111-1111-4111-8111-111111111111'
const ENTITY_ID = '22222222-2222-4222-8222-222222222222'
const TENANT_ID = '33333333-3333-4333-8333-333333333333'
const ORGANIZATION_ID = '44444444-4444-4444-8444-444444444444'

class AdvisoryLockManager {
  private tails = new Map<string, Promise<void>>()

  async acquire(key: string): Promise<() => void> {
    const previous = this.tails.get(key) ?? Promise.resolve()
    let releaseCurrent!: () => void
    const current = new Promise<void>((resolve) => { releaseCurrent = resolve })
    const tail = previous.then(() => current)
    this.tails.set(key, tail)
    await previous
    return () => {
      releaseCurrent()
      if (this.tails.get(key) === tail) this.tails.delete(key)
    }
  }
}

function lockingEntityManager(manager: AdvisoryLockManager, acquiredKeys: string[], statements: string[]) {
  let inTransaction = false
  let releases: Array<() => void> = []
  const em = {
    fork: jest.fn(() => em),
    isInTransaction: () => inTransaction,
    begin: async () => {
      if (inTransaction) throw new Error('Nested transaction')
      inTransaction = true
    },
    execute: async (_sql: string, params: string[]) => {
      if (!inTransaction) throw new Error('Lock query executed outside a transaction')
      statements.push(_sql)
      acquiredKeys.push(params[0]!)
      releases.push(await manager.acquire(params[0]!))
    },
    getConnection: () => {
      throw new Error('Bare connection must not execute transaction-scoped locks')
    },
    commit: async () => {
      if (!inTransaction) throw new Error('Missing transaction')
      inTransaction = false
      releases.reverse().forEach((release) => release())
      releases = []
    },
    rollback: async () => {
      inTransaction = false
      releases.reverse().forEach((release) => release())
      releases = []
    },
  }
  return em
}

function createContendingCommandBus(state: { bookings: number }, transactionContexts: unknown[], sideEffectStates: boolean[]) {
  return {
    execute: jest.fn(async (_commandId: string, options: { ctx: { transactionalEm?: unknown; beforeTransactionalWrite?: (em: never) => Promise<void> } }) => {
      transactionContexts.push(options.ctx.transactionalEm)
      const transactionEm = options.ctx.transactionalEm as {
        begin: () => Promise<void>
        commit: () => Promise<void>
        rollback: () => Promise<void>
        isInTransaction: () => boolean
      }
      await transactionEm.begin()
      try {
        await options.ctx.beforeTransactionalWrite?.(transactionEm as never)
        expect(transactionEm.isInTransaction()).toBe(true)
        await new Promise<void>((resolve) => setTimeout(resolve, 5))
        state.bookings += 1
        await transactionEm.commit()
      } catch (error) {
        await transactionEm.rollback()
        throw error
      }
      sideEffectStates.push(transactionEm.isInTransaction())
      return { result: { interactionId: `visit-${state.bookings}` }, logEntry: null }
    }),
  }
}

describe('Visit booking command serialization', () => {
  it('serializes two concurrent request containers so exactly one overlapping Visit wins', async () => {
    const manager = new AdvisoryLockManager()
    const acquiredKeys: string[] = []
    const statements: string[] = []
    const transactionContexts: unknown[] = []
    const sideEffectStates: boolean[] = []
    const state = { bookings: 0 }
    mockBookedVisitSubjects.mockImplementation(async ({ subjects }: { subjects: Array<{ type: string; id: string }> }) =>
      new Set(state.bookings > 0 ? subjects.map((subject) => `${subject.type}:${subject.id}`) : []))
    const input = {
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      entityId: ENTITY_ID,
      interactionType: 'visit',
      scheduledAt: new Date('2026-10-01T09:00:00.000Z'),
      durationMinutes: 60,
      participants: [{ userId: USER_ID }],
    }
    const context = {
      auth: { tenantId: TENANT_ID },
      selectedOrganizationId: ORGANIZATION_ID,
      organizationIds: [ORGANIZATION_ID],
      organizationScope: null,
      container: {},
    }
    const first = createVisitBookingSerializingCommandBus({
      commandBus: createContendingCommandBus(state, transactionContexts, sideEffectStates) as never,
      em: lockingEntityManager(manager, acquiredKeys, statements) as never,
    })
    const second = createVisitBookingSerializingCommandBus({
      commandBus: createContendingCommandBus(state, transactionContexts, sideEffectStates) as never,
      em: lockingEntityManager(manager, acquiredKeys, statements) as never,
    })

    const outcomes = await Promise.allSettled([
      first.execute('customers.interactions.create', { input, ctx: context as never }),
      second.execute('customers.interactions.create', { input, ctx: context as never }),
    ])

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1)
    expect(state.bookings).toBe(1)
    expect(acquiredKeys).toEqual([
      `example:visit-booking:${TENANT_ID}:${ORGANIZATION_ID}:staff:${USER_ID}`,
      `example:visit-booking:${TENANT_ID}:${ORGANIZATION_ID}:staff:${USER_ID}`,
    ])
    expect(statements).toEqual([
      'select pg_advisory_xact_lock(hashtextextended(?::text, 0))',
      'select pg_advisory_xact_lock(hashtextextended(?::text, 0))',
    ])
    expect(transactionContexts).toHaveLength(2)
    expect(transactionContexts[0]).not.toBe(transactionContexts[1])
    expect((transactionContexts[0] as { fork: jest.Mock }).fork).not.toHaveBeenCalled()
    expect((transactionContexts[1] as { fork: jest.Mock }).fork).not.toHaveBeenCalled()
    expect(sideEffectStates).toEqual([false])
  })
})
