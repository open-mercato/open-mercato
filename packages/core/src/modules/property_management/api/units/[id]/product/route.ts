import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { Unit, UnitProductPeriod } from '../../../../data/entities'
import { unitProductChangeSchema } from '../../../../data/validators'
import { isBuildingPermitted } from '../../../../lib/buildingAccess'
import { findActiveLeases, findUpcomingBookingList } from '../../../../lib/usageGuards'
import { serializeProductPeriod, UNIT_RESOURCE_KIND } from '../../../../commands/unit'
import {
  guardedCommandInput,
  handleRouteError,
  readRouteParam,
  resolveStaffContext,
  runStaffGuard,
  type StaffRouteContext,
} from '../../../routeContext'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['property_management.view'] },
  POST: { requireAuth: true, requireFeatures: ['property_management.manage'] },
}

type RouteContext = { params: Promise<{ id?: string }> }

const bodySchema = z.object({
  catalogProductId: z.string().uuid(),
  catalogCategoryId: z.string().uuid().optional(),
})

const periodSchema = z.object({
  id: z.string().uuid(),
  unitId: z.string().uuid(),
  catalogProductId: z.string().uuid(),
  productName: z.string(),
  use: z.enum(['leasable', 'bookable']),
  billingUnit: z.enum(['month', 'hour', 'day']),
  priceAmount: z.string().nullable(),
  currencyCode: z.string().nullable(),
  priceKindId: z.string().nullable(),
  validFrom: z.string().nullable(),
  validTo: z.string().nullable(),
})

const blockerSchema = z.object({ kind: z.enum(['lease', 'booking']), id: z.string(), label: z.string(), unitId: z.string(), until: z.string().nullable(), startsAt: z.string().optional(), endsAt: z.string().optional(), startsOn: z.string().optional(), endsOn: z.string().optional() })

function hasDuration(period: UnitProductPeriod): boolean {
  if (!period.validTo) return true
  return new Date(period.validTo).getTime() !== new Date(period.validFrom).getTime()
}

async function loadPermittedUnit(context: StaffRouteContext, unitId: string | null): Promise<Unit | null> {
  if (!unitId) return null
  const scope = { tenantId: context.tenantId, organizationId: context.organizationId }
  const unit = await findOneWithDecryption(context.em, Unit, { id: unitId, ...scope, deletedAt: null }, undefined, scope)
  if (!unit || !isBuildingPermitted(context.permitted, unit.buildingId)) return null
  return unit
}

export async function GET(req: Request, routeCtx: RouteContext) {
  try {
    const context = await resolveStaffContext(req)
    const unit = await loadPermittedUnit(context, await readRouteParam(routeCtx.params, 'id'))
    if (!unit) {
      return NextResponse.json({ error: context.translate('property_management.errors.unitNotFound', 'Unit not found.') }, { status: 404 })
    }
    const scope = { tenantId: context.tenantId, organizationId: context.organizationId }
    const [periods, activeLeases, upcomingBookings] = await Promise.all([
      findWithDecryption(context.em, UnitProductPeriod, { ...scope, unitId: unit.id }, { orderBy: { validFrom: 'desc' } }, scope),
      findActiveLeases(context.em, scope, [unit.id]),
      findUpcomingBookingList(context.em, scope, [unit.id]),
    ])
    return NextResponse.json({
      periods: periods.filter(hasDuration).map(serializeProductPeriod),
      productLocked: activeLeases.length > 0,
      activeLeases,
      upcomingBookings: upcomingBookings.blockers,
      upcomingBookingCount: upcomingBookings.total,
    })
  } catch (err) {
    const rejection = getCommandInterceptorHttpRejection(err)
    if (rejection) return NextResponse.json(rejection.body, { status: rejection.status })
    return handleRouteError(err, 'property_management.unit_product_history_failed')
  }
}

export async function POST(req: Request, routeCtx: RouteContext) {
  try {
    const context = await resolveStaffContext(req)
    const unit = await loadPermittedUnit(context, await readRouteParam(routeCtx.params, 'id'))
    if (!unit) {
      return NextResponse.json({ error: context.translate('property_management.errors.unitNotFound', 'Unit not found.') }, { status: 404 })
    }
    const body = bodySchema.parse((await readJsonSafe<Record<string, unknown>>(req, {})) ?? {})
    const input = unitProductChangeSchema.parse({ ...body, id: unit.id, tenantId: context.tenantId, organizationId: context.organizationId })
    const guarded = await runStaffGuard(req, context, {
      resourceKind: UNIT_RESOURCE_KIND,
      resourceId: unit.id,
      operation: 'update',
      payload: { ...input },
    })
    if (!guarded.ok) return guarded.response
    const commandInput = guardedCommandInput(unitProductChangeSchema, guarded, input, {
      id: unit.id,
      tenantId: context.tenantId,
      organizationId: context.organizationId,
    })
    const commandBus = context.ctx.container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<typeof commandInput, { unitId: string; productChange: { openedPeriodId: string } | null }>(
      'property_management.unit.product_change',
      { input: commandInput, ctx: context.ctx },
    )
    await guarded.runAfterSuccess()
    return NextResponse.json({ ok: true, periodId: result?.productChange?.openedPeriodId ?? null })
  } catch (err) {
    const rejection = getCommandInterceptorHttpRejection(err)
    if (rejection) return NextResponse.json(rejection.body, { status: rejection.status })
    return handleRouteError(err, 'property_management.unit_product_change_failed')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Property Management',
  summary: 'Unit product',
  methods: {
    GET: {
      summary: 'Product history of a unit',
      responses: [
        {
          status: 200,
          description: 'Product periods, newest first, and what locks the product; `upcomingBookings` lists at most 100 and `upcomingBookingCount` counts all of them',
          schema: z.object({
            periods: z.array(periodSchema),
            productLocked: z.boolean(),
            activeLeases: z.array(blockerSchema),
            upcomingBookings: z.array(blockerSchema),
            upcomingBookingCount: z.number().int(),
          }),
        },
      ],
      errors: [{ status: 404, description: 'Unit not found or its building is not assigned to the caller' }],
    },
    POST: {
      summary: 'Change the product of a unit',
      description: 'Closes the open product period and opens a new one. 409 while the unit has an active lease; allowed with upcoming bookings, which keep their snapshot. A no-op returning a null periodId when the unit already has that product and unit type.',
      requestBody: { contentType: 'application/json', schema: bodySchema },
      responses: [{ status: 200, description: 'Product changed', schema: z.object({ ok: z.literal(true), periodId: z.string().uuid().nullable() }) }],
      errors: [
        { status: 404, description: 'Unit not found or its building is not assigned to the caller' },
        { status: 409, description: 'Product locked by an active lease (`unit_product_locked`), the unit has upcoming bookings and the new product is leasable (`unit_has_upcoming_bookings`), upcoming bookings use the current billing unit and the new product bills in another (`product_billing_unit_strands`), or the building is archived (no code). Blocker codes carry at most 100 `blockers` and their total `blockerCount`' },
        { status: 422, description: 'Product not in the unit type, not leasable/bookable, or not in this organization' },
      ],
    },
  },
}
