import {
  registerLoggerExtension,
  type LoggerExtensionRecord,
  type LogLevel,
} from '@open-mercato/shared/lib/logger'

export type CapturedLogs = {
  /** Every record emitted while the capture was active, in emission order. */
  readonly records: LoggerExtensionRecord[]
  /** Records at `level` only. */
  at(level: LogLevel): LoggerExtensionRecord[]
  restore(): void
}

/**
 * Capture the structured records that `createLogger` emits.
 *
 * `jest.spyOn(console, 'warn')` does not see them: on the Node server the
 * logging facade routes through the pino/pretty transport rather than
 * `console`. The logger extension is the supported seam that observes every
 * record whichever transport is active.
 */
export function captureLogs(): CapturedLogs {
  const records: LoggerExtensionRecord[] = []
  const dispose = registerLoggerExtension({
    emit: (record) => {
      records.push(record)
    },
  })
  return {
    records,
    at: (level) => records.filter((record) => record.level === level),
    restore: dispose,
  }
}
