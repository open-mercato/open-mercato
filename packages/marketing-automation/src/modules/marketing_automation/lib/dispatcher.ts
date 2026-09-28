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
  countSendsSince,
  createRun,
  failRun,
  hasActiveRun,
  hasRecentRun,
  recordSend,
} from './runs.js'
import type { RunScope } from './runs.js'
import { buildSubjectDocument, loadSubjectTimeZone } from './subject-document.js'

/**
 * How many times a dispatch may cascade before it is refused.
 *
 * `add_tag` emits `customers.tag.assigned`, which is itself a trigger. A campaign that reacts
 * to a tag and adds a tag is an infinite loop, and the author will not necessarily see it — so
 * the depth is carried in the context and enforced here rather than hoped about.
 */
export const MAX_DISPATCH_DEPTH = 3

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
      toAddress: entry.toAddress,
      suppressionReason: entry.suppressionReason,
      sentAt: deps.now,
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
    deps.logger.error('[internal] marketing run failed', {
      runId: run.id,
      campaignId: run.campaignId,
      error: error instanceof Error ? error.message : String(error),
    })
    const outcome = await failRun(
      deps.em,
      run.id,
      deps.scope,
      claimToken,
      { attempts: run.attempts, error, stepLog: state.stepLog },
      deps.now,
    )
    if (outcome === 'retrying') {
      const nextRetryAt = await deps.em.findOne(MarketingCampaignRun, { id: run.id }, { fields: ['resumeAt'] })
      const delayMs = Math.max(0, (nextRetryAt?.resumeAt?.getTime() ?? deps.now.getTime()) - deps.now.getTime())
      await deps.enqueueResume(run.id, delayMs)
    }
    return outcome
  }
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

  if (dispatchDepth >= MAX_DISPATCH_DEPTH) {
    deps.logger.warn('[internal] marketing dispatch depth exceeded, refusing to cascade', {
      eventId: input.eventId,
      dispatchDepth,
    })
    return result
  }

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
      if (input.subjectEntityId && await hasActiveRun(deps.em, campaign.id, input.subjectEntityId, deps.scope)) {
        // Already mid-journey in this campaign; a second concurrent entry would double every
        // remaining step.
        result.skippedByGuard += 1
        continue
      }

      const definition = readDefinition(campaign)
      if (!matchesAudience(definition.audience, subject, { now: deps.now, logger: deps.logger, campaignId: campaign.id })) {
        result.skippedByAudience += 1
        continue
      }

      const context: AutomationContext = {
        tenantId: deps.scope.tenantId,
        organizationId: deps.scope.organizationId,
        eventId: input.eventId,
        occurredAt: deps.now.toISOString(),
        dispatchDepth: dispatchDepth + 1,
        subjectEntityId: input.subjectEntityId,
        subjectEmail: subject.customer?.email ?? null,
        campaignId: campaign.id,
        customer: subject.customer,
        trigger: input.triggerContext,
      }

      const run = await createRun(deps.em, {
        campaignId: campaign.id,
        scope: deps.scope,
        subjectEntityId: input.subjectEntityId,
        triggerEventId: input.eventId,
        context,
      })

      const claimToken = await claimRun(deps.em, run.id, deps.scope, deps.now)
      if (!claimToken) {
        result.skippedByGuard += 1
        continue
      }

      await persist(
        deps,
        { id: run.id, campaignId: campaign.id, subjectEntityId: input.subjectEntityId, attempts: 1 },
        claimToken,
        definition.steps,
        readSendPolicy(definition),
        { currentStepIndex: 0, stepLog: [], context },
      )
      result.started += 1
    } catch (error) {
      deps.logger.error('[internal] marketing campaign dispatch failed', {
        campaignId: campaign.id,
        eventId: input.eventId,
        error: error instanceof Error ? error.message : String(error),
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
