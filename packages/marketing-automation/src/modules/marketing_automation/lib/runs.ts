import { randomUUID } from 'node:crypto'
import { raw } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { MarketingCampaignRun, MarketingMessageSend } from '../data/entities.js'
import type { RunTransition } from './engine/executor.js'
import {
  computeClaimLeaseCutoff,
  computeNextRetryAt,
  hasExhaustedAttempts,
} from './engine/scheduling.js'
import type { AutomationContext, StepOutcome } from './engine/types.js'

export type RunScope = { tenantId: string; organizationId: string }

export async function createRun(
  em: EntityManager,
  input: {
    campaignId: string
    scope: RunScope
    subjectEntityId: string | null
    triggerEventId: string
    context: AutomationContext
  },
): Promise<MarketingCampaignRun> {
  const run = em.create(MarketingCampaignRun, {
    campaignId: input.campaignId,
    tenantId: input.scope.tenantId,
    organizationId: input.scope.organizationId,
    subjectEntityId: input.subjectEntityId,
    triggerEventId: input.triggerEventId,
    context: input.context as Record<string, unknown>,
    currentStepIndex: 0,
    stepLog: [],
    status: 'running',
    attempts: 0,
    startedAt: new Date(),
  })
  em.persist(run)
    await em.flush()
  return run
}

/**
 * Takes exclusive ownership of a run, or returns null.
 *
 * One conditional UPDATE is the whole concurrency story: two workers racing for the same run
 * both issue this statement, and only the one whose WHERE clause still matched gets a token.
 * Nothing downstream needs a lock because nothing downstream proceeds without the token.
 *
 * The `claimed` branch is lease recovery: a worker that died mid-step left the row claimed, and
 * without this it would sit there forever. `attempts` is incremented inside the same statement
 * so two claimers cannot both read the old value.
 */
export async function claimRun(
  em: EntityManager,
  runId: string,
  scope: RunScope,
  now: Date,
): Promise<string | null> {
  const claimToken = randomUUID()
  const affected = await em.nativeUpdate(
    MarketingCampaignRun,
    {
      id: runId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      $or: [
        { status: 'running' },
        { status: 'waiting', resumeAt: { $lte: now } },
        { status: 'claimed', claimedAt: { $lt: computeClaimLeaseCutoff(now) } },
      ],
    },
    {
      status: 'claimed',
      claimedAt: now,
      claimToken,
      attempts: raw('attempts + 1'),
    },
  )
  return affected === 1 ? claimToken : null
}

/**
 * Writes the executor's verdict.
 *
 * Every write re-asserts `claimToken`, so a zombie worker whose lease expired mid-step cannot
 * overwrite the result of the worker that took the run from it.
 */
export async function applyTransition(
  em: EntityManager,
  runId: string,
  scope: RunScope,
  claimToken: string,
  transition: RunTransition,
  now: Date,
): Promise<boolean> {
  const common = {
    stepLog: transition.stepLog as unknown as Record<string, unknown>[],
    context: transition.context as Record<string, unknown>,
    lastError: null,
  }

  const data = transition.kind === 'completed'
    ? { ...common, status: 'completed' as const, completedAt: now, resumeAt: null, claimToken: null, claimedAt: null }
    : {
        ...common,
        status: 'waiting' as const,
        resumeAt: transition.resumeAt,
        currentStepIndex: transition.nextStepIndex,
        claimToken: null,
        claimedAt: null,
      }

  const affected = await em.nativeUpdate(
    MarketingCampaignRun,
    { id: runId, tenantId: scope.tenantId, organizationId: scope.organizationId, claimToken },
    data,
  )
  return affected === 1
}

/**
 * Records a failed attempt, retrying with backoff until the attempt budget runs out.
 *
 * A run that runs out of attempts becomes `dead` rather than being deleted: a customer stuck
 * halfway through a campaign is something an operator needs to be able to see.
 */
