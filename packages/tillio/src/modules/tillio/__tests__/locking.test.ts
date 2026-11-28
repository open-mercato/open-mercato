import type { EntityManager } from '@mikro-orm/postgresql'
import { createTillioLock, tillioOperatorLockKey, tillioPullLockKey } from '../lib/locking'

type FakeTransaction = {
  execute: jest.Mock
  getConnection: jest.Mock
}

function fakeEntityManager(order: string[], connection = {}): { em: EntityManager; tx: FakeTransaction } {
  const connectionExecute = jest.fn(async () => {
    order.push('lock-outside-transaction')
    return []
  })
  const tx: FakeTransaction = {
    execute: jest.fn(async () => {
      order.push('lock')
      return []
    }),
    getConnection: jest.fn(() => ({ execute: connectionExecute })),
  }
  const em = {
    getConnection: () => connection,
    config: { get: () => ({ max: 2 }) },
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
    expect(tx.execute).toHaveBeenCalledWith('select pg_advisory_xact_lock(hashtext(?::text))', ['tillio:pull:tn:org'])
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
      expect(operatorEm.transactional).toHaveBeenCalledTimes(1)
      expect(pullEm.transactional).not.toHaveBeenCalled()
    } finally {
      finishOperator()
      await operatorResult
      await expect(pull).resolves.toBe('done')
    }
    expect(pullEm.transactional).toHaveBeenCalledTimes(1)
  })
})

describe('tillio lock keys', () => {
  it('scopes each lock to the tenant and the organization', () => {
    const scope = { tenantId: 'tn', organizationId: 'org' }
    expect(tillioOperatorLockKey(scope)).toBe('tillio:operators:tn:org')
    expect(tillioPullLockKey(scope)).toBe('tillio:pull:tn:org')
  })
})
