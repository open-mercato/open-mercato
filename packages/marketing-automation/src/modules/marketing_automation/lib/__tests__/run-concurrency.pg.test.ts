/**
 * Behavioural cover for `claimRun`'s compare-and-swap and `createRun`'s dedup insert against a real
 * PostgreSQL. Phase 1b's own unit tests drive both through a hand-rolled `fakeEm` whose
 * `nativeUpdate` just records its arguments — nothing proves that two workers racing for the same
 * run, or two deliveries of the same occurrence, actually resolve to exactly one winner under a
 * real unique index and real row-level locking.
 *
 * Gated on OM_MARKETING_AUTOMATION_PG_URL — a throwaway database, since the suite creates and drops
 * its own table. Run it with, for example:
 *
 *   docker run -d --rm --name om-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=om \
 *     -p 54372:5432 postgres:18-alpine
 *   OM_MARKETING_AUTOMATION_PG_URL=postgres://postgres:postgres@127.0.0.1:54372/om \
 *     yarn workspace @open-mercato/marketing-automation jest run-concurrency.pg
 */
import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy'
import { MikroORM, type EntityManager } from '@mikro-orm/postgresql'
import { MarketingCampaignRun } from '../../data/entities'
import { applyTransition, claimRun, createRun, failRun, type RunScope } from '../runs'

const PG_URL = process.env.OM_MARKETING_AUTOMATION_PG_URL ?? ''
const maybe = PG_URL ? describe : describe.skip

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const OTHER_TENANT = '33333333-3333-4333-8333-333333333333'
const OTHER_ORG = '44444444-4444-4444-8444-444444444444'

