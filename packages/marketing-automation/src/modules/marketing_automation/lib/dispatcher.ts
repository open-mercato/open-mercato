import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { MarketingCampaign, MarketingCampaignRun } from '../data/entities.js'
import { campaignDefinitionSchema } from '../data/validators.js'
import type { CampaignTriggerInput } from '../data/validators.js'
import type { StepDeps } from '../steps/deps.js'
import { matchesAudience } from './engine/audience.js'
import { executeRun } from './engine/executor.js'
import type { ExecutorSideEffects, SendPolicy } from './engine/executor.js'
import { getMarketingStep } from './engine/registry.js'
import type { AutomationContext, CampaignDefinition, EngineLogger, StepOutcome } from './engine/types.js'
import { buildCampaignCommandContext } from './command-context.js'
import { findCampaignsForEvent } from './campaign-lookup.js'
import { recordDeadLetter } from './dead-letter.js'
import {
  applyTransition,
  claimRun,
  countRunsStartedSince,
  countSendsSince,
  createRun,
  failRun,
  hasActiveRun,
  hasRecentRun,
  recordSend,
} from './runs.js'
import type { RunScope } from './runs.js'
import { buildSubjectDocument, loadSubjectTimeZone } from './subject-document.js'
import type { SubjectDocument } from './engine/types.js'
import { reportError } from '@open-mercato/telemetry'

/**
 * Per-subject run budget, across every campaign, inside {@link RUN_BUDGET_WINDOW_MINUTES}.
 *
 * This is the cascade guard, and it replaced an in-context depth counter that could not work: a
 * step assigning a tag causes `customers.tag.assigned`, which is itself a trigger, but that event
 * is emitted by the `customers` module and carries nothing of ours, so nothing could increment a
 * depth across the hop. A budget the database can answer bounds the cycle however many campaigns
 * are in it, and doubles as protection against an event storm from an import.
 */
export const MAX_RUNS_PER_SUBJECT = 20
export const RUN_BUDGET_WINDOW_MINUTES = 60

export type DispatchDeps = {
  em: EntityManager
  container: AwilixContainer
  logger: EngineLogger
  now: Date
  scope: RunScope
  /** Schedules the delayed continuation. Injected so the engine never imports the queue. */
  enqueueResume(runId: string, delayMs: number): Promise<void>
}

function readDefinition(campaign: MarketingCampaign): CampaignDefinition {
  return campaignDefinitionSchema.parse(campaign.definition) as CampaignDefinition
}

function readSendPolicy(definition: CampaignDefinition): SendPolicy {
  return {
    frequencyCap: definition.sendPolicy?.frequencyCap ?? null,
    quietHours: definition.sendPolicy?.quietHours ?? null,
  }
}

function buildEffects(
  deps: DispatchDeps,
  run: { id: string; campaignId: string; subjectEntityId: string | null },
): ExecutorSideEffects<StepDeps> {
  return {
    getStep: (type) => getMarketingStep(type) as ReturnType<ExecutorSideEffects<StepDeps>['getStep']>,
    countSendsSince: (subjectEntityId, since) => countSendsSince(deps.em, subjectEntityId, deps.scope, since),
    recordSend: (entry) => recordSend(deps.em, {
      scope: deps.scope,
      campaignId: run.campaignId,
      runId: run.id,
      stepId: entry.stepId,
      subjectEntityId: run.subjectEntityId,
      channel: entry.channel,
      status: entry.status,
      suppressionReason: entry.suppressionReason,
      // The moment of the send, not the worker's start instant: a long chain would otherwise
      // backdate every send to when the job began and skew the frequency-cap window.
      sentAt: new Date(),
    }),
    resolveTimeZone: (subjectEntityId) => subjectEntityId
      ? loadSubjectTimeZone(deps.em, subjectEntityId, deps.scope)
      : Promise.resolve('UTC'),
    logger: deps.logger,
    now: deps.now,
  }
}

