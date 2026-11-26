import { createHmac } from 'node:crypto'
import { TotpProvider } from '../providers/TotpProvider'
import { PasskeyProvider } from '../providers/PasskeyProvider'
import { defaultSecurityModuleConfig } from '../security-config'
import type { MfaProviderInterface } from '../mfa-provider-interface'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { MfaProviderRegistry } from '../mfa-provider-registry'

const secretVariables = [
  'OM_SECURITY_MFA_SETUP_SECRET',
  'AUTH_JWT_SECRET',
  'AUTH_SECRET',
  'JWT_SECRET',
] as const

const missingSecretMessage = 'Security MFA setup tokens require OM_SECURITY_MFA_SETUP_SECRET, AUTH_JWT_SECRET, AUTH_SECRET, or JWT_SECRET.'
const explicitSecret = 'unit-test-explicit-setup-secret'
const providerFactories: Array<[string, (secret?: string) => MfaProviderInterface]> = [
  ['totp', (secret) => new TotpProvider(defaultSecurityModuleConfig, secret)],
  ['passkey', (secret) => new PasskeyProvider(defaultSecurityModuleConfig, secret)],
]

function expectTokenSignature(token: string, secret: string): void {
  const [payload, signature] = token.split('.')
  expect(signature).toBe(createHmac('sha256', secret).update(payload).digest('base64url'))
}

describe('MFA setup-token secret resolution', () => {
  let originalSecrets: Array<[typeof secretVariables[number], string | undefined]>

  beforeEach(() => {
    originalSecrets = secretVariables.map((name) => [name, process.env[name]])
    for (const name of secretVariables) delete process.env[name]
  })

  afterEach(() => {
    for (const [name, value] of originalSecrets) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })

  test('imports the discovered provider registry without runtime secrets', () => {
    jest.isolateModules(() => {
      const registry = require('../../security.mfa-providers') as typeof import('../../security.mfa-providers')

      expect(registry.mfaProviders.map((provider) => provider.type)).toEqual(['totp', 'passkey', 'otp_email'])
      expect(registry.createDefaultMfaProviders().map((provider) => provider.type)).toEqual(['totp', 'passkey', 'otp_email'])
    })
  })

  test('bootstraps the CLI registrar and resolves MFA providers without runtime secrets', () => {
    jest.isolateModules(() => {
      const { createContainer } = require('awilix') as typeof import('awilix')
      const { register } = require('../../di') as typeof import('../../di')
      const container = createContainer<AppContainer['cradle']>()

      register(container)

      const registry = container.resolve<MfaProviderRegistry>('mfaProviderRegistry')
      expect(registry.listAll().map((provider) => provider.type)).toEqual(['totp', 'passkey', 'otp_email'])
    })
  })

  describe.each(providerFactories)('%s provider', (_type, createProvider) => {
    test('constructs without a setup-token secret', () => {
      expect(() => createProvider()).not.toThrow()
    })

    test('fails closed when signing without a runtime secret', async () => {
      const provider = createProvider()

      await expect(provider.setup('user-1', {})).rejects.toThrow(missingSecretMessage)
    })

    test('fails closed when verifying a setup token without a runtime secret', async () => {
      const setup = await createProvider(explicitSecret).setup('user-1', {})
      const provider = createProvider()

      await expect(provider.confirmSetup('user-1', setup.setupId, { code: '000000', response: {} }))
        .rejects.toThrow(missingSecretMessage)
    })

    test.each(secretVariables)('resolves %s at token use with the existing precedence', async (name) => {
      const provider = createProvider()
      const variableIndex = secretVariables.indexOf(name)
      for (const variable of secretVariables.slice(variableIndex)) {
        process.env[variable] = `unit-test-${variable}`
      }

      const setup = await provider.setup('user-1', {})

      expectTokenSignature(setup.setupId, `unit-test-${name}`)
    })

    test('preserves an explicit secret over environment configuration', async () => {
      process.env.OM_SECURITY_MFA_SETUP_SECRET = 'unit-test-environment-setup-secret'
      const setup = await createProvider(explicitSecret).setup('user-1', {})

      expectTokenSignature(setup.setupId, explicitSecret)
    })
  })
})
