import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { emitSecurityEvent } from '../../events'
import { MfaProviderRegistry } from '../../lib/mfa-provider-registry'
import type { MfaProviderInterface } from '../../lib/mfa-provider-interface'
import {
  defaultSecurityModuleConfig,
  type SecurityModuleConfig,
} from '../../lib/security-config'
import { MfaService } from '../MfaService'

jest.mock('bcryptjs', () => ({
  compare: jest.fn(async (value: string, hashed: string | null) => hashed === `hashed:${value}`),
  hash: jest.fn(async (value: string) => `hashed:${value}`),
}))

jest.mock('../../events', () => ({
  emitSecurityEvent: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))

type MockMethod = {
  id: string
  userId: string
  tenantId: string
  organizationId?: string | null
  type: string
  label?: string | null
  secret?: string | null
  providerMetadata?: Record<string, unknown> | null
  isActive: boolean
  createdAt: Date
  updatedAt: Date
  deletedAt?: Date | null
}

function createProvider(overrides?: Partial<MfaProviderInterface>): MfaProviderInterface {
  return {
    type: 'totp',
    label: 'Authenticator App',
    icon: 'Smartphone',
    allowMultiple: true,
    setupSchema: { parse: (value: unknown) => value } as never,
    verifySchema: { parse: (value: unknown) => value } as never,
    setup: jest.fn(async () => ({
      setupId: 'setup-1',
      clientData: {
        uri: 'otpauth://example',
        secret: 'SECRET',
        qrDataUrl: 'otpauth://example',
      },
    })),
    confirmSetup: jest.fn(async () => ({
      metadata: {
        label: 'Phone Authenticator',
      },
      secret: 'SECRET',
    })),
    prepareChallenge: jest.fn(async () => ({})),
    verify: jest.fn(async () => true),
    ...overrides,
  }
}

function createServiceContext(
  securityConfig: SecurityModuleConfig = defaultSecurityModuleConfig,
) {
  const methods: MockMethod[] = []
  const recoveryCodes: Array<{ userId: string; codeHash: string; isUsed: boolean; usedAt?: Date | null; createdAt: Date }> = []
  const enforcementPolicies: Array<{ scope: string; tenantId?: string | null; organizationId?: string | null; isEnforced: boolean; allowedMethods?: string[] | null; deletedAt?: Date | null }> = []

  const em = {
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => {
      if ('expiresAt' in data) {
        return {
          id: 'challenge-1',
          ...data,
        }
      }
      if ('codeHash' in data) {
        const row = {
          userId: String(data.userId),
          codeHash: String(data.codeHash),
          isUsed: Boolean(data.isUsed),
          usedAt: null,
          createdAt: new Date(),
        }
        recoveryCodes.push(row)
        return row
      }
      const method = {
        id: `method-${methods.length + 1}`,
        userId: String(data.userId),
        tenantId: String(data.tenantId),
        organizationId: (data.organizationId as string | null | undefined) ?? null,
        type: String(data.type),
        label: (data.label as string | null | undefined) ?? null,
        secret: (data.secret as string | null | undefined) ?? null,
        providerMetadata: (data.providerMetadata as Record<string, unknown> | null | undefined) ?? null,
        isActive: Boolean(data.isActive),
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      }
      methods.push(method)
      return method
    }),
    persist: jest.fn(),
    flush: jest.fn().mockResolvedValue(undefined),
    findOne: jest.fn(async (_entity: unknown, query: Record<string, unknown>) => {
      if ('scope' in query) {
        return enforcementPolicies.find(
          (policy) =>
            policy.scope === query.scope &&
            policy.tenantId === (query.tenantId as string | null | undefined) &&
            policy.organizationId === (query.organizationId as string | null | undefined) &&
            policy.isEnforced === query.isEnforced &&
            policy.deletedAt === (query.deletedAt as Date | null | undefined),
        ) ?? null
      }

      if ('id' in query && 'userId' in query) {
        return methods.find(
          (item) =>
            item.id === query.id &&
            item.userId === query.userId &&
            item.isActive === query.isActive &&
            item.deletedAt === query.deletedAt,
        ) ?? null
      }

      return methods.find((item) => {
        if (query.userId !== undefined && item.userId !== query.userId) return false
        if (query.isActive !== undefined && item.isActive !== query.isActive) return false
        if (query.deletedAt !== undefined && item.deletedAt !== query.deletedAt) return false
        if (query.type !== undefined && item.type !== query.type) return false
        if (query.secret !== undefined && item.secret !== query.secret) return false
        if (query.label !== undefined && item.label !== query.label) return false
        return true
      }) ?? null
    }),
    find: jest.fn(async (_entity: unknown, query: Record<string, unknown>) => {
      if ('isUsed' in query) {
        return recoveryCodes.filter((item) => item.userId === query.userId && item.isUsed === query.isUsed)
      }
      return methods.filter((item) => item.userId === query.userId && item.isActive === query.isActive && item.deletedAt === query.deletedAt)
    }),
    count: jest.fn(async (_entity: unknown, query: Record<string, unknown>) => {
      if ('isUsed' in query) {
        return recoveryCodes.filter((item) => item.userId === query.userId && item.isUsed === query.isUsed).length
      }
      return methods.filter((item) => item.userId === query.userId && item.isActive === query.isActive && item.deletedAt === query.deletedAt).length
    }),
  }

  const registry = new MfaProviderRegistry()
  const provider = createProvider()
  registry.register(provider)

  const service = new MfaService(em as unknown as EntityManager, registry, securityConfig)
  return { service, em, registry, provider, methods, recoveryCodes, enforcementPolicies }
}

