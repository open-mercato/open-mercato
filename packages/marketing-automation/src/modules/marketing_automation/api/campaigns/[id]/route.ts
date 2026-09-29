import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import type { EntityManager } from '@mikro-orm/postgresql'
import { MarketingCampaign, MarketingCampaignTrigger } from '../../../data/entities.js'
import { campaignDefinitionSchema } from '../../../data/validators.js'
import { buildRequestCommandContext, commandErrorResponse, readPathUuid } from '../../shared.js'

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['marketing_automation.campaigns.view'] },
  DELETE: { requireAuth: true, requireFeatures: ['marketing_automation.campaigns.manage'] },
}

export const metadata = routeMetadata

function readId(req: Request): string | null {
  return readPathUuid(req, 1)
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const id = readId(req)
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }

  const campaign = await em.findOne(MarketingCampaign, { id, ...scope, deletedAt: null })
  if (!campaign) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const triggers = await em.find(MarketingCampaignTrigger, { campaignId: campaign.id, ...scope })
  // Parsed rather than passed through raw: a definition written by an older version of the
  // module gets its defaults filled in here instead of surprising the canvas.
  const definition = campaignDefinitionSchema.parse(campaign.definition)

  return NextResponse.json({
    id: campaign.id,
    name: campaign.name,
    description: campaign.description ?? null,
    isEnabled: campaign.isEnabled,
    definition,
    triggers: triggers.map((trigger) => trigger.kind === 'event'
      ? { kind: 'event' as const, eventId: trigger.eventId }
      : {
          kind: 'schedule' as const,
          scheduleValue: trigger.scheduleValue,
          reentryAfterDays: trigger.reentryAfterDays ?? null,
          sweepSource: trigger.sweepSource ?? 'customers',
          sweepParams: trigger.sweepParams ?? {},
        }),
    updatedAt: campaign.updatedAt.toISOString(),
    createdAt: campaign.createdAt.toISOString(),
  })
}

export async function DELETE(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const id = readId(req)
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const container = await createRequestContainer()
  const commandBus = container.resolve<CommandBus>('commandBus')
  try {
    await commandBus.execute('marketing_automation.campaigns.delete', {
      input: { id },
      ctx: buildRequestCommandContext(container, auth, req),
    })
  } catch (error) {
    // A delete carries an expected version too, so 409 is a real outcome here and not a server fault.
    return commandErrorResponse(error)
  }

  return NextResponse.json({ ok: true })
}

export const openApi = {
  GET: {
    summary: 'Get a campaign with its full authored graph',
    tags: ['Marketing Automation'],
    responses: { 200: { description: 'The campaign, its triggers and its definition' }, 404: { description: 'Not found' } },
  },
  DELETE: {
    summary: 'Delete a campaign',
    description: 'Soft-deletes the campaign and disables it, so customers parked mid-journey stop instead of continuing.',
    tags: ['Marketing Automation'],
    responses: { 200: { description: 'Deleted' }, 404: { description: 'Not found' } },
  },
}
