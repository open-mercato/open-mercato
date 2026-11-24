import { z } from 'zod'
import { defineEnterpriseGateSuite } from '../../test-support/gate'
import { createManagedRespProvider, MANAGED_REAUTH_LIMITS, managedHostSchema, managedPortSchema, managedTlsSchema, managedTuningShape, redactManagedTls, redactManagedTuning, toRespTls } from '../managed'

const settings = z.object({
  host: managedHostSchema,
  port: managedPortSchema.default(6380),
  tls: managedTlsSchema.default({}),
  ...managedTuningShape,
}).strict()

type FixtureSettings = z.infer<typeof settings>

const provider = createManagedRespProvider<FixtureSettings>({
  id: 'open-mercato/azure-managed-redis',
  settings,
  toRespSettings: (config) => ({
    mode: 'standalone',
    host: config.host,
    port: config.port,
    db: 0,
    tls: toRespTls(config.host, config.tls),
    connectTimeoutMs: config.connectTimeoutMs,
    commandTimeoutMs: config.commandTimeoutMs,
    maxRetriesPerRequest: config.maxRetriesPerRequest,
    batchSize: config.batchSize,
    maxValueBytes: config.maxValueBytes,
  }),
  credentials: () => ({
    source: async () => ({ password: 'fixture-token', expiresAt: null }),
    sourceLabel: 'fixture identity',
    refreshSkewMs: 0,
    reauthIntervalMs: MANAGED_REAUTH_LIMITS.minMs,
  }),
  redact: (config) => ({ host: config.host, port: config.port, tls: redactManagedTls(config.host, config.tls), ...redactManagedTuning(config) }),
})

defineEnterpriseGateSuite({
  provider: provider as never,
  validSettings: { host: 'cache.example.internal' },
})
