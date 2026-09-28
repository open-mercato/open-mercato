import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { ensureOrganizationScope } from '@open-mercato/shared/lib/commands/scope'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { MarketingCampaign, MarketingCampaignRun, MarketingCampaignTrigger } from '../data/entities.js'
import {
  campaignDefinitionSchema,
  campaignEnabledSchema,
  campaignGraphSaveSchema,
} from '../data/validators.js'
import type { CampaignEnabledInput, CampaignGraphSaveInput, CampaignTriggerInput } from '../data/validators.js'
import { getMarketingStep } from '../lib/engine/registry.js'
import { WAIT_STEP_TYPE } from '../lib/engine/chain-planner.js'
import { SPLIT_STEP_TYPE, readVariants } from '../lib/engine/split.js'
import { availableEventTriggers } from '../lib/trigger-catalog.js'
import { isSweepIntervalValid } from '../lib/sweep-interval.js'
import { emitMarketingAutomationEvent } from '../events.js'

type Scope = { tenantId: string; organizationId: string }

function requireScope(ctx: { auth?: { tenantId?: string | null; orgId?: string | null } | null }): Scope {
  const tenantId = ctx.auth?.tenantId ?? null
  const organizationId = ctx.auth?.orgId ?? null
  if (!tenantId || !organizationId) {
    throw new CrudHttpError(400, { error: 'A campaign requires both a tenant and an organization scope' })
  }
  return { tenantId, organizationId }
}

/**
 * Validates the authored graph against what this installation can actually run.
 *
 * Deliberately STRICTER than the dispatcher, which skips an unknown step type and carries on.
 * At author time an unknown type is always a mistake, and the failure mode of accepting it is
 * the worst one a marketing tool has: a campaign that looks saved and silently does nothing.
 */
/**
 * Stable codes so the editor can show a localized message.
 *
 * The English `error` string stays for API clients and logs, but it is the `code` the UI keys off:
 * without it the client can only say "could not save", which is useless to somebody who just
 * mistyped a wait value. Each code has a matching `marketing_automation.validation.*` message.
 */
export const VALIDATION_CODES = {
  unknownStepType: 'marketing_automation.validation.unknownStepType',
  invalidStepParams: 'marketing_automation.validation.invalidStepParams',
  trailingWait: 'marketing_automation.validation.trailingWait',
  unavailableTrigger: 'marketing_automation.validation.unavailableTrigger',
  duplicateTrigger: 'marketing_automation.validation.duplicateTrigger',
  loopRisk: 'marketing_automation.validation.loopRisk',
  noSteps: 'marketing_automation.validation.noSteps',
  noTriggers: 'marketing_automation.validation.noTriggers',
  invalidSchedule: 'marketing_automation.validation.invalidSchedule',
  /** The payload itself did not parse — a client sending a shape this version does not accept. */
  invalidPayload: 'marketing_automation.validation.invalidPayload',
} as const

function invalidGraph(code: string, error: string, detail?: string): CrudHttpError {
  return new CrudHttpError(400, { error, code, ...(detail ? { detail } : {}) })
}

/**
 * Events a step type can cause. Used to refuse a campaign that reacts to an event its own steps
 * emit, which would drive itself in a cycle.
 */
const STEP_EMITTED_EVENTS: Record<string, string[]> = {
  add_tag: ['customers.tag.assigned'],
  add_points: ['marketing_automation.customer.score_changed'],
}

/** Validates a step list, descending into a split's lanes, which are step lists of their own. */
function assertStepsAreRunnable(steps: CampaignGraphSaveInput['definition']['steps'], depth = 0): void {
  if (depth > 5) {
    throw invalidGraph(VALIDATION_CODES.invalidStepParams, 'Campaign steps are nested too deeply')
  }
  for (const step of steps) {
    const handler = getMarketingStep(step.type)
    if (!handler) {
      throw invalidGraph(VALIDATION_CODES.unknownStepType, `Unknown step type: ${step.type}`, step.type)
    }
    if (!handler.paramsSchema.safeParse(step.params).success) {
      throw invalidGraph(VALIDATION_CODES.invalidStepParams, `Invalid parameters for step ${step.type}`, step.type)
    }
    if (step.type === SPLIT_STEP_TYPE) {
      for (const variant of readVariants(step)) {
        assertStepsAreRunnable(variant.steps as CampaignGraphSaveInput['definition']['steps'], depth + 1)
      }
    }
  }
}

