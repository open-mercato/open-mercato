import { asFunction, asValue, createContainer } from 'awilix'
import { resolveMessageChannelThreadAccess } from '../channelThreadAccess'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({ getTelemetryRuntime: jest.fn() }))
const getTelemetryRuntimeMock = jest.mocked(getTelemetryRuntime)
const reportErrorMock = jest.fn()

const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }
const reference = { messageThreadId: 'thread-1' }
const actor = { userId: 'user-1', features: ['messages.*'] }
const serviceName = 'communicationChannelsResolveChannelThreadAccess'
const strictOptions = { throwOnError: true }

describe('resolveMessageChannelThreadAccess', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    getTelemetryRuntimeMock.mockReturnValue({ reportError: reportErrorMock } as never)
  })
  it('preserves an uninstalled optional hub in strict mode', async () => {
    await expect(resolveMessageChannelThreadAccess(
      createContainer(), scope, reference, actor, strictOptions,
    )).resolves.toBeNull()
  })

  it('forwards strict mode to the hub without changing resolved data', async () => {
    const access = {
      messageThreadId: 'thread-1', externalConversationId: 'conversation-1',
      channelId: 'channel-1', channelType: 'email', canAccess: true,
    }
    const service = jest.fn(async () => access)
    const container = createContainer().register(serviceName, asValue(service))

    await expect(resolveMessageChannelThreadAccess(
      container, scope, reference, actor, strictOptions,
    )).resolves.toBe(access)
    expect(service).toHaveBeenCalledWith(container, scope, reference, actor, strictOptions)
  })

  it('preserves four-argument service calls when strict mode is omitted', async () => {
    const service = jest.fn(async () => null)
    const container = createContainer().register(serviceName, asValue(service))

    await expect(resolveMessageChannelThreadAccess(container, scope, reference, actor)).resolves.toBeNull()
    expect(service).toHaveBeenCalledWith(container, scope, reference, actor)
  })

  it.each([false, true])('propagates service failures (synchronous: %s) in strict mode', async (synchronous) => {
    const error = new Error('lookup unavailable')
    const service = synchronous
      ? () => { throw error }
      : () => Promise.reject(error)
    const container = createContainer().register(serviceName, asValue(service))

    await expect(resolveMessageChannelThreadAccess(
      container, scope, reference, actor, strictOptions,
    )).rejects.toBe(error)
    expect(reportErrorMock).toHaveBeenCalledWith(error, {
      module: 'messages', code: 'messages.channel_thread_lookup_failed',
    })
  })

  it('preserves the lookup error when telemetry fails', async () => {
    const error = new Error('lookup unavailable')
    reportErrorMock.mockImplementationOnce(() => { throw new Error('telemetry unavailable') })
    const container = createContainer().register(serviceName, asValue(() => Promise.reject(error)))

    await expect(resolveMessageChannelThreadAccess(
      container, scope, reference, actor, strictOptions,
    )).rejects.toBe(error)
  })

  it('distinguishes a registered resolver construction error from an absent hub', async () => {
    const error = new Error('resolver unavailable')
    const container = createContainer().register(serviceName, asFunction(() => { throw error }))

    await expect(resolveMessageChannelThreadAccess(
      container, scope, reference, actor, strictOptions,
    )).rejects.toBe(error)
    await expect(resolveMessageChannelThreadAccess(container, scope, reference, actor)).resolves.toBeNull()
  })

  it('does not resolve the hub for an empty reference', async () => {
    const service = jest.fn(async () => null)
    const container = createContainer().register(serviceName, asValue(service))

    await expect(resolveMessageChannelThreadAccess(container, scope, {}, actor, strictOptions)).resolves.toBeNull()
    expect(service).not.toHaveBeenCalled()
  })
})
