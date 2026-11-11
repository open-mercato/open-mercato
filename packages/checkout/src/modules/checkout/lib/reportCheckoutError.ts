import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'

const logger = createLogger('checkout').child({ component: 'report-checkout-error' })

export type CheckoutErrorAttributes = Record<string, string | number | boolean | undefined>

/**
 * `getTelemetryRuntime()?.reportError` for call sites on a durable write path: a throwing
 * telemetry backend degrades to a warning instead of failing the caller.
 */
export function reportCheckoutError(err: unknown, code: string, attributes?: CheckoutErrorAttributes): void {
  try {
    getTelemetryRuntime()?.reportError(err, { module: 'checkout', code, attributes })
  } catch (reportErr) {
    logger.warn('[internal] checkout: telemetry reportError failed', { err: reportErr, code })
  }
}
