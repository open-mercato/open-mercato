import { TOTP } from 'otpauth'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { UserMfaMethod } from '../../data/entities'
import { emitSecurityEvent } from '../../events'
import { PUT } from '../../api/mfa/provider/[providername]/route'
import { MfaService } from '../../services/MfaService'
import { MfaProviderRegistry } from '../mfa-provider-registry'
import { TotpProvider } from '../providers/TotpProvider'
import { defaultSecurityModuleConfig } from '../security-config'
import en from '../../i18n/en.json'
import pl from '../../i18n/pl.json'

let mockLocale: 'en' | 'pl' = 'en'
let mockContainer: { resolve: (name: string) => unknown } | null = null

jest.mock('qrcode', () => ({
  __esModule: true,
  default: { toDataURL: jest.fn(async () => 'data:image/png;base64,test') },
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (key: string, fallback: string) => {
      const dictionary: Record<string, string> = mockLocale === 'pl' ? pl : en
      return dictionary[key] ?? fallback
    },
  }),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: jest.fn() }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: jest.fn() }))
jest.mock('../../events', () => ({ emitSecurityEvent: jest.fn().mockResolvedValue(undefined) }))

type PendingMethod = {
  id: string
  userId: string
  tenantId: string
  organizationId: string | null
  type: string
  label: string | null
  secret: string | null
  secretHash: string | null
  providerMetadata: Record<string, unknown> | null
  isActive: boolean
  deletedAt: Date | null
  updatedAt: Date
}

function buildHarness() {
  const provider = new TotpProvider(defaultSecurityModuleConfig, 'unit-test-setup-secret')
  const registry = new MfaProviderRegistry()
  registry.register(provider)
  const methods: PendingMethod[] = []
  const users = ['user-1', 'user-2'].map((id) => ({ id, tenantId: 'tenant-1', organizationId: null, deletedAt: null }))
  const em = {
    execute: jest.fn(async () => []),
    flush: jest.fn(async () => undefined),
    transactional: jest.fn(async (callback: (manager: unknown) => Promise<unknown>) => callback(em)),
  }
  const service = new MfaService(em as never, registry, defaultSecurityModuleConfig)
  const confirmMethod = jest.spyOn(service, 'confirmMethod')
  mockContainer = {
    resolve: (name: string) => {
      if (name === 'mfaService') return service
      if (name === 'rbacService') return { userHasAllFeatures: async () => true }
      return {}
    },
  }
  jest.mocked(findOneWithDecryption).mockImplementation(async (_em, entity, where) => {
    if (entity === User) {
      const criteria = where as Partial<User>
      return users.find((user) => user.id === criteria.id && user.deletedAt === criteria.deletedAt) ?? null
    }
    if (entity !== UserMfaMethod) return null
    const criteria = where as Partial<PendingMethod> & {
      $or?: Array<{ secretHash: { $in: string[] } } | { secretHash: null; secret: string }>
    }
    return methods.find((method) =>
      method.userId === criteria.userId
      && method.isActive === criteria.isActive
      && (criteria.tenantId === undefined || method.tenantId === criteria.tenantId)
      && (criteria.organizationId === undefined || method.organizationId === criteria.organizationId)
      && (criteria.$or === undefined || criteria.$or.some((condition) => condition.secretHash === null
        ? method.secretHash === null && method.secret === condition.secret
        : method.secretHash !== null && condition.secretHash.$in.includes(method.secretHash)))
      && (criteria.type === undefined || method.type === criteria.type),
    ) ?? null
  })

  async function startSetup(userId: string): Promise<PendingMethod> {
    const setup = await provider.setup(userId, {})
    const method: PendingMethod = {
      id: `method-${methods.length + 1}`,
      userId,
      tenantId: 'tenant-1',
      organizationId: null,
      type: 'totp',
      label: null,
      secret: setup.setupId,
      secretHash: null,
      providerMetadata: null,
      isActive: false,
      deletedAt: null,
      updatedAt: new Date(),
    }
    methods.push(method)
    return method
  }

  return { provider, em, confirmMethod, startSetup }
}

function confirmRequest(setupId: string) {
  const request = new Request('http://localhost/api/security/mfa/provider/totp', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ setupId, payload: { code: '123456' } }),
  })
  return PUT(request, { params: Promise.resolve({ providername: 'totp' }) })
}