maybe('run claim/create concurrency against PostgreSQL', () => {
  jest.setTimeout(60_000)
  let orm: MikroORM

  beforeAll(async () => {
    orm = await MikroORM.init({
      clientUrl: PG_URL,
      entities: [MarketingCampaignRun],
      metadataProvider: ReflectMetadataProvider,
      allowGlobalContext: true,
      debug: false,
      pool: { min: 0, max: 10 },
    })
    await orm.schema.refresh()
  }, 60_000)

  afterAll(async () => {
    await orm?.close(true)
  })

  const scope: RunScope = { tenantId: TENANT, organizationId: ORG }
  const otherScope: RunScope = { tenantId: OTHER_TENANT, organizationId: OTHER_ORG }

  /**
   * The boundary this risk-high module depends on, proven against a real row rather than a
   * `fakeEm` that only records the arguments a WHERE clause was built with. Each assertion reads
   * the row back through a FRESH fork rather than trusting the function's own return value,
   * because `nativeUpdate` never touches the identity map and because the claim is specifically
   * that the ROW is untouched, which the return value alone cannot prove.
   */
  it('leaves the row untouched when claimRun is called with another tenant or organization', async () => {
    const em = orm.em.fork()
    const run = em.create(MarketingCampaignRun, {
      campaignId: randomUUID(),
      organizationId: ORG,
      tenantId: TENANT,
      subjectEntityId: null,
      triggerEventId: 'order.created',
      context: {},
      currentStepIndex: 0,
      stepLog: [],
      status: 'waiting',
      resumeAt: new Date(Date.now() - 1000),
      attempts: 0,
    })
    em.persist(run)
    await em.flush()

    const now = new Date()
    const wrongTenant = await claimRun(orm.em.fork(), run.id, { tenantId: OTHER_TENANT, organizationId: ORG }, now)
    const wrongOrg = await claimRun(orm.em.fork(), run.id, { tenantId: TENANT, organizationId: OTHER_ORG }, now)
    expect(wrongTenant).toBeNull()
    expect(wrongOrg).toBeNull()

    const stillUnclaimed = await orm.em.fork().findOneOrFail(MarketingCampaignRun, { id: run.id })
    expect(stillUnclaimed.status).toBe('waiting')
    expect(stillUnclaimed.claimToken).toBeNull()

    // The row is genuinely still claimable — the wrong-scope attempts did not consume it.
    const correctScope = await claimRun(orm.em.fork(), run.id, scope, now)
    expect(correctScope).not.toBeNull()
  })

  it('leaves the row untouched when applyTransition is called with another tenant or organization', async () => {
    const em = orm.em.fork()
    const run = em.create(MarketingCampaignRun, {
      campaignId: randomUUID(),
      organizationId: ORG,
      tenantId: TENANT,
      subjectEntityId: null,
      triggerEventId: 'order.created',
      context: {},
      currentStepIndex: 0,
      stepLog: [],
      status: 'waiting',
      resumeAt: new Date(Date.now() - 1000),
      attempts: 0,
    })
    em.persist(run)
    await em.flush()

    const now = new Date()
    const claimToken = await claimRun(orm.em.fork(), run.id, scope, now)
    expect(claimToken).not.toBeNull()

    const wrongScopeApplied = await applyTransition(
      orm.em.fork(),
      run.id,
      otherScope,
      claimToken as string,
      { kind: 'completed', stepLog: [], context: {} },
      now,
    )
    expect(wrongScopeApplied).toBe(false)

    const stillClaimed = await orm.em.fork().findOneOrFail(MarketingCampaignRun, { id: run.id })
    expect(stillClaimed.status).toBe('claimed')
    expect(stillClaimed.claimToken).toBe(claimToken)
    expect(stillClaimed.completedAt).toBeNull()

    // The claim is genuinely still live — the wrong-scope attempt did not spend it.
    const correctScopeApplied = await applyTransition(
      orm.em.fork(),
      run.id,
      scope,
      claimToken as string,
      { kind: 'completed', stepLog: [], context: {} },
      now,
    )
    expect(correctScopeApplied).toBe(true)
  })

  it('leaves the row untouched when failRun is called with another tenant or organization', async () => {
    const em = orm.em.fork()
    const run = em.create(MarketingCampaignRun, {
      campaignId: randomUUID(),
      organizationId: ORG,
      tenantId: TENANT,
      subjectEntityId: null,
      triggerEventId: 'order.created',
      context: {},
      currentStepIndex: 0,
      stepLog: [],
      status: 'waiting',
      resumeAt: new Date(Date.now() - 1000),
      attempts: 0,
    })
    em.persist(run)
    await em.flush()

    const now = new Date()
    const claimToken = await claimRun(orm.em.fork(), run.id, scope, now)
    expect(claimToken).not.toBeNull()

    // `failRun`'s own return value is not the thing under test here — only `MarketingCampaignRun`'s
    // actual, persisted row says whether the wrong-scope write was ever applied.
    await failRun(
      orm.em.fork(),
      run.id,
      otherScope,
      claimToken as string,
      { attempts: 0, error: new Error('QA induced failure'), stepLog: [], resumeStepIndex: 0, context: {} },
      now,
    )

    const stillClaimed = await orm.em.fork().findOneOrFail(MarketingCampaignRun, { id: run.id })
    expect(stillClaimed.status).toBe('claimed')
    expect(stillClaimed.claimToken).toBe(claimToken)
    expect(stillClaimed.attempts).toBe(0)
    expect(stillClaimed.lastError).toBeNull()
  })

  it('lets exactly one of two concurrent claimers take the run', async () => {
    const em = orm.em.fork()
    const run = em.create(MarketingCampaignRun, {
      campaignId: randomUUID(),
      organizationId: ORG,
      tenantId: TENANT,
      subjectEntityId: null,
      triggerEventId: 'order.created',
      context: {},
      currentStepIndex: 0,
      stepLog: [],
      status: 'waiting',
      resumeAt: new Date(Date.now() - 1000),
      attempts: 0,
    })
    em.persist(run)
    await em.flush()

    const now = new Date()
    const [a, b] = await Promise.all([
      claimRun(orm.em.fork(), run.id, scope, now),
      claimRun(orm.em.fork(), run.id, scope, now),
    ])

    const tokens = [a, b].filter((token): token is string => token !== null)
    expect(tokens).toHaveLength(1)
  })

  it('a third claimer finds nothing left to take once the run is claimed', async () => {
    const em = orm.em.fork()
    const run = em.create(MarketingCampaignRun, {
      campaignId: randomUUID(),
      organizationId: ORG,
      tenantId: TENANT,
      subjectEntityId: null,
      triggerEventId: 'order.created',
      context: {},
      currentStepIndex: 0,
      stepLog: [],
      status: 'waiting',
      resumeAt: new Date(Date.now() - 1000),
      attempts: 0,
    })
    em.persist(run)
    await em.flush()

    const now = new Date()
    const first = await claimRun(orm.em.fork(), run.id, scope, now)
    expect(first).not.toBeNull()

    const second = await claimRun(orm.em.fork(), run.id, scope, now)
    expect(second).toBeNull()
  })

  it('lets exactly one of two concurrent deliveries of the same occurrence create a run', async () => {
    const campaignId = randomUUID()
    const occurrenceKey = randomUUID()

    const [a, b] = await Promise.all([
      createRun(orm.em.fork(), {
        campaignId,
        scope,
        subjectEntityId: null,
        triggerEventId: 'order.created',
        context: {},
        occurrenceKey,
      }),
      createRun(orm.em.fork(), {
        campaignId,
        scope,
        subjectEntityId: null,
        triggerEventId: 'order.created',
        context: {},
        occurrenceKey,
      }),
    ])

    const created = [a, b].filter((run): run is NonNullable<typeof run> => run !== null)
    expect(created).toHaveLength(1)
  })

  it('a second delivery of an already-created occurrence returns null rather than throwing', async () => {
    const campaignId = randomUUID()
    const occurrenceKey = randomUUID()

    const first = await createRun(orm.em.fork(), {
      campaignId,
      scope,
      subjectEntityId: null,
      triggerEventId: 'order.created',
      context: {},
      occurrenceKey,
    })
    expect(first).not.toBeNull()

    const second = await createRun(orm.em.fork(), {
      campaignId,
      scope,
      subjectEntityId: null,
      triggerEventId: 'order.created',
      context: {},
      occurrenceKey,
    })
    expect(second).toBeNull()
  })
})
