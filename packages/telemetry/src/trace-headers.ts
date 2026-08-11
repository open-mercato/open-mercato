/**
 * Backup trace headers shared by the server propagator (`provider/otlp-provider.ts`)
 * and the browser RUM wiring (`browser/`). Kept in a dependency-free module so the
 * client bundle can import the names without pulling any server-only code.
 *
 * The "backup header" pattern: our own callers inject `x-original-traceparent`
 * alongside the standard `traceparent`, and the server continues the trace when it
 * sees the backup — while a *bare* inbound `traceparent` (a load balancer, an
 * untrusted caller) still starts a fresh root unless
 * `TELEMETRY_TRUST_INBOUND_TRACE=true`.
 */
export const BACKUP_TRACEPARENT_HEADER = 'x-original-traceparent'
export const BACKUP_TRACESTATE_HEADER = 'x-original-tracestate'
