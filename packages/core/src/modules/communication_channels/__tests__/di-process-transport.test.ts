import { asValue, createContainer } from 'awilix'
import { getProcessDiRegistrar, runProcessActivations } from '@open-mercato/shared/lib/di/process-registrar'
import { runWithRequestScopeContainer } from '@open-mercato/shared/lib/di/request-scope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { clearRegisteredEmailTransportForTests, getRegisteredEmailTransport } from '@open-mercato/shared/lib/email/transport'
import { register } from '../di'
import { sendSystemEmail } from '../lib/system-email'

jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn() }))
jest.mock('../data/entities', () => ({
  CommunicationChannel: class {}, ExternalConversation: class {}, ExternalMessage: class {},
  MessageChannelLink: class {}, ChannelThreadMapping: class {}, MessageReaction: class {},
}))
jest.mock('../lib/adapter-registry-singleton', () => ({ getChannelAdapterRegistry: () => ({}) }))
jest.mock('../lib/test-seed', () => ({ ensureTestSeedAdapterRegistered: jest.fn() }))
jest.mock('../lib/send-as-user', () => ({ sendAsUser: jest.fn() }))
jest.mock('../lib/resolve-channel-type', () => ({ resolveChannelTypeSafely: jest.fn() }))
jest.mock('../lib/channel-thread-access', () => ({ resolveChannelThreadAccessSafely: jest.fn() }))
jest.mock('../lib/system-email', () => ({ sendSystemEmail: jest.fn(), isSystemEmailTransportConfigured: () => true }))

const payload = { to: 'recipient@example.test', subject: 'Scope test', text: 'Message', tenantId: 'tenant', organizationId: 'organization' }

beforeEach(() => {
  clearRegisteredEmailTransportForTests()
  jest.mocked(sendSystemEmail).mockReset()
  jest.mocked(createRequestContainer).mockReset()
})

it('publishes on activation and resolves each concurrent transport call from its own scope', async () => {
  const root = createContainer()
  await getProcessDiRegistrar(register)!(root)
  expect(getRegisteredEmailTransport()).toBeNull()
  runProcessActivations(root)
  const transport = getRegisteredEmailTransport()!
  const first = root.createScope().register({ identity: asValue('first') })
  const second = root.createScope().register({ identity: asValue('second') })
  const seen: string[] = []
  jest.mocked(sendSystemEmail).mockImplementation(async (caller) => {
    await Promise.resolve()
    seen.push(caller.resolve('identity'))
  })
  await Promise.all([
    runWithRequestScopeContainer(first, () => transport.send(payload)),
    runWithRequestScopeContainer(second, () => transport.send(payload)),
  ])
  expect(seen.sort()).toEqual(['first', 'second'])
  expect(createRequestContainer).not.toHaveBeenCalled()
})

it('opens and disposes a caller for an unscoped transport call even on failure', async () => {
  const root = createContainer()
  await getProcessDiRegistrar(register)!(root)
  runProcessActivations(root)
  const caller = root.createScope()
  const dispose = jest.spyOn(caller, 'dispose')
  jest.mocked(createRequestContainer).mockResolvedValue(caller)
  jest.mocked(sendSystemEmail).mockRejectedValue(new Error('send failed'))
  await expect(getRegisteredEmailTransport()!.send(payload)).rejects.toThrow('send failed')
  expect(sendSystemEmail).toHaveBeenCalledWith(caller, payload)
  expect(dispose).toHaveBeenCalledTimes(1)
})

it('retains the legacy transport registration behavior outside root mode', async () => {
  const legacyCaller = createContainer()
  register(legacyCaller)
  await getRegisteredEmailTransport()!.send(payload)
  expect(sendSystemEmail).toHaveBeenCalledWith(legacyCaller, payload)
})
