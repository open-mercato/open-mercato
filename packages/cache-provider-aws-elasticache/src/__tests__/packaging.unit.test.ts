import path from 'node:path'
import { defineCommercialPackagingSuite } from '@open-mercato/cache-provider-managed-kit/testing/packaging'

defineCommercialPackagingSuite({
  packageDir: path.resolve(__dirname, '../..'),
  allowedRuntimeDependencies: ['@open-mercato/cache-provider-managed-kit', '@open-mercato/cache-redis-protocol', 'ioredis', 'zod', '@aws-sdk/credential-provider-node', '@smithy/signature-v4'],
  requiredFiles: ['RUNBOOK.md'],
})
