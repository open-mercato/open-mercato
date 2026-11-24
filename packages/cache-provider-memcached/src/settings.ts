import { z } from 'zod'
import { MAX_COMMAND_BYTES } from './protocol/client'

export const MEMCACHED_PROVIDER_ID = 'open-mercato/memcached'

export const MEMCACHED_SETTINGS_DEFAULTS = {
  port: 11211,
  bucketCount: 64,
  maxItemBytes: 1024 * 1024,
  casRetries: 16,
  casBackoffMs: 4,
  poolSize: 2,
  connectTimeoutMs: 2_000,
  commandTimeoutMs: 2_000,
  maxCommandBytes: MAX_COMMAND_BYTES,
  enumerationBatchSize: 16,
} as const

const HOST_PATTERN = /^[A-Za-z0-9._:[\]-]+$/

/**
 * Settings accepted by the first supported profile: one self-hosted memcached
 * server over plain TCP. Unknown keys (including transport/auth options of
 * unqualified profiles) are rejected.
 */
export const memcachedSettingsSchema = z.object({
  host: z.string().trim().min(1).max(253).regex(HOST_PATTERN, 'Expected a hostname or IP address'),
  port: z.number().int().min(1).max(65535).default(MEMCACHED_SETTINGS_DEFAULTS.port),
  bucketCount: z.number().int().min(1).max(4096).default(MEMCACHED_SETTINGS_DEFAULTS.bucketCount),
  maxItemBytes: z.number().int().min(4 * 1024).max(128 * 1024 * 1024).default(MEMCACHED_SETTINGS_DEFAULTS.maxItemBytes),
  casRetries: z.number().int().min(1).max(100).default(MEMCACHED_SETTINGS_DEFAULTS.casRetries),
  casBackoffMs: z.number().int().min(0).max(1_000).default(MEMCACHED_SETTINGS_DEFAULTS.casBackoffMs),
  poolSize: z.number().int().min(1).max(32).default(MEMCACHED_SETTINGS_DEFAULTS.poolSize),
  connectTimeoutMs: z.number().int().min(50).max(60_000).default(MEMCACHED_SETTINGS_DEFAULTS.connectTimeoutMs),
  commandTimeoutMs: z.number().int().min(50).max(60_000).default(MEMCACHED_SETTINGS_DEFAULTS.commandTimeoutMs),
  maxCommandBytes: z.number().int().min(256).max(MAX_COMMAND_BYTES).default(MEMCACHED_SETTINGS_DEFAULTS.maxCommandBytes),
  enumerationBatchSize: z.number().int().min(1).max(256).default(MEMCACHED_SETTINGS_DEFAULTS.enumerationBatchSize),
}).strict()

export type MemcachedProviderSettingsInput = z.input<typeof memcachedSettingsSchema>
export type MemcachedProviderConfig = z.output<typeof memcachedSettingsSchema>

export function redactMemcachedSettings(config: MemcachedProviderConfig): Record<string, unknown> {
  return {
    host: config.host,
    port: config.port,
    transport: 'tcp',
    bucketCount: config.bucketCount,
    maxItemBytes: config.maxItemBytes,
    casRetries: config.casRetries,
    poolSize: config.poolSize,
    connectTimeoutMs: config.connectTimeoutMs,
    commandTimeoutMs: config.commandTimeoutMs,
  }
}
