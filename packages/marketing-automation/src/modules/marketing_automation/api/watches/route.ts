import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { MarketingProductWatch } from '../../data/entities.js'
import { startWatch } from '../../lib/product-watches.js'

/**
 * Product watches: what customers are waiting to get cheaper.
 *
 * The list is aggregated by SKU rather than listing every watch, because the operational question is about
 * DEMAND — which products people are waiting for — and a per-row list of ten thousand watches answers a
 * question nobody asks while hiding the one they do.
 */
const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['marketing_automation.runs.view'] },
  POST: { requireAuth: true, requireFeatures: ['marketing_automation.campaigns.manage'] },
}

export const metadata = routeMetadata

const createSchema = z.object({
  customerId: z.string().uuid(),
  sku: z.string().trim().min(1).max(120),
  /** The currency the customer is shopping in; a price drop is only meaningful within one. */
  currencyCode: z.string().trim().length(3).toUpperCase(),
})

type DemandRow = { sku: string; watchers: string; notified: string }

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) return NextResponse.json({ items: [] }, { status: 401 })

  const url = new URL(req.url)
  const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get('limit') ?? '50', 10) || 50, 1), 200)

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }

  const rows = await em.getConnection().execute<DemandRow[]>(
    `select sku,
            count(*)::text as watchers,
            count(*) filter (where notified_at is not null)::text as notified
       from marketing_product_watches
      where tenant_id = ? and organization_id = ? and deleted_at is null
      group by sku
      order by count(*) desc, sku asc
      limit ?`,
    [scope.tenantId, scope.organizationId, limit],
  )

  return NextResponse.json({
    items: rows.map((row) => ({
      sku: row.sku,
      watchers: Number.parseInt(row.watchers ?? '0', 10) || 0,
      notified: Number.parseInt(row.notified ?? '0', 10) || 0,
    })),
  })
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = createSchema.safeParse(await req.json().catch(() => null))
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

  // Checked in THIS tenant: the id arrived in a request, and a watch against somebody else's customer would
  // mail a stranger about a price.
  const customer = await em.findOne(CustomerEntity, { id: parsed.data.customerId, ...scope, deletedAt: null })
  if (!customer) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { watch, created } = await startWatch(em, scope, {
    subjectEntityId: customer.id,
    sku: parsed.data.sku,
    currencyCode: parsed.data.currencyCode,
  })

  return NextResponse.json({
    id: watch.id,
    sku: watch.sku,
    currencyCode: watch.currencyCode,
    watchedPriceGross: watch.watchedPriceGross ?? null,
    /** False when the customer was already watching it — asking twice must not reset their reference price. */
    created,
    updatedAt: watch.updatedAt.toISOString(),
  })
}

export const openApi = {
  GET: {
    summary: 'What customers are waiting to get cheaper, by SKU',
    description: 'Aggregated by SKU and ordered by how many people are waiting — the demand question, not a list of individual watches.',
    tags: ['Marketing Automation'],
    responses: { 200: { description: 'SKUs with watcher counts' } },
  },
  POST: {
    summary: 'Start watching a product for a customer',
    description:
      'Idempotent per customer and SKU. The current list price becomes the reference a drop is measured against, and asking again does NOT reset it, because that would cancel a drop the customer was already owed.',
    tags: ['Marketing Automation'],
    responses: { 200: { description: 'The watch' }, 404: { description: 'No such customer' } },
  },
}
