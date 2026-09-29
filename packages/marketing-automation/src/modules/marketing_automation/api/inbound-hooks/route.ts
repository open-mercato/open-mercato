import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { MarketingCampaign, MarketingInboundHook } from '../../data/entities.js'
import { inboundHookCreateSchema } from '../../data/validators.js'
import { inboundHookUrl } from '../../lib/inbound.js'
import { resolveTrackingBaseUrl, resolveTrackingSecret } from '../../lib/tracking/secret.js'
import { readQueryUuid } from '../shared.js'

/**
 * Inbound hooks: list and create.
 *
 * The URL is computed on every read rather than stored. The token is an HMAC over the row, so it can always
 * be shown again — no "copy this now, you will not see it twice" — while a database copy on its own yields
 * nothing that works.
 *
 * **The URL itself is shown only to `campaigns.manage`.** It is a bearer credential: anybody holding it can make
 * the platform send a real message to a customer THEY choose, with no session — which is more than any
 * authenticated grant in this module can do, admin included. Listing it to read-only `campaigns.view` (the
 * default `employee` role) therefore handed the lowest grant a capability the ACL reserves for the highest. The
 * rest of the row stays visible and `hasUrl` says whether one exists, which is the same shape the `webhooks`
 * module uses when it masks a signing secret.
 */
const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['marketing_automation.campaigns.view'] },
  POST: { requireAuth: true, requireFeatures: ['marketing_automation.campaigns.manage'] },
}

export const metadata = routeMetadata

const MAX_PAGE_SIZE = 100

type HookRow = MarketingInboundHook

function present(
  hook: HookRow,
  campaignName: string | null,
  secret: string | null,
  baseUrl: string | null,
  /** False for a reader who may see that a hook exists but not the credential that operates it. */
  mayRevealUrl: boolean,
) {
  return {
    id: hook.id,
    campaignId: hook.campaignId,
    campaignName,
    name: hook.name,
    /**
     * Null when the installation has no secret or no public base URL configured.
     *
     * Stated as null rather than assembled from a guess: a hook URL that looks right and cannot verify is
     * worse than an admitted gap, because the integrator debugging it has no way to tell.
     */
    url: mayRevealUrl && secret && baseUrl
      ? inboundHookUrl(baseUrl, { tenantId: hook.tenantId, organizationId: hook.organizationId, hookId: hook.id }, secret)
      : null,
    /**
     * Whether a URL exists at all, told separately from its value.
     *
     * Without it a reader without the grant cannot tell "no signing secret configured" — a real operational
     * problem worth surfacing — from "you are not allowed to see this".
     */
    hasUrl: Boolean(secret && baseUrl),
    revokedAt: hook.revokedAt ? hook.revokedAt.toISOString() : null,
    receivedCount: hook.receivedCount,
    lastReceivedAt: hook.lastReceivedAt ? hook.lastReceivedAt.toISOString() : null,
    lastOutcome: hook.lastOutcome ?? null,
    updatedAt: hook.updatedAt.toISOString(),
  }
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) return NextResponse.json({ items: [], total: 0 }, { status: 401 })

  const url = new URL(req.url)
  const pageSize = Math.min(Math.max(Number.parseInt(url.searchParams.get('pageSize') ?? '50', 10) || 50, 1), MAX_PAGE_SIZE)
  const page = Math.max(Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1, 1)
  /**
   * Validated, so a malformed filter is ignored rather than raising.
   *
   * An unusable `?campaignId=` is treated as no filter at all rather than as a 400: this is a LIST, and answering
   * the unfiltered list is closer to what the caller asked for than refusing to answer.
   */
  const campaignId = readQueryUuid(url, 'campaignId')

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }

  const [items, total] = await em.findAndCount(
    MarketingInboundHook,
    { ...scope, deletedAt: null, ...(campaignId ? { campaignId } : {}) },
    { orderBy: { createdAt: 'DESC' }, limit: pageSize, offset: (page - 1) * pageSize },
  )

  // One query for the names, so a list of twenty hooks is two statements rather than twenty-one.
  const campaignIds = [...new Set(items.map((hook) => hook.campaignId))]
  const campaigns = campaignIds.length
    ? await em.find(MarketingCampaign, { id: { $in: campaignIds }, ...scope })
    : []
  const namesById = new Map(campaigns.map((campaign) => [campaign.id, campaign.name]))

  const secret = resolveTrackingSecret()
  const baseUrl = resolveTrackingBaseUrl()

  /**
   * A second check inside the handler, because `requireFeatures` is all-or-nothing per method.
   *
   * The list stays readable at `campaigns.view`; only the credential inside it is raised to `manage`.
   */
  const rbac = container.resolve<RbacService>('rbacService')
  const mayRevealUrl = await rbac.userHasAllFeatures(
    auth.sub,
    ['marketing_automation.campaigns.manage'],
    { tenantId: auth.tenantId ?? null, organizationId: auth.orgId ?? null },
  )

  return NextResponse.json({
    items: items.map((hook) => present(hook, namesById.get(hook.campaignId) ?? null, secret, baseUrl, mayRevealUrl)),
    total,
    page,
    pageSize,
  })
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = inboundHookCreateSchema.safeParse(await req.json().catch(() => null))
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

  // The campaign is checked in THIS tenant before a hook can point at it: the id comes from a request, and
  // a hook naming somebody else's campaign would enrol their customers.
  const campaign = await em.findOne(MarketingCampaign, { id: parsed.data.campaignId, ...scope, deletedAt: null })
  if (!campaign) {
    return NextResponse.json({ error: 'Campaign not found', code: 'marketing_automation.errors.campaignNotFound' }, { status: 404 })
  }

  const hook = em.create(MarketingInboundHook, {
    ...scope,
    campaignId: campaign.id,
    name: parsed.data.name,
  })
  em.persist(hook)
  await em.flush()

  // POST already requires `campaigns.manage`, so creation reveals the URL — which is the moment it is needed.
  return NextResponse.json(present(hook, campaign.name, resolveTrackingSecret(), resolveTrackingBaseUrl(), true))
}

export const openApi = {
  GET: {
    summary: 'List inbound hooks with their URLs',
    tags: ['Marketing Automation'],
    responses: { 200: { description: 'Hooks, each with the signed URL to post to' } },
  },
  POST: {
    summary: 'Create an inbound hook for a campaign',
    description: 'The campaign is fixed at creation. The returned URL is derived from the row and can be read again at any time.',
    tags: ['Marketing Automation'],
    responses: { 200: { description: 'The hook' }, 404: { description: 'No such campaign in this tenant' } },
  },
}
