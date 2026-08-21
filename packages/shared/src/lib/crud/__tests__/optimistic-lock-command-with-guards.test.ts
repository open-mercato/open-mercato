import type { AwilixContainer } from 'awilix'
import {
  enforceCommandOptimisticLockWithGuards,
  type CommandOptimisticLockGuardService,
  type EnforceCommandOptimisticLockInput,
} from '../optimistic-lock-command'
import { CrudHttpError } from '../errors'
import { OPTIMISTIC_LOCK_HEADER_NAME, OPTIMISTIC_LOCK_CONFLICT_CODE } from '../optimistic-lock-headers'

function containerWith(service: CommandOptimisticLockGuardService | null): AwilixContainer {
  return {
    resolve(key: string) {
      if (key === 'commandOptimisticLockGuardService' && service) return service
      throw new Error(`unregistered: ${key}`)
    },
  } as unknown as AwilixContainer
}

function headersWith(expected: string): Headers {
  const h = new Headers()
  h.set(OPTIMISTIC_LOCK_HEADER_NAME, expected)
  return h
}

const ENV_ON = 'all'

describe('enforceCommandOptimisticLockWithGuards', () => {
  test('runs the OSS floor first: a version mismatch 409s before the seam is consulted', async () => {
    const enforce = jest.fn().mockResolvedValue(undefined)
    const container = containerWith({ enforce })
    const input: EnforceCommandOptimisticLockInput = {
      resourceKind: 'sales.order',
      resourceId: 'order-1',
      current: '2026-06-01T00:00:01.000Z',
      request: headersWith('2026-06-01T00:00:00.000Z'),
      envValue: ENV_ON,
    }

    await expect(enforceCommandOptimisticLockWithGuards(container, input)).rejects.toMatchObject({
      status: 409,
    })
    // Floor blocked it; the enterprise seam was never reached.
    expect(enforce).not.toHaveBeenCalled()
  })

  test('migrated path awaits the seam before "mutating" when the floor passes', async () => {
    const order: string[] = []
    const enforce = jest.fn().mockImplementation(async () => {
      order.push('seam-start')
      await Promise.resolve()
      order.push('seam-end')
    })
    const container = containerWith({ enforce })

    await enforceCommandOptimisticLockWithGuards(container, {
      resourceKind: 'sales.order',
      resourceId: 'order-1',
      current: '2026-06-01T00:00:00.000Z',
      request: headersWith('2026-06-01T00:00:00.000Z'),
      envValue: ENV_ON,
    })
    order.push('mutate')

    expect(enforce).toHaveBeenCalledTimes(1)
    expect(order).toEqual(['seam-start', 'seam-end', 'mutate'])
  })

  test('an enterprise-service 409 conflict propagates (blocks the write)', async () => {
    const enforce = jest.fn().mockRejectedValue(
      new CrudHttpError(409, { code: OPTIMISTIC_LOCK_CONFLICT_CODE, error: 'record_modified' }),
    )
    const container = containerWith({ enforce })

    await expect(
      enforceCommandOptimisticLockWithGuards(container, {
        resourceKind: 'sales.order',
        resourceId: 'order-1',
        current: '2026-06-01T00:00:00.000Z',
        request: headersWith('2026-06-01T00:00:00.000Z'),
        envValue: ENV_ON,
      }),
    ).rejects.toMatchObject({ status: 409 })
  })

  test('an unregistered service falls back to OSS-only (no throw beyond the floor)', async () => {
    const container = containerWith(null)
    await expect(
      enforceCommandOptimisticLockWithGuards(container, {
        resourceKind: 'sales.order',
        resourceId: 'order-1',
        current: '2026-06-01T00:00:00.000Z',
        request: headersWith('2026-06-01T00:00:00.000Z'),
        envValue: ENV_ON,
      }),
    ).resolves.toBeUndefined()
  })

  test('a throwing (non-conflict) service degrades to OSS-only — error is swallowed', async () => {
    const enforce = jest.fn().mockRejectedValue(new Error('record_locks down'))
    const container = containerWith({ enforce })

    await expect(
      enforceCommandOptimisticLockWithGuards(container, {
        resourceKind: 'sales.order',
        resourceId: 'order-1',
        current: '2026-06-01T00:00:00.000Z',
        request: headersWith('2026-06-01T00:00:00.000Z'),
        envValue: ENV_ON,
      }),
    ).resolves.toBeUndefined()
    expect(enforce).toHaveBeenCalledTimes(1)
  })

  test('a non-409 CrudHttpError from the service is also swallowed (degrade to OSS-only)', async () => {
    const enforce = jest.fn().mockRejectedValue(new CrudHttpError(500, { error: 'boom' }))
    const container = containerWith({ enforce })

    await expect(
      enforceCommandOptimisticLockWithGuards(container, {
        resourceKind: 'sales.order',
        resourceId: 'order-1',
        current: '2026-06-01T00:00:00.000Z',
        request: headersWith('2026-06-01T00:00:00.000Z'),
        envValue: ENV_ON,
      }),
    ).resolves.toBeUndefined()
  })
})
