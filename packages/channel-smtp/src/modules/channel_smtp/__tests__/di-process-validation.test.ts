import { createContainer } from 'awilix'
import { getProcessDiRegistrar, runProcessActivations } from '@open-mercato/shared/lib/di/process-registrar'
import { hasChannelAdapter } from '@open-mercato/core/modules/communication_channels/lib/adapter-registry-singleton'
import { registerSmtpSystemEmailConfigResolver } from '../lib/system-email-config'
import { register } from '../di'

jest.mock('../lib/adapter', () => ({
  getSmtpChannelAdapter: () => ({
    providerKey: 'smtp', channelType: 'email', capabilities: { reactions: true },
  }),
}))
jest.mock('../lib/system-email-config', () => ({ registerSmtpSystemEmailConfigResolver: jest.fn() }))
jest.mock('../lib/health', () => ({ channelSmtpHealthCheck: jest.fn() }))

test('rejects invalid channel capabilities before publishing the system email resolver', () => {
  const registryKey = Symbol.for('@open-mercato/communication-channels/adapter-registry')
  const host = globalThis as unknown as Record<symbol, unknown>
  const previous = host[registryKey]
  delete host[registryKey]
  try {
    const root = createContainer()
    getProcessDiRegistrar(register)!(root)
    expect(() => runProcessActivations(root)).toThrow('does not implement sendReaction')
    expect(registerSmtpSystemEmailConfigResolver).not.toHaveBeenCalled()
    expect(hasChannelAdapter('smtp')).toBe(false)
  } finally {
    if (previous === undefined) delete host[registryKey]
    else host[registryKey] = previous
  }
})
