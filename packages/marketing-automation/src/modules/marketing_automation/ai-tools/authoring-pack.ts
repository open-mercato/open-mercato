import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import { MarketingCampaign, MarketingCampaignTrigger } from '../data/entities.js'
import { campaignDefinitionSchema } from '../data/validators.js'
import { listMarketingSteps } from '../lib/engine/registry.js'
import { TRIGGER_CATALOG } from '../lib/trigger-catalog.js'
import { sweepSourceCatalog } from '../lib/sweep-sources.js'
import { describeNarrowing, planNarrowing } from '../lib/engine/narrowing.js'
import { createSqlCandidateSource, resolveCandidates } from '../lib/audience/set-resolver.js'
import { buildCampaignCommandContext } from '../lib/command-context.js'
import { requireToolScope } from './types.js'
import type { MarketingAiToolDefinition } from './types.js'

/**
 * `marketing_automation.*` authoring tools for an agent.
 *
 * A person authors a campaign on the canvas; this pack lets an agent author one through the SAME
 * surfaces. Deliberately thin: the step registry, the trigger catalogue and the save command already ARE
 * the authoring API, so every tool delegates to one of them rather than growing a parallel engine.
 *
 * Three invariants hold for every tool here:
 *
 *  1. **Nothing is ever published.** There is no tool that enables a campaign. Enabling is what starts
 *     messaging real customers, it is gated behind its own human permission, and an agent that could do
 *     it would turn a misunderstood sentence into mail nobody approved. Draft, review, publish by hand.
 *  2. **Nothing bypasses the save validation.** `save_graph` goes through the command, so an agent's
 *     graph faces exactly the checks a person's does — unknown step types, trailing waits, cycles,
 *     unavailable triggers — and gets the same stable codes back.
 *  3. **Nothing crosses a tenant.** Every read and write is scoped, so a foreign campaign is invisible
 *     rather than merely forbidden.
 */


const noInput = z.object({})
const listInput = z.object({ limit: z.number().int().min(1).max(50).default(20) })
const getInput = z.object({ campaignId: z.string().uuid() })
const estimateInput = z.object({ audience: z.unknown().nullable() })
const createInput = z.object({ name: z.string().min(1).max(200) })
const saveInput = z.object({
  campaignId: z.string().uuid(),
  updatedAt: z.string().min(1),
  name: z.string().min(1).max(200),
  triggers: z.array(z.record(z.string(), z.unknown())),
  definition: z.record(z.string(), z.unknown()),
})

const describeBuildingBlocksTool: MarketingAiToolDefinition<z.infer<typeof noInput>> = {
    name: 'marketing_automation.describe_building_blocks',
    displayName: 'Describe marketing building blocks',
    description:
      'Lists everything a campaign can be built from in THIS installation: event triggers (with the context paths each contributes), periodic sweep sources, and step types with their parameter names. Call this before composing a campaign — availability differs per installation, and a graph referring to something absent is refused.',
    inputSchema: noInput,
    requiredFeatures: ['marketing_automation.campaigns.view'],
    tags: ['marketing', 'authoring'],
    async handler(_input, context) {
      requireToolScope(context)
      return {
        triggers: TRIGGER_CATALOG.map((entry) => ({
          eventId: entry.eventId,
          available: entry.available,
          blockedReason: entry.blockedReasonKey ?? null,
          contextKeys: entry.contextKeys,
        })),
        sweepSources: sweepSourceCatalog().map((source) => ({
          id: source.id,
          available: source.available,
          contextKeys: source.contextKeys,
          defaultWithinDays: source.defaultWithinDays,
        })),
        steps: listMarketingSteps().map((step) => ({
          type: step.type,
          channel: step.channel ?? null,
          params: step.uiFields.map((field) => ({ name: field.name, kind: field.kind, required: field.required === true })),
        })),
        audienceFields: [
          'tags', 'orders.count', 'orders.totalGross', 'orders.daysSinceLast', 'orders.skus',
          'orders.channels', 'orders.categories', 'orders.averageGross',
          'score.points', 'score.tier', 'score.tierRank',
          // RFM digits are 1–5 and are measured against THIS shop's buyers, so `rfm.monetary >= 4` means
          // "in the top two fifths by spend here" rather than a threshold somebody invented.
          'rfm.recency', 'rfm.frequency', 'rfm.monetary', 'rfm.total', 'rfm.cell',
          'value.averageOrderGross', 'value.ordersPerYear', 'value.projectedHorizonGross', 'value.grossPercentile',
          'survey.nps', 'segments',
          // Engagement, which is what a re-engagement or sunset audience is built on.
          'engagement.sent', 'engagement.opened', 'engagement.clicked', 'engagement.daysSinceEngaged',
          'address.country', 'address.region', 'address.city', 'address.postalCode',
          'customer.email', 'customer.displayName', 'customer.createdAt', 'customer.locale',
        ],
      }
    },
}