function buildStepDeps(deps: DispatchDeps): StepDeps {
  return {
    em: deps.em,
    container: deps.container,
    logger: deps.logger,
    now: deps.now,
    scope: deps.scope,
    commandContext: buildCampaignCommandContext(deps.container, deps.scope),
  }
}

async function persist(
  deps: DispatchDeps,
  run: { id: string; campaignId: string; subjectEntityId: string | null; attempts: number },
  claimToken: string,
  steps: CampaignDefinition['steps'],
  policy: SendPolicy,
  state: { currentStepIndex: number; stepLog: StepOutcome[]; context: AutomationContext },
): Promise<'completed' | 'waiting' | 'retrying' | 'dead'> {
  try {
    const transition = await executeRun(
      { id: run.id, campaignId: run.campaignId, subjectEntityId: run.subjectEntityId, ...state },
      steps,
      policy,
      buildStepDeps(deps),
      buildEffects(deps, run),
    )

    if (transition.kind === 'failed') {
      return recordFailure(deps, run, claimToken, {
        error: transition.error,
        stepLog: transition.stepLog,
        context: transition.context,
        resumeStepIndex: transition.failedIndex,
      })
    }

    await applyTransition(deps.em, run.id, deps.scope, claimToken, transition, deps.now)

    if (transition.kind === 'waiting') {
      const delayMs = Math.max(0, transition.resumeAt.getTime() - deps.now.getTime())
      // The queue job is the fast path; the sweep over due runs is the safety net, so a lost
      // job delays a campaign rather than stranding a customer in it.
      await deps.enqueueResume(run.id, delayMs)
      return 'waiting'
    }
    return 'completed'
  } catch (error) {
    // Not a step failure (those come back as a `failed` transition) but a failure of the
    // orchestration itself — a bad definition, an effects query. Resume where the run already was.
    return recordFailure(deps, run, claimToken, {
      error,
      stepLog: state.stepLog,
      context: state.context,
      resumeStepIndex: state.currentStepIndex,
    })
  }
}

/** One place that records a failure, so the step path and the orchestration path cannot diverge. */
async function recordFailure(
  deps: DispatchDeps,
  run: { id: string; campaignId: string; attempts: number },
  claimToken: string,
  input: { error: unknown; stepLog: StepOutcome[]; context: AutomationContext; resumeStepIndex: number },
): Promise<'retrying' | 'dead'> {
  deps.logger.error('[internal] marketing run failed', {
    runId: run.id,
    campaignId: run.campaignId,
    stepIndex: input.resumeStepIndex,
    error: input.error instanceof Error ? input.error.message : String(input.error),
  })
  reportError(input.error, {
    module: 'marketing_automation',
    code: 'marketing_automation.run_failed',
    attributes: { runId: run.id, campaignId: run.campaignId },
  })

  const outcome = await failRun(
    deps.em,
    run.id,
    deps.scope,
    claimToken,
    {
      attempts: run.attempts,
      error: input.error,
      stepLog: input.stepLog,
      resumeStepIndex: input.resumeStepIndex,
      context: input.context,
    },
    deps.now,
  )
  if (outcome === 'retrying') {
    const parked = await deps.em.findOne(MarketingCampaignRun, { id: run.id }, { fields: ['resumeAt'] })
    const delayMs = Math.max(0, (parked?.resumeAt?.getTime() ?? deps.now.getTime()) - deps.now.getTime())
    await deps.enqueueResume(run.id, delayMs)
  }
  return outcome
}


/**
 * How often the same subject may enter one campaign.
 *
 * Three cases, kept explicit because collapsing them onto a nullable number made "do not check"
 * and "only ever once" indistinguishable:
 *
 *  - `unlimited` — every occurrence starts a run. Right for event triggers: each order placed
 *    is its own reason to run.
 *  - `once` — at most one run per subject, ever.
 *  - `cooldown` — at most one run per subject per window. Required for a scheduled sweep, whose
 *    audience ("dormant for 90 days") stays true on every tick.
 */
