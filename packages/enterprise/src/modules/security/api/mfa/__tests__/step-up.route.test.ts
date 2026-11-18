import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { MfaProviderRegistry } from '../../../lib/mfa-provider-registry'
import type { MfaProviderInterface } from '../../../lib/mfa-provider-interface'
import { OtpEmailProvider } from '../../../lib/providers/OtpEmailProvider'
import { MfaService } from '../../../services/MfaService'
import { emitSecurityEvent } from '../../../events'
import { resolveMfaRequestContext } from '../_shared'
import { PUT } from '../provider/[providername]/route'
import { DELETE } from '../methods/[id]/route'
import { POST as regenerate } from '../recovery-codes/regenerate/route'

jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: jest.fn() }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn() }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback: string) => fallback }),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (em: EntityManager, ...parameters: Parameters<EntityManager['findOne']>) => em.findOne(...parameters),
}))
jest.mock('../_shared', () => ({
  ...jest.requireActual('../_shared'),
  authorizeMfaEnrollmentMutation: jest.fn(async () => null),
  resolveMfaRequestContext: jest.fn(),
}))
jest.mock('../../../events', () => ({ emitSecurityEvent: jest.fn() }))
jest.mock('@open-mercato/shared/lib/email/send', () => ({ sendEmail: jest.fn().mockResolvedValue(undefined) }))

const validateToken = jest.fn()
const checkUserCompliance = jest.fn()
const execute = jest.fn()
const auth = { sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' }
const container = {
  resolve(name: string) {
    if (name === 'sudoChallengeService') return { isProtected: async () => ({ protected: true }), validateToken }
    if (name === 'mfaEnforcementService') return { checkUserCompliance }
    if (name === 'commandBus') return { execute }
    throw new Error(`[internal] Unexpected test dependency: ${name}`)
  },
}

function request(method: string, token?: string) {
  return new Request('https://example.test/api/security/mfa/provider/totp', {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { 'x-sudo-token': token } : {}) },
    ...(method === 'PUT' ? { body: JSON.stringify({ setupId: 'setup-1', payload: { code: '123456' } }) } : {}),
  })
}

function enrollmentContext(activeCount: number) {
  const method = { userId: 'user-1', tenantId: 'tenant-1', type: 'totp', isActive: false, providerMetadata: null }
  const confirmSetup = jest.fn(async () => ({ metadata: {} }))
  const registry = new MfaProviderRegistry()
  registry.register({ type: 'totp', label: 'TOTP', allowMultiple: true, confirmSetup } as unknown as MfaProviderInterface)
  const em = {
    transactional: async (callback: (value: unknown) => Promise<unknown>): Promise<unknown> => callback(em),
    execute: jest.fn(async () => []),
    findOne: jest.fn(async () => method),
    count: jest.fn(async () => activeCount),
    flush: jest.fn(),
  }
  jest.mocked(resolveMfaRequestContext).mockResolvedValue({
    auth, container, mfaService: new MfaService(em as unknown as EntityManager, registry), commandContext: { auth, container },
  } as never)
  return { method, confirmSetup, em }
}