const listCampaignsTool: MarketingAiToolDefinition<z.infer<typeof listInput>> = {
    name: 'marketing_automation.list_campaigns',
    displayName: 'List marketing campaigns',
    description: 'Lists campaigns with their enabled state, trigger count and step count. Read-only.',
    inputSchema: listInput,
    requiredFeatures: ['marketing_automation.campaigns.view'],
    tags: ['marketing'],
    async handler(input, context) {
      const scope = requireToolScope(context)
      const em = context.container.resolve<EntityManager>('em')
      const campaigns = await em.find(
        MarketingCampaign,
        { ...scope, deletedAt: null },
        { orderBy: { updatedAt: 'DESC' }, limit: input.limit },
      )
      return {
        campaigns: campaigns.map((campaign) => {
          const definition = campaignDefinitionSchema.safeParse(campaign.definition)
          return {
            id: campaign.id,
            name: campaign.name,
            isEnabled: campaign.isEnabled,
            updatedAt: campaign.updatedAt.toISOString(),
            stepCount: definition.success ? definition.data.steps.length : 0,
          }
        }),
      }
    },
}

const getCampaignTool: MarketingAiToolDefinition<z.infer<typeof getInput>> = {
    name: 'marketing_automation.get_campaign',
    displayName: 'Get a marketing campaign',
    description:
      'Returns one campaign with its triggers and its authored definition, plus the `updatedAt` a later save must send back. Read-only.',
    inputSchema: getInput,
    requiredFeatures: ['marketing_automation.campaigns.view'],
    tags: ['marketing'],
    async handler(input, context) {
      const scope = requireToolScope(context)
      const em = context.container.resolve<EntityManager>('em')
      const campaign = await em.findOne(MarketingCampaign, { id: input.campaignId, ...scope, deletedAt: null })
      if (!campaign) return { found: false }
      const triggers = await em.find(MarketingCampaignTrigger, { campaignId: campaign.id, ...scope })
      return {
        found: true,
        id: campaign.id,
        name: campaign.name,
        isEnabled: campaign.isEnabled,
        // Required by `save_graph`: read before write is enforced by the optimistic lock, not by advice.
        updatedAt: campaign.updatedAt.toISOString(),
        definition: campaign.definition,
        triggers: triggers.map((trigger) => ({
          kind: trigger.kind,
          eventId: trigger.eventId ?? null,
          scheduleValue: trigger.scheduleValue ?? null,
          sweepSource: trigger.sweepSource ?? null,
          reentryAfterDays: trigger.reentryAfterDays ?? null,
        })),
      }
    },
}

const estimateAudienceTool: MarketingAiToolDefinition<z.infer<typeof estimateInput>> = {
    name: 'marketing_automation.estimate_audience',
    displayName: 'Estimate a marketing audience',
    description:
      'Counts how many customers an audience expression would reach. Answers `exact` only when the whole expression is answerable in the database; otherwise the number is an upper bound, because the rest is decided per customer at send time. Read-only.',
    inputSchema: estimateInput,
    requiredFeatures: ['marketing_automation.campaigns.view'],
    tags: ['marketing', 'audience'],
    async handler(input, context) {
      const scope = requireToolScope(context)
      const em = context.container.resolve<EntityManager>('em')
      const parsed = campaignDefinitionSchema.shape.audience.safeParse(input.audience ?? null)
      if (!parsed.success) return { ok: false, reason: 'invalid_audience' }

      const plan = planNarrowing(parsed.data)
      const candidates = await resolveCandidates(plan.narrowing, createSqlCandidateSource(em, scope, new Date()))
      return {
        ok: true,
        narrowing: describeNarrowing(plan),
        qualifier: plan.complete ? 'exact' : 'atMost',
        candidates: candidates.ids ? candidates.ids.length : null,
      }
    },
}

