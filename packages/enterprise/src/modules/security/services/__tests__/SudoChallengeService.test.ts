import { createHmac } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { ChallengeMethod, SudoChallengeConfig, SudoSession } from '../../data/entities'
import { registerSecuritySudoTargetEntries } from '../../lib/module-security-registry'
import {
  defaultSecurityModuleConfig,
  type SecurityModuleConfig,
} from '../../lib/security-config'
import { SudoChallengeService } from '../SudoChallengeService'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))

import * as securityConfig from '../../lib/security-config'

const mockEmitBypassWarning = jest.spyOn(securityConfig, 'emitMfaEmergencyBypassActiveWarning').mockImplementation(() => {})

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
  scopeTenantId?: string | null
  scopeOrganizationId?: string | null
  targetIdentifier?: string | null
  sudoConfigId?: string | null
  sudoConfigUpdatedAt?: Date | null
  sessionToken: string
  challengeMethod: string
  expiresAt: Date
  verifiedAt?: Date | null
  createdAt: Date
}

const mockedFindOneWithDecryption = findOneWithDecryption as jest.MockedFunction<typeof findOneWithDecryption>

function getSudoTestSecret(): string {
  return process.env.OM_SECURITY_SUDO_SECRET
    ?? process.env.AUTH_JWT_SECRET
    ?? process.env.JWT_SECRET
    ?? 'open-mercato-sudo-secret'
}

function signSudoTokenWithPayload(payload: unknown): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const signature = createHmac('sha256', getSudoTestSecret())
    .update(encodedPayload)
    .digest('base64url')
  return `${encodedPayload}.${signature}`
}

