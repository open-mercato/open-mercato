import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'

const logger = createLogger('checkout').child({ component: 'gateway-status-sync' })

type GatewayStatusSyncContext = {
  event: string
  paymentId?: string
  organizationId?: string
  tenantId?: string
}

type ErrorBody = Record<string, unknown> | undefined

function readBodyString(body: ErrorBody, key: string): string | undefined {
  const value = body?.[key]
  return typeof value === 'string' ? value : undefined
}

function isExpectedRefusal(httpStatus: number | undefined, body: ErrorBody): boolean {
  if (httpStatus === 404) return readBodyString(body, 'error') === 'Transaction not found'
  if (httpStatus === 409) {
    const currentStatus = readBodyString(body, 'currentStatus')
    return currentStatus !== undefined && currentStatus === readBodyString(body, 'requestedStatus')
  }
  return false
}

export function reportGatewayStatusSyncFailure(error: unknown, context: GatewayStatusSyncContext): void {
  const httpStatus = isCrudHttpError(error) ? error.status : undefined
  const body = isCrudHttpError(error) ? (error.body as ErrorBody) : undefined
  if (isExpectedRefusal(httpStatus, body)) {
    logger.debug('Gateway payment status not applied to a checkout transaction', { ...context, err: error })
    return
  }
  const attributes = {
    ...context,
    httpStatus,
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
