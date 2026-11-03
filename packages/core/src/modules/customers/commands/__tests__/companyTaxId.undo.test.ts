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
import { CustomerCompanyProfile, CustomerEntity } from '../../data/entities'

const ORG_ID = 'org-co-1'
const TENANT_ID = 'tenant-co-1'
const COMPANY_ID = 'company-1'
const PROFILE_ID = 'profile-1'
const RESTORED_TAX_ID = 'PL1234567890'

type ProfileRecord = { id?: string; taxId?: string | null; legalName?: string | null }

function makeBeforeSnapshot() {
  return {
    entity: {
      id: COMPANY_ID,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      displayName: 'Acme Corp',
      description: null,
      ownerUserId: null,
      primaryEmail: null,
      primaryPhone: null,
      status: null,
      lifecycleStage: null,
      source: null,
      temperature: null,
      renewalQuarter: null,
      nextInteractionAt: null,
      nextInteractionName: null,
      nextInteractionRefId: null,
      nextInteractionIcon: null,
      nextInteractionColor: null,
      isActive: true,
    },
    profile: {
      id: PROFILE_ID,
      legalName: 'Acme Corporation',
      brandName: null,
      domain: null,
      websiteUrl: null,
      industry: null,
      sizeBucket: null,
      taxId: RESTORED_TAX_ID,
      annualRevenue: null,
    },
    tagIds: [],
    deals: [],
    members: [],
  }
}

function makeEm(existingProfile: ProfileRecord | null) {
  const entity = { id: COMPANY_ID, organizationId: ORG_ID, tenantId: TENANT_ID, kind: 'company' }
  const created: ProfileRecord[] = []
  const em = {
    fork: jest.fn(() => em),
    findOne: jest.fn(async (ctor: unknown) => {
      if (ctor === CustomerEntity) return entity
      if (ctor === CustomerCompanyProfile) return existingProfile
      return null
    }),
    find: jest.fn(async () => []),
    count: jest.fn(async () => 0),
    nativeDelete: jest.fn(async () => undefined),
    nativeUpdate: jest.fn(async () => undefined),
    flush: jest.fn(async () => undefined),
    persist: jest.fn(),
    remove: jest.fn(),
    create: jest.fn((ctor: unknown, data: ProfileRecord) => {
      if (ctor === CustomerCompanyProfile) created.push(data)
      return data
    }),
    getReference: jest.fn((_ctor: unknown, id: string) => ({ id })),
    transactional: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(em)),
    begin: jest.fn(async () => undefined),
    commit: jest.fn(async () => undefined),
    rollback: jest.fn(async () => undefined),
  }
  return { em, created }
}

function makeCtx(em: unknown): CommandRuntimeContext {
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
    request: undefined,
  } as unknown as CommandRuntimeContext
}

async function runUndo(commandId: string, em: unknown) {
  const handler = commandRegistry.get(commandId) as CommandHandler
  expect(handler?.undo).toBeDefined()
  await handler.undo!({
    input: {},
    ctx: makeCtx(em),
    logEntry: { payload: { undo: { before: makeBeforeSnapshot() } } },
  } as unknown as Parameters<NonNullable<CommandHandler['undo']>>[0])
}

describe('company VAT ID undo', () => {
  it.each(['customers.companies.update', 'customers.companies.delete'])(
    '%s undo restores the VAT ID on an existing profile',
    async (commandId) => {
      const profile: ProfileRecord = { id: PROFILE_ID, taxId: 'DE000000000', legalName: 'Changed' }
      const { em } = makeEm(profile)

      await runUndo(commandId, em)

      expect(profile.taxId).toBe(RESTORED_TAX_ID)
      expect(profile.legalName).toBe('Acme Corporation')
    },
  )

  it.each(['customers.companies.update', 'customers.companies.delete'])(
    '%s undo recreates a removed profile with its VAT ID',
    async (commandId) => {
      const { em, created } = makeEm(null)

      await runUndo(commandId, em)

      expect(created).toHaveLength(1)
      expect(created[0]).toMatchObject({ id: PROFILE_ID, taxId: RESTORED_TAX_ID })
    },
  )
})
