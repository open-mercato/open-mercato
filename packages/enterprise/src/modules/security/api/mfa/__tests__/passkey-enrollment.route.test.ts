import type { EntityManager } from '@mikro-orm/postgresql'
import { generateRegistrationOptions, verifyRegistrationResponse } from '@simplewebauthn/server'
import { emitSecurityEvent } from '../../../events'
import { MfaProviderRegistry } from '../../../lib/mfa-provider-registry'
import { PasskeyProvider } from '../../../lib/providers/PasskeyProvider'
import { defaultSecurityModuleConfig } from '../../../lib/security-config'
import { MfaService } from '../../../services/MfaService'
import { resolveMfaRequestContext } from '../_shared'
import { PUT } from '../provider/[providername]/route'

jest.mock('../_shared', () => ({
  ...jest.requireActual('../_shared'),
  authorizeMfaEnrollmentMutation: jest.fn(async () => null),
  resolveMfaRequestContext: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({ translate: (_key: string, fallback: string) => fallback })),
}))

jest.mock('../../../events', () => ({ emitSecurityEvent: jest.fn() }))

jest.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: jest.fn(),
  verifyRegistrationResponse: jest.fn(),
}))

describe('passkey enrollment route with the real service and provider', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.mocked(generateRegistrationOptions).mockResolvedValue({ challenge: 'current-challenge' } as never)
  })

  test.each([
    { credentialId: 'unverified-key', publicKey: 'AQIDBA', challenge: 'current-challenge' },
    {},
    { response: null },
    { response: [] },
  ])('returns 400 without activating a passkey for %j', async (payload) => {
    const provider = new PasskeyProvider(defaultSecurityModuleConfig, 'test-passkey-setup-secret')
    const setup = await provider.setup('user-1', {})
    const method = {
      id: 'method-1', userId: 'user-1', tenantId: 'tenant-1', organizationId: 'org-1',
      type: 'passkey', secret: setup.setupId, label: null, providerMetadata: null,
      isActive: false, deletedAt: null, updatedAt: new Date(),
    }
    const pending = { ...method }
    const em = {
      findOne: jest.fn(async (_entity: unknown, query: Record<string, unknown>) => query.secret === setup.setupId ? method : null),
      flush: jest.fn(),
    }
    const registry = new MfaProviderRegistry()
    registry.register(provider)
    const service = new MfaService(em as unknown as EntityManager, registry, defaultSecurityModuleConfig)
    jest.mocked(resolveMfaRequestContext).mockResolvedValue({
      auth: { sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' },
      mfaService: service,
    } as never)

    const response = await PUT(new Request('http://localhost/api/security/mfa/provider/passkey', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ setupId: setup.setupId, payload }),
    }), { params: Promise.resolve({ providername: 'passkey' }) })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid payload.' })
    expect(method).toEqual(pending)
    expect(em.flush).not.toHaveBeenCalled()
    expect(emitSecurityEvent).not.toHaveBeenCalled()
    expect(verifyRegistrationResponse).not.toHaveBeenCalled()
  })
})
