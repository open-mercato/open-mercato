import { withAtomicFlush } from '../flush'

type FakeEntityManager = {
  flush: jest.Mock<Promise<void>, []>
  begin: jest.Mock<Promise<void>, []>
  commit: jest.Mock<Promise<void>, []>
  rollback: jest.Mock<Promise<void>, []>
}

function createFakeEm(): FakeEntityManager {
  return {
    flush: jest.fn().mockResolvedValue(undefined),
    begin: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
  }
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
    expect(em.begin).not.toHaveBeenCalled()
    expect(em.commit).not.toHaveBeenCalled()
    expect(em.rollback).not.toHaveBeenCalled()
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

  it('propagates a thrown error and does NOT flush when a phase throws (non-transactional)', async () => {
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
})
