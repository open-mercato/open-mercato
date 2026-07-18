import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveProductionActionContext } from '../../actionRouteContext.js'
import { resolveOrganizationScopeFilter } from '../../organizationScopeFilter.js'
import { ProductionBom, ProductionBomItem } from '../../../data/entities.js'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['production.technology.view'],
}

const bomDetailItemSchema = z.object({
  id: z.string().uuid(),
  componentProductId: z.string().uuid(),
  componentVariantId: z.string().uuid().nullable(),
  qtyPerUnit: z.string(),
  uom: z.string(),
  scrapFactor: z.string(),
  isPhantom: z.boolean(),
  operationSequence: z.number().nullable(),
})

const bomDetailSchema = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid(),
  variantId: z.string().uuid().nullable(),
  version: z.number(),
  status: z.enum(['draft', 'active', 'archived']),
  validFrom: z.string().nullable(),
  validTo: z.string().nullable(),
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  items: z.array(bomDetailItemSchema),
})

/**
 * Single-record BOM detail, including line items (the `production.boms` list
 * endpoint is indexer-backed and only exposes header fields — the edit page
 * needs the full items aggregate to hydrate the rows editor, see task 1.3).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> | { id: string } }) {
  const { translate } = await resolveTranslations()
  try {
    const { ctx } = await resolveProductionActionContext(req)
    const resolvedParams = await params
    const id = resolvedParams?.id
    if (!id) {
      return NextResponse.json({ error: translate('production.errors.id_required', 'Record id is required') }, { status: 400 })
    }

    const tenantId = ctx.auth?.tenantId
    if (!tenantId) {
      return NextResponse.json({ error: translate('production.errors.unauthorized', 'Unauthorized') }, { status: 401 })
    }

    const orgScopeFilter = resolveOrganizationScopeFilter({
      organizationIds: ctx.organizationIds,
      selectedOrganizationId: ctx.selectedOrganizationId,
    })

    const em = ctx.container.resolve<EntityManager>('em')
    const bom = await em.findOne(ProductionBom, {
      id,
      tenantId,
      ...orgScopeFilter,
      deletedAt: null,
    })
    if (!bom) {
      return NextResponse.json({ error: translate('production.boms.error.not_found', 'BOM not found') }, { status: 404 })
    }

    const items = await em.find(
      ProductionBomItem,
      { bomId: bom.id, ...orgScopeFilter, deletedAt: null },
      { orderBy: { operationSequence: 'ASC' } },
    )

    return NextResponse.json({
      id: bom.id,
      productId: bom.productId,
      variantId: bom.variantId ?? null,
      version: bom.version,
      status: bom.status,
      validFrom: bom.validFrom ? bom.validFrom.toISOString() : null,
      validTo: bom.validTo ? bom.validTo.toISOString() : null,
      name: bom.name,
      createdAt: bom.createdAt.toISOString(),
      updatedAt: bom.updatedAt.toISOString(),
      items: items.map((item) => ({
        id: item.id,
        componentProductId: item.componentProductId,
        componentVariantId: item.componentVariantId ?? null,
        qtyPerUnit: item.qtyPerUnit,
        uom: item.uom,
        scrapFactor: item.scrapFactor,
        isPhantom: item.isPhantom,
        operationSequence: item.operationSequence ?? null,
      })),
    })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    return NextResponse.json(
      { error: translate('production.boms.error.load_failed', 'Failed to load BOM') },
      { status: 400 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Production',
  summary: 'Get a BOM by id (with items)',
  methods: {
    GET: {
      operationId: 'getProductionBom',
      summary: 'Get a BOM by id, including its component items',
      description: 'Returns the full BOM aggregate (header + items) for the edit UI rows editor.',
      responses: [
        { status: 200, description: 'BOM detail with items', schema: bomDetailSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid request', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 404, description: 'BOM not found', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
