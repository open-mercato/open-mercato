import { UniqueConstraintViolationException } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  isValidNpsScore,
  loadLatestNps,
  npsBand,
  NPS_MAX_SCORE,
  NPS_MIN_SCORE,
  recordSurveyAnswer,
  recordSurveyAsked,
} from '../survey'

const scope = { tenantId: 't1', organizationId: 'o1' }
const now = new Date('2026-09-28T12:00:00.000Z')

describe('the NPS scale', () => {
  test('is 0 to 10, because that is the definition', () => {
    expect([NPS_MIN_SCORE, NPS_MAX_SCORE]).toEqual([0, 10])
  })

  test.each([[0, 'detractor'], [6, 'detractor'], [7, 'passive'], [8, 'passive'], [9, 'promoter'], [10, 'promoter']])(
    '%s is a %s',
    (score, band) => {
      expect(npsBand(score as number)).toBe(band)
    },
  )

  test.each([-1, 11, 3.5, Number.NaN, 'seven', null, undefined])('rejects %s as a score', (value) => {
    expect(isValidNpsScore(value)).toBe(false)
  })

  test('accepts a numeric string, because it arrives from a URL', () => {
    expect(isValidNpsScore('7')).toBe(true)
  })
})

describe('recordSurveyAsked', () => {
  function fakeEm(reject?: unknown, existing: Record<string, unknown> | null = null) {
    const persisted: Record<string, unknown>[] = []
    const fork = {
      create: (_entity: unknown, data: Record<string, unknown>) => ({ id: 'p1', ...data }),
      persist: (row: Record<string, unknown>) => { persisted.push(row) },
      flush: async () => { if (reject) throw reject },
      // Reached only on the duplicate path, to ask whether the earlier attempt got as far as sending.
      findOne: async () => existing,
    }
    return { em: { fork: () => fork } as unknown as EntityManager, persisted }
  }

  test('records the question with no answer yet, so an unanswered survey is visible', async () => {
    const { em, persisted } = fakeEm()
    const result = await recordSurveyAsked(em, {
      scope, subjectEntityId: 'c1', campaignId: 'camp-1', runId: 'r1', stepId: 's1',
      question: 'How likely are you to recommend us?', now,
    })
    expect(result).toEqual({ asked: true, alreadySent: false, promptId: 'p1' })
    expect(persisted[0]).toMatchObject({ score: null, answeredAt: null, question: 'How likely are you to recommend us?' })
  })

  // A customer who receives the same survey twice has been given two chances to answer one question, which
  // quietly doubles their weight in the result.
  test('a step whose message already went out is reported as sent, not repeated', async () => {
    const { em } = fakeEm(
      new UniqueConstraintViolationException(new Error('duplicate key')),
      { id: 'p1', sentAt: new Date('2026-09-27T09:00:00.000Z') },
    )
    expect(await recordSurveyAsked(em, {
      scope, subjectEntityId: 'c1', campaignId: 'camp-1', runId: 'r1', stepId: 's1', question: 'q', now,
    })).toEqual({ asked: false, alreadySent: true, promptId: 'p1' })
  })

  /**
   * The row exists and the message never left.
   *
   * This is the state a failed transport leaves behind, and it used to be indistinguishable from a completed
   * ask — so the retry reported success and the customer was never invited to answer anything. Reported as
   * NOT sent, which is what lets the step try again.
   */
  test('a step whose message never left is reported as unsent, so a retry can send it', async () => {
    const { em } = fakeEm(
      new UniqueConstraintViolationException(new Error('duplicate key')),
      { id: 'p1', sentAt: null },
    )
    expect(await recordSurveyAsked(em, {
      scope, subjectEntityId: 'c1', campaignId: 'camp-1', runId: 'r1', stepId: 's1', question: 'q', now,
    })).toEqual({ asked: false, alreadySent: false, promptId: 'p1' })
  })

  test('any other failure still throws', async () => {
    const { em } = fakeEm(new Error('connection reset'))
    await expect(recordSurveyAsked(em, {
      scope, subjectEntityId: 'c1', campaignId: 'camp-1', runId: 'r1', stepId: 's1', question: 'q', now,
    })).rejects.toThrow('connection reset')
  })
})

