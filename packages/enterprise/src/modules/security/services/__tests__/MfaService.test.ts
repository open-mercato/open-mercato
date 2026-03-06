import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { emitSecurityEvent } from '../../events'
import { MfaProviderRegistry } from '../../lib/mfa-provider-registry'
import type { MfaProviderInterface } from '../../lib/mfa-provider-interface'
import { MfaService } from '../MfaService'

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
        secret: 'SECRET',
        label: 'Phone Authenticator',
      },
    })),
    prepareChallenge: jest.fn(async () => ({})),
    verify: jest.fn(async () => true),
    ...overrides,
  }
}

function createServiceContext() {
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

  const service = new MfaService(em as unknown as EntityManager, registry)
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

  test('confirmMethod activates method and generates recovery codes on first enrollment', async () => {
    const { service, methods } = createServiceContext()
    const generateSpy = jest.spyOn(service, 'generateRecoveryCodes').mockResolvedValue(['A1B2C3D4E5'])

    await service.setupMethod('user-1', 'totp', {})
    await service.confirmMethod('user-1', 'setup-1', { code: '123456' })

    expect(methods[0].isActive).toBe(true)
    expect(methods[0].secret).toBeNull()
    expect(generateSpy).toHaveBeenCalledWith('user-1')
    expect(mockedEmitSecurityEvent).toHaveBeenCalledWith('security.mfa.enrolled', expect.objectContaining({
      userId: 'user-1',
      methodType: 'totp',
    }))
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
})