const createCampaignTool: MarketingAiToolDefinition<z.infer<typeof createInput>> = {
    name: 'marketing_automation.create_campaign',
    displayName: 'Create a marketing campaign',
    description:
      'Creates an empty campaign, DISABLED. It sends nothing until a person enables it; there is no tool that can enable one.',
    inputSchema: createInput,
    requiredFeatures: ['marketing_automation.campaigns.manage'],
    tags: ['marketing', 'authoring'],
    isMutation: true,
    async handler(input, context) {
      const scope = requireToolScope(context)
      const commandBus = context.container.resolve<CommandBus>('commandBus')
      /**
       * The scope travels in the INPUT as well as the context.
       *
       * `buildCampaignCommandContext` is deliberately `auth: null` — a campaign's writes are the module's, not
       * the author's — and the command reads a system actor's scope from its input, the way the platform's own
       * system-actor commands do. Without it every create and save from an agent answered 400.
       */
      const { result } = await commandBus.execute<{ name: string; tenantId: string; organizationId: string }, { id: string }>(
        'marketing_automation.campaigns.create',
        {
          input: { name: input.name, tenantId: scope.tenantId, organizationId: scope.organizationId },
          ctx: buildCampaignCommandContext(context.container, scope),
        },
      )
      return { id: result?.id ?? null, isEnabled: false }
    },
}

const saveCampaignGraphTool: MarketingAiToolDefinition<z.infer<typeof saveInput>> = {
    name: 'marketing_automation.save_campaign_graph',
    displayName: 'Save a marketing campaign graph',
    description:
      'Replaces a campaign\'s name, triggers and authored definition in one write. Send the `updatedAt` from `get_campaign`; a stale value is refused with a conflict. The graph faces exactly the validation a person\'s does — unknown step types, a trailing wait, a cycle, an unavailable trigger — and the refusal carries a stable code. Saving never enables a campaign.',
    inputSchema: saveInput,
    requiredFeatures: ['marketing_automation.campaigns.manage'],
    tags: ['marketing', 'authoring'],
    isMutation: true,
    async handler(input, context) {
      const scope = requireToolScope(context)
      const commandBus = context.container.resolve<CommandBus>('commandBus')
      try {
        const { result } = await commandBus.execute<Record<string, unknown>, { updatedAt: string; waitingRuns: number }>(
          'marketing_automation.campaigns.save_graph',
          {
            input: {
              id: input.campaignId,
              updatedAt: input.updatedAt,
              name: input.name,
              triggers: input.triggers,
              definition: input.definition,
              // See `create` above: a system actor carries its scope in the input.
              tenantId: scope.tenantId,
              organizationId: scope.organizationId,
            },
            ctx: buildCampaignCommandContext(context.container, scope),
          },
        )
        return { ok: true, updatedAt: result?.updatedAt ?? null, waitingRuns: result?.waitingRuns ?? 0 }
      } catch (error) {
        // The stable validation code, not a prose string: an agent can act on a code and cannot on prose.
        const body = (error as { body?: { code?: unknown; error?: unknown }; status?: number } | null)
        return {
          ok: false,
          status: body?.status ?? null,
          code: typeof body?.body?.code === 'string' ? body.body.code : null,
          message: typeof body?.body?.error === 'string' ? body.body.error : 'save failed',
        }
      }
    },
}

/**
 * One cast, on the collection.
 *
 * The same shape the platform's own tool packs use: each tool above keeps its real input type — so its
 * handler is fully checked — and only the ARRAY is erased, because the registry merely carries tools and
 * cannot be generic over six different input shapes.
 */
export const marketingAuthoringAiTools = [
  describeBuildingBlocksTool,
  listCampaignsTool,
  getCampaignTool,
  estimateAudienceTool,
  createCampaignTool,
  saveCampaignGraphTool,
] as unknown as MarketingAiToolDefinition<never, never>[]

export default marketingAuthoringAiTools
