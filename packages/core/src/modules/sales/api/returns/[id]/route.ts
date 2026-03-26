import { z } from 'zod'
import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { SalesReturn, SalesReturnLine } from '../../../data/entities'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['sales.returns.view'] },
}

const paramsSchema = z.object({ id: z.string().uuid() })

const toNumber = (value: unknown): number => {
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (!Number.isNaN(parsed)) return parsed
  }
  return 0
}

export async function GET(req: Request, ctx: { params: { id: string } }) {
  try {
    const { id } = paramsSchema.parse(ctx.params ?? {})
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    const { translate } = await resolveTranslations()

    if (!auth || !auth.tenantId) {
      throw new CrudHttpError(401, { error: translate('sales.documents.errors.unauthorized', 'Unauthorized') })
    }

    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const organizationId = scope?.selectedId ?? auth.orgId ?? null
    if (!organizationId) {
      throw new CrudHttpError(400, {
        error: translate('sales.documents.errors.organization_required', 'Organization context is required'),
      })
    }

    const em = (container.resolve('em') as EntityManager).fork()
    const header = await findOneWithDecryption(
      em,
      SalesReturn,
      { id, deletedAt: null, tenantId: auth.tenantId, organizationId },
      { populate: ['order'] },
      { tenantId: auth.tenantId, organizationId },
    )
    if (!header || !header.order) {
      throw new CrudHttpError(404, { error: translate('sales.returns.notFound', 'Return not found.') })
    }

    const lines = await findWithDecryption(
      em,
      SalesReturnLine,
      { salesReturn: header.id, deletedAt: null },
      { populate: ['orderLine'] },
      { tenantId: auth.tenantId, organizationId },
    )

    const totals = lines.reduce(
      (acc, line) => {
        acc.net += toNumber(line.totalNetAmount)
        acc.gross += toNumber(line.totalGrossAmount)
        return acc
      },
      { net: 0, gross: 0 },
    )

    return NextResponse.json({
      return: {
        id: header.id,
        orderId: typeof header.order === 'string' ? header.order : header.order.id,
        returnNumber: header.returnNumber,
        statusEntryId: header.statusEntryId ?? null,
        status: header.status ?? null,
        reason: header.reason ?? null,
        notes: header.notes ?? null,
        returnedAt: header.returnedAt ? header.returnedAt.toISOString() : null,
        createdAt: header.createdAt ? header.createdAt.toISOString() : null,
        updatedAt: header.updatedAt ? header.updatedAt.toISOString() : null,
        totalNetAmount: totals.net,
        totalGrossAmount: totals.gross,
      },
      lines: lines.map((line) => ({
        id: line.id,
        orderLineId: typeof line.orderLine === 'string' ? line.orderLine : line.orderLine?.id ?? null,
        quantityReturned: line.quantityReturned,
        unitPriceNet: line.unitPriceNet,
        unitPriceGross: line.unitPriceGross,
        totalNetAmount: line.totalNetAmount,
        totalGrossAmount: line.totalGrossAmount,
      })),
    })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('sales.returns.get failed', err)
    const { translate } = await resolveTranslations()
    return NextResponse.json({ error: translate('sales.returns.error', 'Failed to load return.') }, { status: 400 })
  }
}

const returnLineSchema = z.object({
  id: z.string().uuid(),
  orderLineId: z.string().uuid().nullable(),
  quantityReturned: z.string(),
  unitPriceNet: z.string(),
  unitPriceGross: z.string(),
  totalNetAmount: z.string(),
  totalGrossAmount: z.string(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Sales',
  summary: 'Get a return',
  pathParams: paramsSchema,
  methods: {
    GET: {
      summary: 'Get return details',
      responses: [
        {
          status: 200,
          description: 'Return details',
          schema: z.object({
            return: z.object({
              id: z.string().uuid(),
              orderId: z.string().uuid(),
              returnNumber: z.string(),
              statusEntryId: z.string().uuid().nullable(),
              status: z.string().nullable(),
              reason: z.string().nullable(),
              notes: z.string().nullable(),
              returnedAt: z.string().nullable(),
              createdAt: z.string().nullable(),
              updatedAt: z.string().nullable(),
              totalNetAmount: z.number(),
              totalGrossAmount: z.number(),
            }),
            lines: z.array(returnLineSchema),
          }),
        },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 404, description: 'Not found', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}

