import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { Booking, Lease, type SalesOperation } from '../data/entities'
import type { ClassifiedSalesError } from './salesErrors'
import { describeSalesError } from './salesErrorText'
import { notifyStaff } from './staffNotifications'
import { normalizeWallClock } from './wallClock'
import type { Scope } from './productUse'

const logger = createLogger('property_management')

export const STALLED_OPERATION_ATTEMPTS = 5

export type StalledOperationInput = {
  container: AwilixContainer
  em: EntityManager
  scope: Scope
  op: Pick<SalesOperation, 'id' | 'kind' | 'targetType' | 'targetId' | 'leaseId'>
  error: ClassifiedSalesError
  cause: unknown
  attempts: number
}

type OperationSubject = { buildingId: string; reference: string; leaseId?: string; bookingId?: string }

async function loadSubject(em: EntityManager, scope: Scope, op: StalledOperationInput['op']): Promise<OperationSubject | null> {
  if (op.targetType === 'booking') {
    const booking = await findOneWithDecryption(em, Booking, { id: op.targetId, ...scope }, undefined, scope)
    if (!booking) return null
    const reference = `${booking.productName} · ${normalizeWallClock(booking.startsAt).replace('T', ' ')}`
    return { buildingId: booking.buildingId, reference, bookingId: booking.id }
  }
  if (!op.leaseId) return null
  const lease = await findOneWithDecryption(em, Lease, { id: op.leaseId, ...scope }, undefined, scope)
  if (!lease) return null
  return { buildingId: lease.buildingId, reference: lease.reference, leaseId: lease.id }
}

export async function reportStalledOperation(input: StalledOperationInput): Promise<void> {
  const { op, scope, error, attempts } = input
  logger.error('A sales operation keeps failing and is still being retried', { operationId: op.id, kind: op.kind, attempts, code: error.code })
  getTelemetryRuntime()?.reportError(input.cause, {
    module: 'property_management',
    code: 'property_management.sales_operation_stalled',
    attributes: { operationId: op.id, kind: op.kind, attempts },
  })
  try {
    const em = input.em.fork()
    const subject = await loadSubject(em, scope, op)
    if (!subject) return
    await notifyStaff({
      container: input.container,
      em,
      scope,
      type: 'property_management.sales_operation.stalled',
      buildingId: subject.buildingId,
      leaseId: subject.leaseId ?? null,
      bookingId: subject.bookingId ?? null,
      bodyVariables: { reference: subject.reference, attempts: String(attempts), error: await describeSalesError(error) },
      groupKey: `property_management.sales_operation.stalled:${op.id}`,
    })
  } catch (err) {
    logger.error('Notifying staff about a stalled sales operation failed', { operationId: op.id, err })
    getTelemetryRuntime()?.reportError(err, { module: 'property_management', code: 'property_management.sales_operation_stalled_notify_failed' })
  }
}
