/** @jest-environment node */

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(async (...args: unknown[]) => {
    const [em, entity, where, options] = args as [
      { find: (entity: unknown, where: unknown, options?: unknown) => Promise<unknown[]> },
      unknown,
      unknown,
      unknown,
    ]
    return em.find(entity, where, options)
  }),
  findOneWithDecryption: jest.fn(async (...args: unknown[]) => {
    const [em, entity, where, options] = args as [
      { findOne: (entity: unknown, where: unknown, options?: unknown) => Promise<unknown> },
      unknown,
      unknown,
      unknown,
    ]
    return em.findOne(entity, where, options)
  }),
}))

import '@open-mercato/core/modules/customers/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import {
  CustomerCompanyProfile,
  CustomerDeal,
  CustomerDealCompanyLink,
  CustomerEntity,
} from '../../data/entities'

const ORG_ID = '00000000-0000-4000-8000-0000000000a1'
const TENANT_ID = '00000000-0000-4000-8000-0000000000b1'
const COMPANY_ID = '00000000-0000-4000-8000-0000000000c1'
const SOURCE_DEAL_ID = '00000000-0000-4000-8000-0000000000d1'
const SURVIVOR_DEAL_ID = '00000000-0000-4000-8000-0000000000d2'
const ADDED_DEAL_ID = '00000000-0000-4000-8000-0000000000d3'
const SOURCE_LINK_ID = '00000000-0000-4000-8000-0000000000e1'
const ADDED_LINK_ID = '00000000-0000-4000-8000-0000000000e3'

type DealLinkSnapshot = { id: string; dealId: string; createdAt: Date }
type CurrentLink = { id: string; deal: { id: string } }

function makeSnapshot(deals: DealLinkSnapshot[]) {
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
      id: 'profile-1',
      legalName: null,
      brandName: null,
      domain: null,
      websiteUrl: null,
      industry: null,
      sizeBucket: null,
      taxId: null,
      annualRevenue: null,
    },
    tagIds: [],
    deals,
    members: [],
  }
}

function makeEm(options: { liveDealIds: string[]; currentLinks: CurrentLink[] }) {
  const company = { id: COMPANY_ID, organizationId: ORG_ID, tenantId: TENANT_ID, kind: 'company' }
  const profile = { id: 'profile-1' }
  const em = {
    fork: jest.fn(() => em),
    findOne: jest.fn(async (ctor: unknown) => {
      if (ctor === CustomerEntity) return company
      if (ctor === CustomerCompanyProfile) return profile
      return null
    }),
    find: jest.fn(async (ctor: unknown) => {
      if (ctor === CustomerDeal) return options.liveDealIds.map((id) => ({ id }))
      if (ctor === CustomerDealCompanyLink) return options.currentLinks
      return []
    }),
    count: jest.fn(async () => 0),
    execute: jest.fn(async () => []),
    nativeDelete: jest.fn(async () => 0),
    nativeUpdate: jest.fn(async () => 0),
    flush: jest.fn(async () => undefined),
    persist: jest.fn(),
    remove: jest.fn(),
    create: jest.fn((_ctor: unknown, data: Record<string, unknown>) => data),
    getReference: jest.fn((_ctor: unknown, id: string) => ({ id })),
    transactional: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(em)),
    begin: jest.fn(async () => undefined),
    commit: jest.fn(async () => undefined),
    rollback: jest.fn(async () => undefined),
  }
  return { em, company }
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
        throw new Error(`[internal] Unexpected DI token: ${token}`)
      },
    },
    auth: { sub: 'user-1', tenantId: TENANT_ID, orgId: ORG_ID },
    selectedOrganizationId: ORG_ID,
    organizationScope: null,
    organizationIds: null,
    request: undefined,
  } as unknown as CommandRuntimeContext
}

async function runUndo(em: unknown, beforeDeals: DealLinkSnapshot[], afterDeals: DealLinkSnapshot[] | null) {
  const handler = commandRegistry.get('customers.companies.update') as CommandHandler
  await handler.undo!({
    input: {},
    ctx: makeCtx(em),
    logEntry: {
      commandPayload: {
        undo: {
          before: makeSnapshot(beforeDeals),
          after: afterDeals ? makeSnapshot(afterDeals) : null,
        },
      },
    },
  } as unknown as Parameters<NonNullable<CommandHandler['undo']>>[0])
}

function linkCreates(em: ReturnType<typeof makeEm>['em']) {
  return em.create.mock.calls.filter(([ctor]) => ctor === CustomerDealCompanyLink).map(([, data]) => data)
}

function linkDeletes(em: ReturnType<typeof makeEm>['em']) {
  return em.nativeDelete.mock.calls.filter(([ctor]) => ctor === CustomerDealCompanyLink).map(([, where]) => where)
}

const sourceLink: DealLinkSnapshot = { id: SOURCE_LINK_ID, dealId: SOURCE_DEAL_ID, createdAt: new Date('2026-11-01T10:00:00.000Z') }
const addedLink: DealLinkSnapshot = { id: ADDED_LINK_ID, dealId: ADDED_DEAL_ID, createdAt: new Date('2026-11-02T10:00:00.000Z') }

describe('customers.companies.update undo — Deal links', () => {
  afterEach(() => jest.clearAllMocks())

  it('keeps a link a later Deal merge moved to the survivor when the edit did not change links', async () => {
    const { em } = makeEm({
      liveDealIds: [SURVIVOR_DEAL_ID],
      currentLinks: [{ id: SOURCE_LINK_ID, deal: { id: SURVIVOR_DEAL_ID } }],
    })

    await runUndo(em, [sourceLink], [sourceLink])

    expect(linkDeletes(em)).toEqual([])
    expect(linkCreates(em)).toEqual([])
    expect(em.execute).not.toHaveBeenCalled()
  })

  it('leaves links untouched for a log entry without an after snapshot', async () => {
    const { em } = makeEm({ liveDealIds: [], currentLinks: [] })

    await runUndo(em, [sourceLink], null)

    expect(linkDeletes(em)).toEqual([])
    expect(linkCreates(em)).toEqual([])
  })

  it('keeps the survivor link when a merge committed between the before and after snapshots of the edit', async () => {
    const movedLink: DealLinkSnapshot = { id: SOURCE_LINK_ID, dealId: SURVIVOR_DEAL_ID, createdAt: sourceLink.createdAt }
    const { em } = makeEm({
      liveDealIds: [SURVIVOR_DEAL_ID],
      currentLinks: [{ id: SOURCE_LINK_ID, deal: { id: SURVIVOR_DEAL_ID } }],
    })

    await runUndo(em, [sourceLink], [movedLink])

    expect(linkDeletes(em)).toEqual([])
    expect(linkCreates(em)).toEqual([])
    expect(em.execute).not.toHaveBeenCalled()
  })

  it('never restores, deletes or locks Deal links because the update command does not change them', async () => {
    const { em } = makeEm({ liveDealIds: [SOURCE_DEAL_ID, ADDED_DEAL_ID], currentLinks: [] })

    await runUndo(em, [sourceLink], [addedLink])

    expect(linkDeletes(em)).toEqual([])
    expect(linkCreates(em)).toEqual([])
    expect(em.execute).not.toHaveBeenCalled()
    expect(em.find.mock.calls.some(([ctor]) => ctor === CustomerDeal)).toBe(false)
  })
})
