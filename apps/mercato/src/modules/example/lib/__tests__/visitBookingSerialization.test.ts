import { CommandBus, commandRegistry, registerCommand } from '@open-mercato/shared/lib/commands'
import { registerCommandInterceptors } from '@open-mercato/shared/lib/commands/command-interceptor-store'
import { createVisitBookingSerializingCommandBus } from '../visitBookingSerialization'

const mockBookedVisitSubjects = jest.fn()

jest.mock('../visitBookings', () => ({
  bookedVisitSubjects: (...args: unknown[]) => mockBookedVisitSubjects(...args),
}))

const USER_ID = '11111111-1111-4111-8111-111111111111'
const MODIFIED_USER_ID = '55555555-5555-4555-8555-555555555555'
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
  afterEach(() => {
    commandRegistry.unregister('customers.interactions.create')
    registerCommandInterceptors([])
    jest.clearAllMocks()
  })

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

  it('locks and rechecks the final assignment and time from the real modifier interceptor pipeline', async () => {
    const manager = new AdvisoryLockManager()
    const acquiredKeys: string[] = []
    const statements: string[] = []
    const handlerInputs: Array<Record<string, unknown>> = []
    const persistedInputs: Array<Record<string, unknown>> = []
    const transactionEm = lockingEntityManager(manager, acquiredKeys, statements)
    registerCommand({
      id: 'customers.interactions.create',
      execute: async (input: Record<string, unknown>, ctx) => {
        handlerInputs.push(input)
        const writeEm = ctx.transactionalEm as typeof transactionEm
        await writeEm.begin()
        try {
          await ctx.beforeTransactionalWrite?.(writeEm as never, input)
          persistedInputs.push(input)
          await writeEm.commit()
        } catch (error) {
          await writeEm.rollback()
          throw error
        }
        return { interactionId: 'visit-modified' }
      },
    })
    const modifiedScheduledAt = new Date('2026-10-01T14:30:00.000Z')
    registerCommandInterceptors([{
      moduleId: 'test-modifier',
      interceptors: [{
        id: 'test.modify-visit-booking',
        targetCommand: 'customers.interactions.create',
        priority: 90,
        async beforeExecute() {
          return {
            ok: true,
            modifiedInput: {
              scheduledAt: modifiedScheduledAt,
              durationMinutes: 30,
              participants: [{ userId: MODIFIED_USER_ID }],
            },
          }
        },
      }],
    }])
    mockBookedVisitSubjects.mockImplementation(async ({ input, subjects }: {
      input: { startAt: string; endAt: string }
      subjects: Array<{ type: string; id: string }>
    }) => {
      expect(input).toEqual(expect.objectContaining({
        startAt: '2026-10-01T14:30:00.000Z',
        endAt: '2026-10-01T15:00:00.000Z',
      }))
      return new Set(subjects.map((subject) => `${subject.type}:${subject.id}`))
    })
    const bus = createVisitBookingSerializingCommandBus({
      commandBus: new CommandBus(),
      em: transactionEm as never,
    })
    const input = {
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      entityId: ENTITY_ID,
      interactionType: 'visit',
      scheduledAt: new Date('2026-10-01T09:00:00.000Z'),
      durationMinutes: 60,
      participants: [{ userId: USER_ID }],
    }

    await expect(bus.execute('customers.interactions.create', {
      input,
      ctx: {
        auth: { sub: USER_ID, tenantId: TENANT_ID, orgId: ORGANIZATION_ID },
        selectedOrganizationId: ORGANIZATION_ID,
        organizationIds: [ORGANIZATION_ID],
        organizationScope: null,
        container: { resolve: () => undefined },
      } as never,
    })).rejects.toMatchObject({
      status: 422,
      body: { code: 'visit_availability_unavailable' },
    })

    expect(handlerInputs).toEqual([expect.objectContaining({
      scheduledAt: modifiedScheduledAt,
      durationMinutes: 30,
      participants: [{ userId: MODIFIED_USER_ID }],
    })])
    expect(persistedInputs).toEqual([])
    expect(acquiredKeys).toEqual([
      `example:visit-booking:${TENANT_ID}:${ORGANIZATION_ID}:staff:${MODIFIED_USER_ID}`,
    ])
    expect(mockBookedVisitSubjects).toHaveBeenCalledWith(expect.objectContaining({
      subjects: [{ type: 'staff', id: MODIFIED_USER_ID, status: 'available', reasonKey: null }],
    }))
  })
})
