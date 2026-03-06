import type { EntityManager } from '@mikro-orm/postgresql'
import { emitSecurityEvent } from '../../events'
import { MfaProviderRegistry } from '../../lib/mfa-provider-registry'
import type { MfaProviderInterface } from '../../lib/mfa-provider-interface'
import { MfaVerificationService } from '../MfaVerificationService'

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

function createServiceContext() {
  const methods = [
    {
      id: 'method-1',
      userId: 'user-1',
      tenantId: 'tenant-1',
      type: 'totp',
      isActive: true,
      providerMetadata: { secret: 'SECRET' },
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
      verifiedAt: null,
    })),
    persist: jest.fn((challenge: (typeof challenges)[number]) => {
      challenges.push(challenge)
    }),
    flush: jest.fn().mockResolvedValue(undefined),
    find: jest.fn(async () => methods),
    findOne: jest.fn(async (_entity: unknown, query: Record<string, unknown>) => {
      if ('id' in query && !('userId' in query)) {
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

  const service = new MfaVerificationService(
    em as unknown as EntityManager,
    registry,
    mfaService as never,
  )

  return { service, em, registry, provider, mfaService, methods, challenges }
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

  test('verifyChallenge marks challenge verified and emits event', async () => {
    const { service, challenges, methods } = createServiceContext()
    const created = await service.createChallenge('user-1')

    await service.prepareChallenge(created.challengeId, 'totp')
    const verified = await service.verifyChallenge(created.challengeId, 'totp', { code: '123456' })

    expect(verified).toBe(true)
    expect(challenges[0].verifiedAt).toBeInstanceOf(Date)
    expect(challenges[0].methodType).toBe('totp')
    expect(methods[0].lastUsedAt).toBeInstanceOf(Date)
    expect(mockedEmitSecurityEvent).toHaveBeenCalledWith('security.mfa.verified', {
      userId: 'user-1',
      challengeId: 'challenge-1',
      methodType: 'totp',
    })
  })

  test('verifyRecoveryCode delegates to MfaService', async () => {
    const { service, mfaService } = createServiceContext()

    const result = await service.verifyRecoveryCode('user-1', 'AABBCCDDEE')

    expect(result).toBe(true)
    expect(mfaService.verifyRecoveryCode).toHaveBeenCalledWith('user-1', 'AABBCCDDEE')
  })
})
