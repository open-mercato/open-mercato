import { UniqueConstraintViolationException } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { MarketingSurveyPrompt } from '../data/entities.js'
import type { SubjectScope } from './scope.js'

/**
 * Net Promoter Score: one question, an answer between 0 and 10.
 *
 * The scale is fixed at 0–10 because that IS the definition — a "NPS" on a different scale is not
 * comparable with anybody else's, which is the only reason to use the metric rather than inventing one.
 */

export const NPS_MIN_SCORE = 0
export const NPS_MAX_SCORE = 10

/** The industry's own bands, so a screen can say "detractor" without re-deriving the thresholds. */
export type NpsBand = 'detractor' | 'passive' | 'promoter'

export function npsBand(score: number): NpsBand {
  if (score <= 6) return 'detractor'
  if (score <= 8) return 'passive'
  return 'promoter'
}

/**
 * Whether this is a real answer.
 *
 * The explicit rejections matter more than the range check: `Number(null)`, `Number('')` and
 * `Number(false)` are all 0, which is a valid NPS score — the WORST one. Without these guards a missing
 * answer would be recorded as the strongest possible complaint, and it would look like data.
 */
export function isValidNpsScore(value: unknown): value is number {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return false
  if (typeof value !== 'number' && typeof value !== 'string') return false
  const score = Number(value)
  return Number.isInteger(score) && score >= NPS_MIN_SCORE && score <= NPS_MAX_SCORE
}

export type AskInput = {
  scope: SubjectScope
  subjectEntityId: string | null
  campaignId: string
  runId: string
  stepId: string
  question: string
  now: Date
}

/**
 * Records that the question was asked, once.
 *
 * Idempotent on (run, step) through a unique index, for the same reason every other write in this module
 * is: a redelivered job must not ask twice, and a customer who receives the same survey twice has been
 * given two chances to answer one question — which quietly doubles that person's weight in the result.
 */
/**
 * `asked` is true when this call created the row. `alreadySent` is true when a previous attempt got the
 * message out — which is the only reason to stop, and the distinction a retry depends on.
 */
export type AskOutcome = { asked: boolean; alreadySent: boolean; promptId: string | null }

export async function recordSurveyAsked(em: EntityManager, input: AskInput): Promise<AskOutcome> {
  const fork = em.fork()
  const prompt = fork.create(MarketingSurveyPrompt, {
    tenantId: input.scope.tenantId,
    organizationId: input.scope.organizationId,
    subjectEntityId: input.subjectEntityId,
    campaignId: input.campaignId,
    runId: input.runId,
    stepId: input.stepId,
    question: input.question,
    score: null,
    comment: null,
    askedAt: input.now,
    answeredAt: null,
  })
  try {
    fork.persist(prompt)
    await fork.flush()
    return { asked: true, alreadySent: false, promptId: prompt.id }
  } catch (error) {
    if (!(error instanceof UniqueConstraintViolationException)) throw error
    /**
     * The row is already there, and the question is whether the MESSAGE went with it.
     *
     * A redelivery after a successful send must not send again; a retry after a failed one must. Those were
     * indistinguishable while the row's existence was the whole record, so a transport hiccup silently
     * cancelled the survey.
     */
    const existing = await em.fork().findOne(MarketingSurveyPrompt, {
      tenantId: input.scope.tenantId,
      organizationId: input.scope.organizationId,
      runId: input.runId,
      stepId: input.stepId,
    })
    return { asked: false, alreadySent: Boolean(existing?.sentAt), promptId: existing?.id ?? null }
  }
}

/** Marks the prompt as sent, once the transport has accepted it. */
export async function markSurveySent(
  em: EntityManager,
  scope: SubjectScope,
  promptId: string,
  now: Date,
): Promise<void> {
  await em.nativeUpdate(MarketingSurveyPrompt, { id: promptId, ...scope }, { sentAt: now })
}

export type AnswerOutcome = 'recorded' | 'changed' | 'unknown_prompt'

/**
 * Records an answer, or a change of mind.
 *
 * A second answer OVERWRITES the first rather than being refused. Somebody who clicks 3 and then 8 has told
 * us 8, and a survey that keeps the first click is measuring reflexes rather than opinion. The change is
 * visible because `answeredAt` moves.
 */
export async function recordSurveyAnswer(
  em: EntityManager,
  input: {
    scope: SubjectScope
    runId: string
    stepId: string
    score: number
    comment?: string | null
    now: Date
  },
): Promise<AnswerOutcome> {
  const prompt = await em.findOne(MarketingSurveyPrompt, {
    tenantId: input.scope.tenantId,
    organizationId: input.scope.organizationId,
    runId: input.runId,
    stepId: input.stepId,
  })
  if (!prompt) return 'unknown_prompt'

  const changed = prompt.score !== null && prompt.score !== input.score
  prompt.score = input.score
  if (input.comment !== undefined) prompt.comment = input.comment
  prompt.answeredAt = input.now
  await em.flush()
  return changed ? 'changed' : 'recorded'
}

/**
 * The subject's most recent NPS answer.
 *
 * Latest rather than average: NPS is a snapshot of how somebody feels now, and averaging a customer's own
 * history would make an old bad experience permanently outweigh a recent good one.
 */
export async function loadLatestNps(
  em: EntityManager,
  subjectEntityId: string,
  scope: SubjectScope,
): Promise<{ score: number; answeredAt: string } | null> {
  const rows = await em.find(
    MarketingSurveyPrompt,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      subjectEntityId,
      score: { $ne: null },
    },
    { orderBy: { answeredAt: 'DESC' }, limit: 1 },
  )
  const latest = rows[0]
  if (!latest || latest.score === null || latest.score === undefined) return null
  return {
    score: latest.score,
    answeredAt: (latest.answeredAt ?? latest.askedAt).toISOString(),
  }
}
