/**
 * Backup trace headers shared by the server propagator (`provider/otlp-provider.ts`)
 * and the browser RUM wiring (`browser/`). Kept in a dependency-free module so the
 * client bundle can import the names without pulling any server-only code.
 *
 * The "backup header" pattern: our own callers inject `x-original-traceparent`
 * alongside the standard `traceparent`, so the original context survives a proxy
 * that rewrites `traceparent` in between. The backup header is *not* itself a
 * trust signal — at an HTTP boundary it is caller-controlled exactly like the
 * standard one, so the server ignores both and starts a fresh root unless
 * `TELEMETRY_TRUST_INBOUND_TRACE=true`. That flag is the supported way to stitch
 * a browser span to its server span; see `browser/propagator.ts` and the
 * extractor in `provider/otlp-provider.ts`.
 */
export const BACKUP_TRACEPARENT_HEADER = 'x-original-traceparent'
export const BACKUP_TRACESTATE_HEADER = 'x-original-tracestate'
