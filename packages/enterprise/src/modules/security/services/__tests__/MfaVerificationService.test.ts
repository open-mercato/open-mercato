import type { EntityManager } from '@mikro-orm/postgresql'
import { emitSecurityEvent } from '../../events'
import { MfaProviderRegistry } from '../../lib/mfa-provider-registry'
import type { MfaProviderInterface } from '../../lib/mfa-provider-interface'
import {
  defaultSecurityModuleConfig,
  type SecurityModuleConfig,
} from '../../lib/security-config'
import { MfaVerificationService } from '../MfaVerificationService'
import type { MfaEnforcementService } from '../MfaEnforcementService'

jest.mock('../../events', () => ({
  emitSecurityEvent: jest.fn().mockResolvedValue(undefined),
}))

function createProvider(overrides?: Partial<MfaProviderInterface>): MfaProviderInterface {
  return {
    type: 'totp',
    label: 'Authenticator App',
    icon: 'Smartphone',
    allowMultiple: true,
    setupSchema: { parse: (value: unknown) => value } as never,
    verifySchema: { parse: (value: unknown) => value } as never,
    setup: jest.fn(async () => ({ setupId: 'setup-1', clientData: {} })),
    confirmSetup: jest.fn(async () => ({ metadata: {} })),
    prepareChallenge: jest.fn(async () => ({ clientData: { sent: true } })),
    verify: jest.fn(async () => true),
    ...overrides,
  }
}

function createServiceContext(
  securityConfig: SecurityModuleConfig = defaultSecurityModuleConfig,
) {
  const methods = [
    {
      id: 'method-1',
      userId: 'user-1',
      tenantId: 'tenant-1',
      type: 'totp',
      isActive: true,
      secret: 'SECRET',
      providerMetadata: {},
      deletedAt: null,
      createdAt: new Date(),
      lastUsedAt: null,
    },
  ]

  const challenges: Array<{
    id: string
    userId: string
    tenantId: string
    attempts: number
    expiresAt: Date
    methodType?: string | null
    methodId?: string | null
    providerChallenge?: Record<string, unknown> | null
    verifiedAt?: Date | null
  }> = []

  const em = {
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({
      id: `challenge-${challenges.length + 1}`,
      userId: String(data.userId),
      tenantId: String(data.tenantId),
      attempts: Number(data.attempts ?? 0),
      expiresAt: data.expiresAt as Date,
      methodType: null,
      methodId: null,
      providerChallenge: null,
      verifiedAt: null,
    })),
    persist: jest.fn((challenge: (typeof challenges)[number]) => {
      challenges.push(challenge)
    }),
    flush: jest.fn().mockResolvedValue(undefined),
    find: jest.fn(async () => methods),
    findOne: jest.fn(async (_entity: unknown, query: Record<string, unknown>) => {
      if ('id' in query && 'userId' in query) {
        return methods.find(
          (item) =>
            item.id === query.id &&
            item.userId === query.userId &&
            item.isActive === query.isActive &&
            item.deletedAt === query.deletedAt,
        ) ?? null
      }
      if ('id' in query && !('type' in query)) {
        return challenges.find((item) => item.id === query.id) ?? null
      }
      return methods.find(
        (item) =>
          item.userId === query.userId &&
          item.type === query.type &&
          item.isActive === query.isActive &&
          item.deletedAt === query.deletedAt,
      ) ?? null
    }),
  }

  const registry = new MfaProviderRegistry()
  const provider = createProvider()
  registry.register(provider)

  const mfaService = {
    verifyRecoveryCode: jest.fn(async () => true),
  }

  const mfaEnforcementService = {
    getEffectivePolicyForUser: jest.fn(async () => null),
  }

  const service = new MfaVerificationService(
    em as unknown as EntityManager,
    registry,
    mfaService as never,
    mfaEnforcementService as unknown as MfaEnforcementService,
    securityConfig,
  )

  return { service, em, registry, provider, mfaService, mfaEnforcementService, methods, challenges }
}

const mockedEmitSecurityEvent = emitSecurityEvent as jest.MockedFunction<typeof emitSecurityEvent>

