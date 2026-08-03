/**
 * Undo of a person delete must restore the deal-link `isPrimary` flag, otherwise
 * the deal silently loses its primary contact (and the activity-target default).
 * Snapshots written before the flag existed restore as non-primary.
 */

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

const mockFindWithDecryption = jest.fn(async () => [])
const mockFindOneWithDecryption = jest.fn(async () => null)

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args as []),
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args as []),
}))

import '@open-mercato/core/modules/customers/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import {
  CustomerDeal,
  CustomerDealPersonLink,
  CustomerEntity,
} from '../../data/entities'

const ORG_ID = 'org-deal-link'
const TENANT_ID = 'tenant-deal-link'
const ENTITY_ID = 'person-deal-link'
const DEAL_ID = 'deal-deal-link'
const LINK_ID = 'link-deal-link'

function makeEntity(): CustomerEntity {
  return {
    id: ENTITY_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    kind: 'person',
    displayName: 'Primary Contact',
    description: null,
    ownerUserId: null,
    primaryEmail: null,
    primaryPhone: null,
    status: null,
    lifecycleStage: null,
    source: null,
    nextInteractionAt: null,
    nextInteractionName: null,
    nextInteractionRefId: null,
    nextInteractionIcon: null,
    nextInteractionColor: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  } as unknown as CustomerEntity
}

function makeEm(entity: CustomerEntity) {
  const em: any = {
    fork: jest.fn().mockReturnThis(),
    findOne: jest.fn(async (ctor: any) => (ctor === CustomerEntity ? entity : null)),
    find: jest.fn(async (ctor: any) => (ctor === CustomerDeal ? [{ id: DEAL_ID }] : [])),
    count: jest.fn(async () => 0),
    nativeDelete: jest.fn(async () => undefined),
    remove: jest.fn().mockReturnValue({ flush: jest.fn().mockResolvedValue(undefined) }),
    flush: jest.fn().mockResolvedValue(undefined),
    transactional: jest.fn(async (fn: any) => fn(em)),
    begin: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    create: jest.fn((_ctor: any, data: any) => ({ id: 'new-id', ...data })),
    persist: jest.fn(),
    getReference: jest.fn((_ctor: any, id: string) => ({ id })),
  }
  return em
}

function makeCtx(em: any): CommandRuntimeContext {
  const dataEngine: any = {
    setCustomFields: jest.fn(async () => {}),
    emitOrmEntityEvent: jest.fn(async () => {}),
    markOrmEntityChange: jest.fn(),
    flushOrmEntityChanges: jest.fn(async () => {}),
  }
  return {
    container: {
      resolve: (token: string): any => {
        if (token === 'em') return em
        if (token === 'dataEngine') return dataEngine
        throw new Error(`Unexpected DI token: ${token}`)
      },
    } as any,
    auth: { sub: 'user-1', tenantId: TENANT_ID, orgId: ORG_ID } as any,
    selectedOrganizationId: ORG_ID,
    organizationScope: null,
    organizationIds: null,
    request: undefined as any,
  }
}

function makeBefore(dealLink: Record<string, unknown>) {
  return {
    entity: {
      id: ENTITY_ID,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      kind: 'person' as const,
      displayName: 'Primary Contact',
      description: null,
      ownerUserId: null,
      primaryEmail: null,
      primaryPhone: null,
      status: null,
      lifecycleStage: null,
      source: null,
      nextInteractionAt: null,
      nextInteractionName: null,
      nextInteractionRefId: null,
      isActive: true,
    },
    profile: {
      id: 'profile-1',
      firstName: 'Primary',
      lastName: 'Contact',
      preferredName: null,
      jobTitle: null,
      department: null,
      seniority: null,
      timezone: null,
      linkedInUrl: null,
      twitterUrl: null,
      companyEntityId: null,
    },
    deals: [dealLink],
    comments: [],
    addresses: [],
    tagIds: [],
    custom: {},
  }
}

async function runUndo(before: Record<string, unknown>) {
  const entity = makeEntity()
  const em = makeEm(entity)
  const ctx = makeCtx(em)
  mockFindOneWithDecryption.mockImplementation(async (_em: unknown, ctor: unknown) => {
    if (ctor === CustomerEntity) return entity
    return null
  })
  const handler = commandRegistry.get('customers.people.delete') as CommandHandler
  await handler.undo!({ input: undefined, logEntry: { commandPayload: { undo: { before } } } as any, ctx })
  return (em.create as jest.Mock).mock.calls.find(([ctor]: [any]) => ctor === CustomerDealPersonLink)
}

describe('customers.people.delete — undo restores deal-link primary flag', () => {
  afterEach(() => jest.clearAllMocks())

  it('restores isPrimary when the snapshot recorded a primary contact', async () => {
    const call = await runUndo(makeBefore({
      id: LINK_ID,
      dealId: DEAL_ID,
      participantRole: 'buyer',
      isPrimary: true,
      createdAt: new Date('2026-07-01T10:00:00.000Z'),
    }))

    expect(call).toBeDefined()
    expect(call![1]).toMatchObject({ id: LINK_ID, participantRole: 'buyer', isPrimary: true })
  })

  it('restores a pre-flag snapshot as non-primary', async () => {
    const call = await runUndo(makeBefore({
      id: LINK_ID,
      dealId: DEAL_ID,
      participantRole: null,
      createdAt: new Date('2026-07-01T10:00:00.000Z'),
    }))

    expect(call).toBeDefined()
    expect(call![1]).toMatchObject({ id: LINK_ID, isPrimary: false })
  })
})