/** Every chain a subject could actually walk must not end on a wait. */
function assertNoTrailingWait(steps: CampaignGraphSaveInput['definition']['steps']): void {
  const last = steps[steps.length - 1]
  if (!last) return
  if (last.type === WAIT_STEP_TYPE) {
    throw invalidGraph(VALIDATION_CODES.trailingWait, 'The last step is a wait, which has nothing to wait for')
  }
  // When the campaign ends on a split, each lane becomes the end of the chain for the subjects it
  // selects, so a lane ending on a wait parks them forever exactly as a top-level trailing wait would.
  if (last.type === SPLIT_STEP_TYPE) {
    for (const variant of readVariants(last)) {
      assertNoTrailingWait(variant.steps as CampaignGraphSaveInput['definition']['steps'])
    }
  }
}

function assertGraphIsRunnable(payload: CampaignGraphSaveInput): void {
  const steps = payload.definition.steps

  assertStepsAreRunnable(steps)
  // A trailing wait has nothing to wait for. Silently dropping it would lose the author's
  // intent, and keeping it would park every customer forever at the end of the campaign.
  assertNoTrailingWait(steps)

  const allowedEventIds = new Set(availableEventTriggers().map((entry) => entry.eventId))
  const seenEvents = new Set<string>()
  const seenSchedules = new Set<string>()
  for (const trigger of payload.triggers) {
    if (trigger.kind === 'event') {
      if (!allowedEventIds.has(trigger.eventId)) {
        throw invalidGraph(VALIDATION_CODES.unavailableTrigger, `Trigger is not available: ${trigger.eventId}`, trigger.eventId)
      }
      if (seenEvents.has(trigger.eventId)) {
        throw invalidGraph(VALIDATION_CODES.duplicateTrigger, `Duplicate trigger: ${trigger.eventId}`, trigger.eventId)
      }
      seenEvents.add(trigger.eventId)
      continue
    }
    if (!isSweepIntervalValid(trigger.scheduleValue)) {
      throw invalidGraph(
        VALIDATION_CODES.invalidSchedule,
        `Unsupported schedule: ${trigger.scheduleValue}`,
        trigger.scheduleValue,
      )
    }
    // Keyed on the SOURCE as well as the interval, exactly as the canvas node id is. "Every day over
    // all customers" and "every day over delivered orders" are two different triggers; keying on the
    // interval alone refused a campaign the canvas had just let somebody build.
    const scheduleKey = `${trigger.sweepSource ?? 'customers'}:${trigger.scheduleValue}`
    if (seenSchedules.has(scheduleKey)) {
      throw invalidGraph(VALIDATION_CODES.duplicateTrigger, `Duplicate schedule: ${scheduleKey}`, scheduleKey)
    }
    seenSchedules.add(scheduleKey)
  }

  // Refused, not warned: a campaign reacting to an event its own step causes drives itself, and
  // the per-subject run budget would then be the only thing standing between it and a storm.
  const emitted = new Set(steps.flatMap((step) => STEP_EMITTED_EVENTS[step.type] ?? []))
  for (const eventId of seenEvents) {
    if (emitted.has(eventId)) {
      throw invalidGraph(
        VALIDATION_CODES.loopRisk,
        `Campaign reacts to ${eventId}, which its own steps emit`,
        eventId,
      )
    }
  }
}

async function replaceTriggers(
  em: EntityManager,
  campaignId: string,
  scope: Scope,
  triggers: CampaignTriggerInput[],
): Promise<void> {
  // Delete-and-reinsert rather than a diff: there are a handful of rows, they carry no state of
  // their own (the campaign's jsonb holds the graph and layout), and diffing would buy nothing
  // but a class of bugs.
  await em.nativeDelete(MarketingCampaignTrigger, {
    campaignId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })

  for (const trigger of triggers) {
    const row = em.create(MarketingCampaignTrigger, {
      campaignId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      kind: trigger.kind,
      eventId: trigger.kind === 'event' ? trigger.eventId : null,
      scheduleValue: trigger.kind === 'schedule' ? trigger.scheduleValue : null,
      reentryAfterDays: trigger.kind === 'schedule' ? trigger.reentryAfterDays : null,
      sweepSource: trigger.kind === 'schedule' ? trigger.sweepSource : null,
      sweepParams: trigger.kind === 'schedule' ? trigger.sweepParams : null,
    })
    em.persist(row)
  }
  await em.flush()
}

