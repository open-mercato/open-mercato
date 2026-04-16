import { withAtomicFlush } from '../flush'

type FakeEntityManager = {
  flush: jest.Mock<Promise<void>, []>
  transactional: jest.Mock<Promise<void>, [(em: FakeEntityManager) => Promise<void>]>
}

function createFakeEm(): FakeEntityManager {
  const em: FakeEntityManager = {
    flush: jest.fn().mockResolvedValue(undefined),
    transactional: jest.fn(async (cb: (em: FakeEntityManager) => Promise<void>) => {
      await cb(em)
    }),
  }
  return em
}

describe('withAtomicFlush', () => {
  it('runs phases in order and flushes once at the end', async () => {
    const em = createFakeEm()
    const calls: string[] = []

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

    expect(calls).toEqual(['phase1-start', 'phase1-end', 'phase2', 'phase3'])
    expect(em.flush).toHaveBeenCalledTimes(1)
    expect(em.transactional).not.toHaveBeenCalled()
  })

  it('lets a later phase observe state a prior phase mutated', async () => {
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
    expect(em.flush).toHaveBeenCalledTimes(1)
  })

  it('runs inside em.transactional when transaction option is true', async () => {
    const em = createFakeEm()
    const phase = jest.fn()

    await withAtomicFlush(em as any, [phase], { transaction: true })

    expect(em.transactional).toHaveBeenCalledTimes(1)
    expect(phase).toHaveBeenCalledTimes(1)
    expect(em.flush).toHaveBeenCalledTimes(1)
  })

  it('propagates a thrown error and does NOT flush when a phase throws', async () => {
    const em = createFakeEm()
    const failure = new Error('phase-failure')

    await expect(
      withAtomicFlush(em as any, [
        () => {
          // ok
        },
        () => {
          throw failure
        },
        () => {
          throw new Error('should-not-run')
        },
      ]),
    ).rejects.toBe(failure)

    expect(em.flush).not.toHaveBeenCalled()
  })

  it('propagates a thrown error inside a transaction without flushing', async () => {
    const em = createFakeEm()
    const failure = new Error('transactional-failure')

    await expect(
      withAtomicFlush(em as any, [
        () => {
          throw failure
        },
      ], { transaction: true }),
    ).rejects.toBe(failure)

    expect(em.transactional).toHaveBeenCalledTimes(1)
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('is a no-op when phases is empty, still calls flush once to keep semantics explicit', async () => {
    const em = createFakeEm()

    await withAtomicFlush(em as any, [])

    expect(em.flush).toHaveBeenCalledTimes(1)
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
})
