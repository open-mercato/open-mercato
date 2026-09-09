/**
 * Browser RUM entry — the ONLY part of `@open-mercato/telemetry` a client
 * bundle may reach. Import from `@open-mercato/telemetry/browser`.
 *
 * Everything here is env-free. The server half — `resolveBrowserTelemetryConfig()`
 * plus the collector endpoint/credential readers — lives behind
 * `@open-mercato/telemetry/browser/server`, which refuses to load in a browser.
 * A server component resolves the config there and passes it to
 * `<BrowserTelemetry />`, a `'use client'` boundary that dynamically loads the
 * OTel web SDK only when the config is non-null.
 */
export { BrowserTelemetry } from './BrowserTelemetry'
export { BROWSER_TRACES_PATH } from './config'
export type { BrowserTelemetryConfig } from './config'
export { BACKUP_TRACEPARENT_HEADER, BACKUP_TRACESTATE_HEADER } from '../trace-headers'
