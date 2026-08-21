import { runCrudCommandWrite } from '../runCrudCommandWrite'

type FakeEntityManager = {
  flush: jest.Mock<Promise<void>, []>
  begin: jest.Mock<Promise<void>, []>
  commit: jest.Mock<Promise<void>, []>
  rollback: jest.Mock<Promise<void>, []>
  fork: jest.Mock<FakeEntityManager, []>
}

type FakeDataEngine = {
  setCustomFields: jest.Mock<Promise<void>, [unknown]>
  markOrmEntityChange: jest.Mock<void, [unknown]>
}

function createFakeEm(): FakeEntityManager {
  const em: FakeEntityManager = {
    flush: jest.fn().mockResolvedValue(undefined),
    begin: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    fork: jest.fn(),
  }
  em.fork.mockReturnValue(em)
  return em
}

function createFakeDataEngine(): FakeDataEngine {
  return {
    setCustomFields: jest.fn().mockResolvedValue(undefined),
    markOrmEntityChange: jest.fn(),
  }
}

function createCtx(em: FakeEntityManager, de: FakeDataEngine) {
  return {
    container: {
      resolve: jest.fn((token: string) => {
        if (token === 'em') return em
        if (token === 'dataEngine') return de
        throw new Error(`unexpected resolve(${token})`)
      }),
    },
    auth: null,
    organizationScope: null,
    selectedOrganizationId: null,
    organizationIds: null,
  } as any
}

const baseScope = { tenantId: 't1', organizationId: 'o1' } as const
const entity = { id: 'rec-1', tenantId: 't1', organizationId: 'o1' }
const identifiers = { id: 'rec-1', tenantId: 't1', organizationId: 'o1' }
const events = { module: 'customers', entity: 'deal', persistent: true } as const
const indexer = { entityType: 'customers:customer_deal' } as const

