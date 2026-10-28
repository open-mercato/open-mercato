import type { SalesOperation } from '../data/entities'
import { leaseOperationHandler } from './leaseOperationHandlers'
import type { OperationTargetHandler } from './salesOperationRunner'

export function resolveOperationHandler(op: SalesOperation): OperationTargetHandler {
  if (op.targetType === 'booking') throw new Error('[internal] Booking sales operations ship with bookings')
  return leaseOperationHandler
}
