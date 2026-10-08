jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(async () => []),
  findOneWithDecryption: jest.fn(async () => null),
}))

import '@open-mercato/core/modules/customers/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CustomerEntity, CustomerCompanyProfile } from '../../data/entities'

const ORG_ID = '11111111-1111-4111-8111-111111111111'
const TENANT_ID = '22222222-2222-4222-8222-222222222222'
const COMPANY_ID = '33333333-3333-4333-8333-333333333333'
const LOADED_VERSION = new Date('2026-01-01T10:00:00.000Z')

function makeCompany(): CustomerEntity {
  return {
    id: COMPANY_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    kind: 'company',
    displayName: 'Acme Corp',
    isActive: true,
    createdAt: LOADED_VERSION,
    updatedAt: LOADED_VERSION,
    deletedAt: null,
  } as unknown as CustomerEntity
}

function makeProfile(): CustomerCompanyProfile {
  return {
    id: 'profile-1',
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    legalName: null,
    brandName: null,
    domain: null,
    websiteUrl: null,
    industry: null,
    sizeBucket: null,
    annualRevenue: null,
  } as unknown as CustomerCompanyProfile
}

function makeEm(company: CustomerEntity, profile: CustomerCompanyProfile) {
  const em: Record<string, unknown> = {
    fork: jest.fn(() => em),
    findOne: jest.fn(async (ctor: unknown) => {
      if (ctor === CustomerEntity) return company
      if (ctor === CustomerCompanyProfile) return profile
      return null
    }),
    find: jest.fn(async () => []),
    flush: jest.fn(async () => undefined),
    transactional: jest.fn(async (fn: (inner: unknown) => unknown) => fn(em)),
    begin: jest.fn(async () => undefined),
    commit: jest.fn(async () => undefined),
    rollback: jest.fn(async () => undefined),
    persist: jest.fn(),
    remove: jest.fn(),
    nativeDelete: jest.fn(async () => 0),
    getReference: jest.fn((_ctor: unknown, id: string) => ({ id })),
  }
  return em
}

function makeCtx(em: Record<string, unknown>): CommandRuntimeContext {
  const dataEngine = {
    setCustomFields: jest.fn(async () => undefined),
    emitOrmEntityEvent: jest.fn(async () => undefined),
    markOrmEntityChange: jest.fn(),
    flushOrmEntityChanges: jest.fn(async () => undefined),
  }
  return {
    container: {
      resolve: (token: string): unknown => {
        if (token === 'em') return em
        if (token === 'dataEngine') return dataEngine
        if (token === 'eventBus') return { emitEvent: jest.fn(async () => undefined) }
        throw new Error(`Unexpected DI token: ${token}`)
      },
    },
    auth: { sub: 'user-1', tenantId: TENANT_ID, orgId: ORG_ID },
    selectedOrganizationId: ORG_ID,
    organizationScope: null,
    organizationIds: null,
  } as unknown as CommandRuntimeContext
}

async function runUpdate(input: Record<string, unknown>) {
  const company = makeCompany()
  const profile = makeProfile()
  const ctx = makeCtx(makeEm(company, profile))
  const handler = commandRegistry.get('customers.companies.update') as CommandHandler
  const result = (await handler.execute({ id: COMPANY_ID, ...input }, ctx)) as { updatedAt: Date }
  return { company, profile, result }
}

describe('customers.companies.update — optimistic-lock version (#7033)', () => {
  it('advances updatedAt when only company-profile fields change', async () => {
    const { company, profile, result } = await runUpdate({ annualRevenue: 300 })

    expect(profile.annualRevenue).toBe('300')
    expect(company.updatedAt.getTime()).toBeGreaterThan(LOADED_VERSION.getTime())
    expect(result.updatedAt).toBe(company.updatedAt)
  })

  it.each([
    ['legalName', 'Acme Legal'],
    ['brandName', 'Acme'],
    ['domain', 'acme.test'],
    ['websiteUrl', 'https://acme.test'],
    ['industry', 'retail'],
    ['sizeBucket', 'B-size'],
  ])('advances updatedAt when only %s changes', async (field, value) => {
    const { company } = await runUpdate({ [field]: value })

    expect(company.updatedAt.getTime()).toBeGreaterThan(LOADED_VERSION.getTime())
  })

  it('advances updatedAt when only custom fields change', async () => {
    const { company } = await runUpdate({ cf_priority: 'high' })

    expect(company.updatedAt.getTime()).toBeGreaterThan(LOADED_VERSION.getTime())
  })

  it('leaves updatedAt alone when no profile or custom field is submitted', async () => {
    const { company } = await runUpdate({})

    expect(company.updatedAt).toBe(LOADED_VERSION)
  })
})
