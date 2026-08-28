/**
 * The deal's optimistic-lock token is `customer_deals.updated_at`, and `CustomerDeal.updatedAt`
 * is `onUpdate`-only, so it advances only when the deal entity itself enters the change set.
 * A `{ id, personIds }` or `{ id, companyIds }` payload mutates link rows exclusively, so
 * without an explicit touch the token never moved and two clients editing the same deal's links
 * from the same base version both passed the version check — the later stale whole-set payload
 * silently reinstating what the earlier one removed.
 *
 * Three properties are pinned here, and the third is the one that is easy to get wrong:
 *
 *  1. a real link change advances the token;
 *  2. a write that changes nothing does not (an idle save must not invalidate other sessions),
 *     and does not delete/recreate the rows either;
 *  3. the touch is the LAST thing each helper does. MikroORM v7 discards a pending scalar
 *     change when a query runs on the same EntityManager before the flush (SPEC-018), and these
 *     helpers query — `requireCustomerEntity` per linked id. Touching before those reads leaves
 *     the assignment visible on the in-memory entity while no UPDATE is ever issued, so an
 *     assertion on `deal.updatedAt` alone passes against a completely broken implementation.
 *     The `queryOrder` instrumentation below is what makes that failure observable in a unit
 *     test: it records when the touch happened relative to the last query on the same EM.
 */

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (emInstance: any, entity: unknown, filters: unknown, opts?: unknown) =>
    emInstance.find(entity, filters, opts),
  findOneWithDecryption: (emInstance: any, entity: unknown, filters: unknown, opts?: unknown) =>
    emInstance.findOne(entity, filters, opts),
}))

import '@open-mercato/core/modules/customers/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import {
  CustomerDeal,
  CustomerDealCompanyLink,
  CustomerDealPersonLink,
  CustomerDealStageTransition,
  CustomerDictionaryEntry,
  CustomerEntity,
  CustomerPipelineStage,
} from '../../data/entities'

const DEAL_ID = '550e8400-e29b-41d4-a716-446655440000'
const ADA = '550e8400-e29b-41d4-a716-4466554400a1'
const BOB = '550e8400-e29b-41d4-a716-4466554400a2'
const ACME = '550e8400-e29b-41d4-a716-4466554400c1'
const GLOBEX = '550e8400-e29b-41d4-a716-4466554400c2'

const BASE_UPDATED_AT = new Date('2026-04-10T08:00:00.000Z')

type Probe = {
  /** Monotonic tick, bumped on every EM read. */
  tick: number
  /** Tick at which the last read happened. */
  lastQueryTick: number
  /** Tick at which `updatedAt` was assigned, or null if it never was. */
  touchTick: number | null
}

function makeDeal(probe: Probe): CustomerDeal {
  const deal: Record<string, unknown> = {
    id: DEAL_ID,
    organizationId: 'org-1',
    tenantId: 'tenant-1',
    title: 'Expansion renewal',
    description: null,
    status: 'open',
    pipelineStage: 'Discovery',
    pipelineId: null,
    pipelineStageId: null,
    valueAmount: '12000',
    valueCurrency: 'USD',
    probability: 65,
    expectedCloseAt: null,
    ownerUserId: null,
    source: 'Referral',
    closureOutcome: null,
    lossReasonId: null,
    lossNotes: null,
    createdAt: BASE_UPDATED_AT,
    deletedAt: null,
    people: [],
    companies: [],
    activities: [],
    comments: [],
    stageTransitions: [],
  }
  let updatedAt = BASE_UPDATED_AT
  Object.defineProperty(deal, 'updatedAt', {
    get: () => updatedAt,
    set: (next: Date) => {
      updatedAt = next
      probe.touchTick = probe.tick
    },
    enumerable: true,
    configurable: true,
  })
  return deal as unknown as CustomerDeal
}

type LinkFixtures = {
  people?: Array<{ personId: string; isPrimary?: boolean }>
  companies?: string[]
}

