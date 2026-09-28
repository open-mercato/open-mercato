import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { ensureOrganizationScope } from '@open-mercato/shared/lib/commands/scope'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { MarketingCampaign, MarketingCampaignRun, MarketingCampaignTrigger } from '../data/entities.js'
import {
  campaignDefinitionSchema,
  campaignGraphSaveSchema,
  campaignTriggerSchema,
} from '../data/validators.js'
import type { CampaignGraphSaveInput, CampaignTriggerInput } from '../data/validators.js'
import { getMarketingStep } from '../lib/engine/registry.js'
import { WAIT_STEP_TYPE } from '../lib/engine/chain-planner.js'
import { availableEventTriggers } from '../lib/trigger-catalog.js'
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
function assertGraphIsRunnable(payload: CampaignGraphSaveInput): void {
  const steps = payload.definition.steps

  for (const step of steps) {
    if (!getMarketingStep(step.type)) {
      throw new CrudHttpError(400, { error: `Unknown step type: ${step.type}` })
    }
    const handler = getMarketingStep(step.type)!
    const parsed = handler.paramsSchema.safeParse(step.params)
    if (!parsed.success) {
      throw new CrudHttpError(400, { error: `Invalid parameters for step ${step.type}` })
    }
  }

  // A trailing wait has nothing to wait for. Silently dropping it would lose the author's
  // intent, and keeping it would park every customer forever at the end of the campaign.
  const last = steps[steps.length - 1]
  if (last && last.type === WAIT_STEP_TYPE) {
    throw new CrudHttpError(400, { error: 'The last step is a wait, which has nothing to wait for' })
  }

  const allowedEventIds = new Set(availableEventTriggers().map((entry) => entry.eventId))
  const seen = new Set<string>()
  for (const trigger of payload.triggers) {
    if (trigger.kind === 'event') {
      if (!allowedEventIds.has(trigger.eventId)) {
        throw new CrudHttpError(400, { error: `Trigger is not available: ${trigger.eventId}` })
      }
      if (seen.has(trigger.eventId)) {
        throw new CrudHttpError(400, { error: `Duplicate trigger: ${trigger.eventId}` })
      }
      seen.add(trigger.eventId)
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
    const payload = campaignGraphSaveSchema.parse(rest)
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
    const currentVersion = campaign.updatedAt.toISOString()
    if (payload.updatedAt !== currentVersion) {
      throw new CrudHttpError(409, {
        error: 'Campaign was modified by somebody else',
        updatedAt: currentVersion,
      })
    }

    const wasEnabled = campaign.isEnabled
    campaign.name = payload.name
    campaign.description = payload.description ?? null
    campaign.isEnabled = payload.isEnabled
    campaign.definition = payload.definition as unknown as Record<string, unknown>
    await em.flush()

    await replaceTriggers(em, campaign.id, scope, payload.triggers)

    await emitMarketingAutomationEvent('marketing_automation.campaign.saved', {
      id: campaign.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }, { persistent: true })

    if (wasEnabled !== payload.isEnabled) {
      await emitMarketingAutomationEvent(
        payload.isEnabled ? 'marketing_automation.campaign.enabled' : 'marketing_automation.campaign.disabled',
        { id: campaign.id, tenantId: scope.tenantId, organizationId: scope.organizationId },
        { persistent: true },
      )
    }

    // Reported so the UI can tell the author how many customers are mid-journey — editing a
    // campaign changes what they will receive next, and that is worth saying out loud.
    const waitingRuns = await em.count(MarketingCampaignRun, {
      campaignId: campaign.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      status: 'waiting',
    })

    return { id: campaign.id, updatedAt: campaign.updatedAt.toISOString(), waitingRuns }
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
registerCommand(deleteCampaignCommand)

export { createCampaignCommand, saveCampaignGraphCommand, deleteCampaignCommand }
