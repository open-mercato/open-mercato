const baseConfig = require('@open-mercato/shared/jest.config.base.cjs')

/** @type {import('jest').Config} */
module.exports = {
  ...baseConfig,
  displayName: 'events',
}