function createServiceContext(
  securityConfig: SecurityModuleConfig = defaultSecurityModuleConfig,
) {
  const configs: ConfigRecord[] = []
  const sessions: SessionRecord[] = []
  const connectionExecute = jest.fn(async () => [])
  const transactional = jest.fn()

  const em = {
    create: jest.fn((entity: unknown, data: Record<string, unknown>) => {
      if (entity === expect.anything()) return data
      if (entity === SudoChallengeConfig) {
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
        scopeTenantId: (data.scopeTenantId as string | null | undefined) ?? null,
        scopeOrganizationId: (data.scopeOrganizationId as string | null | undefined) ?? null,
        targetIdentifier: (data.targetIdentifier as string | null | undefined) ?? null,
        sudoConfigId: (data.sudoConfigId as string | null | undefined) ?? null,
        sudoConfigUpdatedAt: (data.sudoConfigUpdatedAt as Date | null | undefined) ?? null,
        sessionToken: String(data.sessionToken),
        challengeMethod: String(data.challengeMethod),
        expiresAt: data.expiresAt as Date,
        verifiedAt: (data.verifiedAt as Date | null | undefined) ?? null,
        createdAt: (data.createdAt as Date | undefined) ?? new Date(),
      }
    }),
    persist: jest.fn((record: ConfigRecord | SessionRecord) => {
      if ('isDeveloperDefault' in record) configs.push(record)
      else sessions.push(record)
    }),
    flush: jest.fn().mockResolvedValue(undefined),
    find: jest.fn(async (entity: unknown, query: Record<string, unknown>) => {
      if (entity === SudoChallengeConfig) {
        return configs.filter((config) => {
          if ('targetIdentifier' in query && config.targetIdentifier !== query.targetIdentifier) return false
          if (query.deletedAt !== undefined && config.deletedAt !== query.deletedAt) return false
          if (query.tenantId !== undefined && config.tenantId !== query.tenantId) return false
          const orPredicates = (query as Record<string, unknown>).$or as Array<Record<string, unknown>> | undefined
          if (Array.isArray(orPredicates) && orPredicates.length > 0) {
            const matches = orPredicates.some((predicate) => {
              if ('tenantId' in predicate && config.tenantId !== (predicate.tenantId as string | null)) return false
              return true
            })
            if (!matches) return false
          }
          return true
        })
      }
      return []
    }),
    findOne: jest.fn(async (entity: unknown, query: Record<string, unknown>) => {
      if (entity === SudoChallengeConfig) {
        return configs.find((config) => {
          if (query.id !== undefined && config.id !== query.id) return false
          if ('targetIdentifier' in query && config.targetIdentifier !== query.targetIdentifier) return false
          if (query.tenantId !== undefined && config.tenantId !== query.tenantId) return false
          if (query.organizationId !== undefined && config.organizationId !== query.organizationId) return false
          if (query.isDeveloperDefault !== undefined && config.isDeveloperDefault !== query.isDeveloperDefault) return false
          if (query.deletedAt !== undefined && config.deletedAt !== query.deletedAt) return false
          return true
        }) ?? null
      }
      if ('sessionToken' in query || 'id' in query) {
        return sessions.find((session) => {
          if (query.id !== undefined && session.id !== query.id) return false
          if (query.userId !== undefined && session.userId !== query.userId) return false
          if (query.sessionToken !== undefined && session.sessionToken !== query.sessionToken) return false
          if ('targetIdentifier' in query && session.targetIdentifier !== query.targetIdentifier) return false
          if ('scopeTenantId' in query && session.scopeTenantId !== query.scopeTenantId) return false
          if ('scopeOrganizationId' in query && session.scopeOrganizationId !== query.scopeOrganizationId) return false
          const verifiedAt = query.verifiedAt as { $ne?: Date | null } | Date | null | undefined
          if (verifiedAt && typeof verifiedAt === 'object' && '$ne' in verifiedAt) {
            if (verifiedAt.$ne === null && session.verifiedAt == null) return false
          } else if ('verifiedAt' in query && session.verifiedAt !== verifiedAt) {
            return false
          }
          return true
        }) ?? null
      }
      return null
    }),
    nativeUpdate: jest.fn(async (entity: unknown, query: Record<string, unknown>, updates: Record<string, unknown>) => {
      if (entity !== SudoSession) return 0
      const session = sessions.find((candidate) => {
        if (query.id !== undefined && candidate.id !== query.id) return false
        if (query.sessionToken !== undefined && candidate.sessionToken !== query.sessionToken) return false
        if (query.verifiedAt !== undefined && candidate.verifiedAt !== query.verifiedAt) return false
        const expiresAt = query.expiresAt as { $gt?: Date } | undefined
        if (expiresAt?.$gt && candidate.expiresAt.getTime() <= expiresAt.$gt.getTime()) return false
        return true
      })
      if (!session) return 0
      Object.assign(session, updates)
      return 1
    }),
    nativeDelete: jest.fn(async () => 0),
    execute: connectionExecute,
    transactional,
  }
  transactional.mockImplementation(async (callback: (transactionalEm: EntityManager) => Promise<unknown>) => (
    callback(em as unknown as EntityManager)
  ))

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

  return {
    service,
    configs,
    sessions,
    passwordService,
    mfaService,
    mfaVerificationService,
    connectionExecute,
  }
}

