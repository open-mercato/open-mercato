'use strict'

// Request headers that carry credentials or signing secrets and must never reach
// New Relic transaction traces or forwarded logs. `allow_all_headers` is deliberately
// NOT enabled: with it off the agent only records its built-in safe header set, so any
// future custom auth header fails closed (is not captured) instead of leaking until
// someone remembers to add it here. The explicit exclude list is defense-in-depth that
// also covers forwarded log records and anything in the agent's default header set.
const sensitiveRequestHeaders = [
  'cookie',
  'authorization',
  'x-api-key',
  'x-sudo-token',
  'x-domain-check-secret',
  'x-domain-resolve-secret',
  'x-force-host-secret',
  'x-webhook-signature',
  'svix-signature',
]

exports.sensitiveRequestHeaders = sensitiveRequestHeaders

exports.config = {
  app_name: [process.env.NEW_RELIC_APP_NAME || 'open-mercato'],
  license_key: process.env.NEW_RELIC_LICENSE_KEY,
  distributed_tracing: { enabled: true },
  transaction_tracer: {
    enabled: true,
    record_sql: 'obfuscated',  // <-- REQUIRED to see SQL queries
    explain_threshold: 1, // ms, optional
  },
  slow_sql: {
    enabled: true,
  },
  logging: { level: 'info' },
  application_logging: { forwarding: { enabled: true } },
  attributes: {
    include: ['request.*'],
    exclude: sensitiveRequestHeaders.map((name) => `request.headers.${name}`),
  },
}
