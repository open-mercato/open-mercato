import path from 'node:path'
import { defineCommercialPackagingSuite } from '../../test-support/packaging'

defineCommercialPackagingSuite({
  packageDir: path.resolve(__dirname, '../..'),
  allowedRuntimeDependencies: ['@open-mercato/cache-redis-protocol', 'zod'],
})
