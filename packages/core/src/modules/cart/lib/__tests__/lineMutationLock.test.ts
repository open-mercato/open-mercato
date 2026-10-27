import type { EntityManager } from '@mikro-orm/postgresql'
import { withCartLineMutationLock } from '../lineMutationLock'

function createManager(initialTransaction = false) {
  let active = initialTransaction
  const manager = {
    begin: jest.fn(async () => { active = true }),
    commit: jest.fn(async () => { active = false }),
    rollback: jest.fn(async () => { active = false }),
    flush: jest.fn(async () => undefined),
    execute: jest.fn(async () => [{ locked: true }]),
    isInTransaction: jest.fn(() => active),
  }
  return { manager, em: manager as unknown as EntityManager }
}

afterEach(() => { jest.useRealTimers() })

test('a contended cart releases its transaction before backing off and never runs mutations before acquisition', async () => {
  jest.useFakeTimers()
  const { manager, em } = createManager()
  manager.execute.mockResolvedValueOnce([{ locked: false }])
  const mutate = jest.fn(async () => undefined)
  const pending = withCartLineMutationLock(em, 'cart-a', [mutate], 'cart.lines.add')
  await jest.advanceTimersByTimeAsync(0)
  expect(manager.rollback).toHaveBeenCalledTimes(1)
  expect(manager.isInTransaction()).toBe(false)
  expect(manager.flush).not.toHaveBeenCalled()
  expect(mutate).not.toHaveBeenCalled()
  expect(manager.execute).toHaveBeenCalledWith(
    'select pg_try_advisory_xact_lock(hashtextextended(?::text, 0)) as locked',
    ['cart:lines:cart-a'],
  )
  await jest.advanceTimersByTimeAsync(100)
  await pending
  expect(mutate).toHaveBeenCalledTimes(1)
  expect(manager.commit).toHaveBeenCalledTimes(1)
  expect(manager.rollback).toHaveBeenCalledTimes(1)
})

test('waiting longer than fifteen seconds preserves the original lock wait behavior', async () => {
  jest.useFakeTimers()
  const { manager, em } = createManager()
  const availableAt = Date.now() + 30_000
  manager.execute.mockImplementation(async () => [{ locked: Date.now() >= availableAt }])
  const mutate = jest.fn(async () => undefined)
  const pending = withCartLineMutationLock(em, 'cart-a', [mutate], 'cart.lines.add')
  await jest.advanceTimersByTimeAsync(20_000)
  expect(manager.isInTransaction()).toBe(false)
  expect(mutate).not.toHaveBeenCalled()
  expect(manager.commit).not.toHaveBeenCalled()
  await jest.advanceTimersByTimeAsync(11_000)
  await pending
  expect(mutate).toHaveBeenCalledTimes(1)
  expect(manager.commit).toHaveBeenCalledTimes(1)
})

test('a mutation failure rolls back and propagates without retrying its writes', async () => {
  const { manager, em } = createManager()
  const error = new Error('[internal] Mutation failed')
  const mutate = jest.fn(async () => { throw error })
  await expect(withCartLineMutationLock(em, 'cart-a', [mutate], 'cart.lines.add')).rejects.toBe(error)
  expect(mutate).toHaveBeenCalledTimes(1)
  expect(manager.begin).toHaveBeenCalledTimes(1)
  expect(manager.rollback).toHaveBeenCalledTimes(1)
  expect(manager.commit).not.toHaveBeenCalled()
})

test('an advisory query failure propagates without retrying or running mutations', async () => {
  const { manager, em } = createManager()
  const error = new Error('[internal] Database query failed')
  manager.execute.mockRejectedValue(error)
  const mutate = jest.fn(async () => undefined)
  await expect(withCartLineMutationLock(em, 'cart-a', [mutate], 'cart.lines.add')).rejects.toBe(error)
  expect(manager.execute).toHaveBeenCalledTimes(1)
  expect(manager.rollback).toHaveBeenCalledTimes(1)
  expect(mutate).not.toHaveBeenCalled()
})

test('an ambient transaction keeps ownership of its lock, commit, and rollback', async () => {
  const { manager, em } = createManager(true)
  const mutate = jest.fn(async () => undefined)
  await withCartLineMutationLock(em, 'cart-a', [mutate], 'cart.lines.add')
  expect(manager.execute).toHaveBeenCalledWith(
    'select pg_advisory_xact_lock(hashtextextended(?::text, 0))',
    ['cart:lines:cart-a'],
  )
  expect(mutate).toHaveBeenCalledTimes(1)
  expect(manager.begin).not.toHaveBeenCalled()
  expect(manager.commit).not.toHaveBeenCalled()
  expect(manager.rollback).not.toHaveBeenCalled()
})

test('an ambient mutation failure is returned to its transaction owner without replay', async () => {
  const { manager, em } = createManager(true)
  const error = new Error('[internal] Mutation failed')
  const mutate = jest.fn(async () => { throw error })
  await expect(withCartLineMutationLock(em, 'cart-a', [mutate], 'cart.lines.bulkAdd')).rejects.toBe(error)
  expect(mutate).toHaveBeenCalledTimes(1)
  expect(manager.execute).toHaveBeenCalledTimes(1)
  expect(manager.isInTransaction()).toBe(true)
  expect(manager.commit).not.toHaveBeenCalled()
  expect(manager.rollback).not.toHaveBeenCalled()
})

test('a failed rollback does not retry while its connection remains in a transaction', async () => {
  const { manager, em } = createManager()
  manager.execute.mockResolvedValue([{ locked: false }])
  manager.rollback.mockRejectedValue(new Error('[internal] Rollback failed'))
  const mutate = jest.fn(async () => undefined)
  await expect(withCartLineMutationLock(em, 'cart-a', [mutate], 'cart.lines.add'))
    .rejects.toThrow('[internal] Cart line mutation lock is busy')
  expect(manager.begin).toHaveBeenCalledTimes(1)
  expect(manager.execute).toHaveBeenCalledTimes(1)
  expect(manager.isInTransaction()).toBe(true)
  expect(mutate).not.toHaveBeenCalled()
})
