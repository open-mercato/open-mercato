import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('configs')

/**
 * Stable `configs.<reason>` fingerprints the error backend groups on. Enumerated here so an alert
 * written against one keeps working; the raw exception is the report body, never an attribute.
 */
export const QUEUE_STATUS_ERROR_CODES = {
  /** One queue's introspection reads threw while building the dashboard snapshot. */
  queueReadFailed: 'configs.queues_status.queue_read_failed',
  /** One queue's introspection reads did not answer in time (e.g. Redis down). */
  queueReadTimeout: 'configs.queues_status.queue_read_timeout',
  /** The snapshot route failed outright. */
  snapshotFailed: 'configs.queues_status.snapshot_failed',
  /** The Job Inspector route failed outright (queue read). */
  inspectFailed: 'configs.queues_status.inspect_failed',
  /** The access-log write for an inspector read failed. */
  auditFailed: 'configs.queues_status.audit_failed',
} as const

export type QueueStatusErrorCode = (typeof QUEUE_STATUS_ERROR_CODES)[keyof typeof QUEUE_STATUS_ERROR_CODES]

/**
 * Report a recorded (caught) failure to the optional shared telemetry runtime. The API dispatcher
 * only reports exceptions that escape a handler, so every catch path that converts a failure into a
 * fallback/500 response reports here instead. Never throws: telemetry must not break the response.
 */
export function reportQueueStatusError(
  error: unknown,
  code: QueueStatusErrorCode,
  attributes?: Record<string, string | number | boolean | undefined>,
): void {
  try {
    getTelemetryRuntime()?.reportError(error, {
      module: 'configs',
      code,
      attributes,
    })
  } catch (telemetryError) {
    logger.warn('Failed to report a queue status error to telemetry', { code, err: telemetryError as Error })
  }
}
