import { NextResponse } from 'next/server'
import { z } from 'zod'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { Building, Unit } from '../../../../data/entities'
import { unitSlotsQuerySchema } from '../../../../data/validators'
import { bookingPriceContext, bookingRangeOf, findOverlappingBookings, resolveBookingProduct } from '../../../../lib/bookingRecords'
import { computeDaySlots } from '../../../../lib/bookingSlots'
import { isBuildingPermitted } from '../../../../lib/buildingAccess'
import { resolvePriceSnapshot } from '../../../../lib/productUse'
import { loadSettings } from '../../../../lib/settings'
import { endOfDay, localNow, startOfDay } from '../../../../lib/wallClock'
import { loadBuildingOpening, openingWindowFor } from '../../../../lib/openingHours'
import { blockedRangesForDay, resolveUnitAvailability } from '../../../../lib/availabilityResolver'
import { handleRouteError, readRouteParam, resolveStaffContext } from '../../../routeContext'
import { buildQueryParams } from '@open-mercato/shared/lib/crud/query-params'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['property_management.view'] },
}

type RouteContext = { params: Promise<{ id?: string }> }

export async function GET(req: Request, routeCtx: RouteContext) {
  try {
    const context = await resolveStaffContext(req)
    const id = await readRouteParam(routeCtx.params, 'id')
    if (!id) return NextResponse.json({ error: context.translate('property_management.errors.unitNotFound', 'Unit not found.') }, { status: 404 })
    const scope = { tenantId: context.tenantId, organizationId: context.organizationId }
    const query = unitSlotsQuerySchema.parse(buildQueryParams(new URL(req.url).searchParams))
    const unit = await findOneWithDecryption(context.em, Unit, { id, ...scope, deletedAt: null }, undefined, scope)
    if (!unit || !isBuildingPermitted(context.permitted, unit.buildingId)) return NextResponse.json({ error: context.translate('property_management.errors.unitNotFound', 'Unit not found.') }, { status: 404 })
    const product = await resolveBookingProduct(context.em, scope, unit)
    const day = { start: startOfDay(query.date), end: endOfDay(query.date) }
    const building = await findOneWithDecryption(context.em, Building, { id: unit.buildingId, ...scope }, undefined, scope)
    const settings = await loadSettings(context.em, scope)
    const billingChannelId = settings.billingChannelId
    const [bookings, price, opening, windows] = await Promise.all([
      findOverlappingBookings(context.em, scope, unit.id, day),
      billingChannelId
        ? resolvePriceSnapshot(context.em, context.ctx.container, scope, product.catalogProductId, bookingPriceContext({ channelId: billingChannelId, startsAt: day.start }))
        : Promise.resolve(null),
      building ? loadBuildingOpening(context.em, scope, building) : Promise.resolve(null),
      resolveUnitAvailability(context.em, scope, unit, day),
    ])
    const { openingHours, slots } = computeDaySlots({
      date: query.date,
      billingUnit: product.billingUnit,
      opening: openingWindowFor(opening, query.date),
      blocked: blockedRangesForDay(windows, query.date),
      booked: bookings.map(bookingRangeOf),
      now: localNow(),
    })
    return NextResponse.json({
      date: query.date,
      openingHours,
      slots,
      price: { amount: price?.priceAmount ?? null, currency: price?.currencyCode ?? null, billingUnit: product.billingUnit },
      billingChannelConfigured: billingChannelId !== null,
    })
  } catch (err) {
    return handleRouteError(err, 'property_management.unit_slots_failed')
  }
}

const rangeSchema = z.object({ start: z.string(), end: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: 'Property Management',
  summary: 'Bookable slots of a unit',
  methods: {
    GET: {
      summary: 'Slots of a bookable unit for one day',
      description:
        'Whole-hour slots (hourly products) or one whole-day slot (daily products) for the date, in building-local wall-clock time (`YYYY-MM-DDTHH:mm`). Pending and confirmed bookings mark their slots `booked`; slots that have already ended (`booking_in_past`) and times when the unit, its space, floor or building is unavailable are left out (an archived building or a day it is unavailable has no slots). With opening hours the window is that weekday’s hours (`openingHours: []` on a closed day); without them it is the whole day and `openingHours` is null. `price` is the catalog net price for one hour or day in the billing sales channel, valid at the start of the date, without customer-specific prices; a booking prices its whole quantity for its customer. Until the billing sales channel is chosen in the settings, `billingChannelConfigured` is false, `price.amount` and `price.currency` are null, and creating a booking is refused with 422 `billing_channel_missing`.',
      query: unitSlotsQuerySchema,
      responses: [
        {
          status: 200,
          description: 'Slots for the day',
          schema: z.object({
            date: z.string(),
            openingHours: z.array(rangeSchema).nullable(),
            slots: z.array(rangeSchema.extend({ state: z.enum(['free', 'booked']) })),
            price: z.object({ amount: z.string().nullable(), currency: z.string().nullable(), billingUnit: z.enum(['hour', 'day']) }),
            billingChannelConfigured: z.boolean(),
          }),
        },
      ],
      errors: [
        { status: 404, description: 'Unit not found or its building is not assigned to the caller' },
        { status: 422, description: 'unit_not_bookable' },
      ],
    },
  },
}
