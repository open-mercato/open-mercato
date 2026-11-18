import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { bookingCancelSchema } from '../../../../data/validators'
import { loadPermittedBooking } from '../../../../lib/bookingRecords'
import { BOOKING_RESOURCE_KIND, type BookingCancelResult } from '../../../../commands/booking'
import { guardedCommandInput, handleRouteError, readRouteParam, resolveStaffContext, runStaffGuard } from '../../../routeContext'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['property_management.bookings.manage'] },
}

type RouteContext = { params: Promise<{ id?: string }> }

export async function POST(req: Request, routeCtx: RouteContext) {
  try {
    const context = await resolveStaffContext(req)
    const id = await readRouteParam(routeCtx.params, 'id')
    if (!id) return NextResponse.json({ error: context.translate('property_management.errors.bookingNotFound', 'Booking not found.') }, { status: 404 })
    const scope = { tenantId: context.tenantId, organizationId: context.organizationId }
    await loadPermittedBooking(context.em, scope, context.permitted, id)
    const input = bookingCancelSchema.parse({ id, reason: 'manager', ...scope })
    const guarded = await runStaffGuard(req, context, { resourceKind: BOOKING_RESOURCE_KIND, resourceId: id, operation: 'update', payload: { ...input } })
    if (!guarded.ok) return guarded.response
    const commandInput = guardedCommandInput(bookingCancelSchema, guarded, input, { id, reason: 'manager', ...scope })
    const commandBus = context.ctx.container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<typeof commandInput, BookingCancelResult>('property_management.booking.cancel', {
      input: commandInput,
      ctx: context.ctx,
    })
    await guarded.runAfterSuccess()
    return NextResponse.json({ ok: true, id: result.bookingId, status: result.status, operationId: result.operationId })
  } catch (err) {
    const rejection = getCommandInterceptorHttpRejection(err)
    if (rejection) return NextResponse.json(rejection.body, { status: rejection.status })
    return handleRouteError(err, 'property_management.booking_cancel_failed')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Property Management',
  summary: 'Cancel a booking',
  methods: {
    POST: {
      summary: 'Cancel a booking (manager)',
      description:
        'Cancels a pending or confirmed booking with the reason `manager` and releases its slot. A confirmed booking\'s sales order is moved to the sales order status configured as cancelled in Property Management settings (never deleted); a pending booking\'s order is cancelled the same way once it exists. A booking whose end time (building-local wall clock) has passed can no longer be cancelled: `409 booking_already_ended`, even before the booking sweep marks it completed.',
      responses: [
        {
          status: 200,
          description: 'Booking cancelled',
          schema: z.object({ ok: z.literal(true), id: z.string().uuid(), status: z.literal('cancelled'), operationId: z.string().uuid().nullable() }),
        },
      ],
      errors: [
        { status: 404, description: 'Booking not found or its building is not assigned to the caller' },
        {
          status: 409,
          description:
            'booking_not_cancellable — the booking is already completed or cancelled; booking_already_ended — the booking\'s end time has passed',
        },
        { status: 422, description: 'cancelled_status_missing — no cancelled order status is configured' },
      ],
    },
  },
}
