import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import type { EntityManager } from '@mikro-orm/postgresql'
import { MarketingCampaign, MarketingCampaignTrigger } from '../../data/entities.js'
import { campaignDefinitionSchema } from '../../data/validators.js'
import { buildRequestCommandContext } from '../shared.js'

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['marketing_automation.campaigns.view'] },
  POST: { requireAuth: true, requireFeatures: ['marketing_automation.campaigns.manage'] },
}

export const metadata = routeMetadata

const createBodySchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
})

const MAX_PAGE_SIZE = 100

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ items: [], total: 0 }, { status: 401 })
  }

  const url = new URL(req.url)
  const pageSize = Math.min(Number.parseInt(url.searchParams.get('pageSize') ?? '25', 10) || 25, MAX_PAGE_SIZE)
  const page = Math.max(Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1, 1)

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }

  const [campaigns, total] = await em.findAndCount(
    MarketingCampaign,
    { ...scope, deletedAt: null },
    { orderBy: { updatedAt: 'DESC' }, limit: pageSize, offset: (page - 1) * pageSize },
  )

  // One query for every campaign's triggers rather than one per row.
  const triggers = campaigns.length
    ? await em.find(MarketingCampaignTrigger, { campaignId: { $in: campaigns.map((c) => c.id) }, ...scope })
    : []
  const triggersByCampaign = new Map<string, MarketingCampaignTrigger[]>()
  for (const trigger of triggers) {
    const list = triggersByCampaign.get(trigger.campaignId) ?? []
    list.push(trigger)
    triggersByCampaign.set(trigger.campaignId, list)
  }

  return NextResponse.json({
    items: campaigns.map((campaign) => {
      const definition = campaignDefinitionSchema.safeParse(campaign.definition)
      return {
        id: campaign.id,
        name: campaign.name,
        description: campaign.description ?? null,
        isEnabled: campaign.isEnabled,
        stepCount: definition.success ? definition.data.steps.length : 0,
        triggers: (triggersByCampaign.get(campaign.id) ?? []).map((trigger) => ({
          kind: trigger.kind,
          eventId: trigger.eventId ?? null,
          scheduleValue: trigger.scheduleValue ?? null,
        })),
        // Required in every response: the canvas sends it back as the optimistic lock.
        updatedAt: campaign.updatedAt.toISOString(),
        createdAt: campaign.createdAt.toISOString(),
      }
    }),
    total,
    page,
    pageSize,
  })
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = createBodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const container = await createRequestContainer()
  const commandBus = container.resolve<CommandBus>('commandBus')
  const { result } = await commandBus.execute<typeof parsed.data, { id: string }>(
    'marketing_automation.campaigns.create',
    { input: parsed.data, ctx: buildRequestCommandContext(container, auth, req) },
  )

  return NextResponse.json({ id: result.id }, { status: 201 })
}

export const openApi = {
  GET: {
    summary: 'List marketing campaigns',
    description: 'Returns campaigns for the authenticated organization, with their trigger summary and step count.',
    tags: ['Marketing Automation'],
    responses: { 200: { description: 'A page of campaigns' } },
  },
  POST: {
    summary: 'Create a marketing campaign',
    description: 'Creates an empty, disabled campaign. The graph is authored separately through save-graph.',
    tags: ['Marketing Automation'],
    responses: { 201: { description: 'The created campaign id' } },
  },
}
