import { randomUUID } from 'node:crypto'
import type { MikroORM } from '@mikro-orm/postgresql'
import { MarketingCampaignRun } from '../data/entities'
import { claimRun, createRun, findDueRunIds } from '../lib/runs'
import { PG_URL, SCOPE, createPgOrm, maybe } from './pg-helpers'

/**
 * M2's two invariants, against real concurrent connections: `claimRun`'s conditional UPDATE is the
 * entire concurrency story (lib/runs.ts's own docblock says a fake EntityManager cannot stage a
 * race), and a run orphaned between `createRun` and its first claim has to be found again.
 */
maybe('run claiming against PostgreSQL', () => {
  jest.setTimeout(60_000)
  let orm: MikroORM

  beforeAll(async () => {
    orm = await createPgOrm([MarketingCampaignRun])
  }, 30_000)

  afterAll(async () => {
    await orm?.close(true)
  })

  function baseRun() {
    return {
      campaignId: randomUUID(),
      scope: SCOPE,
      subjectEntityId: randomUUID(),
      triggerEventId: 'evt-1',
      context: { tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId, eventId: 'evt-1', occurredAt: new Date().toISOString(), dispatchDepth: 1 } as never,
    }
  }

  it('exactly one of two concurrent claims on the same freshly created run wins', async () => {
    const run = await createRun(orm.em.fork(), baseRun())
    expect(run).not.toBeNull()

    const now = new Date()
    const [a, b] = await Promise.all([
      claimRun(orm.em.fork(), run!.id, SCOPE, now),
      claimRun(orm.em.fork(), run!.id, SCOPE, now),
    ])
    const tokens = [a, b].filter((token): token is string => token !== null)
    expect(tokens).toHaveLength(1)

    const row = await orm.em.fork().findOneOrFail(MarketingCampaignRun, { id: run!.id })
    expect(row.status).toBe('claimed')
    expect(row.claimToken).toBe(tokens[0])
  })

  it('a run orphaned between create and claim is found by the due-run scan and can still be claimed', async () => {
    const run = await createRun(orm.em.fork(), baseRun())
    expect(run).not.toBeNull()
    // Simulates the lost-claim window: nothing ever claimed it, and enough of the lease window
    // has passed that it counts as stale rather than mid-handoff.
    const staleStartedAt = new Date(Date.now() - 20 * 60_000)
    await orm.em.fork().nativeUpdate(MarketingCampaignRun, { id: run!.id }, { startedAt: staleStartedAt })

    const dueIds = await findDueRunIds(orm.em.fork(), SCOPE, new Date(), 50)
    expect(dueIds).toContain(run!.id)

    const token = await claimRun(orm.em.fork(), run!.id, SCOPE, new Date())
    expect(token).not.toBeNull()
  })

  it('a run still inside the handoff window is not treated as orphaned', async () => {
    const run = await createRun(orm.em.fork(), baseRun())
    expect(run).not.toBeNull()

    const dueIds = await findDueRunIds(orm.em.fork(), SCOPE, new Date(), 50)
    expect(dueIds).not.toContain(run!.id)
  })

  it('500 concurrent claim attempts across 50 runs each produce exactly one winner', async () => {
    const runs = await Promise.all(Array.from({ length: 50 }, () => createRun(orm.em.fork(), baseRun())))
    const now = new Date()
    const results = await Promise.all(
      runs.flatMap((run) => Array.from({ length: 10 }, () => claimRun(orm.em.fork(), run!.id, SCOPE, now))),
    )
    const winnersPerRun = new Map<string, number>()
    for (let i = 0; i < runs.length; i += 1) {
      const slice = results.slice(i * 10, i * 10 + 10)
      winnersPerRun.set(runs[i]!.id, slice.filter((token) => token !== null).length)
    }
    for (const [, winners] of winnersPerRun) expect(winners).toBe(1)
  })
})
