import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { reportError } from '@open-mercato/telemetry'
import { MarketingCampaign, MarketingCampaignTrigger } from '../../../../data/entities.js'
import { listContentBlockKeys } from '../../../../lib/content-blocks.js'
import {
  CopyDraftUnavailableError,
  CopyDraftUnusableError,
  draftCampaignCopy,
  loadBrandVoice,
} from '../../../../lib/ai-copy.js'
import { COPY_PLACEHOLDERS } from '../../../../lib/interpolate.js'
import { readPathUuid } from '../../../shared.js'

/**
 * Drafts a subject and body for one message in this campaign.
 *
 * Authoring only. The draft is RETURNED, never saved: the author sees it, edits it, and saves the campaign
 * as usual. That is the whole reason this is an endpoint of its own rather than a step — the module's
 * standing rule is that AI may author and only a human may publish, and returning a draft is the only shape
 * that keeps the rule structural rather than a matter of trust.
 */
const routeMetadata = {
  POST: { requireAuth: true, requireFeatures: ['marketing_automation.campaigns.manage'] },
}

export const metadata = routeMetadata

const logger = createLogger('marketing_automation')

const bodySchema = z.object({
  /** What the author wants the message to say. Free text; the only part that drives the content. */
  brief: z.string().trim().max(2000).optional(),
})

function readCampaignId(req: Request): string | null {
  // .../campaigns/<id>/draft-copy
  return readPathUuid(req, 2)
}

/** What the campaign reacts to, in a sentence a model can use. */
function describeTriggers(triggers: MarketingCampaignTrigger[]): string | null {
  const described = triggers.map((trigger) => (trigger.kind === 'schedule'
    ? `a periodic sweep (${trigger.scheduleValue ?? 'unspecified interval'})`
    : trigger.eventId ?? 'an unspecified event'))
  return described.length > 0 ? described.join(', ') : null
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const campaignId = readCampaignId(req)
  if (!campaignId) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return NextResponse.json(
      {
        error: issue ? `${issue.path.join('.') || 'payload'}: ${issue.message}` : 'Invalid payload',
        code: 'marketing_automation.validation.invalidPayload',
      },
      { status: 400 },
    )
  }

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }

  const campaign = await em.findOne(MarketingCampaign, { id: campaignId, ...scope, deletedAt: null })
  if (!campaign) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const [triggers, blocks, brandVoice] = await Promise.all([
    em.find(MarketingCampaignTrigger, { campaignId: campaign.id, ...scope }),
    listContentBlockKeys(em, scope),
    loadBrandVoice(container, scope),
  ])

  try {
    const copy = await draftCampaignCopy(container, {
      campaignName: campaign.name,
      triggerDescription: describeTriggers(triggers),
      brief: parsed.data.brief ?? null,
      brandVoice,
      // The real placeholders, so the draft cannot invent one that renders as literal braces in an inbox.
      placeholders: [...COPY_PLACEHOLDERS],
      blockKeys: blocks.map((block) => block.key),
      recommendationsAvailable: true,
    })
    return NextResponse.json(copy)
  } catch (error) {
    if (error instanceof CopyDraftUnavailableError) {
      return NextResponse.json(
        { error: 'No AI model is configured', code: 'marketing_automation.errors.aiNotConfigured' },
        { status: 503 },
      )
    }
    if (error instanceof CopyDraftUnusableError) {
      return NextResponse.json(
        { error: 'The model did not return usable copy', code: 'marketing_automation.errors.aiUnusable' },
        { status: 502 },
      )
    }
    // A provider failure quotes whatever it likes, including the request it rejected; it goes to the log and
    // the reporter, and the author gets a sentence they can act on.
    logger.error('[internal] marketing copy draft failed', {
      campaignId: campaign.id,
      error: error instanceof Error ? error.message : String(error),
    })
    reportError(error, { module: 'marketing_automation', code: 'marketing_automation.copy_draft_failed' })
    return NextResponse.json(
      { error: 'Could not draft the copy', code: 'marketing_automation.errors.aiFailed' },
      { status: 502 },
    )
  }
}

export const openApi = {
  POST: {
    summary: 'Draft a subject and body for a message in this campaign',
    description:
      'Returns a draft for the author to edit; saves nothing. Grounded in the campaign name, its triggers, the tenant brand voice and the placeholders and content blocks that actually exist. 503 when no model is configured, which includes an installation without the AI package.',
    tags: ['Marketing Automation'],
    responses: {
      200: { description: 'The drafted subject, HTML body and plain-text body' },
      404: { description: 'No such campaign in this tenant' },
      502: { description: 'The model failed or returned nothing usable' },
      503: { description: 'No model configured' },
    },
  },
}
