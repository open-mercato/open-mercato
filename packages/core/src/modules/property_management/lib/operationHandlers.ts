import type { SalesOperation } from '../data/entities'
import { bookingOperationHandler } from './bookingOperationHandlers'
import { leaseOperationHandler } from './leaseOperationHandlers'
import type { OperationTargetHandler } from './salesOperationRunner'

export function resolveOperationHandler(op: SalesOperation): OperationTargetHandler {
  if (op.targetType === 'booking') return bookingOperationHandler
  return leaseOperationHandler
}