describe('runCrudCommandWrite', () => {
  it('runs phases on the helper-forked EM, then writes custom fields, then queues exactly one CRUD side-effect (AC1 + AC4)', async () => {
    const rootEm = createFakeEm()
    const forked = createFakeEm()
    rootEm.fork.mockReturnValue(forked)
    const de = createFakeDataEngine()
    const ctx = createCtx(rootEm, de)
    const events_called: string[] = []
    let observedPhaseEm: FakeEntityManager | null = null

    await runCrudCommandWrite({
      ctx,
      entityId: 'customers:customer_deal',
      action: 'updated',
      scope: baseScope,
      customFields: { priority: 3 },
      events,
      indexer,
      sideEffect: () => ({ entity, identifiers }),
      phases: [
        async ({ em }) => {
          events_called.push('phase')
          observedPhaseEm = em as unknown as FakeEntityManager
        },
      ],
    })

    expect(rootEm.fork).toHaveBeenCalledTimes(1)
    expect(observedPhaseEm).toBe(forked)
    expect(forked.begin).toHaveBeenCalledTimes(1)
    expect(forked.flush).toHaveBeenCalledTimes(1)
    expect(forked.commit).toHaveBeenCalledTimes(1)
    expect(forked.rollback).not.toHaveBeenCalled()

    expect(de.setCustomFields).toHaveBeenCalledTimes(1)
    expect(de.setCustomFields).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: 'customers:customer_deal',
        recordId: 'rec-1',
        tenantId: 't1',
        organizationId: 'o1',
        values: { priority: 3 },
        notify: false,
      }),
    )

    expect(de.markOrmEntityChange).toHaveBeenCalledTimes(1)
    expect(de.markOrmEntityChange).toHaveBeenCalledWith({
      action: 'updated',
      entity,
      identifiers,
      syncOrigin: null,
      events,
      indexer,
    })

    // Order: setCustomFields must complete before markOrmEntityChange is queued
    const customFieldsOrder = de.setCustomFields.mock.invocationCallOrder[0]
    const markOrder = de.markOrmEntityChange.mock.invocationCallOrder[0]
    expect(customFieldsOrder).toBeLessThan(markOrder)
  })

  it('skips setCustomFields when customFields is undefined but still queues the side-effect', async () => {
    const em = createFakeEm()
    const de = createFakeDataEngine()
    const ctx = createCtx(em, de)

    await runCrudCommandWrite({
      ctx,
      entityId: 'customers:customer_deal',
      action: 'created',
      scope: baseScope,
      sideEffect: () => ({ entity, identifiers }),
      phases: [() => {}],
    })

    expect(de.setCustomFields).not.toHaveBeenCalled()
    expect(de.markOrmEntityChange).toHaveBeenCalledTimes(1)
  })

  it('skips setCustomFields when customFields is an empty object', async () => {
    const em = createFakeEm()
    const de = createFakeDataEngine()
    const ctx = createCtx(em, de)

    await runCrudCommandWrite({
      ctx,
      entityId: 'customers:customer_deal',
      action: 'updated',
      scope: baseScope,
      customFields: {},
      sideEffect: () => ({ entity, identifiers }),
      phases: [() => {}],
    })

    expect(de.setCustomFields).not.toHaveBeenCalled()
    expect(de.markOrmEntityChange).toHaveBeenCalledTimes(1)
  })

  it('does NOT emit side-effects when a phase throws (AC2)', async () => {
    const em = createFakeEm()
    const de = createFakeDataEngine()
    const ctx = createCtx(em, de)
    const failure = new Error('phase-failure')

    await expect(
      runCrudCommandWrite({
        ctx,
        entityId: 'customers:customer_deal',
        action: 'updated',
        scope: baseScope,
        customFields: { priority: 3 },
        events,
        indexer,
        sideEffect: () => ({ entity, identifiers }),
        phases: [
          () => {
            throw failure
          },
        ],
      }),
    ).rejects.toBe(failure)

    expect(em.begin).toHaveBeenCalledTimes(1)
    expect(em.rollback).toHaveBeenCalledTimes(1)
    expect(em.flush).not.toHaveBeenCalled()
    expect(em.commit).not.toHaveBeenCalled()
    expect(de.setCustomFields).not.toHaveBeenCalled()
    expect(de.markOrmEntityChange).not.toHaveBeenCalled()
  })

  it('does NOT emit side-effects when setCustomFields throws (AC3)', async () => {
    const em = createFakeEm()
    const de = createFakeDataEngine()
    const ctx = createCtx(em, de)
    const failure = new Error('custom-field-failure')
    de.setCustomFields.mockRejectedValueOnce(failure)

    await expect(
      runCrudCommandWrite({
        ctx,
        entityId: 'customers:customer_deal',
        action: 'updated',
        scope: baseScope,
        customFields: { priority: 3 },
        events,
        indexer,
        sideEffect: () => ({ entity, identifiers }),
        phases: [() => {}],
      }),
    ).rejects.toBe(failure)

    expect(em.flush).toHaveBeenCalledTimes(1)
    expect(em.commit).toHaveBeenCalledTimes(1)
    expect(de.setCustomFields).toHaveBeenCalledTimes(1)
    expect(de.markOrmEntityChange).not.toHaveBeenCalled()
  })

  it('uses a caller-supplied EM instead of forking a new one when opts.em is provided', async () => {
    const rootEm = createFakeEm()
    const callerEm = createFakeEm()
    const de = createFakeDataEngine()
    const ctx = createCtx(rootEm, de)
    let observedPhaseEm: FakeEntityManager | null = null

    await runCrudCommandWrite({
      ctx,
      entityId: 'customers:customer_deal',
      action: 'updated',
      scope: baseScope,
      em: callerEm as any,
      sideEffect: () => ({ entity, identifiers }),
      phases: [
        ({ em }) => {
          observedPhaseEm = em as unknown as FakeEntityManager
        },
      ],
    })

    expect(rootEm.fork).not.toHaveBeenCalled()
    expect(observedPhaseEm).toBe(callerEm)
    expect(callerEm.begin).toHaveBeenCalledTimes(1)
    expect(callerEm.flush).toHaveBeenCalledTimes(1)
    expect(callerEm.commit).toHaveBeenCalledTimes(1)
  })

  it('uses a caller-supplied DataEngine instead of resolving from container', async () => {
    const em = createFakeEm()
    const containerDe = createFakeDataEngine()
    const callerDe = createFakeDataEngine()
    const ctx = createCtx(em, containerDe)

    await runCrudCommandWrite({
      ctx,
      entityId: 'customers:customer_deal',
      action: 'updated',
      scope: baseScope,
      customFields: { priority: 3 },
      dataEngine: callerDe as any,
      sideEffect: () => ({ entity, identifiers }),
      phases: [() => {}],
    })

    expect(callerDe.setCustomFields).toHaveBeenCalledTimes(1)
    expect(callerDe.markOrmEntityChange).toHaveBeenCalledTimes(1)
    expect(containerDe.setCustomFields).not.toHaveBeenCalled()
    expect(containerDe.markOrmEntityChange).not.toHaveBeenCalled()
  })

  it('evaluates sideEffect lazily after phases commit (supports closure-captured entities created inside a phase)', async () => {
    const em = createFakeEm()
    const de = createFakeDataEngine()
    const ctx = createCtx(em, de)
    let createdEntity: { id: string; tenantId: string; organizationId: string } | null = null
    const sideEffectSpy = jest.fn(() => ({
      entity: createdEntity!,
      identifiers: { id: createdEntity!.id, tenantId: 't1', organizationId: 'o1' },
    }))

    await runCrudCommandWrite({
      ctx,
      entityId: 'customers:customer_deal',
      action: 'created',
      scope: baseScope,
      sideEffect: sideEffectSpy,
      phases: [
        () => {
          createdEntity = { id: 'fresh-id', tenantId: 't1', organizationId: 'o1' }
        },
      ],
    })

    expect(sideEffectSpy).toHaveBeenCalledTimes(1)
    expect(de.markOrmEntityChange).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: { id: 'fresh-id', tenantId: 't1', organizationId: 'o1' },
        identifiers: { id: 'fresh-id', tenantId: 't1', organizationId: 'o1' },
      }),
    )
  })

  it('runs phases sequentially in a single transaction, flushing per phase (SPEC-018)', async () => {
    const em = createFakeEm()
    const de = createFakeDataEngine()
    const ctx = createCtx(em, de)
    const order: string[] = []

    await runCrudCommandWrite({
      ctx,
      entityId: 'customers:customer_deal',
      action: 'updated',
      scope: baseScope,
      sideEffect: () => ({ entity, identifiers }),
      phases: [
        async () => {
          await Promise.resolve()
          order.push('phase-1')
        },
        () => {
          order.push('phase-2')
        },
      ],
    })

    expect(order).toEqual(['phase-1', 'phase-2'])
    expect(em.begin).toHaveBeenCalledTimes(1)
    // SPEC-018: withAtomicFlush flushes after each phase (one per phase) so a
    // later phase's reads see the prior phase's mutations without UoW reset.
    expect(em.flush).toHaveBeenCalledTimes(2)
    expect(em.commit).toHaveBeenCalledTimes(1)
  })

  it('honours transaction:false (no begin/commit, single flush still happens)', async () => {
    const em = createFakeEm()
    const de = createFakeDataEngine()
    const ctx = createCtx(em, de)

    await runCrudCommandWrite({
      ctx,
      entityId: 'customers:customer_deal',
      action: 'updated',
      scope: baseScope,
      transaction: false,
      sideEffect: () => ({ entity, identifiers }),
      phases: [() => {}],
    })

    expect(em.begin).not.toHaveBeenCalled()
    expect(em.commit).not.toHaveBeenCalled()
    expect(em.flush).toHaveBeenCalledTimes(1)
    expect(de.markOrmEntityChange).toHaveBeenCalledTimes(1)
  })

  it('forwards syncOrigin to the side-effect emit', async () => {
    const em = createFakeEm()
    const de = createFakeDataEngine()
    const ctx = createCtx(em, de)

    await runCrudCommandWrite({
      ctx,
      entityId: 'customers:customer_deal',
      action: 'updated',
      scope: baseScope,
      syncOrigin: 'sync_excel',
      sideEffect: () => ({ entity, identifiers }),
      phases: [() => {}],
    })

    expect(de.markOrmEntityChange).toHaveBeenCalledWith(
      expect.objectContaining({ syncOrigin: 'sync_excel' }),
    )
  })

  it('passes notifyCustomFields:true through to setCustomFields when requested', async () => {
    const em = createFakeEm()
    const de = createFakeDataEngine()
    const ctx = createCtx(em, de)

    await runCrudCommandWrite({
      ctx,
      entityId: 'customers:customer_deal',
      action: 'updated',
      scope: baseScope,
      customFields: { priority: 3 },
      notifyCustomFields: true,
      sideEffect: () => ({ entity, identifiers }),
      phases: [() => {}],
    })

    expect(de.setCustomFields).toHaveBeenCalledWith(
      expect.objectContaining({ notify: true }),
    )
  })
})
