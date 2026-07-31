import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { SsoConfig } from '../../data/entities'
import type { SsoProviderRegistry } from '../../lib/registry'
import { HrdService } from '../hrdService'
import { SsoConfigError, SsoConfigService, type SsoAdminScope } from '../ssoConfigService'
import { SsoService } from '../ssoService'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(),
}))

const findWithDecryptionMock = findWithDecryption as jest.MockedFunction<typeof findWithDecryption>

const scope: SsoAdminScope = {
  isSuperAdmin: true,
  organizationId: null,
  tenantId: null,
}

function testDomain(): string {
  return `sso-${randomUUID().slice(0, 8)}.example.com`
}

function makeConfig(overrides: Partial<SsoConfig> = {}): SsoConfig {
  return {
    id: randomUUID(),
    tenantId: null,
    organizationId: randomUUID(),
    protocol: 'oidc',
    issuer: 'https://accounts.google.com',
    clientId: 'client',
    clientSecretEnc: 'secret',
    allowedDomains: [],
    jitEnabled: true,
    autoLinkByEmail: true,
    isActive: false,
    ssoRequired: false,
    appRoleMappings: {},
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  } as SsoConfig
}

function createConfigServiceContext(config: SsoConfig) {
  const calls: string[] = []
  const lock = jest.fn().mockImplementation(async (_sql: string, params: string[]) => {
    calls.push(`lock:${params[0]}`)
  })
  const txEm = {
    findOne: jest.fn().mockResolvedValue(config),
    count: jest.fn().mockResolvedValue(0),
    flush: jest.fn().mockImplementation(async () => {
      calls.push('flush')
    }),
    getConnection: jest.fn().mockReturnValue({ execute: lock }),
  }
  const em = {
    ...txEm,
    transactional: jest.fn().mockImplementation(async (fn: (tx: typeof txEm) => Promise<unknown>) => fn(txEm)),
  }
  const provider = { validateConfig: jest.fn().mockResolvedValue({ ok: true }) }
  const registry = { resolve: jest.fn().mockReturnValue(provider) }

  return {
    service: new SsoConfigService(
      em as unknown as EntityManager,
      {} as unknown as TenantDataEncryptionService,
      registry as unknown as SsoProviderRegistry,
    ),
    em,
    txEm,
    calls,
    lock,
  }
}

describe('SSO active domain uniqueness', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('rejects activating a config whose domain is already claimed by another active config', async () => {
    const domain = testDomain()
    const config = makeConfig({ allowedDomains: [domain], isActive: false })
    const existing = makeConfig({ allowedDomains: [domain.toUpperCase()], isActive: true })
    const { service, calls } = createConfigServiceContext(config)
    findWithDecryptionMock.mockImplementation(async () => {
      calls.push('check')
      return [existing]
    })

    await expect(service.activate(scope, config.id, true)).rejects.toMatchObject({
      statusCode: 409,
    } satisfies Partial<SsoConfigError>)
    expect(config.isActive).toBe(false)
    expect(calls).toEqual([
      `lock:sso:sso_config:${config.id}`,
      `lock:sso:allowed_domain:${domain}`,
      'check',
    ])
  })

  it('rejects adding a conflicting domain to an already active config', async () => {
    const domain = testDomain()
    const config = makeConfig({ allowedDomains: [], isActive: true })
    const existing = makeConfig({ allowedDomains: [domain], isActive: true })
    const { service, calls } = createConfigServiceContext(config)
    findWithDecryptionMock.mockImplementation(async () => {
      calls.push('check')
      return [existing]
    })

    await expect(service.addDomain(scope, config.id, domain.toUpperCase())).rejects.toMatchObject({
      statusCode: 409,
    } satisfies Partial<SsoConfigError>)
    expect(config.allowedDomains).toEqual([])
    expect(calls).toEqual([
      `lock:sso:sso_config:${config.id}`,
      `lock:sso:allowed_domain:${domain}`,
      'check',
    ])
  })

  it('serializes active domain writes before flushing the new domain', async () => {
    const domain = testDomain()
    const config = makeConfig({ allowedDomains: [], isActive: true })
    const { service, calls } = createConfigServiceContext(config)
    findWithDecryptionMock.mockImplementation(async () => {
      calls.push('check')
      return []
    })

    await expect(service.addDomain(scope, config.id, domain.toUpperCase())).resolves.toMatchObject({
      allowedDomains: [domain],
    })
    expect(calls).toEqual([
      `lock:sso:sso_config:${config.id}`,
      `lock:sso:allowed_domain:${domain}`,
      'check',
      'flush',
    ])
  })

  it('fails HRD closed when multiple active configs claim the same domain', async () => {
    const domain = testDomain()
    const rows = [
      { id: randomUUID(), allowed_domains: [domain], is_active: true },
      { id: randomUUID(), allowed_domains: [domain], is_active: true },
    ]
    const query = {
      selectAll: jest.fn(),
      where: jest.fn(),
      limit: jest.fn(),
      execute: jest.fn().mockResolvedValue(rows),
      executeTakeFirst: jest.fn().mockResolvedValue(rows[0]),
    }
    query.selectAll.mockReturnValue(query)
    query.where.mockReturnValue(query)
    query.limit.mockReturnValue(query)

    const em = {
      getKysely: jest.fn().mockReturnValue({ selectFrom: jest.fn().mockReturnValue(query) }),
      map: jest.fn((_entity: unknown, row: Record<string, unknown>) => row),
    }
    const service = new HrdService(em as unknown as EntityManager)

    await expect(service.findActiveConfigByEmailDomain(`user@${domain}`)).resolves.toBeNull()
  })

  it('fails SSO email config lookup closed when multiple active configs claim the same domain', async () => {
    const domain = testDomain()
    const first = makeConfig({ allowedDomains: [domain], isActive: true })
    const second = makeConfig({ allowedDomains: [domain], isActive: true })
    findWithDecryptionMock.mockResolvedValue([first, second])

    const service = new SsoService(
      {} as EntityManager,
      {} as SsoProviderRegistry,
      {} as never,
      {} as TenantDataEncryptionService,
      {} as never,
      {} as never,
    )

    await expect(service.findConfigByEmail(`user@${domain}`)).resolves.toBeNull()
  })
})
