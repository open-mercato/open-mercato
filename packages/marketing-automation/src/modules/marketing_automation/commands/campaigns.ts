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
import { SPLIT_STEP_TYPE, readVariants, writeVariants } from '../lib/engine/split.js'
import { availableEventTriggers } from '../lib/trigger-catalog.js'
import { carrySweepClocks, isSweepIntervalValid, sweepClockKey } from '../lib/sweep-interval.js'
import { emitMarketingAutomationEvent } from '../events.js'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { recordRevision } from '../lib/revisions.js'

const logger = createLogger('marketing_automation')

type Scope = { tenantId: string; organizationId: string }

/**
 * The tenant and organization this write belongs to.
 *
 * From `ctx.auth` for a request, and from the INPUT for a system actor — which is the platform's own pattern
 * (`warranty_claims` takes `input.tenantId` and then `ensureTenantScope`). Reading only `ctx.auth` meant every
 * caller built with `buildCampaignCommandContext` — deliberately `auth: null`, so a campaign's writes are not
 * attributed to whoever authored it — got a flat 400. That made the AI authoring tools' entire write path fail:
 * the agent could describe and estimate, then every `create` and `save_graph` returned "requires a tenant".
 *
 * A system-actor context cannot be constructed from HTTP, so trusting its input is the same trust level the
 * platform already extends; a request-borne caller still gets its scope from the session and nothing else.
 */