describe('TOTP setup confirmation through the PUT route', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-11-19T12:00:00Z'))
    mockLocale = 'en'
    jest.mocked(getAuthFromRequest).mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-1', orgId: null } as never)
    jest.mocked(emitSecurityEvent).mockClear()
  })

  afterEach(() => {
    jest.restoreAllMocks()
    jest.useRealTimers()
  })

  test.each(['en', 'pl'] as const)('rejects an invalid code with a localized 400 in %s and accepts a retry', async (locale) => {
    mockLocale = locale
    const { em, startSetup } = buildHarness()
    const method = await startSetup('user-1')
    jest.spyOn(TOTP.prototype, 'validate').mockReturnValueOnce(null).mockReturnValueOnce(0)

    const rejected = await confirmRequest(method.secret as string)
    const dictionary = locale === 'pl' ? pl : en
    expect(rejected.status).toBe(400)
    await expect(rejected.json()).resolves.toEqual({ error: dictionary['security.api.errors.invalidTotpCode'] })
    expect(method.isActive).toBe(false)
    expect(em.flush).not.toHaveBeenCalled()
    expect(emitSecurityEvent).not.toHaveBeenCalled()

    const accepted = await confirmRequest(method.secret as string)
    expect(accepted.status).toBe(200)
    expect(method.isActive).toBe(true)
    expect(em.flush).toHaveBeenCalledTimes(1)
    expect(emitSecurityEvent).toHaveBeenCalledWith('security.mfa.enrolled', expect.objectContaining({ methodId: method.id }), { tenantId: null, organizationId: null })
  })

  test('returns a localized 404 when the provider no longer holds the setup session', async () => {
    mockLocale = 'pl'
    const { provider, em, startSetup } = buildHarness()
    const method = await startSetup('user-1')
    const validate = jest.spyOn(TOTP.prototype, 'validate')
    jest.spyOn(provider as unknown as { resolveSetup: () => null }, 'resolveSetup').mockReturnValue(null)

    const response = await confirmRequest(method.secret as string)
    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: pl['security.api.errors.totpSetupSessionNotFound'] })
    expect(validate).not.toHaveBeenCalled()
    expect(method.isActive).toBe(false)
    expect(em.flush).not.toHaveBeenCalled()
    expect(emitSecurityEvent).not.toHaveBeenCalled()
  })

  test('returns a localized 400 for an expired setup session', async () => {
    const { em, startSetup } = buildHarness()
    const method = await startSetup('user-1')
    const validate = jest.spyOn(TOTP.prototype, 'validate')
    jest.advanceTimersByTime(defaultSecurityModuleConfig.totp.setupTtlMs + 1)

    const response = await confirmRequest(method.secret as string)
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: en['security.api.errors.totpSetupSessionExpired'] })
    expect(validate).not.toHaveBeenCalled()
    expect(method.isActive).toBe(false)
    expect(em.flush).not.toHaveBeenCalled()
    expect(emitSecurityEvent).not.toHaveBeenCalled()
  })

  test('keeps unexpected provider failures behind a generic 500', async () => {
    const { provider, em, startSetup } = buildHarness()
    const method = await startSetup('user-1')
    jest.spyOn(provider, 'confirmSetup').mockRejectedValue(new Error('Unexpected internal failure'))

    const response = await confirmRequest(method.secret as string)
    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: en['security.api.errors.mfaRequestFailed'] })
    expect(method.isActive).toBe(false)
    expect(em.flush).not.toHaveBeenCalled()
    expect(emitSecurityEvent).not.toHaveBeenCalled()
  })

  test('does not let a user confirm another user\'s pending setup', async () => {
    const { em, startSetup } = buildHarness()
    const otherUsersMethod = await startSetup('user-2')
    const validate = jest.spyOn(TOTP.prototype, 'validate')

    const response = await confirmRequest(otherUsersMethod.secret as string)
    expect(response.status).toBe(404)
    expect(validate).not.toHaveBeenCalled()
    expect(otherUsersMethod.isActive).toBe(false)
    expect(em.flush).not.toHaveBeenCalled()
    expect(emitSecurityEvent).not.toHaveBeenCalled()
  })

  test('rejects unauthenticated requests before reaching the service', async () => {
    const { confirmMethod, startSetup } = buildHarness()
    const method = await startSetup('user-1')
    jest.mocked(getAuthFromRequest).mockResolvedValue(null as never)

    const response = await confirmRequest(method.secret as string)
    expect(response.status).toBe(401)
    expect(confirmMethod).not.toHaveBeenCalled()
    expect(method.isActive).toBe(false)
  })
})