export async function failRun(
  em: EntityManager,
  runId: string,
  scope: RunScope,
  claimToken: string,
  input: { attempts: number; error: unknown; stepLog: StepOutcome[] },
  now: Date,
): Promise<'retrying' | 'dead'> {
  const message = input.error instanceof Error ? input.error.message : String(input.error)
  const dead = hasExhaustedAttempts(input.attempts)
  const nextRetryAt = dead ? null : computeNextRetryAt(input.attempts, now)

  await em.nativeUpdate(
    MarketingCampaignRun,
    { id: runId, tenantId: scope.tenantId, organizationId: scope.organizationId, claimToken },
    {
      status: dead ? 'dead' : 'waiting',
      lastError: message.slice(0, 2000),
      nextRetryAt,
      resumeAt: nextRetryAt,
      claimToken: null,
      claimedAt: null,
      stepLog: input.stepLog as unknown as Record<string, unknown>[],
    },
  )
  return dead ? 'dead' : 'retrying'
}

export async function findDueRunIds(
  em: EntityManager,
  scope: RunScope,
  now: Date,
  limit: number,
): Promise<string[]> {
  const rows = await em.find(
    MarketingCampaignRun,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      $or: [
        { status: 'waiting', resumeAt: { $lte: now } },
        // Lease recovery: picked up here too, so a crashed worker's run is not lost even if the
        // delayed queue job died with it.
        { status: 'claimed', claimedAt: { $lt: computeClaimLeaseCutoff(now) } },
      ],
    },
    { fields: ['id'], orderBy: { resumeAt: 'ASC', id: 'ASC' }, limit },
  )
  return rows.map((row) => row.id)
}

/**
 * The re-entry guard.
 *
 * A scheduled sweep re-evaluates the same audience every tick, so without this a customer who
 * matches "has not ordered in 90 days" would be enrolled on every single tick. `since = null`
 * means enrol at most once ever.
 */
export async function hasRecentRun(
  em: EntityManager,
  campaignId: string,
  subjectEntityId: string,
  scope: RunScope,
  since: Date | null,
): Promise<boolean> {
  const count = await em.count(MarketingCampaignRun, {
    campaignId,
    subjectEntityId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    ...(since ? { startedAt: { $gte: since } } : {}),
  })
  return count > 0
}

/** Also counts an in-flight run, so a customer cannot be enrolled twice concurrently. */
export async function hasActiveRun(
  em: EntityManager,
  campaignId: string,
  subjectEntityId: string,
  scope: RunScope,
): Promise<boolean> {
  const count = await em.count(MarketingCampaignRun, {
    campaignId,
    subjectEntityId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    status: { $in: ['running', 'waiting', 'claimed'] },
  })
  return count > 0
}

/** Counts across ALL campaigns — a per-campaign cap would not protect anybody. */
export async function countSendsSince(
  em: EntityManager,
  subjectEntityId: string,
  scope: RunScope,
  since: Date,
): Promise<number> {
  return em.count(MarketingMessageSend, {
    subjectEntityId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    status: 'sent',
    sentAt: { $gte: since },
  })
}

export async function recordSend(
  em: EntityManager,
  entry: {
    scope: RunScope
    campaignId: string
    runId: string
    stepId: string
    subjectEntityId: string | null
    channel: 'email' | 'sms' | 'push'
    status: 'sent' | 'suppressed' | 'failed'
    toAddress?: string | null
    suppressionReason?: string | null
    sentAt: Date
  },
): Promise<void> {
  const record = em.create(MarketingMessageSend, {
    tenantId: entry.scope.tenantId,
    organizationId: entry.scope.organizationId,
    campaignId: entry.campaignId,
    runId: entry.runId,
    stepId: entry.stepId,
    subjectEntityId: entry.subjectEntityId,
    channel: entry.channel,
    status: entry.status,
    toAddress: entry.toAddress ?? null,
    suppressionReason: entry.suppressionReason ?? null,
    sentAt: entry.sentAt,
  })
  em.persist(record)
    await em.flush()
}