const emptyDefinition = () => campaignDefinitionSchema.parse({ version: 1 })

const createCampaignCommand: CommandHandler<{ name: string; description?: string | null }, { id: string }> = {
  id: 'marketing_automation.campaigns.create',

  async execute(input, ctx) {
    const scope = requireScope(ctx)
    ensureOrganizationScope(ctx, scope.organizationId)

    const em = ctx.container.resolve<EntityManager>('em').fork()
    const campaign = em.create(MarketingCampaign, {
      name: input.name,
      description: input.description ?? null,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      // A new campaign always starts disabled: it has no steps yet, and a campaign that could
      // go live before anybody authored it is a way to mail customers by accident.
      isEnabled: false,
      definition: emptyDefinition() as unknown as Record<string, unknown>,
    })
    em.persist(campaign)
    await em.flush()

    await emitMarketingAutomationEvent('marketing_automation.campaign.created', {
      id: campaign.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }, { persistent: true })

    return { id: campaign.id }
  },
}

const saveCampaignGraphCommand: CommandHandler<
  CampaignGraphSaveInput & { id: string },
  { id: string; updatedAt: string; waitingRuns: number }
> = {
  id: 'marketing_automation.campaigns.save_graph',

  async execute(rawInput, ctx) {
    const scope = requireScope(ctx)
    ensureOrganizationScope(ctx, scope.organizationId)

    const { id, ...rest } = rawInput
    // A malformed payload is the CLIENT's mistake, not the server's: parsed with `safeParse` so it
    // answers 400 with a code the editor can localize, rather than throwing past the route and
    // surfacing as a 500 that says nothing.
    const parsedPayload = campaignGraphSaveSchema.safeParse(rest)
    if (!parsedPayload.success) {
      const issue = parsedPayload.error.issues[0]
      throw invalidGraph(
        VALIDATION_CODES.invalidPayload,
        issue ? `${issue.path.join('.') || 'payload'}: ${issue.message}` : 'Invalid payload',
        issue?.path.join('.') || undefined,
      )
    }
    const payload = parsedPayload.data
    assertGraphIsRunnable(payload)

    const em = ctx.container.resolve<EntityManager>('em').fork()
    const campaign = await em.findOne(MarketingCampaign, {
      id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    })
    if (!campaign) throw new CrudHttpError(404, { error: 'Campaign not found' })

    // A campaign graph is exactly the kind of document two people edit at once, so a stale save
    // must collide rather than quietly overwrite the other person's work.
    //
    // Delegated to the platform guard rather than compared by hand: it produces the canonical
    // 409 body (`optimistic_lock_conflict` with `currentUpdatedAt`) that `surfaceRecordConflict`
    // and the shared conflict bar already know how to render. The payload's `updatedAt` is passed
    // explicitly AND the request is threaded, so the canvas can send the version as the extension
    // header while an API client may keep sending it in the body.
    enforceCommandOptimisticLock({
      resourceKind: 'marketing_automation.campaign',
      resourceId: campaign.id,
      current: campaign.updatedAt,
      expected: payload.updatedAt,
      request: ctx.request ?? null,
    })

    // One transaction: without it a failure between the two writes leaves an ENABLED campaign
    // carrying its new definition and ZERO triggers — and the unique constraint on
    // (campaign, event) makes a concurrent double-save a plausible way to get there.
    await em.transactional(async (tx) => {
      const managed = await tx.findOne(MarketingCampaign, { id: campaign.id })
      if (!managed) throw new CrudHttpError(404, { error: 'Campaign not found' })
      managed.name = payload.name
      // `description` is only touched when the caller sent the field. The canvas does not edit it,
      // and treating an absent field as "clear it" silently wiped descriptions set through the API.
      if (payload.description !== undefined) managed.description = payload.description ?? null
      managed.definition = payload.definition as unknown as Record<string, unknown>
      await replaceTriggers(tx, campaign.id, scope, payload.triggers)
    })

    // Emitted only after the whole write is committed, so no subscriber can observe a campaign
    // that does not exist in the shape the event announces.
    await emitMarketingAutomationEvent('marketing_automation.campaign.saved', {
      id: campaign.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }, { persistent: true })

    // Reported so the UI can tell the author how many customers are mid-journey — editing a
    // campaign changes what they will receive next, and that is worth saying out loud.
    const waitingRuns = await em.count(MarketingCampaignRun, {
      campaignId: campaign.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      status: 'waiting',
    })

    const saved = await em.findOne(MarketingCampaign, { id: campaign.id })
    return {
      id: campaign.id,
      updatedAt: (saved?.updatedAt ?? campaign.updatedAt).toISOString(),
      waitingRuns,
    }
  },
}