describe('recordSurveyAnswer', () => {
  function fakeEm(prompt: Record<string, unknown> | null) {
    let flushes = 0
    const em = {
      findOne: async () => prompt,
      flush: async () => { flushes += 1 },
    }
    return { em: em as unknown as EntityManager, flushes: () => flushes, prompt }
  }

  test('records a first answer', async () => {
    const prompt: Record<string, unknown> = { score: null, comment: null, answeredAt: null }
    const { em } = fakeEm(prompt)
    expect(await recordSurveyAnswer(em, { scope, runId: 'r1', stepId: 's1', score: 9, now })).toBe('recorded')
    expect(prompt).toMatchObject({ score: 9, answeredAt: now })
  })

  // Somebody who clicks 3 and then 8 has told us 8; keeping the first click measures reflexes, not opinion.
  test('a change of mind overwrites, and is reported as a change', async () => {
    const prompt: Record<string, unknown> = { score: 3, comment: null, answeredAt: new Date('2026-09-27T00:00:00.000Z') }
    const { em } = fakeEm(prompt)
    expect(await recordSurveyAnswer(em, { scope, runId: 'r1', stepId: 's1', score: 8, now })).toBe('changed')
    expect(prompt.score).toBe(8)
    expect(prompt.answeredAt).toBe(now)
  })

  test('the same answer again is not a change', async () => {
    const prompt: Record<string, unknown> = { score: 8, comment: null, answeredAt: null }
    const { em } = fakeEm(prompt)
    expect(await recordSurveyAnswer(em, { scope, runId: 'r1', stepId: 's1', score: 8, now })).toBe('recorded')
  })

  test('a comment is stored without disturbing the score', async () => {
    const prompt: Record<string, unknown> = { score: 9, comment: null, answeredAt: null }
    const { em } = fakeEm(prompt)
    await recordSurveyAnswer(em, { scope, runId: 'r1', stepId: 's1', score: 9, comment: 'fast delivery', now })
    expect(prompt).toMatchObject({ score: 9, comment: 'fast delivery' })
  })

  test('an answer with nowhere to go is reported rather than invented', async () => {
    const { em } = fakeEm(null)
    expect(await recordSurveyAnswer(em, { scope, runId: 'r1', stepId: 's1', score: 9, now })).toBe('unknown_prompt')
  })
})

describe('loadLatestNps', () => {
  function fakeEm(rows: unknown[]) {
    const queries: Array<Record<string, unknown>> = []
    const em = {
      find: async (_entity: unknown, where: Record<string, unknown>, options: Record<string, unknown>) => {
        queries.push({ where, options })
        return rows
      },
    }
    return { em: em as unknown as EntityManager, queries }
  }

  // Latest, not average: NPS is how somebody feels now, and averaging their history would make an old bad
  // experience permanently outweigh a recent good one.
  test('asks for the most recent answered prompt only', async () => {
    const { em, queries } = fakeEm([{ score: 9, answeredAt: now, askedAt: now }])
    expect(await loadLatestNps(em, 'c1', scope)).toEqual({ score: 9, answeredAt: now.toISOString() })
    expect(queries[0].options).toMatchObject({ orderBy: { answeredAt: 'DESC' }, limit: 1 })
    expect(queries[0].where).toMatchObject({ subjectEntityId: 'c1', tenantId: 't1', organizationId: 'o1' })
  })

  test('a customer who never answered has no score', async () => {
    const { em } = fakeEm([])
    expect(await loadLatestNps(em, 'c1', scope)).toBeNull()
  })

  test('falls back to when it was asked if the answer time is missing', async () => {
    const asked = new Date('2026-09-01T00:00:00.000Z')
    const { em } = fakeEm([{ score: 5, answeredAt: null, askedAt: asked }])
    expect(await loadLatestNps(em, 'c1', scope)).toEqual({ score: 5, answeredAt: asked.toISOString() })
  })
})
