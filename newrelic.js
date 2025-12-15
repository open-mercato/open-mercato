'use strict'
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
  allow_all_headers: true,
  attributes: { include: ['request.*'], exclude: ['request.headers.cookie', 'request.headers.authorization'] },
}