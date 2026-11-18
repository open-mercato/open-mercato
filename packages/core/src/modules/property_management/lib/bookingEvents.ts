import type { AwilixContainer } from 'awilix'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { E } from '#generated/entities.ids.generated'
import type { Booking } from '../data/entities'
import { emitPropertyManagementEvent, type PropertyManagementEventId } from '../events'
import { normalizeWallClock } from './wallClock'

const logger = createLogger('property_management')

export const bookingCrudIndexer: CrudIndexerConfig<Booking> = { entityType: E.property_management.booking }

export const bookingCrudEvents: CrudEventsConfig<Booking> = {
  module: 'property_management',
  entity: 'booking',
  persistent: true,
  buildPayload: (emitCtx) => ({
    ...bookingEventPayload(emitCtx.entity),
    id: emitCtx.identifiers.id,
    organizationId: emitCtx.identifiers.organizationId,
    tenantId: emitCtx.identifiers.tenantId,
  }),
}

export type BookingLifecycleEvent = Extract<
  PropertyManagementEventId,
  | 'property_management.booking.cancelled'
  | 'property_management.booking.completed'
  | 'property_management.booking.order_orphaned'
>

export function bookingEventPayload(booking: Booking): Record<string, unknown> {
  return {
    id: booking.id,
    bookingId: booking.id,
    unitId: booking.unitId,
    buildingId: booking.buildingId,
    status: booking.status,
    startsAt: normalizeWallClock(booking.startsAt),
    endsAt: normalizeWallClock(booking.endsAt),
    customerCompanyId: booking.customerCompanyId ?? null,
    customerUserId: booking.customerUserId ?? null,
    bookedByPersonId: booking.bookedByPersonId,
    salesOrderId: booking.salesOrderId ?? null,
    cancelReason: booking.cancelReason ?? null,
    tenantId: booking.tenantId,
    organizationId: booking.organizationId,
  }
}

export async function markBookingChanged(container: AwilixContainer, booking: Booking): Promise<void> {
  try {
    const dataEngine = container.resolve('dataEngine') as DataEngine
    dataEngine.markOrmEntityChange({
      action: 'updated',
      entity: booking,
      identifiers: { id: booking.id, organizationId: booking.organizationId, tenantId: booking.tenantId },
      indexer: bookingCrudIndexer,
    })
    await dataEngine.flushOrmEntityChanges()
  } catch (err) {
    logger.error('Booking side effects failed', { bookingId: booking.id, err })
    getTelemetryRuntime()?.reportError(err, { module: 'property_management', code: 'property_management.booking_side_effects_failed' })
  }
}

export async function emitBookingEvent(id: BookingLifecycleEvent, booking: Booking, extra: Record<string, unknown> = {}): Promise<void> {
  await emitPropertyManagementEvent(
    id,
    { ...bookingEventPayload(booking), ...extra },
    { persistent: true, tenantId: booking.tenantId, organizationId: booking.organizationId },
  ).catch((err) => {
    logger.error('Booking event failed', { id, bookingId: booking.id, err })
    getTelemetryRuntime()?.reportError(err, { module: 'property_management', code: 'property_management.booking_event_failed' })
  })
}