const setCampaignEnabledCommand: CommandHandler<
  CampaignEnabledInput & { id: string },
  { id: string; isEnabled: boolean; updatedAt: string }
> = {
  id: 'marketing_automation.campaigns.set_enabled',

  async execute(rawInput, ctx) {
    const scope = requireScope(ctx)
    ensureOrganizationScope(ctx, scope.organizationId)

    const { id, ...rest } = rawInput
    const payload = campaignEnabledSchema.parse(rest)

    const em = ctx.container.resolve<EntityManager>('em').fork()
    const campaign = await em.findOne(MarketingCampaign, {
      id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    })
    if (!campaign) throw new CrudHttpError(404, { error: 'Campaign not found' })

    enforceCommandOptimisticLock({
      resourceKind: 'marketing_automation.campaign',
      resourceId: campaign.id,
      current: campaign.updatedAt,
      expected: payload.updatedAt,
      request: ctx.request ?? null,
    })

    // Enabling a campaign with nothing to run is a configuration mistake that looks like success,
    // so it is refused here rather than discovered when nobody receives anything.
    if (payload.isEnabled) {
      const definition = campaignDefinitionSchema.parse(campaign.definition)
      if (definition.steps.length === 0) {
        throw invalidGraph(VALIDATION_CODES.noSteps, 'A campaign cannot be enabled with no steps')
      }
      const triggerCount = await em.count(MarketingCampaignTrigger, {
        campaignId: campaign.id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })
      if (triggerCount === 0) {
        throw invalidGraph(VALIDATION_CODES.noTriggers, 'A campaign cannot be enabled with no triggers')
      }
    }

    const changed = campaign.isEnabled !== payload.isEnabled
    campaign.isEnabled = payload.isEnabled
    await em.flush()

    if (changed) {
      await emitMarketingAutomationEvent(
        payload.isEnabled ? 'marketing_automation.campaign.enabled' : 'marketing_automation.campaign.disabled',
        { id: campaign.id, tenantId: scope.tenantId, organizationId: scope.organizationId },
        { persistent: true },
      )
    }

    return { id: campaign.id, isEnabled: campaign.isEnabled, updatedAt: campaign.updatedAt.toISOString() }
  },
}

const deleteCampaignCommand: CommandHandler<{ id: string }, { id: string }> = {
  id: 'marketing_automation.campaigns.delete',

  async execute(input, ctx) {
    const scope = requireScope(ctx)
    ensureOrganizationScope(ctx, scope.organizationId)

    const em = ctx.container.resolve<EntityManager>('em').fork()
    const campaign = await em.findOne(MarketingCampaign, {
      id: input.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    })
    if (!campaign) throw new CrudHttpError(404, { error: 'Campaign not found' })

    // Deleting is a mutation of a user-editable record, so it carries the same version check as a
    // save — the platform's locking covers update AND delete.
    enforceCommandOptimisticLock({
      resourceKind: 'marketing_automation.campaign',
      resourceId: campaign.id,
      current: campaign.updatedAt,
      request: ctx.request ?? null,
    })

    // Soft delete, and the resume path already refuses a removed campaign, so customers parked
    // inside it stop rather than continuing to receive messages from a deleted campaign.
    campaign.deletedAt = new Date()
    campaign.isEnabled = false
    await em.flush()

    await emitMarketingAutomationEvent('marketing_automation.campaign.deleted', {
      id: campaign.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }, { persistent: true })

    return { id: campaign.id }
  },
}

registerCommand(createCampaignCommand)
registerCommand(saveCampaignGraphCommand)
registerCommand(setCampaignEnabledCommand)
registerCommand(deleteCampaignCommand)

export { createCampaignCommand, saveCampaignGraphCommand, setCampaignEnabledCommand, deleteCampaignCommand }
