import type { AwilixContainer } from 'awilix'
import { registerMutationGuards } from '@open-mercato/shared/lib/crud/mutation-guard-store'
import type { MutationGuard } from '@open-mercato/shared/lib/crud/mutation-guard-registry'
import { validateRouteMutationGuard } from '../route-mutation-guard'

function makeContainer(registrations: Record<string, unknown> = {}): AwilixContainer {
  return {
    resolve: (name: string) => {
      if (Object.prototype.hasOwnProperty.call(registrations, name)) return registrations[name]
      throw new Error(`[test] no registration for ${name}`)
    },
  } as unknown as AwilixContainer
}

function makeRequest(method = 'POST'): Request {
  return new Request('https://example.test/api/communication_channels/channels/chan-1/set-primary', { method })
}

const auth = { sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' }

afterEach(() => {
  registerMutationGuards([])
  jest.restoreAllMocks()
})

describe('communication_channels validateRouteMutationGuard', () => {
  it('routes a custom write through the full registry and blocks when a channel guard rejects', async () => {
    const guard: MutationGuard = {
      id: 'channel-guard',
      targetEntity: 'communication_channels.channel',
      operations: ['update', 'delete'],
      validate: jest.fn().mockResolvedValue({ ok: false, status: 422, body: { error: 'channel blocked' } }),
    }
    registerMutationGuards([{ moduleId: 'communication_channels', guards: [guard] }])

    const result = await validateRouteMutationGuard({
      container: makeContainer(),
      req: makeRequest(),
      auth,
      input: { resourceKind: 'communication_channels.channel', resourceId: 'chan-1', operation: 'custom' },
    })

    expect('response' in result).toBe(true)
    if (!('response' in result)) throw new Error('expected blocked response')
    expect(result.response.status).toBe(422)
    // proves the 'custom' operation was mapped to 'update' so the guard matched
    expect(guard.validate).toHaveBeenCalledTimes(1)
  })

  it('returns an afterSuccess runner that fires registry afterSuccess on success', async () => {
    const afterSuccess = jest.fn().mockResolvedValue(undefined)
    const guard: MutationGuard = {
      id: 'channel-after-guard',
      targetEntity: 'communication_channels.channel',
      operations: ['update'],
      validate: jest.fn().mockResolvedValue({ ok: true, shouldRunAfterSuccess: true }),
      afterSuccess,
    }
    registerMutationGuards([{ moduleId: 'communication_channels', guards: [guard] }])

    const result = await validateRouteMutationGuard({
      container: makeContainer(),
      req: makeRequest(),
      auth,
      input: { resourceKind: 'communication_channels.channel', resourceId: 'chan-1', operation: 'custom' },
    })

    expect('response' in result).toBe(false)
    if ('response' in result) throw new Error('expected passed result')
    await result.afterSuccess()
    expect(afterSuccess).toHaveBeenCalledTimes(1)
  })

  it('short-circuits to a no-op when auth is incomplete', async () => {
    const guard: MutationGuard = {
      id: 'never-runs',
      targetEntity: 'communication_channels.channel',
      operations: ['update'],
      validate: jest.fn().mockResolvedValue({ ok: false }),
    }
    registerMutationGuards([{ moduleId: 'communication_channels', guards: [guard] }])

    const result = await validateRouteMutationGuard({
      container: makeContainer(),
      req: makeRequest(),
      auth: { sub: null, tenantId: null },
      input: { resourceKind: 'communication_channels.channel', resourceId: 'chan-1', operation: 'custom' },
    })

    expect('response' in result).toBe(false)
    if ('response' in result) throw new Error('expected no-op result')
    await expect(result.afterSuccess()).resolves.toBeUndefined()
    expect(guard.validate).not.toHaveBeenCalled()
  })
})