function makeEm(deal: CustomerDeal, links: LinkFixtures, probe: Probe) {
  const personLinks = (links.people ?? []).map((entry, index) => ({
    id: `person-link-${index}`,
    deal,
    person: { id: entry.personId },
    isPrimary: entry.isPrimary === true,
    participantRole: 'stakeholder',
    createdAt: BASE_UPDATED_AT,
  }))
  const companyLinks = (links.companies ?? []).map((companyId, index) => ({
    id: `company-link-${index}`,
    deal,
    company: { id: companyId },
    createdAt: BASE_UPDATED_AT,
  }))

  const known = new Map<string, unknown>([
    [ADA, { id: ADA, organizationId: 'org-1', tenantId: 'tenant-1', kind: 'person', deletedAt: null }],
    [BOB, { id: BOB, organizationId: 'org-1', tenantId: 'tenant-1', kind: 'person', deletedAt: null }],
    [ACME, { id: ACME, organizationId: 'org-1', tenantId: 'tenant-1', kind: 'company', deletedAt: null }],
    [GLOBEX, { id: GLOBEX, organizationId: 'org-1', tenantId: 'tenant-1', kind: 'company', deletedAt: null }],
  ])

  const noteRead = () => {
    probe.tick += 1
    probe.lastQueryTick = probe.tick
  }

  const em: any = {
    findOne: jest.fn(async (ctor: unknown, where: Record<string, unknown>) => {
      noteRead()
      if (ctor === CustomerDeal && where.id === deal.id) return deal
      if (ctor === CustomerEntity) return known.get(where.id as string) ?? null
      if (ctor === CustomerDealPersonLink) return personLinks.find((link) => link.isPrimary) ?? null
      if (ctor === CustomerDealStageTransition) return null
      if (ctor === CustomerDictionaryEntry) return null
      if (ctor === CustomerPipelineStage) return null
      return null
    }),
    find: jest.fn(async (ctor: unknown) => {
      noteRead()
      if (ctor === CustomerDealPersonLink) return personLinks
      if (ctor === CustomerDealCompanyLink) return companyLinks
      return []
    }),
    nativeDelete: jest.fn(async () => {}),
    create: jest.fn((ctor: unknown, payload: Record<string, unknown>) => ({ __entity: ctor, ...payload })),
    persist: jest.fn(() => {}),
    flush: jest.fn(async () => {}),
    transactional: jest.fn(async (fn: (inner: any) => Promise<unknown>) => fn(em)),
    begin: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    getReference: jest.fn((_ctor: unknown, id: string) => ({ id })),
    remove: jest.fn(),
    getKysely: jest.fn(() => {
      throw Object.assign(new Error('no kysely in this test'), { code: '42P01' })
    }),
  }
  em.fork = jest.fn(() => em)
  return em
}

function makeCtx(em: any) {
  const engine: any = {
    setCustomFields: jest.fn(async () => {}),
    emitOrmEntityEvent: jest.fn(async () => {}),
  }
  const queue: any[] = []
  engine.markOrmEntityChange = jest.fn((entry: any) => {
    if (entry?.entity) queue.push(entry)
  })
  engine.flushOrmEntityChanges = jest.fn(async () => {
    while (queue.length > 0) await engine.emitOrmEntityEvent(queue.shift())
  })

  return {
    container: {
      resolve: (token: string) => {
        if (token === 'em') return em
        if (token === 'dataEngine') return engine as unknown as DataEngine
        if (token === 'eventBus') return undefined
        throw new Error(`Unexpected dependency: ${token}`)
      },
    } as any,
    auth: {
      sub: '550e8400-e29b-41d4-a716-446655440099',
      tenantId: 'tenant-1',
      orgId: 'org-1',
    } as any,
    selectedOrganizationId: 'org-1',
    organizationScope: null,
    organizationIds: null,
    request: undefined as any,
  }
}

async function runUpdate(links: LinkFixtures, input: Record<string, unknown>) {
  const handler = commandRegistry.get('customers.deals.update') as CommandHandler
  expect(handler).toBeDefined()
  const probe: Probe = { tick: 0, lastQueryTick: 0, touchTick: null }
  const deal = makeDeal(probe)
  const em = makeEm(deal, links, probe)
  await handler.execute!({ id: DEAL_ID, ...input }, makeCtx(em))
  return { deal, em, probe }
}

