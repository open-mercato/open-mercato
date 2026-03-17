import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { ChallengeMethod } from '../../data/entities'
import { registerSecuritySudoTargetEntries } from '../../lib/module-security-registry'
import {
  defaultSecurityModuleConfig,
  type SecurityModuleConfig,
} from '../../lib/security-config'
import { SudoChallengeService } from '../SudoChallengeService'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))

type ConfigRecord = {
  id: string
  tenantId: string | null
  organizationId: string | null
  label: string | null
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

function createServiceContext(
  securityConfig: SecurityModuleConfig = defaultSecurityModuleConfig,
) {
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
          label: (data.label as string | null | undefined) ?? null,
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
          config.targetIdentifier === query.targetIdentifier
          && config.deletedAt === query.deletedAt,
        )
      }
      return []
    }),
    findOne: jest.fn(async (_entity: unknown, query: Record<string, unknown>) => {
      if ('targetIdentifier' in query) {
        return configs.find((config) =>
          config.targetIdentifier === query.targetIdentifier
          && config.tenantId === (query.tenantId as string | null | undefined)
          && config.organizationId === (query.organizationId as string | null | undefined)
          && (query.isDeveloperDefault === undefined || config.isDeveloperDefault === query.isDeveloperDefault)
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
    securityConfig,
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
    registerSecuritySudoTargetEntries([
      {
        moduleId: 'security',
        targets: [
          {
            type: 'feature',
            identifier: 'security.sudo.manage',
            ttlSeconds: 300,
            challengeMethod: 'auto',
          },
        ],
      },
    ])
  })

  test('registers developer defaults on demand and resolves protection', async () => {
    const { service, configs } = createServiceContext()

    const result = await service.isProtected('security.sudo.manage', 'tenant-1', 'org-1')

    expect(result.protected).toBe(true)
    expect(configs).toHaveLength(1)
    expect(configs[0].isDeveloperDefault).toBe(true)
  })

  test('initiates password sudo challenge when no MFA methods exist', async () => {
    const { service, sessions } = createServiceContext()

    const result = await service.initiate('user-1', 'security.sudo.manage', {
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
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })

    expect(initiated.method).toBe('mfa')
    expect(mfaVerificationService.createChallenge).toHaveBeenCalled()

    const verified = await service.verify(
      initiated.sessionId!,
      'totp',
      { code: '123456' },
      { targetIdentifier: 'security.sudo.manage' },
    )

    expect(verified.sudoToken).toBeTruthy()
    expect(sessions[0].sessionToken).toBe(verified.sudoToken)
    await expect(service.validateToken(verified.sudoToken, 'security.sudo.manage', {
      expectedUserId: 'user-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })).resolves.toBe(true)
  })

  test('signs sudo tokens with the active request scope when it differs from the stored user scope', async () => {
    const { service, mfaService } = createServiceContext()
    mfaService.getUserMethods.mockResolvedValueOnce([{ id: 'method-1' }])

    const initiated = await service.initiate('user-1', 'security.sudo.manage', {
      tenantId: 'tenant-override',
      organizationId: 'org-override',
    })

    const verified = await service.verify(
      initiated.sessionId!,
      'totp',
      { code: '123456' },
      {
        expectedUserId: 'user-1',
        tenantId: 'tenant-override',
        organizationId: 'org-override',
        targetIdentifier: 'security.sudo.manage',
      },
    )

    await expect(service.validateToken(verified.sudoToken, 'security.sudo.manage', {
      expectedUserId: 'user-1',
      tenantId: 'tenant-override',
      organizationId: 'org-override',
    })).resolves.toBe(true)

    await expect(service.validateToken(verified.sudoToken, 'security.sudo.manage', {
      expectedUserId: 'user-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })).resolves.toBe(false)
  })

  test('preserves explicit null request scope when signing sudo tokens', async () => {
    const { service, mfaService } = createServiceContext()
    mfaService.getUserMethods.mockResolvedValueOnce([{ id: 'method-1' }])

    const initiated = await service.initiate('user-1', 'security.sudo.manage', {
      tenantId: null,
      organizationId: null,
    })

    const verified = await service.verify(
      initiated.sessionId!,
      'totp',
      { code: '123456' },
      {
        expectedUserId: 'user-1',
        tenantId: null,
        organizationId: null,
        targetIdentifier: 'security.sudo.manage',
      },
    )

    await expect(service.validateToken(verified.sudoToken, 'security.sudo.manage', {
      expectedUserId: 'user-1',
      tenantId: null,
      organizationId: null,
    })).resolves.toBe(true)

    await expect(service.validateToken(verified.sudoToken, 'security.sudo.manage', {
      expectedUserId: 'user-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })).resolves.toBe(false)
  })

  test('falls back to password when MFA emergency bypass is enabled', async () => {
    const { service, mfaService, mfaVerificationService } = createServiceContext({
      ...defaultSecurityModuleConfig,
      mfa: {
        ...defaultSecurityModuleConfig.mfa,
        emergencyBypass: true,
      },
    })
    mfaService.getUserMethods.mockResolvedValueOnce([{ id: 'method-1' }])

    const result = await service.initiate('user-1', 'security.sudo.manage', {
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })

    expect(result.method).toBe('password')
    expect(mfaVerificationService.createChallenge).not.toHaveBeenCalled()
  })
})
