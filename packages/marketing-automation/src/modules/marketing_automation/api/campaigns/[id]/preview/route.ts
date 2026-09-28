import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { MarketingCampaign } from '../../../../data/entities.js'
import { buildEffects, readDefinition, readSendPolicyOf } from '../../../../lib/dispatcher.js'
import { matchesAudience } from '../../../../lib/engine/audience.js'
import { describeVariantChoices } from '../../../../lib/engine/split.js'
import { previewJourney } from '../../../../lib/preview.js'
import { buildSubjectDocument } from '../../../../lib/subject-document.js'
import { loadTierThresholds } from '../../../../lib/tiers.js'
import { buildCampaignCommandContext } from '../../../../lib/command-context.js'
import type { AutomationContext } from '../../../../lib/engine/types.js'

/**
 * What one named customer would receive from this campaign, and when.
 *
 * Behind the same feature as the dry run, and for the same reason: it names a customer and reports what
 * would be sent to them, which is a disclosure about a person even though no message goes out.
 *
 * Nothing is written and nothing is sent. The preview drives the real engine with recording effects, so
 * quiet hours, the frequency cap and the learned send hour all move the predicted timestamps exactly as
 * they would on the day — which is the only reason the answer is worth showing.
 */
const routeMetadata = {
  POST: { requireAuth: true, requireFeatures: ['marketing_automation.campaigns.test_dispatch'] },
}

export const metadata = routeMetadata

const logger = createLogger('marketing_automation')

const bodySchema = z.object({
  subjectEntityId: z.string().uuid(),
  /** Scalars a trigger would have contributed, so an audience that reads them can be exercised. */
  trigger: z.record(z.string(), z.unknown()).default({}),
})

function readCampaignId(req: Request): string | null {
  const segments = new URL(req.url).pathname.split('/').filter(Boolean)
  // .../campaigns/<id>/preview
  return segments[segments.length - 2] ?? null
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const campaignId = readCampaignId(req)
  if (!campaignId) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }
  const now = new Date()

  const campaign = await em.findOne(MarketingCampaign, { id: campaignId, ...scope, deletedAt: null })
  if (!campaign) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const definition = readDefinition(campaign)
  const tierThresholds = await loadTierThresholds(container, scope)
  const subject = await buildSubjectDocument(em, parsed.data.subjectEntityId, scope, parsed.data.trigger, now, { tierThresholds })
  const entered = matchesAudience(definition.audience, subject, { now, logger, campaignId: campaign.id })

  const context: AutomationContext = {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    eventId: 'marketing_automation.preview',
    occurredAt: now.toISOString(),
    dispatchDepth: 1,
    subjectEntityId: parsed.data.subjectEntityId,
    campaignId: campaign.id,
    trigger: parsed.data.trigger,
  }

  const deps = {
    em,
    container: container as unknown as AwilixContainer,
    logger,
    now,
    scope,
    commandContext: buildCampaignCommandContext(container as unknown as AwilixContainer, scope),
    enqueueResume: async () => {},
  }

  const result = await previewJourney(
    {
      campaignId: campaign.id,
      subjectEntityId: parsed.data.subjectEntityId,
      context,
      steps: definition.steps,
      policy: readSendPolicyOf(definition),
      entered,
      now,
      variantChoices: describeVariantChoices(definition.steps, parsed.data.subjectEntityId),
    },
    {
      deps,
      // The real effects, minus the writes — `previewJourney` replaces `recordSend` and every handler.
      effects: buildEffects(deps, { id: `preview-${campaign.id}`, campaignId: campaign.id, subjectEntityId: parsed.data.subjectEntityId }),
      logger,
    },
  )

  return NextResponse.json({
    campaign: { id: campaign.id, name: campaign.name },
    // No PII: step ids, types, timestamps and the lane assignment. Never the address the message
    // would go to, which is the same line the dry run holds.
    ...result,
  })
}

export const openApi = {
  POST: {
    summary: 'Preview a campaign for one customer',
    description:
      'Simulates the whole journey for a named customer by driving the real engine with recording side effects: every step, whether the audience admits them, which A/B lane they take, and when each step would happen once waits, quiet hours, the frequency cap and the learned send hour are applied. Sends nothing and writes nothing. Gated by `marketing_automation.campaigns.test_dispatch`.',
    tags: ['Marketing Automation'],
    responses: {
      200: { description: 'The simulated timeline' },
      400: { description: 'Invalid request body' },
      404: { description: 'Not found' },
    },
  },
}
