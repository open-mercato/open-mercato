import { withAtomicFlush } from '../flush'
import { createLogger } from '@open-mercato/shared/lib/logger'

jest.mock('@open-mercato/shared/lib/logger', () => {
  const mocked = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(),
  }
  mocked.child.mockImplementation(() => mocked)
  return { createLogger: jest.fn(() => mocked) }
})
const loggerWarn = createLogger('shared').warn as jest.Mock


type FakeEntityManager = {
  flush: jest.Mock<Promise<void>, []>
  begin: jest.Mock<Promise<void>, [unknown?]>
  commit: jest.Mock<Promise<void>, []>
  rollback: jest.Mock<Promise<void>, []>
  isInTransaction: jest.Mock<boolean, []>
}

function createFakeEm(overrides?: { inTransaction?: boolean }): FakeEntityManager {
  return {
    flush: jest.fn().mockResolvedValue(undefined),
    begin: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    isInTransaction: jest.fn().mockReturnValue(overrides?.inTransaction ?? false),
  }
}

describe('withAtomicFlush', () => {
  it('runs phases in order and flushes after each phase (SPEC-018 boundaries)', async () => {
    const em = createFakeEm()
    const calls: string[] = []
    em.flush.mockImplementation(async () => {
      calls.push('flush')
    })

    await withAtomicFlush(em as any, [
      async () => {
        calls.push('phase1-start')
        await Promise.resolve()
        calls.push('phase1-end')
      },
      () => {
        calls.push('phase2')
      },
      async () => {
        calls.push('phase3')
      },
    ])

    // Each phase is flushed before the next begins — the interleaved-read guard.
    expect(calls).toEqual([
      'phase1-start',
      'phase1-end',
      'flush',
      'phase2',
      'flush',
      'phase3',
      'flush',
    ])
    expect(em.flush).toHaveBeenCalledTimes(3)
    expect(em.begin).not.toHaveBeenCalled()
    expect(em.commit).not.toHaveBeenCalled()
    expect(em.rollback).not.toHaveBeenCalled()
  })

  it('flushes a phase before a later phase observes its mutation', async () => {
    const em = createFakeEm()
    const state: { value: number } = { value: 0 }
    let observed: number | null = null

    await withAtomicFlush(em as any, [
      () => {
        state.value = 42
      },
      () => {
        observed = state.value
      },
    ])

    expect(observed).toBe(42)
    // Two phases → flushed at each boundary.
    expect(em.flush).toHaveBeenCalledTimes(2)
  })

  it('wraps phases in begin/commit when transaction option is true', async () => {
    const em = createFakeEm()
    const phase = jest.fn()

    await withAtomicFlush(em as any, [phase], { transaction: true })

    expect(em.begin).toHaveBeenCalledTimes(1)
    expect(phase).toHaveBeenCalledTimes(1)
    expect(em.flush).toHaveBeenCalledTimes(1)
    expect(em.commit).toHaveBeenCalledTimes(1)
    expect(em.rollback).not.toHaveBeenCalled()
  })

  it('calls rollback when a transactional phase throws', async () => {
    const em = createFakeEm()
    const failure = new Error('transactional-failure')

    await expect(
      withAtomicFlush(em as any, [
        () => {
          throw failure
        },
      ], { transaction: true }),
    ).rejects.toBe(failure)

    expect(em.begin).toHaveBeenCalledTimes(1)
    expect(em.flush).not.toHaveBeenCalled()
    expect(em.commit).not.toHaveBeenCalled()
    expect(em.rollback).toHaveBeenCalledTimes(1)
  })

  it('propagates a thrown error and stops at the failing phase (non-transactional, per-phase flush)', async () => {
    const em = createFakeEm()
    const failure = new Error('phase-failure')
    let thirdPhaseRan = false

    await expect(
      withAtomicFlush(em as any, [
        () => {
          // ok — its changeset is flushed at the phase boundary before phase 2 runs
        },
        () => {
          throw failure
        },
        () => {
          thirdPhaseRan = true
        },
      ]),
    ).rejects.toBe(failure)

    // Non-transactional: the first phase flushed independently before phase 2
    // threw; the failing phase's own flush and every later phase are skipped.
    // (This independent-commit risk is exactly why mutating commands pass
    // `{ transaction: true }`, where the whole sequence rolls back instead.)
    expect(em.flush).toHaveBeenCalledTimes(1)
    expect(thirdPhaseRan).toBe(false)
  })

  it('is a true no-op when phases is empty — no flush, no transaction', async () => {
    const em = createFakeEm()

    await withAtomicFlush(em as any, [])

    expect(em.flush).not.toHaveBeenCalled()
    expect(em.begin).not.toHaveBeenCalled()
  })

  it('is a true no-op when phases is empty even with transaction option', async () => {
    const em = createFakeEm()

    await withAtomicFlush(em as any, [], { transaction: true })

    expect(em.flush).not.toHaveBeenCalled()
    expect(em.begin).not.toHaveBeenCalled()
    expect(em.commit).not.toHaveBeenCalled()
    expect(em.rollback).not.toHaveBeenCalled()
  })

  it('does not swallow an async rejection from a phase', async () => {
    const em = createFakeEm()
    const failure = new Error('async-failure')

    await expect(
      withAtomicFlush(em as any, [
        async () => {
          await Promise.resolve()
          throw failure
        },
      ]),
    ).rejects.toBe(failure)

    expect(em.flush).not.toHaveBeenCalled()
  })

  it('throws the original phase error even if rollback fails', async () => {
    const em = createFakeEm()
    em.rollback.mockRejectedValueOnce(new Error('rollback-failed'))
    const failure = new Error('phase-failure')

    await expect(
      withAtomicFlush(em as any, [
        () => {
          throw failure
        },
      ], { transaction: true }),
    ).rejects.toBe(failure)

    expect(em.rollback).toHaveBeenCalledTimes(1)
  })

  it('joins an ambient transaction instead of clobbering it (re-entrancy)', async () => {
    const em = createFakeEm({ inTransaction: true })
    const phase = jest.fn()

    await withAtomicFlush(em as any, [phase], { transaction: true })

    // Must NOT open/commit a nested transaction — the outermost caller owns it.
    expect(em.begin).not.toHaveBeenCalled()
    expect(em.commit).not.toHaveBeenCalled()
    expect(em.rollback).not.toHaveBeenCalled()
    expect(phase).toHaveBeenCalledTimes(1)
    expect(em.flush).toHaveBeenCalledTimes(1)
  })

  it('propagates a phase error when joining an ambient transaction (no local rollback)', async () => {
    const em = createFakeEm({ inTransaction: true })
    const failure = new Error('nested-phase-failure')

    await expect(
      withAtomicFlush(em as any, [
        () => {
          throw failure
        },
      ], { transaction: true }),
    ).rejects.toBe(failure)

    // The enclosing transaction owns rollback; this call must not commit or rollback.
    expect(em.begin).not.toHaveBeenCalled()
    expect(em.commit).not.toHaveBeenCalled()
    expect(em.rollback).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('forwards isolationLevel to begin when opening a top-level transaction', async () => {
    const em = createFakeEm()

    await withAtomicFlush(em as any, [() => {}], {
      transaction: true,
      isolationLevel: 'serializable' as any,
    })

    expect(em.begin).toHaveBeenCalledTimes(1)
    expect(em.begin).toHaveBeenCalledWith({ isolationLevel: 'serializable' })
    expect(em.commit).toHaveBeenCalledTimes(1)
  })

  it('does not pass options to begin when no isolationLevel is set', async () => {
    const em = createFakeEm()

    await withAtomicFlush(em as any, [() => {}], { transaction: true })

    expect(em.begin).toHaveBeenCalledWith(undefined)
  })

  describe('commit-boundary pending-changes guard', () => {
    type UowEm = FakeEntityManager & {
      getUnitOfWork: jest.Mock<{ computeChangeSets: jest.Mock; getChangeSets: jest.Mock }, []>
    }

    function createUowEm(pendingChangeSets: unknown[], opts?: { inTransaction?: boolean }): UowEm {
      const computeChangeSets = jest.fn()
      const getChangeSets = jest.fn().mockReturnValue(pendingChangeSets)
      return {
        ...createFakeEm(opts),
        getUnitOfWork: jest.fn().mockReturnValue({ computeChangeSets, getChangeSets }),
      }
    }

    it('flushes once more when a change set lingers past the last phase flush', async () => {
      // One managed entity is still dirty at the commit boundary (a phase mutated
      // after its own flush). The guard must persist it instead of letting the
      // transaction commit the work-in-progress silently.
      const em = createUowEm([{ entity: 'lingering' }], { inTransaction: false })
      loggerWarn.mockClear()
      try {
        await withAtomicFlush(em as any, [() => {}], { transaction: true, label: 'demo.command' })
      } finally {
      }

      // 1 per-phase flush + 1 defensive guard flush, all inside the same transaction.
      expect(em.flush).toHaveBeenCalledTimes(2)
      expect(em.commit).toHaveBeenCalledTimes(1)
      expect(em.rollback).not.toHaveBeenCalled()
    })

    it('warns (dev) and names the label when the guard has to act', async () => {
      const em = createUowEm([{ a: 1 }, { b: 2 }])
      const previousEnv = process.env.NODE_ENV
      process.env.NODE_ENV = 'development'
      loggerWarn.mockClear()
      try {
        await withAtomicFlush(em as any, [() => {}], { label: 'sales.update_shipment' })
      } finally {
        process.env.NODE_ENV = previousEnv
      }

      expect(loggerWarn).toHaveBeenCalledTimes(1)
      expect(loggerWarn).toHaveBeenCalledWith(
        expect.stringContaining('flushed defensively'),
        expect.objectContaining({ label: 'sales.update_shipment', pendingCount: 2 }),
      )
    })

    it('does NOT flush again when the UnitOfWork is clean at the boundary', async () => {
      const em = createUowEm([])
      loggerWarn.mockClear()
      try {
        await withAtomicFlush(em as any, [() => {}, () => {}])
      } finally {
      }

      // 2 phases → 2 per-phase flushes; the clean guard adds nothing.
      expect(em.flush).toHaveBeenCalledTimes(2)
      expect(loggerWarn).not.toHaveBeenCalled()
    })

    it('never throws when the UnitOfWork probe itself fails', async () => {
      const em: any = {
        ...createFakeEm(),
        getUnitOfWork: jest.fn(() => {
          throw new Error('uow unavailable')
        }),
      }

      await expect(withAtomicFlush(em, [() => {}])).resolves.toBeUndefined()
      // Probe failure → unknown → no defensive flush beyond the per-phase one.
      expect(em.flush).toHaveBeenCalledTimes(1)
    })
  })

  it('opens its own transaction when the EM does not implement isInTransaction (partial/mock EM)', async () => {
    // Many command unit tests mock an EntityManager with begin/commit/rollback/flush
    // but no isInTransaction. The re-entrancy probe must not throw on such EMs — it
    // treats the missing method as "not in a transaction" and opens its own.
    const begin = jest.fn().mockResolvedValue(undefined)
    const commit = jest.fn().mockResolvedValue(undefined)
    const flush = jest.fn().mockResolvedValue(undefined)
    const partialEm = { begin, commit, rollback: jest.fn(), flush }
    const phase = jest.fn()

    await expect(
      withAtomicFlush(partialEm as any, [phase], { transaction: true }),
    ).resolves.toBeUndefined()

    expect(begin).toHaveBeenCalledTimes(1)
    expect(phase).toHaveBeenCalledTimes(1)
    expect(flush).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenCalledTimes(1)
  })
})
