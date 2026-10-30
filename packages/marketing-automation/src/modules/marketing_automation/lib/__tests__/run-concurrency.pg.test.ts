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
import { claimRun, createRun, type RunScope } from '../runs'

const PG_URL = process.env.OM_MARKETING_AUTOMATION_PG_URL ?? ''
const maybe = PG_URL ? describe : describe.skip

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'

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
    await em.persistAndFlush(run)

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
    await em.persistAndFlush(run)

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