export type ReentryPolicy =
  | { kind: 'unlimited' }
  | { kind: 'once' }
  | { kind: 'cooldown'; afterDays: number }

export type StartOutcome = 'started' | 'audience' | 'guard'

/**
 * Enrols one subject in one campaign, if the guards and the audience allow it.
 *
 * Shared by the event path and the scheduled sweep on purpose: the two ways a campaign starts
 * must apply the same re-entry guard and the same audience, or a sweep would quietly bypass
 * protections the event path has.
 */
export async function startCampaignForSubject(
  campaign: MarketingCampaign,
  input: {
    subject: SubjectDocument
    subjectEntityId: string | null
    triggerEventId: string
    triggerContext: Record<string, unknown>
    dispatchDepth: number
    reentryPolicy: ReentryPolicy
  },
  deps: DispatchDeps,
): Promise<StartOutcome> {
  if (input.subjectEntityId) {
    if (await hasActiveRun(deps.em, campaign.id, input.subjectEntityId, deps.scope)) {
      // Already mid-journey here; a second concurrent entry would double every remaining step.
      return 'guard'
    }

    const budgetSince = new Date(deps.now.getTime() - RUN_BUDGET_WINDOW_MINUTES * 60_000)
    const recentRuns = await countRunsStartedSince(deps.em, input.subjectEntityId, deps.scope, budgetSince)
    if (recentRuns >= MAX_RUNS_PER_SUBJECT) {
      deps.logger.warn('[internal] marketing run budget exhausted for subject, refusing to enrol', {
        campaignId: campaign.id,
        subjectEntityId: input.subjectEntityId,
        recentRuns,
      })
      return 'guard'
    }
    if (input.reentryPolicy.kind !== 'unlimited') {
      const since = input.reentryPolicy.kind === 'once'
        ? null
        : new Date(deps.now.getTime() - input.reentryPolicy.afterDays * 86_400_000)
      if (await hasRecentRun(deps.em, campaign.id, input.subjectEntityId, deps.scope, since)) return 'guard'
    }
  }

  const definition = readDefinition(campaign)
  if (!matchesAudience(definition.audience, input.subject, { now: deps.now, logger: deps.logger, campaignId: campaign.id })) {
    return 'audience'
  }

  const context: AutomationContext = {
    tenantId: deps.scope.tenantId,
    organizationId: deps.scope.organizationId,
    eventId: input.triggerEventId,
    occurredAt: deps.now.toISOString(),
    dispatchDepth: input.dispatchDepth,
    subjectEntityId: input.subjectEntityId,
    campaignId: campaign.id,
    // Deliberately NO email and NO customer record here. This context is persisted to
    // `marketing_campaign_runs.context`, and `primary_email`/`display_name` are encrypted at rest
    // by the platform — copying them into jsonb would create an unencrypted mirror of PII the rest
    // of the system protects, readable by anyone with plain database access. `send_email` resolves
    // the recipient through the decrypting finder at send time instead, which also means a customer
    // who changes their address mid-journey receives the later steps at the new one.
    trigger: input.triggerContext,
  }

  const run = await createRun(deps.em, {
    campaignId: campaign.id,
    scope: deps.scope,
    subjectEntityId: input.subjectEntityId,
    triggerEventId: input.triggerEventId,
    context,
  })

  const claimToken = await claimRun(deps.em, run.id, deps.scope, deps.now)
  if (!claimToken) return 'guard'

  await persist(
    deps,
    { id: run.id, campaignId: campaign.id, subjectEntityId: input.subjectEntityId, attempts: 1 },
    claimToken,
    definition.steps,
    readSendPolicy(definition),
    { currentStepIndex: 0, stepLog: [], context },
  )
  return 'started'
}

export type DispatchResult = { started: number; skippedByAudience: number; skippedByGuard: number }

/**
 * Starts every campaign listening on one platform event, for one subject.
 *
 * A failure is isolated to the campaign that caused it: one broken campaign must not stop the
 * others from reacting to the same event.
 */
