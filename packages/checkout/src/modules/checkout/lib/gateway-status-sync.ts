import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'

const logger = createLogger('checkout').child({ component: 'gateway-status-sync' })

type GatewayStatusSyncContext = {
  event: string
  paymentId?: string
}

function readBodyString(body: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = body?.[key]
  return typeof value === 'string' ? value : undefined
}

function isExpectedRefusal(error: unknown): boolean {
  if (!isCrudHttpError(error)) return false
  const body = error.body as Record<string, unknown> | undefined
  if (error.status === 404) return readBodyString(body, 'error') === 'Transaction not found'
  if (error.status === 409) {
    const currentStatus = readBodyString(body, 'currentStatus')
    return currentStatus !== undefined && currentStatus === readBodyString(body, 'requestedStatus')
  }
  return false
}

export function reportGatewayStatusSyncFailure(error: unknown, context: GatewayStatusSyncContext): void {
  if (isExpectedRefusal(error)) {
    logger.debug('Gateway payment status not applied to a checkout transaction', { ...context, err: error })
    return
  }
  const body = isCrudHttpError(error) ? (error.body as Record<string, unknown> | undefined) : undefined
  const attributes = {
    event: context.event,
    paymentId: context.paymentId,
    httpStatus: isCrudHttpError(error) ? error.status : undefined,
    errorCode: readBodyString(body, 'code'),
    currentStatus: readBodyString(body, 'currentStatus'),
    requestedStatus: readBodyString(body, 'requestedStatus'),
  }
  logger.error('Failed to apply gateway payment status to checkout transaction', { ...attributes, err: error })
  getTelemetryRuntime()?.reportError(error, {
    module: 'checkout',
    code: 'checkout.gateway_status_sync_failed',
    attributes,
  })
}