describe('MfaVerificationService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('createChallenge returns available methods and persists a challenge', async () => {
    const { service, challenges } = createServiceContext()

    const result = await service.createChallenge('user-1')

    expect(result.challengeId).toBe('challenge-1')
    expect(result.availableMethods).toEqual([
      { type: 'totp', label: 'Authenticator App', icon: 'Smartphone' },
    ])
    expect(challenges).toHaveLength(1)
  })

  test('createChallenge rejects when no active methods exist', async () => {
    const { service, em } = createServiceContext()
    em.find.mockResolvedValueOnce([])

    await expect(service.createChallenge('user-1')).rejects.toMatchObject({
      name: 'MfaVerificationServiceError',
      statusCode: 400,
      message: 'No MFA methods configured',
    })
  })

  test('createChallenge rejects when configured methods reference no registered providers', async () => {
    const { service, em } = createServiceContext()
    em.find.mockResolvedValueOnce([{
      id: 'method-unknown',
      userId: 'user-1',
      tenantId: 'tenant-1',
      type: 'hardware_token',
      isActive: true,
      providerMetadata: {},
      deletedAt: null,
      createdAt: new Date(),
      lastUsedAt: null,
    }])

    await expect(service.createChallenge('user-1')).rejects.toMatchObject({
      name: 'MfaVerificationServiceError',
      statusCode: 400,
      message: 'No registered MFA providers are available for the configured methods',
    })
  })

  test('createChallenge filters out methods disallowed by the active enforcement policy', async () => {
    const { service, mfaEnforcementService, methods } = createServiceContext()
    methods.push({
      id: 'method-2',
      userId: 'user-1',
      tenantId: 'tenant-1',
      type: 'passkey',
      isActive: true,
      providerMetadata: {},
      deletedAt: null,
      createdAt: new Date(),
      lastUsedAt: null,
    })
    mfaEnforcementService.getEffectivePolicyForUser.mockResolvedValueOnce({
      id: 'policy-1',
      isEnforced: true,
      allowedMethods: ['totp'],
    })

    const result = await service.createChallenge('user-1')

    expect(result.availableMethods).toEqual([
      { type: 'totp', label: 'Authenticator App', icon: 'Smartphone' },
    ])
  })

  test('prepareChallenge persists provider verification context on the challenge', async () => {
    const { service, challenges, registry } = createServiceContext()
    const provider = registry.get('totp')
    if (!provider) {
      throw new Error('Expected TOTP provider to be registered')
    }
    provider.prepareChallenge = jest.fn(async () => ({
      clientData: { sent: true },
      verifyContext: { challenge: { nonce: 'challenge-nonce' } },
    }))

    const created = await service.createChallenge('user-1')
    const result = await service.prepareChallenge(created.challengeId, 'totp')

    expect(result).toEqual({ clientData: { sent: true }, verifyContext: { challenge: { nonce: 'challenge-nonce' } } })
    expect(challenges[0].methodType).toBe('totp')
    expect(challenges[0].providerChallenge).toEqual({ nonce: 'challenge-nonce' })
  })

  test('verifyChallenge marks challenge verified and emits event', async () => {
    const { service, challenges, methods } = createServiceContext()
    const created = await service.createChallenge('user-1')

    await service.prepareChallenge(created.challengeId, 'totp')
    const verified = await service.verifyChallenge(created.challengeId, 'totp', { code: '123456' })

    expect(verified).toBe(true)
    expect(challenges[0].verifiedAt).toBeInstanceOf(Date)
    expect(challenges[0].methodType).toBe('totp')
    expect(challenges[0].methodId).toBe('method-1')
    expect(methods[0].lastUsedAt).toBeInstanceOf(Date)
    expect(mockedEmitSecurityEvent).toHaveBeenCalledWith('security.mfa.verified', {
      userId: 'user-1',
      challengeId: 'challenge-1',
      methodType: 'totp',
    })
  })

  test('verifyChallenge increments attempts when method type changes mid-challenge', async () => {
    const { service, challenges } = createServiceContext()
    const created = await service.createChallenge('user-1')

    await service.prepareChallenge(created.challengeId, 'totp')
    const verified = await service.verifyChallenge(created.challengeId, 'passkey', { code: '123456' })

    expect(verified).toBe(false)
    expect(challenges[0].attempts).toBe(1)
  })

  test('verifyChallenge expires the challenge after the maximum attempts', async () => {
    const { service, challenges, registry } = createServiceContext()
    const provider = registry.get('totp')
    if (!provider) {
      throw new Error('Expected TOTP provider to be registered')
    }
    provider.verify = jest.fn(async () => false)
    const created = await service.createChallenge('user-1')

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await service.verifyChallenge(created.challengeId, 'totp', { code: '000000' })
    }

    expect(challenges[0].attempts).toBe(5)
    expect(challenges[0].expiresAt.getTime()).toBeLessThanOrEqual(Date.now())
  })

  test('verifyChallenge uses the configured max attempts limit', async () => {
    const { service, challenges, registry } = createServiceContext({
      ...defaultSecurityModuleConfig,
      mfa: {
        ...defaultSecurityModuleConfig.mfa,
        maxAttempts: 2,
      },
    })
    const provider = registry.get('totp')
    if (!provider) {
      throw new Error('Expected TOTP provider to be registered')
    }
    provider.verify = jest.fn(async () => false)
    const created = await service.createChallenge('user-1')

    await service.verifyChallenge(created.challengeId, 'totp', { code: '000000' })
    await service.verifyChallenge(created.challengeId, 'totp', { code: '000000' })

    expect(challenges[0].attempts).toBe(2)
    expect(challenges[0].expiresAt.getTime()).toBeLessThanOrEqual(Date.now())
  })

  test('verifyChallenge rejects already verified challenges', async () => {
    const { service, challenges } = createServiceContext()
    const created = await service.createChallenge('user-1')
    challenges[0].verifiedAt = new Date()

    await expect(service.verifyChallenge(created.challengeId, 'totp', { code: '123456' })).rejects.toMatchObject({
      name: 'MfaVerificationServiceError',
      statusCode: 400,
      message: 'MFA challenge already verified',
    })
  })

  test('verifyRecoveryCode delegates to MfaService', async () => {
    const { service, mfaService } = createServiceContext()

    const result = await service.verifyRecoveryCode('user-1', 'AABBCCDDEE')

    expect(result).toBe(true)
    expect(mfaService.verifyRecoveryCode).toHaveBeenCalledWith('user-1', 'AABBCCDDEE')
  })
})