export async function dispatchEvent(
  input: {
    eventId: string
    eventPayload: Record<string, unknown>
    subjectEntityId: string | null
    triggerContext: Record<string, unknown>
    dispatchDepth?: number
  },
  deps: DispatchDeps,
): Promise<DispatchResult> {
  const result: DispatchResult = { started: 0, skippedByAudience: 0, skippedByGuard: 0 }
  const dispatchDepth = input.dispatchDepth ?? 0
  const candidates = await findCampaignsForEvent(deps.em, input.eventId, deps.scope)
  if (!candidates.length) return result

  const subject = await buildSubjectDocument(
    deps.em,
    input.subjectEntityId,
    deps.scope,
    input.triggerContext,
    deps.now,
  )

  for (const { campaign } of candidates) {
    try {
      const started = await startCampaignForSubject(
        campaign,
        {
          subject,
          subjectEntityId: input.subjectEntityId,
          triggerEventId: input.eventId,
          triggerContext: input.triggerContext,
          dispatchDepth: dispatchDepth + 1,
          reentryPolicy: { kind: 'unlimited' },
        },
        deps,
      )
      if (started === 'started') result.started += 1
      else if (started === 'audience') result.skippedByAudience += 1
      else result.skippedByGuard += 1
    } catch (error) {
      deps.logger.error('[internal] marketing campaign dispatch failed', {
        campaignId: campaign.id,
        eventId: input.eventId,
        error: error instanceof Error ? error.message : String(error),
      })
      reportError(error, {
        module: 'marketing_automation',
        code: 'marketing_automation.dispatch_failed',
        attributes: { campaignId: campaign.id, eventId: input.eventId },
      })
      await recordDeadLetter(deps.em, {
        source: 'dispatch',
        error,
        payload: input.eventPayload,
        eventId: input.eventId,
        campaignId: campaign.id,
        tenantId: deps.scope.tenantId,
        organizationId: deps.scope.organizationId,
      })
    }
  }

  return result
}

/** Continues a parked run. Returns `skipped` when another worker already owns it. */
export async function resumeRun(
  runId: string,
  deps: DispatchDeps,
): Promise<'completed' | 'waiting' | 'retrying' | 'dead' | 'skipped'> {
  const claimToken = await claimRun(deps.em, runId, deps.scope, deps.now)
  if (!claimToken) return 'skipped'

  const run = await deps.em.findOne(MarketingCampaignRun, {
    id: runId,
    tenantId: deps.scope.tenantId,
    organizationId: deps.scope.organizationId,
  })
  if (!run) return 'skipped'

  const campaign = await deps.em.findOne(MarketingCampaign, {
    id: run.campaignId,
    tenantId: deps.scope.tenantId,
    organizationId: deps.scope.organizationId,
    deletedAt: null,
  })

  // Disabling a campaign is expected to stop it, including for customers already parked inside
  // it. Without this check a disabled campaign keeps delivering to everybody mid-journey.
  if (!campaign || !campaign.isEnabled) {
    await applyTransition(deps.em, runId, deps.scope, claimToken, {
      kind: 'completed',
      stepLog: [
        ...(run.stepLog as unknown as StepOutcome[]),
        { stepId: '-', type: '-', status: 'skipped', at: deps.now.toISOString(), detail: 'campaign disabled or removed' },
      ],
      context: run.context as AutomationContext,
    }, deps.now)
    return 'completed'
  }

  const definition = readDefinition(campaign)
  return persist(
    deps,
    { id: run.id, campaignId: run.campaignId, subjectEntityId: run.subjectEntityId ?? null, attempts: run.attempts },
    claimToken,
    definition.steps,
    readSendPolicy(definition),
    {
      currentStepIndex: run.currentStepIndex,
      stepLog: run.stepLog as unknown as StepOutcome[],
      context: run.context as AutomationContext,
    },
  )
}
