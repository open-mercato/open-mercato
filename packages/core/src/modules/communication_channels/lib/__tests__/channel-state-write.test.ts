import { LockMode } from '@mikro-orm/core'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { EntityManager } from '@mikro-orm/postgresql'
import { sameSyncState, syncState, withLockedChannel } from '../channel-state-write'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: jest.fn() }))

afterEach(() => jest.clearAllMocks())

it('compares sync cursors independently of push keys and object key ordering', () => {
  expect(sameSyncState({ nested: { first: 1, second: 2 }, historyId: '1' }, {
    pushStatus: 'inactive', historyId: '1', nested: { second: 2, first: 1 },
  })).toBe(true)
  expect(sameSyncState({ historyId: '1' }, { historyId: '2' })).toBe(false)
  expect(syncState(null)).toEqual({})
})

it.each([null, 'org'])('locks a fresh scoped row inside a cleared transaction (org=%s)', async (organizationId) => {
  const current = { id: 'channel', tenantId: 'tenant', organizationId }
  const transaction = { flush: jest.fn() }
  const transactional = jest.fn(async (callback: (manager: typeof transaction) => Promise<unknown>) => callback(transaction))
  const fork = jest.fn(() => ({ transactional }))
  ;(findOneWithDecryption as jest.Mock).mockResolvedValue(current)
  const update = jest.fn(async () => 'committed')
  await expect(withLockedChannel({ fork } as unknown as EntityManager, current, update)).resolves.toBe('committed')
  expect(fork).toHaveBeenCalledWith({ clear: true })
  expect(findOneWithDecryption).toHaveBeenCalledWith(transaction, expect.anything(), {
    id: 'channel', tenantId: 'tenant', organizationId, deletedAt: null,
  }, { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true }, { tenantId: 'tenant', organizationId })
  expect(update).toHaveBeenCalledWith(current, transaction)
})

it('does not mutate a deleted row or swallow a transaction failure', async () => {
  const transactional = jest.fn(async (callback: (manager: unknown) => Promise<unknown>) => callback({}))
  const em = { fork: () => ({ transactional }) } as unknown as EntityManager
  const update = jest.fn(async () => true)
  ;(findOneWithDecryption as jest.Mock).mockResolvedValue(null)
  await expect(withLockedChannel(em, { id: 'c', tenantId: 't' }, update)).resolves.toBeUndefined()
  expect(update).not.toHaveBeenCalled()
  transactional.mockRejectedValueOnce(new Error('commit failed'))
  await expect(withLockedChannel(em, { id: 'c', tenantId: 't' }, update)).rejects.toThrow('commit failed')
})
