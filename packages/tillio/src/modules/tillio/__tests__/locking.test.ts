import type { EntityManager } from '@mikro-orm/postgresql'
import { createTillioLock, tillioOperatorLockKey, tillioPullLockKey } from '../lib/locking'

type FakeTransaction = {
  execute: jest.Mock
  getConnection: jest.Mock
}

function fakeEntityManager(order: string[], connection = {}, lockTimeout = 0): { em: EntityManager; tx: FakeTransaction } {
  const connectionExecute = jest.fn(async () => {
    order.push('lock-outside-transaction')
    return []
  })
  const tx: FakeTransaction = {
    execute: jest.fn(async () => {
      order.push('lock')
      return [{ locked: true }]
    }),
    getConnection: jest.fn(() => ({ execute: connectionExecute })),
  }
  const em = {
    getConnection: () => connection,
    config: { get: (key: string) => (key === 'pool' ? { max: 2 } : { lock_timeout: lockTimeout }) },
    transactional: jest.fn(async (callback: (transaction: FakeTransaction) => Promise<unknown>) => {
      order.push('begin')
      const result = await callback(tx)
      order.push('commit')
      return result
    }),
  } as unknown as EntityManager
  return { em, tx }
}

describe('createTillioLock', () => {
  it('takes the advisory lock on the transaction that wraps the critical section', async () => {
    const order: string[] = []
    const { em, tx } = fakeEntityManager(order)
    const withLock = createTillioLock(em, 'tillio:pull:tn:org')

    const result = await withLock(async () => {
      order.push('run')
      return 'done'
    })

    expect(result).toBe('done')
    expect(tx.execute).toHaveBeenCalledWith('select pg_try_advisory_xact_lock(hashtext(?::text)) as locked', ['tillio:pull:tn:org'])
    expect(tx.getConnection).not.toHaveBeenCalled()
    expect(order).toEqual(['begin', 'lock', 'run', 'commit'])
  })

  it('propagates a failure from the critical section so the transaction rolls back and releases the lock', async () => {
    const order: string[] = []
    const { em } = fakeEntityManager(order)
    const withLock = createTillioLock(em, 'tillio:operators:tn:org')

    await expect(
      withLock(async () => {
        throw new Error('[internal] boom')
      }),
    ).rejects.toThrow('boom')
    expect(order).toEqual(['begin', 'lock'])
  })

  it('waits outside the transaction across lock kinds and frees the slot after failure', async () => {
    const connection = {}
    const order: string[] = []
    const { em: operatorEm } = fakeEntityManager(order, connection)
    const { em: pullEm } = fakeEntityManager(order, connection)
    let finishOperator!: () => void
    const operatorWork = new Promise<void>((resolve) => {
      finishOperator = resolve
    })
    const failure = new Error('[internal] operator write failed')
    const operator = createTillioLock(operatorEm, 'tillio:operators:tn:org')(async () => {
      await operatorWork
      throw failure
    })
    const operatorResult = expect(operator).rejects.toBe(failure)
    const pull = createTillioLock(pullEm, 'tillio:pull:other-tn:other-org')(async () => 'done')

    try {
      await Promise.resolve()
      expect(operatorEm.transactional).toHaveBeenCalledTimes(1)
      expect(pullEm.transactional).not.toHaveBeenCalled()
    } finally {
      finishOperator()
      await operatorResult
      await expect(pull).resolves.toBe('done')
    }
    expect(pullEm.transactional).toHaveBeenCalledTimes(1)
  })

  it('removes a timed-out waiter without running its callback or leaking the slot', async () => {
    jest.useFakeTimers()
    const connection = {}
    const { em: holderEm } = fakeEntityManager([], connection)
    const { em: waiterEm } = fakeEntityManager([], connection, 100)
    let finishHolder!: () => void
    const held = new Promise<void>((resolve) => {
      finishHolder = resolve
    })
    const holder = createTillioLock(holderEm, 'tillio:operators:tn:org')(() => held)
    const withLock = createTillioLock(waiterEm, 'tillio:pull:other-tn:other-org')
    const callback = jest.fn(async () => 'done')
    const waiter = expect(withLock(callback)).rejects.toThrow('wait deadline')

    try {
      await jest.advanceTimersByTimeAsync(100)
      await waiter
      expect(waiterEm.transactional).not.toHaveBeenCalled()
      expect(callback).not.toHaveBeenCalled()
    } finally {
      finishHolder()
      await holder
      jest.useRealTimers()
    }

    await expect(withLock(callback)).resolves.toBe('done')
  })
})

describe('tillio lock keys', () => {
  it('scopes each lock to the tenant and the organization', () => {
    const scope = { tenantId: 'tn', organizationId: 'org' }
    expect(tillioOperatorLockKey(scope)).toBe('tillio:operators:tn:org')
    expect(tillioPullLockKey(scope)).toBe('tillio:pull:tn:org')
  })
})
