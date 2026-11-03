import { randomUUID } from 'node:crypto'
import type { MikroORM } from '@mikro-orm/postgresql'
import { MarketingCustomerScoreEntry } from '../../data/entities'
import { addScoreEntry, markScoreEventEmitted } from '../scores'
import { PG_URL, SCOPE, createPgOrm, maybe } from '../../__tests__/pg-helpers'

/**
 * M6 against the real `marketing_score_entry_step_uniq` partial unique index, not a mocked
 * `UniqueConstraintViolationException`: a retry whose earlier attempt wrote the ledger row but
 * never confirmed the emit has to be told to try again, while a plain redelivery of an
 * already-confirmed step must not re-emit.
 */
maybe('score ledger retry collisions against PostgreSQL', () => {
  jest.setTimeout(60_000)
  let orm: MikroORM

  beforeAll(async () => {
    orm = await createPgOrm([MarketingCustomerScoreEntry])
  }, 30_000)

  afterAll(async () => {
    await orm?.close(true)
  })

  function entryInput(subjectEntityId: string, runId: string, stepId: string, points: number) {
    return { scope: SCOPE, subjectEntityId, points, source: 'campaign' as const, runId, stepId, now: new Date() }
  }

  it('a retry whose event was never confirmed sent collides but is still told to try again', async () => {
    const subjectEntityId = randomUUID()
    const runId = randomUUID()
    const stepId = randomUUID()
    const first = await addScoreEntry(orm.em.fork(), entryInput(subjectEntityId, runId, stepId, 10))
    expect(first).toMatchObject({ applied: true, eventPending: true })

    // Retry: the ledger write collides on the real unique index, but nothing ever confirmed the emit.
    const retry = await addScoreEntry(orm.em.fork(), entryInput(subjectEntityId, runId, stepId, 10))
    expect(retry.applied).toBe(false)
    expect(retry.eventPending).toBe(true)
    expect(retry.entryId).toBe(first.entryId)
    expect(retry.points).toBe(first.points)
    expect(retry.previousPoints).toBe(first.previousPoints)
  })

  it('a plain redelivery of an already-confirmed step is told nothing is owed', async () => {
    const subjectEntityId = randomUUID()
    const runId = randomUUID()
    const stepId = randomUUID()
    const first = await addScoreEntry(orm.em.fork(), entryInput(subjectEntityId, runId, stepId, 10))
    await markScoreEventEmitted(orm.em.fork(), first.entryId!, new Date())

    const redelivery = await addScoreEntry(orm.em.fork(), entryInput(subjectEntityId, runId, stepId, 10))
    expect(redelivery).toMatchObject({ applied: false, eventPending: false, entryId: first.entryId })
  })

  it('does not double-award points across the retry', async () => {
    const subjectEntityId = randomUUID()
    const runId = randomUUID()
    const stepId = randomUUID()
    await addScoreEntry(orm.em.fork(), entryInput(subjectEntityId, runId, stepId, 25))
    await addScoreEntry(orm.em.fork(), entryInput(subjectEntityId, runId, stepId, 25))

    const rows = await orm.em.fork().find(MarketingCustomerScoreEntry, { runId, stepId })
    expect(rows).toHaveLength(1)
    expect(rows[0].points).toBe(25)
  })

  it('a manual adjustment with no (run, step) never collides at all', async () => {
    const subjectEntityId = randomUUID()
    const a = await addScoreEntry(orm.em.fork(), { scope: SCOPE, subjectEntityId, points: 5, source: 'manual', now: new Date() })
    const b = await addScoreEntry(orm.em.fork(), { scope: SCOPE, subjectEntityId, points: 5, source: 'manual', now: new Date() })
    expect(a.applied).toBe(true)
    expect(b.applied).toBe(true)
    expect(b.previousPoints).toBe(5)
  })
})