describe('SudoChallengeService', () => {
  const ORIGINAL_SUDO_SECRET = process.env.OM_SECURITY_SUDO_SECRET
  const ORIGINAL_AUTH_JWT_SECRET = process.env.AUTH_JWT_SECRET
  const ORIGINAL_AUTH_SECRET = process.env.AUTH_SECRET
  const ORIGINAL_JWT_SECRET = process.env.JWT_SECRET

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.OM_SECURITY_SUDO_SECRET = 'unit-test-sudo-secret'
    delete process.env.AUTH_JWT_SECRET
    delete process.env.AUTH_SECRET
    delete process.env.JWT_SECRET
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

  test('rejects target substitution before verifying a weaker password challenge', async () => {
    const { service, passwordService } = createServiceContext()
    await service.createConfig({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      targetIdentifier: 'security.password.target',
      isEnabled: true,
      ttlSeconds: 300,
      challengeMethod: ChallengeMethod.PASSWORD,
    }, 'admin-1')
    await service.createConfig({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      targetIdentifier: 'security.mfa.target',
      isEnabled: true,
      ttlSeconds: 300,
      challengeMethod: ChallengeMethod.MFA,
    }, 'admin-1')

    const initiated = await service.initiate('user-1', 'security.password.target', {
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })

    await expect(service.verify(
      initiated.sessionId!,
      'password',
      { password: 'Valid1!Pass' },
      {
        expectedUserId: 'user-1',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        targetIdentifier: 'security.mfa.target',
      },
    )).rejects.toMatchObject({ statusCode: 403 })
    expect(passwordService.verifyPassword).not.toHaveBeenCalled()
  })

  test.each([
    [{ tenantId: 'tenant-2', organizationId: 'org-1' }],
    [{ tenantId: 'tenant-1', organizationId: 'org-2' }],
  ])('rejects verification outside the initiated scope', async (scope) => {
    const { service, passwordService } = createServiceContext()
    const initiated = await service.initiate('user-1', 'security.sudo.manage', {
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })

    await expect(service.verify(
      initiated.sessionId!,
      'password',
      { password: 'Valid1!Pass' },
      {
        expectedUserId: 'user-1',
        ...scope,
        targetIdentifier: 'security.sudo.manage',
      },
    )).rejects.toMatchObject({ statusCode: 403 })
    expect(passwordService.verifyPassword).not.toHaveBeenCalled()
  })

  test('rejects a challenge after its selected sudo configuration changes', async () => {
    const { service, configs, passwordService } = createServiceContext()
    const config = await service.createConfig({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      targetIdentifier: 'security.versioned.target',
      isEnabled: true,
      ttlSeconds: 300,
      challengeMethod: ChallengeMethod.PASSWORD,
    }, 'admin-1')
    const initiated = await service.initiate('user-1', config.targetIdentifier, {
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    const storedConfig = configs.find((candidate) => candidate.id === config.id)!
    storedConfig.ttlSeconds = 600
    storedConfig.updatedAt = new Date(storedConfig.updatedAt.getTime() + 1000)

    await expect(service.verify(
      initiated.sessionId!,
      'password',
      { password: 'Valid1!Pass' },
      {
        expectedUserId: 'user-1',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        targetIdentifier: config.targetIdentifier,
      },
    )).rejects.toMatchObject({ statusCode: 403 })
    expect(passwordService.verifyPassword).not.toHaveBeenCalled()
  })

  test('rejects legacy pending sessions without target and configuration bindings', async () => {
    const { service, sessions, passwordService } = createServiceContext()
    sessions.push({
      id: 'legacy-session',
      userId: 'user-1',
      tenantId: 'tenant-1',
      sessionToken: 'legacy-pending-token',
      challengeMethod: 'password',
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
    })

    await expect(service.verify(
      'legacy-session',
      'password',
      { password: 'Valid1!Pass' },
      {
        expectedUserId: 'user-1',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        targetIdentifier: 'security.sudo.manage',
      },
    )).rejects.toMatchObject({ statusCode: 404 })
    expect(passwordService.verifyPassword).not.toHaveBeenCalled()
  })

  test('allows exactly one winner when two verifiers consume the same password challenge', async () => {
    const { service, passwordService } = createServiceContext()
    const initiated = await service.initiate('user-1', 'security.sudo.manage', {
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    const verification = {
      expectedUserId: 'user-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      targetIdentifier: 'security.sudo.manage',
    }

    const results = await Promise.allSettled([
      service.verify(
        initiated.sessionId!,
        'password',
        { password: 'Valid1!Pass' },
        verification,
      ),
      service.verify(
        initiated.sessionId!,
        'password',
        { password: 'Valid1!Pass' },
        verification,
      ),
    ])

    const fulfilled = results.filter((result) => result.status === 'fulfilled')
    const rejected = results.filter((result) => result.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0]).toMatchObject({ reason: { statusCode: 400 } })
    expect(passwordService.verifyPassword).toHaveBeenCalledTimes(2)
  })

  test('rejects a higher-priority policy installed while credentials are being verified', async () => {
    const { service, configs, passwordService, connectionExecute } = createServiceContext()
    const initiated = await service.initiate('user-1', 'security.sudo.manage', {
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    passwordService.verifyPassword.mockImplementationOnce(async () => {
      configs.push({
        ...configs[0],
        id: 'replacement-config',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        isDeveloperDefault: false,
        challengeMethod: ChallengeMethod.MFA,
        updatedAt: new Date(configs[0].updatedAt.getTime() + 1000),
      })
      return true
    })

    await expect(service.verify(
      initiated.sessionId!,
      'password',
      { password: 'Valid1!Pass' },
      {
        expectedUserId: 'user-1',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        targetIdentifier: 'security.sudo.manage',
      },
    )).rejects.toMatchObject({ statusCode: 403 })
    expect(connectionExecute).toHaveBeenCalledWith('lock table "sudo_challenge_configs" in share mode')
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
    expect(mockEmitBypassWarning).toHaveBeenCalledWith(
      'sudo challenge downgraded to password',
      expect.objectContaining({
        availableMfaMethodCount: 1,
        userId: 'user-1',
        targetIdentifier: 'security.sudo.manage',
      }),
    )
  })

  test('does not warn when no MFA methods are available so password was already the outcome', async () => {
    const { service, mfaService, mfaVerificationService } = createServiceContext({
      ...defaultSecurityModuleConfig,
      mfa: {
        ...defaultSecurityModuleConfig.mfa,
        emergencyBypass: true,
      },
    })
    mfaService.getUserMethods.mockResolvedValueOnce([])

    const result = await service.initiate('user-1', 'security.sudo.manage', {
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })

    expect(result.method).toBe('password')
    expect(mockEmitBypassWarning).not.toHaveBeenCalled()
  })

  test('does not warn when bypass is disabled even though MFA would be used', async () => {
    const { service, mfaService } = createServiceContext({
      ...defaultSecurityModuleConfig,
      mfa: {
        ...defaultSecurityModuleConfig.mfa,
        emergencyBypass: false,
      },
    })
    mfaService.getUserMethods.mockResolvedValueOnce([{ id: 'method-1' }])

    const result = await service.initiate('user-1', 'security.sudo.manage', {
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })

    expect(result.method).toBe('mfa')
    expect(mockEmitBypassWarning).not.toHaveBeenCalled()
  })

  describe('tenant isolation for sudo configs', () => {
    function seedConfig(
      configs: ConfigRecord[],
      overrides?: Partial<ConfigRecord>,
    ): ConfigRecord {
      const record: ConfigRecord = {
        id: 'config-a',
        tenantId: 'tenant-a',
        organizationId: null,
        label: null,
        targetIdentifier: 'security.custom.target',
        isEnabled: true,
        isDeveloperDefault: false,
        ttlSeconds: 300,
        challengeMethod: ChallengeMethod.PASSWORD,
        configuredBy: 'user-a',
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        ...overrides,
      }
      configs.push(record)
      return record
    }

    test('updateConfig rejects cross-tenant writes from a tenant admin', async () => {
      const { service, configs } = createServiceContext()
      seedConfig(configs)

      await expect(
        service.updateConfig(
          'config-a',
          { isEnabled: false },
          'user-b',
          { tenantId: 'tenant-b', organizationId: null, isSuperAdmin: false },
        ),
      ).rejects.toMatchObject({
        name: 'SudoChallengeServiceError',
        statusCode: 404,
      })

      expect(configs[0].isEnabled).toBe(true)
      expect(configs[0].configuredBy).toBe('user-a')
    })

    test('deleteConfig rejects cross-tenant deletes from a tenant admin', async () => {
      const { service, configs } = createServiceContext()
      seedConfig(configs)

      await expect(
        service.deleteConfig('config-a', {
          tenantId: 'tenant-b',
          organizationId: null,
          isSuperAdmin: false,
        }),
      ).rejects.toMatchObject({
        name: 'SudoChallengeServiceError',
        statusCode: 404,
      })

      expect(configs[0].deletedAt).toBeNull()
    })

    test('getConfigById and listConfigs hide cross-tenant records from a tenant admin', async () => {
      const { service, configs } = createServiceContext()
      seedConfig(configs)
      seedConfig(configs, {
        id: 'config-b',
        tenantId: 'tenant-b',
        targetIdentifier: 'security.custom.target.b',
        configuredBy: 'user-b',
      })

      const foreignScope = { tenantId: 'tenant-b', organizationId: null, isSuperAdmin: false }
      const fetched = await service.getConfigById('config-a', foreignScope)
      expect(fetched).toBeNull()

      const visible = await service.listConfigs(foreignScope)
      expect(visible.map((item) => item.id)).not.toContain('config-a')
      expect(visible.map((item) => item.id)).toContain('config-b')
    })

    test('createConfig rejects attempts to target a foreign tenant', async () => {
      const { service, configs } = createServiceContext()

      await expect(
        service.createConfig(
          {
            tenantId: 'tenant-b',
            organizationId: null,
            targetIdentifier: 'security.custom.new',
            isEnabled: true,
            ttlSeconds: 300,
            challengeMethod: ChallengeMethod.PASSWORD,
          },
          'user-a',
          { tenantId: 'tenant-a', organizationId: null, isSuperAdmin: false },
        ),
      ).rejects.toMatchObject({
        name: 'SudoChallengeServiceError',
        statusCode: 404,
      })

      expect(configs.find((item) => item.targetIdentifier === 'security.custom.new')).toBeUndefined()
    })

    test('superadmin bypasses tenant scope and can manage any config', async () => {
      const { service, configs } = createServiceContext()
      seedConfig(configs)

      const superAdminScope = { tenantId: null, organizationId: null, isSuperAdmin: true }
      await service.updateConfig(
        'config-a',
        { isEnabled: false },
        'super-admin',
        superAdminScope,
      )
      expect(configs[0].isEnabled).toBe(false)

      await service.deleteConfig('config-a', superAdminScope)
      expect(configs[0].deletedAt).toBeInstanceOf(Date)
    })
  })

  describe('signed token payload shape validation', () => {
    const validPayload = {
      sid: 'session-shape-1',
      sub: 'user-1',
      tid: 'tenant-1',
      oid: 'org-1',
      tgt: 'security.sudo.manage',
      exp: Date.now() + 60_000,
    }

    function seedMatchingSession(
      sessions: SessionRecord[],
      token: string,
      overrides: Partial<SessionRecord> = {},
    ) {
      sessions.push({
        id: validPayload.sid,
        userId: validPayload.sub,
        tenantId: 'tenant-1',
        scopeTenantId: validPayload.tid,
        scopeOrganizationId: validPayload.oid,
        targetIdentifier: validPayload.tgt,
        sudoConfigId: 'config-1',
        sudoConfigUpdatedAt: new Date(),
        sessionToken: token,
        challengeMethod: 'password',
        expiresAt: new Date(Date.now() + 60_000),
        verifiedAt: new Date(),
        createdAt: new Date(),
        ...overrides,
      })
    }

    test('rejects an HMAC-valid token whose payload is missing the exp field even when a live session exists', async () => {
      const { service, sessions } = createServiceContext()
      const { exp: _exp, ...withoutExp } = validPayload
      const token = signSudoTokenWithPayload(withoutExp)
      seedMatchingSession(sessions, token)

      await expect(
        service.validateToken(token, 'security.sudo.manage', {
          expectedUserId: 'user-1',
          tenantId: 'tenant-1',
          organizationId: 'org-1',
        }),
      ).resolves.toBe(false)
    })

    test('rejects an HMAC-valid token whose exp is not numeric even when a live session exists', async () => {
      const { service, sessions } = createServiceContext()
      const token = signSudoTokenWithPayload({ ...validPayload, exp: 'not-a-number' })
      seedMatchingSession(sessions, token)

      await expect(
        service.validateToken(token, 'security.sudo.manage', {
          expectedUserId: 'user-1',
          tenantId: 'tenant-1',
          organizationId: 'org-1',
        }),
      ).resolves.toBe(false)
    })

    test('rejects an HMAC-valid token whose payload is not an object', async () => {
      const { service } = createServiceContext()
      const token = signSudoTokenWithPayload('totally-not-a-payload')

      await expect(
        service.validateToken(token, 'security.sudo.manage', {
          expectedUserId: 'user-1',
          tenantId: 'tenant-1',
          organizationId: 'org-1',
        }),
      ).resolves.toBe(false)
    })

    test('rejects an HMAC-valid token whose tid has the wrong type even when a live session exists', async () => {
      const { service, sessions } = createServiceContext()
      const token = signSudoTokenWithPayload({ ...validPayload, tid: 42 })
      seedMatchingSession(sessions, token)

      await expect(
        service.validateToken(token, 'security.sudo.manage', {
          expectedUserId: 'user-1',
          tenantId: 'tenant-1',
          organizationId: 'org-1',
        }),
      ).resolves.toBe(false)
    })

    test('accepts an HMAC-valid token with a well-formed payload and a live session', async () => {
      const { service, sessions } = createServiceContext()
      const token = signSudoTokenWithPayload(validPayload)
      seedMatchingSession(sessions, token)

      await expect(
        service.validateToken(token, 'security.sudo.manage', {
          expectedUserId: 'user-1',
          tenantId: 'tenant-1',
          organizationId: 'org-1',
        }),
      ).resolves.toBe(true)
    })

    test.each([
      ['target', { targetIdentifier: 'security.other.target' }],
      ['tenant scope', { scopeTenantId: 'tenant-2' }],
      ['organization scope', { scopeOrganizationId: 'org-2' }],
      ['verification state', { verifiedAt: null }],
    ])('rejects a well-formed token when the durable %s binding differs', async (_label, overrides) => {
      const { service, sessions } = createServiceContext()
      const token = signSudoTokenWithPayload(validPayload)
      seedMatchingSession(sessions, token, overrides)

      await expect(
        service.validateToken(token, 'security.sudo.manage', {
          expectedUserId: 'user-1',
          tenantId: 'tenant-1',
          organizationId: 'org-1',
        }),
      ).resolves.toBe(false)
    })
  })

  describe('sudo secret resolution', () => {
    afterAll(() => {
      if (ORIGINAL_SUDO_SECRET === undefined) delete process.env.OM_SECURITY_SUDO_SECRET
      else process.env.OM_SECURITY_SUDO_SECRET = ORIGINAL_SUDO_SECRET
      if (ORIGINAL_AUTH_JWT_SECRET === undefined) delete process.env.AUTH_JWT_SECRET
      else process.env.AUTH_JWT_SECRET = ORIGINAL_AUTH_JWT_SECRET
      if (ORIGINAL_AUTH_SECRET === undefined) delete process.env.AUTH_SECRET
      else process.env.AUTH_SECRET = ORIGINAL_AUTH_SECRET
      if (ORIGINAL_JWT_SECRET === undefined) delete process.env.JWT_SECRET
      else process.env.JWT_SECRET = ORIGINAL_JWT_SECRET
    })

    async function initiateMfaChallenge(service: SudoChallengeService, mfaService: { getUserMethods: jest.Mock }) {
      mfaService.getUserMethods.mockResolvedValueOnce([{ id: 'method-1' }])
      return service.initiate('user-1', 'security.sudo.manage', {
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      })
    }

    test('verify throws a descriptive error when no sudo secret env var is set', async () => {
      delete process.env.OM_SECURITY_SUDO_SECRET
      delete process.env.AUTH_JWT_SECRET
      delete process.env.AUTH_SECRET
      delete process.env.JWT_SECRET

      const { service, mfaService } = createServiceContext()
      const initiated = await initiateMfaChallenge(service, mfaService)

      await expect(
        service.verify(
          initiated.sessionId!,
          'totp',
          { code: '123456' },
          { targetIdentifier: 'security.sudo.manage' },
        ),
      ).rejects.toThrow(/OM_SECURITY_SUDO_SECRET, AUTH_JWT_SECRET, AUTH_SECRET, or JWT_SECRET/)
    })

    test('validateToken throws when no sudo secret env var is set', async () => {
      delete process.env.OM_SECURITY_SUDO_SECRET
      delete process.env.AUTH_JWT_SECRET
      delete process.env.AUTH_SECRET
      delete process.env.JWT_SECRET

      const { service } = createServiceContext()

      await expect(
        service.validateToken('fabricated.token', 'security.sudo.manage', {
          expectedUserId: 'user-1',
          tenantId: 'tenant-1',
          organizationId: 'org-1',
        }),
      ).rejects.toThrow(/OM_SECURITY_SUDO_SECRET, AUTH_JWT_SECRET, AUTH_SECRET, or JWT_SECRET/)
    })

    test('empty-string env vars are treated as unset and throw', async () => {
      process.env.OM_SECURITY_SUDO_SECRET = ''
      process.env.AUTH_JWT_SECRET = '   '
      process.env.AUTH_SECRET = '\t'
      process.env.JWT_SECRET = ''

      const { service, mfaService } = createServiceContext()
      const initiated = await initiateMfaChallenge(service, mfaService)

      await expect(
        service.verify(
          initiated.sessionId!,
          'totp',
          { code: '123456' },
          { targetIdentifier: 'security.sudo.manage' },
        ),
      ).rejects.toThrow(/OM_SECURITY_SUDO_SECRET, AUTH_JWT_SECRET, AUTH_SECRET, or JWT_SECRET/)
    })

    test('OM_SECURITY_SUDO_SECRET wins over the other fallbacks', async () => {
      process.env.OM_SECURITY_SUDO_SECRET = 'primary-secret'
      process.env.AUTH_JWT_SECRET = 'auth-jwt-secret'
      process.env.AUTH_SECRET = 'auth-secret'
      process.env.JWT_SECRET = 'legacy-secret'

      const { service, mfaService } = createServiceContext()
      const initiated = await initiateMfaChallenge(service, mfaService)
      const verified = await service.verify(
        initiated.sessionId!,
        'totp',
        { code: '123456' },
        { targetIdentifier: 'security.sudo.manage' },
      )

      process.env.OM_SECURITY_SUDO_SECRET = 'rotated-primary-secret'
      await expect(
        service.validateToken(verified.sudoToken, 'security.sudo.manage', {
          expectedUserId: 'user-1',
          tenantId: 'tenant-1',
          organizationId: 'org-1',
        }),
      ).resolves.toBe(false)
    })

    test('AUTH_JWT_SECRET wins over AUTH_SECRET and JWT_SECRET when OM_SECURITY_SUDO_SECRET is unset', async () => {
      delete process.env.OM_SECURITY_SUDO_SECRET
      process.env.AUTH_JWT_SECRET = 'auth-jwt-secret'
      process.env.AUTH_SECRET = 'auth-secret'
      process.env.JWT_SECRET = 'legacy-secret'

      const { service, mfaService } = createServiceContext()
      const initiated = await initiateMfaChallenge(service, mfaService)
      const verified = await service.verify(
        initiated.sessionId!,
        'totp',
        { code: '123456' },
        { targetIdentifier: 'security.sudo.manage' },
      )

      process.env.AUTH_JWT_SECRET = 'rotated-auth-jwt-secret'
      await expect(
        service.validateToken(verified.sudoToken, 'security.sudo.manage', {
          expectedUserId: 'user-1',
          tenantId: 'tenant-1',
          organizationId: 'org-1',
        }),
      ).resolves.toBe(false)
    })

    test('AUTH_SECRET wins over JWT_SECRET when neither OM_SECURITY_SUDO_SECRET nor AUTH_JWT_SECRET is set', async () => {
      delete process.env.OM_SECURITY_SUDO_SECRET
      delete process.env.AUTH_JWT_SECRET
      process.env.AUTH_SECRET = 'auth-secret'
      process.env.JWT_SECRET = 'legacy-secret'

      const { service, mfaService } = createServiceContext()
      const initiated = await initiateMfaChallenge(service, mfaService)
      const verified = await service.verify(
        initiated.sessionId!,
        'totp',
        { code: '123456' },
        { targetIdentifier: 'security.sudo.manage' },
      )

      process.env.AUTH_SECRET = 'rotated-auth-secret'
      await expect(
        service.validateToken(verified.sudoToken, 'security.sudo.manage', {
          expectedUserId: 'user-1',
          tenantId: 'tenant-1',
          organizationId: 'org-1',
        }),
      ).resolves.toBe(false)
    })

    test('JWT_SECRET-only deployment can round-trip a sudo token', async () => {
      delete process.env.OM_SECURITY_SUDO_SECRET
      delete process.env.AUTH_JWT_SECRET
      delete process.env.AUTH_SECRET
      process.env.JWT_SECRET = 'legacy-only-secret'

      const { service, mfaService } = createServiceContext()
      const initiated = await initiateMfaChallenge(service, mfaService)
      const verified = await service.verify(
        initiated.sessionId!,
        'totp',
        { code: '123456' },
        { targetIdentifier: 'security.sudo.manage' },
      )

      await expect(
        service.validateToken(verified.sudoToken, 'security.sudo.manage', {
          expectedUserId: 'user-1',
          tenantId: 'tenant-1',
          organizationId: 'org-1',
        }),
      ).resolves.toBe(true)
    })
  })
})
