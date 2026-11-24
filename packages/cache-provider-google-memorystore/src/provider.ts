import { z } from 'zod'
import { CacheProviderError } from '@open-mercato/cache/provider'
import type { CacheProviderDefinition, CacheProviderEnv } from '@open-mercato/cache/provider'
import type { RespSettings } from '@open-mercato/cache-redis-protocol'
import type { ManagedAccessToken, ManagedAccessTokenSource } from '@open-mercato/cache-provider-managed-kit'
import {
  createManagedRespProvider,
  MANAGED_REAUTH_LIMITS,
  managedHostSchema,
  managedPortSchema,
  managedTlsWithCaSchema,
  managedTuningShape,
  redactManagedTls,
  redactManagedTuning,
  toRespTls,
} from '@open-mercato/cache-provider-managed-kit'

export const GOOGLE_MEMORYSTORE_CACHE_PROVIDER_ID = 'open-mercato/google-memorystore' as const

export const GOOGLE_CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform'
export const GOOGLE_DEFAULT_REAUTH_INTERVAL_MS = 10 * 60_000
const GOOGLE_TOKEN_REFRESH_SKEW_MS = 5 * 60_000

const iamAuthSchema = z.object({
  kind: z.literal('iam'),
  /** Application Default Credentials (workload identity, attached service account, gcloud ADC); no keys in settings. */
  credentials: z.literal('application-default').default('application-default'),
  reauthIntervalMs: z.number().int().min(MANAGED_REAUTH_LIMITS.minMs).max(MANAGED_REAUTH_LIMITS.maxMs).default(GOOGLE_DEFAULT_REAUTH_INTERVAL_MS),
}).strict()

const valkeyClusterEnabledSchema = z.object({
  product: z.literal('valkey'),
  clusterMode: z.literal('enabled'),
  /** Discovery endpoint of the instance; shard endpoints are discovered with CLUSTER SLOTS. */
  discoveryEndpoint: z.object({ host: managedHostSchema, port: managedPortSchema.default(6379) }).strict(),
  auth: z.discriminatedUnion('kind', [iamAuthSchema]),
  /** In-transit encryption with the instance's server CA (required). */
  tls: managedTlsWithCaSchema,
  ...managedTuningShape,
  maxRetriesPerRequest: managedTuningShape.maxRetriesPerRequest.default(3),
}).strict()

/**
 * Discriminated by product; each product variant pins cluster mode and auth
 * kind. Only the first qualified profile is listed: Memorystore for Valkey,
 * cluster mode enabled, IAM, TLS with server CA.
 */
export const settings = z.discriminatedUnion('product', [valkeyClusterEnabledSchema])

export type GoogleMemorystoreSettings = z.infer<typeof settings>
export type GoogleMemorystoreSettingsInput = z.input<typeof settings>

/**
 * The `google-auth-library` auth client surface used here: `getAccessToken()`
 * refreshes when needed and `credentials.expiry_date` then holds the real
 * expiry (epoch ms) of the token it returned.
 */
export type GoogleAccessTokenClient = {
  getAccessToken(): Promise<string | null | undefined | { token?: string | null }>
  credentials?: { expiry_date?: number | null }
}

/**
 * Memorystore IAM AUTH: the OAuth access token is the password (single-argument
 * AUTH). The expiry is the one the auth library reports for that token; when it
 * reports none the token is never reused from the cache.
 */
export function createGoogleIamTokenSource(client: GoogleAccessTokenClient): ManagedAccessTokenSource {
  return async (): Promise<ManagedAccessToken> => {
    const result = await client.getAccessToken()
    const token = typeof result === 'string' ? result : result?.token
    if (!token) {
      throw new CacheProviderError('unavailable', `Cache provider "${GOOGLE_MEMORYSTORE_CACHE_PROVIDER_ID}" did not receive a Google access token`, { providerId: GOOGLE_MEMORYSTORE_CACHE_PROVIDER_ID })
    }
    const expiry = client.credentials?.expiry_date
    return { password: token, expiresAt: typeof expiry === 'number' && Number.isFinite(expiry) ? expiry : null }
  }
}

async function createApplicationDefaultClient(): Promise<GoogleAccessTokenClient> {
  const { GoogleAuth } = await import('google-auth-library')
  return new GoogleAuth({ scopes: [GOOGLE_CLOUD_PLATFORM_SCOPE] }).getClient()
}

export type GoogleMemorystoreProviderOptions = {
  /** Test seam: replaces Application Default Credentials (never set in production registrations). */
  credentialSource?: (config: GoogleMemorystoreSettings) => ManagedAccessTokenSource
  reauthIntervalMs?: number
  /** Environment the Enterprise activation gate reads (default: `process.env` at call time). */
  env?: CacheProviderEnv
}

export function toMemorystoreRespSettings(config: GoogleMemorystoreSettings): RespSettings {
  const { host, port } = config.discoveryEndpoint
  return {
    mode: 'cluster',
    nodes: [{ host, port }],
    tls: toRespTls(host, config.tls),
    connectTimeoutMs: config.connectTimeoutMs,
    commandTimeoutMs: config.commandTimeoutMs,
    maxRetriesPerRequest: config.maxRetriesPerRequest,
    batchSize: config.batchSize,
    maxValueBytes: config.maxValueBytes,
  }
}

export function redactGoogleMemorystoreSettings(config: GoogleMemorystoreSettings): Record<string, unknown> {
  return {
    product: config.product,
    clusterMode: config.clusterMode,
    discoveryEndpoint: `${config.discoveryEndpoint.host}:${config.discoveryEndpoint.port}`,
    auth: { kind: config.auth.kind, credentials: config.auth.credentials, reauthIntervalMs: config.auth.reauthIntervalMs },
    tls: redactManagedTls(config.discoveryEndpoint.host, config.tls),
    ...redactManagedTuning(config),
  }
}

export function createGoogleMemorystoreProvider(options: GoogleMemorystoreProviderOptions = {}): CacheProviderDefinition<GoogleMemorystoreSettings> {
  return createManagedRespProvider<GoogleMemorystoreSettings>({
    id: GOOGLE_MEMORYSTORE_CACHE_PROVIDER_ID,
    settings,
    expectedEngine: 'valkey',
    toRespSettings: toMemorystoreRespSettings,
    credentials(config) {
      let client: Promise<GoogleAccessTokenClient> | null = null
      const source: ManagedAccessTokenSource = options.credentialSource
        ? options.credentialSource(config)
        : async () => {
          client ??= createApplicationDefaultClient()
          return createGoogleIamTokenSource(await client)()
        }
      return {
        source,
        sourceLabel: 'Google Application Default Credentials',
        refreshSkewMs: GOOGLE_TOKEN_REFRESH_SKEW_MS,
        reauthIntervalMs: options.reauthIntervalMs ?? config.auth.reauthIntervalMs,
      }
    },
    redact: redactGoogleMemorystoreSettings,
    ...(options.env !== undefined ? { env: options.env } : {}),
  })
}
