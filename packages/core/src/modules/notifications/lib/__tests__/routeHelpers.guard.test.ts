import type { AwilixContainer } from 'awilix'
import { registerMutationGuards } from '@open-mercato/shared/lib/crud/mutation-guard-store'
import type { MutationGuard } from '@open-mercato/shared/lib/crud/mutation-guard-registry'
import { runGuardedNotificationWrite } from '../routeHelpers'

function makeContainer(registrations: Record<string, unknown> = {}): AwilixContainer {
  return {
    resolve: (name: string) => {
      if (Object.prototype.hasOwnProperty.call(registrations, name)) return registrations[name]
      throw new Error(`[test] no registration for ${name}`)
    },
  } as unknown as AwilixContainer
}

function makeRequest(method = 'POST'): Request {
  return new Request('https://example.test/api/notifications', { method })
}

const scope = { tenantId: 'tenant-1', organizationId: 'org-1', userId: 'user-1' }

afterEach(() => {
  registerMutationGuards([])
  jest.restoreAllMocks()
})

describe('notifications runGuardedNotificationWrite', () => {
  it('runs the write and registry afterSuccess when guards pass', async () => {
    const afterSuccess = jest.fn().mockResolvedValue(undefined)
    const guard: MutationGuard = {
      id: 'notification-guard',
      targetEntity: 'notifications.notification',
      operations: ['create'],
      validate: jest.fn().mockResolvedValue({ ok: true, shouldRunAfterSuccess: true }),
      afterSuccess,
    }
    registerMutationGuards([{ moduleId: 'notifications', guards: [guard] }])

    const write = jest.fn().mockResolvedValue('written')
    const result = await runGuardedNotificationWrite(
      makeContainer(),
      scope,
      makeRequest(),
      { resourceKind: 'notifications.notification', operation: 'create' },
      write,
    )

    expect(guard.validate).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenCalledTimes(1)
    expect(afterSuccess).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ ok: true, result: 'written' })
  })

  it('blocks via the registry and skips the write when a guard rejects', async () => {
    const guard: MutationGuard = {
      id: 'notification-block-guard',
      targetEntity: 'notifications.notification',
      operations: ['create'],
      validate: jest.fn().mockResolvedValue({ ok: false, status: 422, body: { error: 'blocked' } }),
    }
    registerMutationGuards([{ moduleId: 'notifications', guards: [guard] }])

    const write = jest.fn().mockResolvedValue('written')
    const result = await runGuardedNotificationWrite(
      makeContainer(),
      scope,
      makeRequest(),
      { resourceKind: 'notifications.notification', operation: 'create' },
      write,
    )

    expect(write).not.toHaveBeenCalled()
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected blocked result')
    expect(result.response.status).toBe(422)
    await expect(result.response.json()).resolves.toEqual({ error: 'blocked' })
  })
})
