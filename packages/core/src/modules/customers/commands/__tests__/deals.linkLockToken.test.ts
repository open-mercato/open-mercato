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
  /** Monotonic tick, bumped on every EM read and every flush. */
  tick: number
  /** Tick at which the last read happened. */
  lastQueryTick: number
  /** Tick at which `updatedAt` was last assigned, or null if it never was. */
  touchTick: number | null
  /** Ticks at which reads happened, in order. */
  readTicks: number[]
  /** Ticks at which `em.flush()` was called, in order. */
  flushTicks: number[]
  /**
   * How many times `isPrimary` was assigned on an ALREADY EXISTING link row. Rows the run
   * creates itself are plain objects and never counted, so this isolates the churn the
   * primary-only branch used to produce on a save that changes nothing.
   */
  primaryFlagWrites: number
}

function emptyProbe(): Probe {
  return {
    tick: 0,
    lastQueryTick: 0,
    touchTick: null,
    readTicks: [],
    flushTicks: [],
    primaryFlagWrites: 0,
  }
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

function makeEm(
  deal: CustomerDeal,
  links: LinkFixtures,
  probe: Probe,
  scope: { tenantId: string; organizationId: string } = { tenantId: 'tenant-1', organizationId: 'org-1' },
) {
  const personLinks = (links.people ?? []).map((entry, index) => {
    const link: Record<string, unknown> = {
      id: `person-link-${index}`,
      deal,
      person: { id: entry.personId },
      participantRole: 'stakeholder',
      createdAt: BASE_UPDATED_AT,
    }
    let isPrimary = entry.isPrimary === true
    Object.defineProperty(link, 'isPrimary', {
      get: () => isPrimary,
      set: (next: boolean) => {
        isPrimary = next
        probe.primaryFlagWrites += 1
      },
      enumerable: true,
      configurable: true,
    })
    return link
  })
  const companyLinks = (links.companies ?? []).map((companyId, index) => ({
    id: `company-link-${index}`,
    deal,
    company: { id: companyId },
    createdAt: BASE_UPDATED_AT,
  }))

  const known = new Map<string, unknown>([
    [ADA, { id: ADA, ...scope, kind: 'person', deletedAt: null }],
    [BOB, { id: BOB, ...scope, kind: 'person', deletedAt: null }],
    [ACME, { id: ACME, ...scope, kind: 'company', deletedAt: null }],
    [GLOBEX, { id: GLOBEX, ...scope, kind: 'company', deletedAt: null }],
  ])

  const noteRead = () => {
    probe.tick += 1
    probe.lastQueryTick = probe.tick
    probe.readTicks.push(probe.tick)
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
    flush: jest.fn(async () => {
      probe.tick += 1
      probe.flushTicks.push(probe.tick)
    }),
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

const SCOPE_TENANT_ID = '550e8400-e29b-41d4-a716-4466554400f1'
const SCOPE_ORG_ID = '550e8400-e29b-41d4-a716-4466554400f2'

function makeCtx(em: any, scope?: { tenantId: string; orgId: string }) {
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
      tenantId: scope?.tenantId ?? 'tenant-1',
      orgId: scope?.orgId ?? 'org-1',
    } as any,
    selectedOrganizationId: scope?.orgId ?? 'org-1',
    organizationScope: null,
    organizationIds: null,
    request: undefined as any,
  }
}

async function runUpdate(links: LinkFixtures, input: Record<string, unknown>) {
  const handler = commandRegistry.get('customers.deals.update') as CommandHandler
  expect(handler).toBeDefined()
  const probe = emptyProbe()
  const deal = makeDeal(probe)
  const em = makeEm(deal, links, probe)
  await handler.execute!({ id: DEAL_ID, ...input }, makeCtx(em))
  return { deal, em, probe }
}

/**
 * A `DealSnapshot` as `loadDealSnapshot` would have produced it. Only the link fields vary
 * per case; the scalars mirror the fixture deal so the undo's scalar-restore phase is a
 * no-op and cannot be mistaken for the link work under test.
 */
function makeSnapshot(
  people: string[],
  companies: string[],
  primaryPersonEntityId: string | null = null,
): Record<string, unknown> {
  return {
    deal: {
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
    },
    people,
    primaryPersonEntityId,
    companies,
    transitions: [],
  }
}

async function runRestoreDirection(
  commandId: string,
  direction: 'undo' | 'redo',
  links: LinkFixtures,
  snapshot: { before?: unknown; after?: unknown },
) {
  const handler = commandRegistry.get(commandId) as CommandHandler
  expect(handler).toBeDefined()
  const run = handler[direction]
  expect(run).toBeDefined()
  const probe = emptyProbe()
  const deal = makeDeal(probe)
  const em = makeEm(deal, links, probe)
  await run!({
    logEntry: { resourceId: DEAL_ID, commandPayload: { undo: snapshot } },
    ctx: makeCtx(em),
  } as any)
  return { deal, em, probe }
}

/** The person ids the run actually recreated, in insertion order. */
function recreatedPersonIds(em: any): string[] {
  return em.create.mock.calls
    .filter((call: unknown[]) => call[0] === CustomerDealPersonLink)
    .map((call: any[]) => call[1].person.id as string)
}

/**
 * The token moved AND the assignment reached the database.
 *
 * The property that actually matters is *not* "the touch was the last event on the EM" —
 * that only holds for a single-field payload, where the sibling helper returns at its
 * `=== undefined` guard without querying. For the combined `{ personIds, companyIds }` shape
 * the deal is touched by `syncDealPeople` and then `syncDealCompanies` issues its own read,
 * which is still correct because `withAtomicFlush` flushes after **every** phase — an
 * invariant that lives in another package and that nothing here would otherwise pin.
 *
 * So assert the real thing: a flush follows the touch with no read in between. MikroORM
 * discards a pending scalar change when a query runs before the flush (SPEC-018), so a read
 * landing in that window is exactly the failure mode, whatever the payload shape.
 */
function expectTokenAdvanced(deal: CustomerDeal, probe: Probe) {
  expect(deal.updatedAt.getTime()).toBeGreaterThan(BASE_UPDATED_AT.getTime())
  expect(probe.touchTick).not.toBeNull()
  const touchTick = probe.touchTick as number
  const nextFlush = probe.flushTicks.find((tick) => tick > touchTick)
  expect(nextFlush).toBeDefined()
  const readsInWindow = probe.readTicks.filter(
    (tick) => tick > touchTick && tick < (nextFlush as number),
  )
  expect(readsInWindow).toEqual([])
}

function expectTokenUnchanged(deal: CustomerDeal, probe: Probe) {
  expect(deal.updatedAt.getTime()).toBe(BASE_UPDATED_AT.getTime())
  expect(probe.touchTick).toBeNull()
}

const COMBINED_NOTE =
  'the shape DealForm submits on every deal save — both lists, unconditionally'

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

  // The primary-only branch (personIds omitted) reaches the same no-op guard by a different
  // route. Without it the branch would clear the flag on every row and flush just to put it
  // back on the row it was already on.
  it('writes nothing at all on a primary-only payload that re-sends the current primary', async () => {
    const { deal, em, probe } = await runUpdate(
      { people: [{ personId: ADA, isPrimary: true }, { personId: BOB }] },
      { primaryPersonEntityId: ADA },
    )
    expectTokenUnchanged(deal, probe)
    // The branch used to clear the flag on every row, flush, and re-set it on the row it had
    // just cleared. Nothing was lost — these are updates, not a delete-and-recreate — but the
    // save wrote twice and passed through a transient state with no primary at all.
    expect(probe.primaryFlagWrites).toBe(0)
    expect(em.nativeDelete).not.toHaveBeenCalledWith(CustomerDealPersonLink, expect.anything())
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

  // `DealForm` puts personIds AND companyIds into its payload on every save, so this is the
  // dominant shape in production — and the only one where the people-side touch is followed by
  // another helper's read. It passes because withAtomicFlush flushes per phase; these cases are
  // what would catch that guarantee being removed.
  it(`advances the token when only the people set changes in a combined payload (${COMBINED_NOTE})`, async () => {
    const { deal, probe } = await runUpdate(
      { people: [{ personId: ADA }], companies: [ACME] },
      { personIds: [ADA, BOB], companyIds: [ACME] },
    )
    expectTokenAdvanced(deal, probe)
  })

  it('advances the token when both sets change in a combined payload', async () => {
    const { deal, probe } = await runUpdate(
      { people: [{ personId: ADA }], companies: [ACME] },
      { personIds: [ADA, BOB], companyIds: [ACME, GLOBEX] },
    )
    expectTokenAdvanced(deal, probe)
  })

  it('leaves the token alone when a combined payload changes neither set', async () => {
    const { deal, probe } = await runUpdate(
      { people: [{ personId: ADA }], companies: [ACME] },
      { personIds: [ADA], companyIds: [ACME] },
    )
    expectTokenUnchanged(deal, probe)
  })

  it('leaves the token and the rows alone when the company set is unchanged', async () => {
    const { deal, em, probe } = await runUpdate(
      { companies: [ACME, GLOBEX] },
      { companyIds: [GLOBEX, ACME] },
    )
    expectTokenUnchanged(deal, probe)
    expect(em.nativeDelete).not.toHaveBeenCalledWith(CustomerDealCompanyLink, expect.anything())
  })

  // The spec's blast-radius section asks that create and the undo directions keep producing the
  // exact sets they produce today. Create additionally opts out of the stamp: a brand-new deal
  // has no other session holding a token, and stamping there would only push `updated_at` past
  // `created_at` on every deal created with links.
  it('does not stamp the token on create, while still linking the requested people', async () => {
    const handler = commandRegistry.get('customers.deals.create') as CommandHandler
    expect(handler).toBeDefined()

    const probe = emptyProbe()
    const deal = makeDeal(probe)
    const em = makeEm(deal, {}, probe, {
      tenantId: SCOPE_TENANT_ID,
      organizationId: SCOPE_ORG_ID,
    })
    // The create path builds its own entity; hand back the fixture so the helpers operate on a
    // deal whose `updatedAt` is instrumented.
    em.create = jest.fn((ctor: unknown, payload: Record<string, unknown>) =>
      ctor === CustomerDeal ? Object.assign(deal, payload) : { __entity: ctor, ...payload },
    )

    await handler.execute!(
      {
        title: 'New expansion',
        organizationId: SCOPE_ORG_ID,
        tenantId: SCOPE_TENANT_ID,
        personIds: [ADA, BOB],
      },
      makeCtx(em, { tenantId: SCOPE_TENANT_ID, orgId: SCOPE_ORG_ID }),
    )

    expect(probe.touchTick).toBeNull()
    expect(deal.updatedAt.getTime()).toBe(BASE_UPDATED_AT.getTime())
    expect(em.persist).toHaveBeenCalledWith(
      expect.objectContaining({ __entity: CustomerDealPersonLink }),
    )
  })
})

/**
 * The three restore directions call the sync helpers WITHOUT `{ stampLockToken: false }`, so
 * unlike create they inherit both halves of this change: they stamp the token when the
 * replayed snapshot differs from what is on the deal now, and they take the new no-op early
 * return when it does not. The second half is what makes the spec's "an undo should not
 * re-date links it did not touch" executable rather than aspirational — before the early
 * return, replaying an identical set still deleted and recreated every row.
 *
 * The set assertions are the other half of the spec's acceptance criterion: whatever the
 * token does, a restore must still reproduce the snapshot's set exactly.
 */
describe('deal link restore directions — token and set fidelity', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  it('restores the snapshot set exactly and stamps the token when undoing an update', async () => {
    const { deal, em, probe } = await runRestoreDirection(
      'customers.deals.update',
      'undo',
      { people: [{ personId: BOB }], companies: [ACME] },
      { before: makeSnapshot([ADA], [ACME]), after: makeSnapshot([BOB], [ACME]) },
    )
    expect(recreatedPersonIds(em)).toEqual([ADA])
    expectTokenAdvanced(deal, probe)
  })

  it('restores the snapshot set exactly when redoing a create', async () => {
    const { deal, em, probe } = await runRestoreDirection(
      'customers.deals.create',
      'redo',
      { people: [{ personId: BOB }] },
      { after: makeSnapshot([ADA, BOB], []) },
    )
    expect(recreatedPersonIds(em)).toEqual([ADA, BOB])
    expectTokenAdvanced(deal, probe)
  })

  it('restores the snapshot set exactly when undoing a delete', async () => {
    const { em } = await runRestoreDirection(
      'customers.deals.delete',
      'undo',
      {},
      { before: makeSnapshot([ADA, BOB], [ACME], ADA) },
    )
    expect(recreatedPersonIds(em)).toEqual([ADA, BOB])
  })

  // The point of the early return, stated as a test: a restore whose snapshot already matches
  // the live rows must leave them alone. Deleting and recreating them would re-date every
  // surviving link and discard its participant_role — an undo of a change that never touched
  // those rows silently rewriting them.
  it('touches nothing when the replayed snapshot already matches the current links', async () => {
    const { deal, em, probe } = await runRestoreDirection(
      'customers.deals.update',
      'undo',
      { people: [{ personId: ADA }, { personId: BOB }], companies: [ACME] },
      {
        before: makeSnapshot([BOB, ADA], [ACME]),
        after: makeSnapshot([BOB, ADA], [ACME]),
      },
    )
    expect(em.nativeDelete).not.toHaveBeenCalledWith(CustomerDealPersonLink, expect.anything())
    expect(em.nativeDelete).not.toHaveBeenCalledWith(CustomerDealCompanyLink, expect.anything())
    expect(recreatedPersonIds(em)).toEqual([])
    expectTokenUnchanged(deal, probe)
  })
})
