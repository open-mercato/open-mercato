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

const mockFindWithDecryption = jest.fn(async (...args: unknown[]): Promise<unknown[]> => {
  const [manager, entity, where, options] = args as [
    { find: (entity: unknown, where: unknown, options?: unknown) => Promise<unknown[]> },
    unknown, unknown, unknown,
  ]
  return manager.find(entity, where, options)
})
const mockFindOneWithDecryption = jest.fn(async () => null)

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args as []),
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args as []),
}))

import '@open-mercato/core/modules/customers/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import {
  CustomerActivity,
  CustomerComment,
  CustomerDeal,
  CustomerInteraction,
  CustomerDealPersonLink,
  CustomerEntity,
} from '../../data/entities'

const ORG_ID = 'org-deal-link'
const TENANT_ID = 'tenant-deal-link'
const ENTITY_ID = 'person-deal-link'
const DEAL_ID = '123e4567-e89b-41d3-a456-426614174100'
const MISSING_DEAL_ID = '123e4567-e89b-41d3-a456-426614174101'
const CHIP_DEAL_ID = '123e4567-e89b-41d3-a456-426614174102'
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
    execute: jest.fn(async () => []),
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

async function restoreDeletedCustomer(before: Record<string, unknown>, kind: 'people' | 'companies') {
  const entity = makeEntity()
  const em = makeEm(entity)
  const ctx = makeCtx(em)
  mockFindOneWithDecryption.mockImplementation(async (_em: unknown, ctor: unknown) => {
    if (ctor === CustomerEntity) return entity
    return null
  })
  if (kind === 'companies') entity.kind = 'company'
  const handler = commandRegistry.get(`customers.${kind}.delete`) as CommandHandler
  await handler.undo!({ input: undefined, logEntry: { commandPayload: { undo: { before } } } as any, ctx })
  return em
}

async function runUndo(before: Record<string, unknown>) {
  const em = await restoreDeletedCustomer(before, 'people')
  return (em.create as jest.Mock).mock.calls.find(([ctor]) => ctor === CustomerDealPersonLink)
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


describe.each(['people', 'companies'] as const)('customers.%s.delete — undo serializes Deal restores', (kind) => {
  afterEach(() => jest.clearAllMocks())

  it('locks Deal references before checking liveness and preserves children when their Deal disappeared', async () => {
    const liveChip = { type: 'deal', id: DEAL_ID.toUpperCase(), label: 'Live' }
    const personChip = { type: 'person', id: ENTITY_ID, label: 'Contact' }
    const em = await restoreDeletedCustomer({
      ...makeBefore({ id: LINK_ID, dealId: DEAL_ID }),
      comments: [{ id: 'comment-missing', dealId: MISSING_DEAL_ID }, { id: 'comment-live', dealId: DEAL_ID }],
      activities: [{ id: 'activity-missing', dealId: MISSING_DEAL_ID }],
      interactions: [{
        id: 'interaction-missing',
        dealId: MISSING_DEAL_ID,
        interactionType: 'task',
        linkedEntities: [liveChip, { type: 'deal', id: CHIP_DEAL_ID, label: 'Missing' }, personChip],
      }],
    }, kind)

    expect((em.execute as jest.Mock).mock.calls.map(([, [key]]) => key)).toEqual(
      [DEAL_ID, MISSING_DEAL_ID, CHIP_DEAL_ID].map((id) =>
        `entity-reference:customers:customer_deal:${TENANT_ID}:${ORG_ID}:${id}`,
      ),
    )
    const dealLookup = (em.find as jest.Mock).mock.calls.findIndex(([entity]) => entity === CustomerDeal)
    const createdComment = (em.create as jest.Mock).mock.calls.findIndex(([entity]) => entity === CustomerComment)
    expect(em.find.mock.calls[dealLookup][1]).toMatchObject({
      tenantId: TENANT_ID, organizationId: ORG_ID, deletedAt: null,
    })
    expect(em.begin.mock.invocationCallOrder[0]).toBeLessThan(em.execute.mock.invocationCallOrder[0])
    expect(em.execute.mock.invocationCallOrder.at(-1)).toBeLessThan(em.find.mock.invocationCallOrder[dealLookup])
    expect(em.find.mock.invocationCallOrder[dealLookup]).toBeLessThan(em.create.mock.invocationCallOrder[createdComment])
    expect(em.create.mock.invocationCallOrder[createdComment]).toBeLessThan(em.commit.mock.invocationCallOrder[0])
    expect(em.create).toHaveBeenCalledWith(CustomerComment, expect.objectContaining({ id: 'comment-missing', deal: null }))
    expect(em.create).toHaveBeenCalledWith(CustomerComment, expect.objectContaining({ id: 'comment-live', deal: { id: DEAL_ID } }))
    expect(em.create).toHaveBeenCalledWith(CustomerActivity, expect.objectContaining({ id: 'activity-missing', deal: null }))
    expect(em.create).toHaveBeenCalledWith(CustomerInteraction, expect.objectContaining({
      id: 'interaction-missing', dealId: null, linkedEntities: [liveChip, personChip],
    }))
  })
})
