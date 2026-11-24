import { z } from 'zod'

export const IGNITE_PROVIDER_ID = 'open-mercato/ignite'
export const DEFAULT_CACHE_NAME_PREFIX = 'om-cache-'
export const DEFAULT_CONNECT_TIMEOUT_MS = 5_000
export const DEFAULT_COMMAND_TIMEOUT_MS = 5_000
export const DEFAULT_SCAN_PAGE_SIZE = 256
export const DEFAULT_SCAN_TIMEOUT_MS = 120_000
export const DEFAULT_MUTATION_CONCURRENCY = 16
export const DEFAULT_CAS_ATTEMPTS = 8
export const DEFAULT_MAX_VALUE_BYTES = 4 * 1024 * 1024

const ENDPOINT_PATTERN = /^(?:\[[0-9a-fA-F:.]+\]|[a-zA-Z0-9.-]+):\d{1,5}$/
const CACHE_NAME_PREFIX_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$/

const endpointSchema = z.string().trim().regex(ENDPOINT_PATTERN, 'Expected "host:port"').refine((value) => {
  const port = Number(value.slice(value.lastIndexOf(':') + 1))
  return port >= 1 && port <= 65535
}, 'Port must be between 1 and 65535')

const pemSchema = z.string().trim().min(1).refine((value) => value.includes('-----BEGIN '), 'Expected PEM-encoded material')

const tlsSchema = z.strictObject({
  ca: pemSchema.optional(),
  cert: pemSchema.optional(),
  key: pemSchema.optional(),
  servername: z.string().trim().min(1).max(253).optional(),
  rejectUnauthorized: z.boolean().default(true),
}).refine((tls) => (tls.cert === undefined) === (tls.key === undefined), {
  message: 'cert and key must be provided together',
  path: ['cert'],
})

export const igniteCacheProviderSettingsSchema = z.strictObject({
  endpoints: z.array(endpointSchema).min(1).max(32),
  username: z.string().min(1).max(256).optional(),
  password: z.string().min(1).max(1024).optional(),
  tls: tlsSchema.optional(),
  cacheNamePrefix: z.string().regex(CACHE_NAME_PREFIX_PATTERN, 'Expected 1-63 letters, digits, ".", "_" or "-"').default(DEFAULT_CACHE_NAME_PREFIX),
  createCache: z.boolean().default(true),
  connectTimeoutMs: z.number().int().min(100).max(120_000).default(DEFAULT_CONNECT_TIMEOUT_MS),
  commandTimeoutMs: z.number().int().min(50).max(120_000).default(DEFAULT_COMMAND_TIMEOUT_MS),
  scanPageSize: z.number().int().min(1).max(10_000).default(DEFAULT_SCAN_PAGE_SIZE),
  scanTimeoutMs: z.number().int().min(1_000).max(3_600_000).default(DEFAULT_SCAN_TIMEOUT_MS),
  mutationConcurrency: z.number().int().min(1).max(256).default(DEFAULT_MUTATION_CONCURRENCY),
  casAttempts: z.number().int().min(1).max(64).default(DEFAULT_CAS_ATTEMPTS),
  maxValueBytes: z.number().int().min(1024).max(256 * 1024 * 1024).default(DEFAULT_MAX_VALUE_BYTES),
}).refine((settings) => (settings.username === undefined) === (settings.password === undefined), {
  message: 'username and password must be provided together',
  path: ['password'],
})

export type IgniteCacheProviderSettingsInput = z.input<typeof igniteCacheProviderSettingsSchema>
export type IgniteCacheProviderConfig = z.output<typeof igniteCacheProviderSettingsSchema>

export type IgniteTransportWarning = 'tls_verification_disabled' | 'credentials_over_plaintext'

export function igniteTransportWarnings(config: Pick<IgniteCacheProviderConfig, 'tls' | 'password'>): IgniteTransportWarning[] {
  const warnings: IgniteTransportWarning[] = []
  if (config.tls && config.tls.rejectUnauthorized === false) warnings.push('tls_verification_disabled')
  if (!config.tls && config.password !== undefined) warnings.push('credentials_over_plaintext')
  return warnings
}

export function redactIgniteCacheProviderConfig(config: IgniteCacheProviderConfig): Record<string, unknown> {
  return {
    endpoints: [...config.endpoints],
    authentication: config.username !== undefined ? 'configured' : 'none',
    username: config.username !== undefined ? '[redacted]' : undefined,
    password: config.password !== undefined ? '[redacted]' : undefined,
    tls: config.tls
      ? {
        ca: config.tls.ca !== undefined ? '[redacted]' : undefined,
        clientCertificate: config.tls.cert !== undefined ? 'configured' : 'none',
        servername: config.tls.servername,
        rejectUnauthorized: config.tls.rejectUnauthorized,
      }
      : 'disabled',
    cacheNamePrefix: config.cacheNamePrefix,
    createCache: config.createCache,
    connectTimeoutMs: config.connectTimeoutMs,
    commandTimeoutMs: config.commandTimeoutMs,
    scanPageSize: config.scanPageSize,
    scanTimeoutMs: config.scanTimeoutMs,
    mutationConcurrency: config.mutationConcurrency,
    casAttempts: config.casAttempts,
    maxValueBytes: config.maxValueBytes,
  }
}
