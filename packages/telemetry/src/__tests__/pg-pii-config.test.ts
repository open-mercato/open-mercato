import { PG_INSTRUMENTATION_OPTIONS } from '../provider/otlp-provider'

/**
 * Regression guard for the PII promise (telemetry spec Privacy / R12): the pg
 * instrumentation must never capture bound SQL parameter VALUES. Flipping this
 * to `true` would leak user data into `db.statement` spans. The runtime
 * behaviour itself is OpenTelemetry's (tested upstream); this locks OUR
 * configuration so a refactor can't silently enable it.
 */
describe('pg instrumentation PII config', () => {
  it('never enables enhancedDatabaseReporting (no SQL parameter values in spans)', () => {
    expect(PG_INSTRUMENTATION_OPTIONS.enhancedDatabaseReporting).toBe(false)
  })
})