describe('MFA HTTP mutations with real sudo middleware and enrollment service', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.mocked(getAuthFromRequest).mockResolvedValue(auth as never)
    jest.mocked(createRequestContainer).mockResolvedValue(container as never)
    validateToken.mockImplementation(async (token, target, scope) => token === 'valid' && target === 'security.mfa.self.manage' && scope.expectedUserId === auth.sub)
    checkUserCompliance.mockResolvedValue({ enforced: false, compliant: true })
    execute.mockResolvedValue({ result: { ok: true } })
  })

  test.each([undefined, 'invalid', 'token-for-other-target'])('confirmation rejects %s sudo before provider activation', async (token) => {
    const { method, confirmSetup, em } = enrollmentContext(1)
    const response = await PUT(request('PUT', token), { params: Promise.resolve({ providername: 'totp' }) })
    expect(response.status).toBe(403)
    expect((await response.json()).error).toBe('sudo_required')
    expect(method.isActive).toBe(false)
    expect(confirmSetup).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
    expect(emitSecurityEvent).not.toHaveBeenCalled()
  })

  test('valid scoped sudo allows activation inside the enrollment transaction', async () => {
    const { method, confirmSetup, em } = enrollmentContext(1)
    const response = await PUT(request('PUT', 'valid'), { params: Promise.resolve({ providername: 'totp' }) })
    expect(response.status).toBe(200)
    expect(method.isActive).toBe(true)
    expect(confirmSetup).toHaveBeenCalledTimes(1)
    expect(em.execute).toHaveBeenCalledWith(expect.stringContaining('pg_advisory_xact_lock'), expect.any(Array))
    expect(validateToken).toHaveBeenCalledWith('valid', 'security.mfa.self.manage', {
      expectedUserId: 'user-1', tenantId: 'tenant-1', organizationId: 'org-1',
    })
    expect(getAuthFromRequest).not.toHaveBeenCalled()
    expect(createRequestContainer).not.toHaveBeenCalled()
  })

  test('compelled first enrollment works without sudo; existing methods remove that exemption', async () => {
    checkUserCompliance.mockResolvedValue({ enforced: true, compliant: false })
    enrollmentContext(0)
    expect((await PUT(request('PUT'), { params: Promise.resolve({ providername: 'totp' }) })).status).toBe(200)
    enrollmentContext(1)
    expect((await PUT(request('PUT'), { params: Promise.resolve({ providername: 'totp' }) })).status).toBe(403)
  })

  test('real Email OTP confirmation maps a wrong code to 400 without activating, then accepts the sent code', async () => {
    const previousTestMode = process.env.OM_TEST_MODE
    process.env.OM_TEST_MODE = 'true'
    try {
      const provider = new OtpEmailProvider()
      const setup = await provider.setup('user-1', { email: 'owner@example.test' })
      const registry = new MfaProviderRegistry()
      registry.register(provider)
      const { method, em } = enrollmentContext(0)
      method.type = 'otp_email'
      em.findOne.mockImplementation(async (_entity: unknown, query: Record<string, unknown>) => query.isActive === false ? method : null)
      jest.mocked(resolveMfaRequestContext).mockResolvedValue({
        auth, container, commandContext: { auth, container },
        mfaService: new MfaService(em as unknown as EntityManager, registry),
      } as never)
      const confirm = (code: unknown) => PUT(new Request('https://example.test/api/security/mfa/provider/otp_email', {
        method: 'PUT', headers: { 'content-type': 'application/json', 'x-sudo-token': 'valid' },
        body: JSON.stringify({ setupId: setup.setupId, payload: { code, email: 'substituted@example.test' } }),
      }), { params: Promise.resolve({ providername: 'otp_email' }) })
      const wrongCode = setup.clientData.code === '000000' ? '111111' : '000000'
      expect((await confirm(wrongCode)).status).toBe(400)
      expect(method.isActive).toBe(false)
      expect((await confirm(setup.clientData.code)).status).toBe(200)
      expect(method.providerMetadata).toMatchObject({ email: 'owner@example.test' })
    } finally {
      if (previousTestMode === undefined) delete process.env.OM_TEST_MODE
      else process.env.OM_TEST_MODE = previousTestMode
    }
  })

  test.each([false, true])('removal and recovery regeneration require sudo (valid=%s)', async (valid) => {
    enrollmentContext(1)
    const token = valid ? 'valid' : undefined
    const removed = await DELETE(request('DELETE', token), { params: Promise.resolve({ id: '5f9be724-3382-4e44-9039-54fb5b3a0d00' }) })
    const regenerated = await regenerate(request('POST', token))
    expect(removed.status).toBe(valid ? 200 : 403)
    expect(regenerated.status).toBe(valid ? 200 : 403)
    expect(execute).toHaveBeenCalledTimes(valid ? 2 : 0)
  })
})
