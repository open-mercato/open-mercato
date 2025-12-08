'use strict'
exports.config = {
  app_name: [process.env.NEW_RELIC_APP_NAME || 'open-mercato'],
  license_key: process.env.NEW_RELIC_LICENSE_KEY,
  distributed_tracing: { enabled: true },
  logging: { level: 'info' },
  application_logging: { forwarding: { enabled: true } },
  allow_all_headers: true,
  attributes: { exclude: ['request.headers.cookie', 'request.headers.authorization'] },
}