import {
  registerLoggerExtension,
  type LoggerExtensionRecord,
} from '@open-mercato/shared/lib/logger'
import type { Attributes, LogRecord, TelemetryProvider } from '../types'
import { redactAttributes } from './redact'
import { serializeError } from './serialize'

function toAttributes(record: LoggerExtensionRecord): Attributes {
  const attributes: Attributes = {
    'logger.name': record.namespace,
  }
  for (const [key, value] of Object.entries(record.fields)) {
    if (key === 'err' || value === undefined) continue
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      attributes[key] = value
    }
  }
  return redactAttributes(attributes)
}

function toLogRecord(record: LoggerExtensionRecord): LogRecord {
  const error = record.fields.err === undefined
    ? undefined
    : serializeError(record.fields.err)
  return {
    level: record.level,
    message: record.message,
    attributes: toAttributes(record),
    error,
    time: record.time,
  }
}

/**
 * Extend the canonical shared logger with trace correlation + remote export.
 * The shared logger remains the sole application-facing logger and sole local
 * output path; telemetry observes the already-normalized record exactly once.
 */
export function registerTelemetryLogger(provider: TelemetryProvider): () => void {
  return registerLoggerExtension({
    enrich: () => {
      const context = provider.activeTraceContext()
      return context
        ? { trace_id: context.traceId, span_id: context.spanId }
        : undefined
    },
    emit: (record) => provider.emitLog(toLogRecord(record)),
  })
}