const mockedFindOneWithDecryption = findOneWithDecryption as jest.MockedFunction<typeof findOneWithDecryption>
const mockedEmitSecurityEvent = emitSecurityEvent as jest.MockedFunction<typeof emitSecurityEvent>

describe('MfaService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockedFindOneWithDecryption.mockResolvedValue({
      id: 'user-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      deletedAt: null,
    } as never)
  })

  test('setupMethod delegates to provider and persists pending method', async () => {
    const { service, methods } = createServiceContext()

    const result = await service.setupMethod('user-1', 'totp', { label: 'Phone' })

    expect(result.setupId).toBe('setup-1')
    expect(methods).toHaveLength(1)
    expect(methods[0].isActive).toBe(false)
    expect(methods[0].secret).toBe('setup-1')
  })

  test('confirmMethod activates the first method without generating recovery codes', async () => {
    const { service, methods } = createServiceContext()
    const generateSpy = jest.spyOn(service, 'generateRecoveryCodes').mockResolvedValue(['A1B2C3D4E5'])

    await service.setupMethod('user-1', 'totp', {})
    const result = await service.confirmMethod('user-1', 'setup-1', { code: '123456' })

    expect(result).toEqual({})
    expect(methods[0].isActive).toBe(true)
    expect(methods[0].secret).toBe('SECRET')
    expect(methods[0].providerMetadata).toEqual({ label: 'Phone Authenticator' })
    expect(generateSpy).not.toHaveBeenCalled()
    expect(mockedEmitSecurityEvent).toHaveBeenCalledWith('security.mfa.enrolled', expect.objectContaining({
      userId: 'user-1',
      methodType: 'totp',
    }))
  })

  test('setupMethod rejects duplicate single-instance provider enrollment', async () => {
    const { service, registry, methods } = createServiceContext()
    registry.register(createProvider({
      type: 'otp_email',
      allowMultiple: false,
      setup: jest.fn(async () => ({
        setupId: 'setup-otp-1',
        clientData: { email: 'user@example.com' },
      })),
    }))

    methods.push({
      id: 'method-existing',
      userId: 'user-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      type: 'otp_email',
      label: 'Primary email',
      secret: null,
      providerMetadata: { email: 'user@example.com' },
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    })

    await expect(service.setupMethod('user-1', 'otp_email', {})).rejects.toMatchObject({
      name: 'MfaServiceError',
      statusCode: 409,
      message: "MFA provider 'otp_email' is already configured",
    })
  })

  test('confirmMethod rejects duplicate confirmation for a single-instance provider', async () => {
    const { service, registry, methods } = createServiceContext()
    registry.register(createProvider({
      type: 'otp_email',
      allowMultiple: false,
      setup: jest.fn(async () => ({
        setupId: 'setup-otp-1',
        clientData: { email: 'user@example.com' },
      })),
      confirmSetup: jest.fn(async () => ({
        metadata: { email: 'user@example.com' },
      })),
    }))

    await service.setupMethod('user-1', 'otp_email', {})
    methods.push({
      id: 'method-existing',
      userId: 'user-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      type: 'otp_email',
      label: 'Primary email',
      secret: null,
      providerMetadata: { email: 'user@example.com' },
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    })

    await expect(service.confirmMethod('user-1', 'setup-otp-1', {})).rejects.toMatchObject({
      name: 'MfaServiceError',
      statusCode: 409,
      message: "MFA provider 'otp_email' is already configured",
    })
  })

  test('confirmMethod rejects duplicate label for allowMultiple provider', async () => {
    const { service } = createServiceContext()

    mockedFindOneWithDecryption.mockResolvedValue({
      id: 'user-1',
      tenantId: 'tenant-1',
      organizationId: null,
      email: 'user@example.com',
    } as never)

    await service.setupMethod('user-1', 'totp', {})
    await service.confirmMethod('user-1', 'setup-1', { code: '123456' })

    await service.setupMethod('user-1', 'totp', {})
    await expect(service.confirmMethod('user-1', 'setup-1', { code: '654321' })).rejects.toMatchObject({
      name: 'MfaServiceError',
      statusCode: 409,
      message: 'An MFA method with this name already exists',
    })
  })

  test('confirmMethod rejects provider mismatch for setup session', async () => {
    const { service } = createServiceContext()

    await service.setupMethod('user-1', 'totp', {})

    await expect(service.confirmMethod('user-1', 'setup-1', { code: '123456' }, 'passkey')).rejects.toMatchObject({
      name: 'MfaServiceError',
      statusCode: 400,
      message: 'MFA setup session does not match the requested provider',
    })
  })

  test('confirmMethod does not generate recovery codes when MFA already exists', async () => {
    const { service, methods } = createServiceContext()
    const generateSpy = jest.spyOn(service, 'generateRecoveryCodes').mockResolvedValue(['SHOULD-NOT-HAPPEN'])

    methods.push({
      id: 'method-existing',
      userId: 'user-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      type: 'passkey',
      label: 'Laptop',
      secret: null,
      providerMetadata: { credentialId: 'cred-1' },
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    })

    await service.setupMethod('user-1', 'totp', {})
    const result = await service.confirmMethod('user-1', 'setup-1', { code: '123456' })

    expect(result).toEqual({})
    expect(generateSpy).not.toHaveBeenCalled()
  })

  test('generateRecoveryCodes rotates previous codes and returns new plaintext set', async () => {
    const { service, recoveryCodes } = createServiceContext()
    recoveryCodes.push({
      userId: 'user-1',
      codeHash: 'old-hash',
      isUsed: false,
      usedAt: null,
      createdAt: new Date(),
    })

    const plaintextCodes = await service.generateRecoveryCodes('user-1')

    expect(plaintextCodes).toHaveLength(10)
    expect(recoveryCodes[0].isUsed).toBe(true)
    expect(recoveryCodes.slice(1)).toHaveLength(10)
    expect(mockedEmitSecurityEvent).toHaveBeenCalledWith('security.recovery.regenerated', {
      userId: 'user-1',
      total: 10,
    })
  })

  test('generateRecoveryCodes respects the configured recovery code count', async () => {
    const { service, recoveryCodes } = createServiceContext({
      ...defaultSecurityModuleConfig,
      recoveryCodes: {
        ...defaultSecurityModuleConfig.recoveryCodes,
        count: 3,
      },
    })

    const plaintextCodes = await service.generateRecoveryCodes('user-1')

    expect(plaintextCodes).toHaveLength(3)
    expect(recoveryCodes).toHaveLength(3)
  })

  test('verifyRecoveryCode accepts normalized lowercase and hyphenated input', async () => {
    const { service, recoveryCodes } = createServiceContext()
    const [firstCode] = await service.generateRecoveryCodes('user-1')
    expect(firstCode).toBeTruthy()

    const formatted = `${firstCode.slice(0, 5)}-${firstCode.slice(5)}`.toLowerCase()
    const verified = await service.verifyRecoveryCode('user-1', ` ${formatted} `)

    expect(verified).toBe(true)
    expect(recoveryCodes.filter((entry) => entry.isUsed)).toHaveLength(1)
    expect(mockedEmitSecurityEvent).toHaveBeenCalledWith('security.recovery.used', {
      userId: 'user-1',
      remaining: 9,
    })
  })

  test('verifyRecoveryCode returns false for blank input', async () => {
    const { service } = createServiceContext()

    await expect(service.verifyRecoveryCode('user-1', '   ')).resolves.toBe(false)
  })

  test('setupOtpEmail falls back to user email when payload email is missing', async () => {
    const { service, registry } = createServiceContext()
    mockedFindOneWithDecryption.mockResolvedValueOnce({
      id: 'user-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      email: 'user@example.com',
      deletedAt: null,
    } as never)

    const otpProvider = createProvider({
      type: 'otp_email',
      allowMultiple: false,
      resolveSetupPayload: jest.fn((user, payload) => ({
        ...(payload as Record<string, unknown>),
        email: user.email,
      })),
      setup: jest.fn(async (_userId, payload) => ({
        setupId: 'setup-otp-1',
        clientData: payload as Record<string, unknown>,
      })),
    })
    registry.register(otpProvider)

    const result = await service.setupMethod('user-1', 'otp_email', { label: 'Work' })

    expect(otpProvider.resolveSetupPayload).toHaveBeenCalledWith(expect.objectContaining({
      email: 'user@example.com',
    }), { label: 'Work' })
    expect(otpProvider.setup).toHaveBeenCalledWith('user-1', {
      email: 'user@example.com',
      label: 'Work',
    })
    expect(result).toEqual({
      setupId: 'setup-otp-1',
      clientData: {
        email: 'user@example.com',
        label: 'Work',
      },
    })
  })

  test('setupOtpEmail fails when neither payload nor user profile provides an email', async () => {
    const { service, registry } = createServiceContext()
    mockedFindOneWithDecryption.mockResolvedValueOnce({
      id: 'user-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      email: null,
      deletedAt: null,
    } as never)

    registry.register(createProvider({
      type: 'otp_email',
      allowMultiple: false,
      resolveSetupPayload: jest.fn((user) => {
        if (!user.email) {
          throw new Error('Unable to configure Email OTP without a destination email')
        }
        return { email: user.email }
      }),
    }))

    await expect(service.setupMethod('user-1', 'otp_email', {})).rejects.toThrow(
      'Unable to configure Email OTP without a destination email',
    )
  })
})
