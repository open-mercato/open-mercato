import { z } from 'zod'
import { defineCacheProvider } from '@open-mercato/cache/provider'
import type { CacheProviderDefinition, CacheProviderEnv, CacheProviderHostContext, CacheProviderSettingsSchema } from '@open-mercato/cache/provider'
import type { CacheStrategy } from '@open-mercato/cache/types'
import { createRespCacheProvider, RESP_DEFAULTS, RESP_LIMITS } from '@open-mercato/cache-redis-protocol'
import type { RespServerEngine, RespSettings } from '@open-mercato/cache-redis-protocol'
import { createCachedCredentialsProvider } from './credentials'
import type { ManagedAccessTokenSource } from './credentials'
import { gateEnterpriseCacheProvider } from './enterprise'
import type { OfficialManagedCacheProviderId } from './enterprise'

const pemSchema = z.string().min(1).max(64 * 1024)

export const managedHostSchema = z.string().trim().min(1).max(255)
export const managedPortSchema = z.number().int().min(1).max(65535)

/**
 * TLS is always on with certificate and hostname verification. There is no
 * `rejectUnauthorized` (or any other bypass) key; strict parsing rejects it.
 */
export const managedTlsSchema = z.object({
  ca: pemSchema.optional(),
  servername: z.string().trim().min(1).max(255).optional(),
}).strict()

export const managedTlsWithCaSchema = z.object({
  ca: pemSchema,
  servername: z.string().trim().min(1).max(255).optional(),
}).strict()

export type ManagedTlsSettings = z.infer<typeof managedTlsSchema>

export const MANAGED_REAUTH_LIMITS = { minMs: 60_000, maxMs: 30 * 60_000 } as const

export const managedTuningShape = {
  connectTimeoutMs: z.number().int().min(100).max(RESP_LIMITS.maxTimeoutMs).default(RESP_DEFAULTS.connectTimeoutMs),
  commandTimeoutMs: z.number().int().min(50).max(RESP_LIMITS.maxTimeoutMs).default(RESP_DEFAULTS.commandTimeoutMs),
  maxRetriesPerRequest: z.number().int().min(0).max(RESP_LIMITS.maxRetriesPerRequest).default(RESP_DEFAULTS.maxRetriesPerRequest),
  batchSize: z.number().int().min(1).max(RESP_LIMITS.maxBatchSize).default(RESP_DEFAULTS.batchSize),
  maxValueBytes: z.number().int().min(1024).max(RESP_LIMITS.maxValueBytes).default(RESP_DEFAULTS.maxValueBytes),
}

export type ManagedTuning = {
  connectTimeoutMs: number
  commandTimeoutMs: number
  maxRetriesPerRequest: number
  batchSize: number
  maxValueBytes: number
}

const IPV4_PATTERN = /^\d{1,3}(\.\d{1,3}){3}$/

function defaultServername(host: string, tls: ManagedTlsSettings | undefined): string | undefined {
  if (tls?.servername !== undefined) return tls.servername
  if (IPV4_PATTERN.test(host) || host.includes(':')) return undefined
  return host
}

export function toRespTls(host: string, tls: ManagedTlsSettings | undefined): NonNullable<RespSettings['tls']> {
  const servername = defaultServername(host, tls)
  return {
    ...(tls?.ca !== undefined ? { ca: tls.ca } : {}),
    ...(servername !== undefined ? { servername } : {}),
    rejectUnauthorized: true,
  }
}

export function redactManagedTls(host: string, tls: ManagedTlsSettings | undefined): Record<string, unknown> {
  return {
    enabled: true,
    ca: tls?.ca !== undefined ? 'configured' : 'system',
    servername: defaultServername(host, tls) ?? null,
    hostnameVerification: true,
  }
}

export function redactManagedTuning(config: ManagedTuning): Record<string, unknown> {
  return {
    connectTimeoutMs: config.connectTimeoutMs,
    commandTimeoutMs: config.commandTimeoutMs,
    maxRetriesPerRequest: config.maxRetriesPerRequest,
    batchSize: config.batchSize,
    maxValueBytes: config.maxValueBytes,
  }
}

export type ManagedCredentialPlan = {
  source: ManagedAccessTokenSource
  sourceLabel: string
  /** The cache fetches a new token once the current one is this close to expiry. */
  refreshSkewMs: number
  /** Longest gap between live re-`AUTH`s; each one is scheduled earlier when the token goes stale sooner. */
  reauthIntervalMs: number
}

export type ManagedRespProviderOptions<TConfig> = {
  id: OfficialManagedCacheProviderId
  settings: CacheProviderSettingsSchema<TConfig>
  expectedEngine?: RespServerEngine
  toRespSettings(config: TConfig): RespSettings
  /** Called only after the activation gate passed; may lazily import a cloud SDK. */
  credentials(config: TConfig, context: CacheProviderHostContext): ManagedCredentialPlan
  redact(config: TConfig): Record<string, unknown>
  /** Environment the Enterprise activation gate reads (default: `process.env` at call time). */
  env?: CacheProviderEnv
}

/**
 * Official managed provider over the shared RESP strategy: gate first, then
 * map provider-owned settings to RESP settings and authenticate every
 * connection (initial, reconnect, new shard) with a refreshed short-lived token.
 * Live connections are re-`AUTH`ed at most every `reauthIntervalMs` and always
 * by the time the token goes stale, so a live connection never keeps an
 * expired token.
 */
export function createManagedRespProvider<TConfig>(options: ManagedRespProviderOptions<TConfig>): CacheProviderDefinition<TConfig> {
  const definition = defineCacheProvider<TConfig>({
    id: options.id,
    settings: options.settings,
    capability: () => ({ placement: 'shared' }),
    async create(config: TConfig, context: CacheProviderHostContext): Promise<CacheStrategy> {
      const resp = options.toRespSettings(config)
      const plan = options.credentials(config, context)
      const credentialsProvider = createCachedCredentialsProvider(plan.source, {
        providerId: options.id,
        sourceLabel: plan.sourceLabel,
        refreshSkewMs: plan.refreshSkewMs,
      })
      const inner = createRespCacheProvider<RespSettings>({
        id: options.id,
        settings: { safeParse: (input) => ({ success: true, data: input as RespSettings }) },
        ...(options.expectedEngine ? { expectedEngine: options.expectedEngine } : {}),
        clientOptions: () => ({
          credentialsProvider,
          refreshIntervalMs: () => credentialsProvider.nextRefreshDelayMs(plan.reauthIntervalMs),
        }),
      })
      return inner.create(resp, context)
    },
    redact: (config: TConfig) => options.redact(config),
  })
  return gateEnterpriseCacheProvider(options.id, definition, options.env)
}