function requireScope(
  ctx: { auth?: { tenantId?: string | null; orgId?: string | null } | null; systemActor?: boolean },
  rawInput?: unknown,
): Scope {
  let tenantId = ctx.auth?.tenantId ?? null
  let organizationId = ctx.auth?.orgId ?? null

  if ((!tenantId || !organizationId) && ctx.systemActor === true && rawInput && typeof rawInput === 'object') {
    const carried = rawInput as { tenantId?: unknown; organizationId?: unknown }
    if (!tenantId && typeof carried.tenantId === 'string' && carried.tenantId.trim()) tenantId = carried.tenantId
    if (!organizationId && typeof carried.organizationId === 'string' && carried.organizationId.trim()) {
      organizationId = carried.organizationId
    }
  }

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

/**
 * Every event any step could emit, INCLUDING steps inside a split's lanes.
 *
 * Exported for its own test. A trunk-only version of this shipped first and was the interesting kind
 * of wrong: its two sibling assertions both recurse, so a campaign whose `add_tag` sat inside a lane
 * passed the cycle check and then drove itself on every tag assignment, with only the per-subject run
 * budget braking it.
 */
export function collectEmittedEvents(
  steps: CampaignGraphSaveInput['definition']['steps'],
  depth = 0,
): Set<string> {
  const emitted = new Set<string>()
  if (depth > 5) return emitted
  for (const step of steps) {
    for (const eventId of STEP_EMITTED_EVENTS[step.type] ?? []) emitted.add(eventId)
    if (step.type !== SPLIT_STEP_TYPE) continue
    for (const variant of readVariants(step)) {
      const nested = collectEmittedEvents(
        variant.steps as CampaignGraphSaveInput['definition']['steps'],
        depth + 1,
      )
      for (const eventId of nested) emitted.add(eventId)
    }
  }
  return emitted
}

/**
 * Refused, not warned: a campaign reacting to an event its own step causes drives itself, and the
 * per-subject run budget would then be the only thing standing between it and a storm.
 */
export function assertNoLoopRisk(
  steps: CampaignGraphSaveInput['definition']['steps'],
  eventIds: Iterable<string>,
): void {
  const emitted = collectEmittedEvents(steps)
  for (const eventId of eventIds) {
    if (emitted.has(eventId)) {
      throw invalidGraph(
        VALIDATION_CODES.loopRisk,
        `Campaign reacts to ${eventId}, which its own steps emit`,
        eventId,
      )
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

  assertNoLoopRisk(steps, seenEvents)
}

async function replaceTriggers(
  em: EntityManager,
  campaignId: string,
  scope: Scope,
  triggers: CampaignTriggerInput[],
): Promise<void> {
  // Delete-and-reinsert rather than a diff: there are a handful of rows, and diffing would buy nothing
  // but a class of bugs. The campaign's jsonb holds the graph and the layout, so the only per-row state
  // is the sweep clock — carried across below, because losing it is not cosmetic.
  const existing = await em.find(MarketingCampaignTrigger, {
    campaignId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })

  // The sweep clock survives the save — `carrySweepClocks` says why, and is where it is tested.
  const sweptAt = carrySweepClocks(existing)

  await em.nativeDelete(MarketingCampaignTrigger, {
    campaignId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })

  for (const trigger of triggers) {
    const schedule = trigger.kind === 'schedule'
    const row = em.create(MarketingCampaignTrigger, {
      campaignId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      kind: trigger.kind,
      eventId: trigger.kind === 'event' ? trigger.eventId : null,
      scheduleValue: schedule ? trigger.scheduleValue : null,
      reentryAfterDays: schedule ? trigger.reentryAfterDays : null,
      sweepSource: schedule ? trigger.sweepSource : null,
      sweepParams: schedule ? trigger.sweepParams : null,
      lastSweptAt: schedule ? sweptAt.get(sweepClockKey(trigger.sweepSource, trigger.scheduleValue)) ?? null : null,
    })
    em.persist(row)
  }
  await em.flush()
}

const emptyDefinition = () => campaignDefinitionSchema.parse({ version: 1 })

const createCampaignCommand: CommandHandler<{ name: string; description?: string | null }, { id: string }> = {
  id: 'marketing_automation.campaigns.create',

  async execute(input, ctx) {
    const scope = requireScope(ctx, input)
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

/**
 * Replaces a split with the steps of the lane that won.
 *
 * The A/B test is over at this point: every later subject walks the winner, and the split node
 * disappears from the canvas. Recursive, because a split can sit inside another split's lane.
 *
 * Returns null when the step was not found or is not a split, so the caller answers 404 rather than
 * saving a definition it did not change.
 */
function applyWinnerToSteps(
  steps: CampaignGraphSaveInput['definition']['steps'],
  splitStepId: string,
  variantKey: string,
  depth = 0,
): CampaignGraphSaveInput['definition']['steps'] | null {
  if (depth > 5) return null
  const next: CampaignGraphSaveInput['definition']['steps'] = []
  let replaced = false

  for (const step of steps) {
    if (step.id === splitStepId && step.type === SPLIT_STEP_TYPE) {
      const variant = readVariants(step).find((entry) => entry.key === variantKey)
      if (!variant) return null
      // Spliced IN PLACE, exactly as `flattenSteps` would have done for a subject in that lane — so
      // the campaign keeps running the chain those subjects were already walking.
      next.push(...(variant.steps as CampaignGraphSaveInput['definition']['steps']))
      replaced = true
      continue
    }

    if (step.type === SPLIT_STEP_TYPE) {
      const variants = readVariants(step)
      let touched = false
      const rewritten = variants.map((variant) => {
        if (touched) return variant
        const laneSteps = applyWinnerToSteps(
          variant.steps as CampaignGraphSaveInput['definition']['steps'],
          splitStepId,
          variantKey,
          depth + 1,
        )
        if (!laneSteps) return variant
        touched = true
        return { ...variant, steps: laneSteps }
      })
      if (touched) {
        replaced = true
        next.push(writeVariants(step, rewritten) as CampaignGraphSaveInput['definition']['steps'][number])
        continue
      }
    }

    next.push(step)
  }

  return replaced ? next : null
}

const applySplitWinnerCommand: CommandHandler<
  { id: string; updatedAt?: string; stepId: string; variantKey: string },
  { id: string; updatedAt: string; stepId: string; variantKey: string }
> = {
  id: 'marketing_automation.campaigns.apply_split_winner',

  async execute(rawInput, ctx) {
    const scope = requireScope(ctx, rawInput)
    ensureOrganizationScope(ctx, scope.organizationId)

    const stepId = typeof rawInput.stepId === 'string' ? rawInput.stepId.trim() : ''
    const variantKey = typeof rawInput.variantKey === 'string' ? rawInput.variantKey.trim() : ''
    if (!stepId || !variantKey) {
      throw invalidGraph(VALIDATION_CODES.invalidPayload, 'stepId and variantKey are required')
    }

    /**
     * The expected version is a string or it is ABSENT, and there is no third option.
     *
     * `enforceCommandOptimisticLock` falls back to the request header when no version is passed, so anything
     * that is neither a string nor undefined — a number, an object, a client's `null` — used to reach it as a
     * value it could not compare, and the lock on a rewrite of the whole campaign quietly opened. Refused
     * here instead.
     */
    if (rawInput.updatedAt !== undefined && typeof rawInput.updatedAt !== 'string') {
      throw invalidGraph(VALIDATION_CODES.invalidPayload, 'updatedAt must be the version string the client last read')
    }

    const em = ctx.container.resolve<EntityManager>('em').fork()
    const campaign = await em.findOne(MarketingCampaign, {
      id: rawInput.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    })
    if (!campaign) throw new CrudHttpError(404, { error: 'Campaign not found' })

    // Applying a winner rewrites the campaign, so it collides with a concurrent edit exactly as a
    // save does — the author on the other screen is mid-change to the very steps being replaced.
    enforceCommandOptimisticLock({
      resourceKind: 'marketing_automation.campaign',
      resourceId: campaign.id,
      current: campaign.updatedAt,
      // Undefined when the client sent the version as the extension header instead of in the body;
      // the guard reads it from the request in that case.
      expected: rawInput.updatedAt,
      request: ctx.request ?? null,
    })

    const definition = campaignDefinitionSchema.parse(campaign.definition)
    const steps = applyWinnerToSteps(
      definition.steps as CampaignGraphSaveInput['definition']['steps'],
      stepId,
      variantKey,
    )
    if (!steps) throw new CrudHttpError(404, { error: 'Split or variant not found' })

    const rewritten = { ...definition, steps }
    // The result has to be runnable on its own terms: a winning lane ending on a wait, promoted to the
    // end of the campaign, would park every future subject forever.
    assertStepsAreRunnable(steps)
    assertNoTrailingWait(steps)
    // And it must not become a cycle. The promoted lane's steps are the trunk now, so a lane emitting
    // an event this campaign reacts to would start driving itself the moment the test ended.
    const triggers = await em.find(MarketingCampaignTrigger, {
      campaignId: campaign.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      kind: 'event',
    })
    assertNoLoopRisk(steps, triggers.map((trigger) => trigger.eventId).filter((eventId): eventId is string => !!eventId))

    await em.transactional(async (tx) => {
      const managed = await tx.findOne(MarketingCampaign, { id: campaign.id })
      if (!managed) throw new CrudHttpError(404, { error: 'Campaign not found' })
      managed.definition = rewritten as unknown as Record<string, unknown>
    })

    /**
     * Recorded in the history like any other edit, because it IS one.
     *
     * Promoting a winner replaces the split with one lane's steps — the most consequential single change this
     * module can make to a campaign, and the only one that was invisible in the version list and therefore
     * impossible to undo. The note names the variant, since "why does this campaign no longer have an A/B
     * test in it" is the question somebody reads the list to answer.
     */
    await recordRevision(
      em,
      scope,
      {
        campaignId: campaign.id,
        name: campaign.name,
        definition: rewritten as unknown as Record<string, unknown>,
        actorId: typeof ctx.auth?.sub === 'string' ? ctx.auth.sub : null,
        note: `winner:${variantKey}`,
      },
      (error) => {
        logger.warn('[internal] marketing campaign revision not recorded', {
          campaignId: campaign.id,
          error: error instanceof Error ? error.message : String(error),
        })
      },
    )

    await emitMarketingAutomationEvent('marketing_automation.campaign.saved', {
      id: campaign.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }, { persistent: true })

    const saved = await em.findOne(MarketingCampaign, { id: campaign.id })
    return {
      id: campaign.id,
      updatedAt: (saved?.updatedAt ?? campaign.updatedAt).toISOString(),
      stepId,
      variantKey,
    }
  },
}

const saveCampaignGraphCommand: CommandHandler<
  /** `restoredFrom` is internal: the restore endpoint sets it so the history entry can say so. */
  CampaignGraphSaveInput & { id: string; restoredFrom?: number },
  { id: string; updatedAt: string; waitingRuns: number }
> = {
  id: 'marketing_automation.campaigns.save_graph',

  async execute(rawInput, ctx) {
    const scope = requireScope(ctx, rawInput)
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

    /**
     * History, recorded after the commit and never able to fail the save.
     *
     * `restoredFrom` is threaded through the input rather than inferred, because a restore looks exactly
     * like an edit from in here — and "version 7 is a restore of version 3" is the one thing a person
     * reading the list actually wants to know.
     */
    await recordRevision(
      em,
      scope,
      {
        campaignId: campaign.id,
        name: payload.name,
        definition: payload.definition as unknown as Record<string, unknown>,
        actorId: typeof ctx.auth?.sub === 'string' ? ctx.auth.sub : null,
        note: typeof rawInput.restoredFrom === 'number' ? `restored:${rawInput.restoredFrom}` : 'saved',
      },
      (error) => {
        logger.warn('[internal] marketing campaign revision not recorded', {
          campaignId: campaign.id,
          error: error instanceof Error ? error.message : String(error),
        })
      },
    )

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
    const scope = requireScope(ctx, rawInput)
    ensureOrganizationScope(ctx, scope.organizationId)

    const { id, ...rest } = rawInput
    // `safeParse`, like the graph save: a malformed body is the client's mistake and must answer 400
    // with a code, not escape the command and surface as a 500 that says nothing.
    const parsedEnabled = campaignEnabledSchema.safeParse(rest)
    if (!parsedEnabled.success) {
      const issue = parsedEnabled.error.issues[0]
      throw invalidGraph(
        VALIDATION_CODES.invalidPayload,
        issue ? `${issue.path.join('.') || 'payload'}: ${issue.message}` : 'Invalid payload',
        issue?.path.join('.') || undefined,
      )
    }
    const payload = parsedEnabled.data

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
    const scope = requireScope(ctx, input)
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
registerCommand(applySplitWinnerCommand)
registerCommand(setCampaignEnabledCommand)
registerCommand(deleteCampaignCommand)

export { createCampaignCommand, saveCampaignGraphCommand, setCampaignEnabledCommand, deleteCampaignCommand }
