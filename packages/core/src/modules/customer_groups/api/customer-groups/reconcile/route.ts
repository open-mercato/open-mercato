import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { scanOrphanedCustomerGroupReferences } from '../../../lib/reconcile'

const logger = createLogger('customer_groups')

// Read-only scan — no mutation guard wiring needed (see `reconcile/adopt/route.ts`
// for the mutating counterpart, which does wire the mutation guard registry per
// packages/core/AGENTS.md § API Routes).
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customer_groups.groups.manage'] },
}

export async function GET(req: Request) {
  try {
    const auth = await getAuthFromRequest(req)
    const { translate } = await resolveTranslations()
    if (!auth) {
      throw new CrudHttpError(401, { error: translate('customer_groups.errors.unauthorized', 'Unauthorized') })
    }
    // Always scoped to the caller's own tenant — never accepts a `tenant`
    // override from the request the way the CLI does, per root AGENTS.md
    // "Never expose cross-tenant data".
    const tenantId = auth.tenantId ?? null
    if (!tenantId) {
      return NextResponse.json(
        { error: translate('customer_groups.errors.tenant_required', 'Tenant context is required') },
        { status: 400 },
      )
    }

    const container = await createRequestContainer()
    const em = container.resolve<EntityManager>('em')
    const orphans = await scanOrphanedCustomerGroupReferences(em, { tenantId })

    return NextResponse.json({ orphans })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    logger.error('customer_groups.groups.reconcile failed', { err })
    return NextResponse.json({ error: 'Failed to scan for orphaned customer group references' }, { status: 400 })
  }
}

const orphanSchema = z.object({
  groupId: z.string().uuid(),
  tenantId: z.string().uuid().nullable(),
  catalogPriceCount: z.number().int().min(0),
  salesTaxRateCount: z.number().int().min(0),
  sampleCatalogPriceIds: z.array(z.string().uuid()),
  sampleSalesTaxRateIds: z.array(z.string().uuid()),
})
const reconcileResponseSchema = z.object({ orphans: z.array(orphanSchema) })
const reconcileErrorSchema = z.object({ error: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: 'CustomerGroups',
  summary: 'Scan for orphaned customer-group references',
  methods: {
    GET: {
      summary: 'Scan for orphaned customer-group references',
      description:
        'Scans catalog_product_variant_prices.customer_group_id and sales_tax_rates.customer_group_id for values with no matching customer_groups row, scoped to the authenticated tenant.',
      responses: [{ status: 200, description: 'Orphan scan result', schema: reconcileResponseSchema }],
      errors: [
        { status: 400, description: 'Tenant context missing', schema: reconcileErrorSchema },
        { status: 401, description: 'Unauthorized', schema: reconcileErrorSchema },
      ],
    },
  },
}
