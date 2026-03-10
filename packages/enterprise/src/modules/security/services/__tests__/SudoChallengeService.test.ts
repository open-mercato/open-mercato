import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { getModules } from '@open-mercato/shared/lib/modules/registry'
import { ChallengeMethod, SudoTargetType } from '../../data/entities'
import { SudoChallengeService } from '../SudoChallengeService'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/modules/registry', () => ({
  getModules: jest.fn(),
}))

type ConfigRecord = {
  id: string
  tenantId: string | null
  organizationId: string | null
  targetType: SudoTargetType
  targetIdentifier: string
  isEnabled: boolean
  isDeveloperDefault: boolean
  ttlSeconds: number
  challengeMethod: ChallengeMethod
  configuredBy: string | null
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
}

type SessionRecord = {
  id: string
  userId: string
  tenantId: string
  sessionToken: string
  challengeMethod: string
  expiresAt: Date
  createdAt: Date
}

const mockedFindOneWithDecryption = findOneWithDecryption as jest.MockedFunction<typeof findOneWithDecryption>
const mockedGetModules = getModules as jest.MockedFunction<typeof getModules>

function createServiceContext() {
  const configs: ConfigRecord[] = []
  const sessions: SessionRecord[] = []

  const em = {
    create: jest.fn((entity: unknown, data: Record<string, unknown>) => {
      if (entity === expect.anything()) return data
      if ('targetIdentifier' in data) {
        return {
          id: data.id ?? `config-${configs.length + 1}`,
          tenantId: (data.tenantId as string | null | undefined) ?? null,
          organizationId: (data.organizationId as string | null | undefined) ?? null,
          targetType: data.targetType as SudoTargetType,
          targetIdentifier: String(data.targetIdentifier),
          isEnabled: Boolean(data.isEnabled),
          isDeveloperDefault: Boolean(data.isDeveloperDefault),
          ttlSeconds: Number(data.ttlSeconds),
          challengeMethod: data.challengeMethod as ChallengeMethod,
          configuredBy: (data.configuredBy as string | null | undefined) ?? null,
          createdAt: (data.createdAt as Date | undefined) ?? new Date(),
          updatedAt: (data.updatedAt as Date | undefined) ?? new Date(),
          deletedAt: (data.deletedAt as Date | null | undefined) ?? null,
        }
      }

      return {
        id: `session-${sessions.length + 1}`,
        userId: String(data.userId),
        tenantId: String(data.tenantId),
        sessionToken: String(data.sessionToken),
        challengeMethod: String(data.challengeMethod),
        expiresAt: data.expiresAt as Date,
        createdAt: (data.createdAt as Date | undefined) ?? new Date(),
      }
    }),
    persist: jest.fn((record: ConfigRecord | SessionRecord) => {
      if ('targetIdentifier' in record) configs.push(record)
      else sessions.push(record)
    }),
    flush: jest.fn().mockResolvedValue(undefined),
    find: jest.fn(async (_entity: unknown, query: Record<string, unknown>) => {
      if ('targetIdentifier' in query) {
        return configs.filter((config) =>
          config.targetType === query.targetType
          && config.targetIdentifier === query.targetIdentifier
          && config.deletedAt === query.deletedAt,
        )
      }
      return []
    }),
    findOne: jest.fn(async (_entity: unknown, query: Record<string, unknown>) => {
      if ('targetIdentifier' in query) {
        return configs.find((config) =>
          config.targetType === query.targetType
          && config.targetIdentifier === query.targetIdentifier
          && config.tenantId === (query.tenantId as string | null | undefined)
          && config.organizationId === (query.organizationId as string | null | undefined)
          && config.isDeveloperDefault === query.isDeveloperDefault
          && (query.deletedAt === undefined || config.deletedAt === query.deletedAt)
        ) ?? null
      }
      if ('sessionToken' in query || 'id' in query) {
        return sessions.find((session) => {
          if (query.id !== undefined && session.id !== query.id) return false
          if (query.userId !== undefined && session.userId !== query.userId) return false
          if (query.sessionToken !== undefined && session.sessionToken !== query.sessionToken) return false
          return true
        }) ?? null
      }
      return null
    }),
    nativeDelete: jest.fn(async () => 0),
  }

  const passwordService = {
    verifyPassword: jest.fn(async () => true),
  }

  const mfaService = {
    getUserMethods: jest.fn(async () => []),
  }

  const mfaVerificationService = {
    createChallenge: jest.fn(async () => ({
      challengeId: 'mfa-challenge-1',
      availableMethods: [{ type: 'totp', label: 'Authenticator app', icon: 'Smartphone' }],
    })),
    prepareChallenge: jest.fn(async () => ({ clientData: { codeSent: true } })),
    verifyChallenge: jest.fn(async () => true),
  }

  const service = new SudoChallengeService(
    em as unknown as EntityManager,
    passwordService as never,
    mfaService as never,
    mfaVerificationService as never,
  )

  return { service, configs, sessions, passwordService, mfaService, mfaVerificationService }
}

describe('SudoChallengeService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockedFindOneWithDecryption.mockResolvedValue({
      id: 'user-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      deletedAt: null,
    } as never)
    mockedGetModules.mockReturnValue([
      {
        id: 'security',
        setup: {
          sudoProtected: [
            {
              type: 'feature',
              identifier: 'security.sudo.manage',
              ttlSeconds: 300,
              challengeMethod: 'auto',
            },
          ],
        },
      },
    ] as never)
  })

  test('registers developer defaults on demand and resolves protection', async () => {
    const { service, configs } = createServiceContext()

    const result = await service.isProtected(SudoTargetType.FEATURE, 'security.sudo.manage', 'tenant-1', 'org-1')

    expect(result.protected).toBe(true)
    expect(configs).toHaveLength(1)
    expect(configs[0].isDeveloperDefault).toBe(true)
  })

  test('initiates password sudo challenge when no MFA methods exist', async () => {
    const { service, sessions } = createServiceContext()

    const result = await service.initiate('user-1', 'security.sudo.manage', {
      targetType: SudoTargetType.FEATURE,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })

    expect(result.required).toBe(true)
    expect(result.method).toBe('password')
    expect(sessions).toHaveLength(1)
  })

  test('verifies an MFA sudo challenge and validates the signed token', async () => {
    const { service, sessions, mfaService, mfaVerificationService } = createServiceContext()
    mfaService.getUserMethods.mockResolvedValueOnce([{ id: 'method-1' }])

    const initiated = await service.initiate('user-1', 'security.sudo.manage', {
      targetType: SudoTargetType.FEATURE,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })

    expect(initiated.method).toBe('mfa')
    expect(mfaVerificationService.createChallenge).toHaveBeenCalled()

    const verified = await service.verify(
      initiated.sessionId!,
      'totp',
      { code: '123456' },
      {
        targetType: SudoTargetType.FEATURE,
        targetIdentifier: 'security.sudo.manage',
      },
    )

    expect(verified.sudoToken).toBeTruthy()
    expect(sessions[0].sessionToken).toBe(verified.sudoToken)
    await expect(service.validateToken(verified.sudoToken, 'security.sudo.manage', {
      targetType: SudoTargetType.FEATURE,
      expectedUserId: 'user-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })).resolves.toBe(true)
  })
})