/**
 * The token moved AND the assignment was not stranded behind a later read on the same EM.
 * Without the second half, an implementation that touches before `requireCustomerEntity`
 * passes here while issuing no UPDATE at all.
 */
function expectTokenAdvanced(deal: CustomerDeal, probe: Probe) {
  expect(deal.updatedAt.getTime()).toBeGreaterThan(BASE_UPDATED_AT.getTime())
  expect(probe.touchTick).not.toBeNull()
  expect(probe.touchTick).toBeGreaterThanOrEqual(probe.lastQueryTick)
}

function expectTokenUnchanged(deal: CustomerDeal, probe: Probe) {
  expect(deal.updatedAt.getTime()).toBe(BASE_UPDATED_AT.getTime())
  expect(probe.touchTick).toBeNull()
}

describe('customers.deals.update — deal lock token on link changes', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  it('advances the token when a person is added, after the last read', async () => {
    const { deal, probe } = await runUpdate({ people: [{ personId: ADA }] }, { personIds: [ADA, BOB] })
    expectTokenAdvanced(deal, probe)
  })

  it('advances the token when a person is removed', async () => {
    const { deal, probe } = await runUpdate(
      { people: [{ personId: ADA }, { personId: BOB }] },
      { personIds: [BOB] },
    )
    expectTokenAdvanced(deal, probe)
  })

  it('advances the token when every person is unlinked', async () => {
    const { deal, probe } = await runUpdate({ people: [{ personId: ADA }] }, { personIds: [] })
    expectTokenAdvanced(deal, probe)
  })

  it('leaves the token and the rows alone when the people set is unchanged', async () => {
    const { deal, em, probe } = await runUpdate(
      { people: [{ personId: ADA }, { personId: BOB }] },
      { personIds: [BOB, ADA] },
    )
    expectTokenUnchanged(deal, probe)
    // A no-op must not delete and recreate the links either: that would silently discard
    // participant_role, created_at and the link ids while reporting no change to other sessions.
    expect(em.nativeDelete).not.toHaveBeenCalledWith(CustomerDealPersonLink, expect.anything())
    expect(em.create).not.toHaveBeenCalledWith(CustomerDealPersonLink, expect.anything())
  })

  it('advances the token when the primary flag moves within an unchanged set', async () => {
    const { deal, probe } = await runUpdate(
      { people: [{ personId: ADA, isPrimary: true }, { personId: BOB }] },
      { personIds: [ADA, BOB], primaryPersonEntityId: BOB },
    )
    expectTokenAdvanced(deal, probe)
  })

  it('leaves the token alone when the primary is re-sent unchanged', async () => {
    const { deal, probe } = await runUpdate(
      { people: [{ personId: ADA, isPrimary: true }, { personId: BOB }] },
      { personIds: [ADA, BOB], primaryPersonEntityId: ADA },
    )
    expectTokenUnchanged(deal, probe)
  })

  it('advances the token on a primary-only payload that omits personIds', async () => {
    const { deal, probe } = await runUpdate(
      { people: [{ personId: ADA, isPrimary: true }, { personId: BOB }] },
      { primaryPersonEntityId: BOB },
    )
    expectTokenAdvanced(deal, probe)
  })

  it('advances the token when the company set changes, after the last read', async () => {
    const { deal, probe } = await runUpdate({ companies: [ACME] }, { companyIds: [ACME, GLOBEX] })
    expectTokenAdvanced(deal, probe)
  })

  it('leaves the token and the rows alone when the company set is unchanged', async () => {
    const { deal, em, probe } = await runUpdate(
      { companies: [ACME, GLOBEX] },
      { companyIds: [GLOBEX, ACME] },
    )
    expectTokenUnchanged(deal, probe)
    expect(em.nativeDelete).not.toHaveBeenCalledWith(CustomerDealCompanyLink, expect.anything())
  })
})
