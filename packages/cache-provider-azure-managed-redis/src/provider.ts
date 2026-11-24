import { z } from 'zod'
import { CacheProviderError } from '@open-mercato/cache/provider'
import type { CacheProviderDefinition } from '@open-mercato/cache/provider'
import type { RespSettings } from '@open-mercato/cache-redis-protocol'
import type { ManagedAccessToken, ManagedAccessTokenSource } from './credentials'
import {
  createManagedRespProvider,
  MANAGED_REAUTH_LIMITS,
  managedHostSchema,
  managedPortSchema,
  managedTlsSchema,
  managedTuningShape,
  redactManagedTls,
  redactManagedTuning,
  toRespTls,
} from './managed'

export const AZURE_MANAGED_REDIS_CACHE_PROVIDER_ID = 'open-mercato/azure-managed-redis' as const

/** Microsoft Entra scope for Azure Managed Redis / Azure Cache for Redis data access. */
export const AZURE_REDIS_ENTRA_SCOPE = 'https://redis.azure.com/.default'
export const AZURE_MANAGED_REDIS_DEFAULT_PORT = 10_000
export const AZURE_DEFAULT_REAUTH_INTERVAL_MS = 10 * 60_000
const AZURE_TOKEN_REFRESH_SKEW_MS = 5 * 60_000

const guidSchema = z.string().trim().regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/, 'Expected a GUID')

const entraAuthSchema = z.object({
  kind: z.literal('entra'),
  /** Where the Entra token comes from; secrets are never part of settings. */
  identity: z.enum(['default', 'managed-identity', 'workload-identity']).default('default'),
  /** Client id of a user-assigned managed identity / workload identity app registration. */
  clientId: guidSchema.optional(),
  /** Object (principal) id used as the Redis username; read from the token `oid` claim when omitted. */
  objectId: guidSchema.optional(),
  reauthIntervalMs: z.number().int().min(MANAGED_REAUTH_LIMITS.minMs).max(MANAGED_REAUTH_LIMITS.maxMs).default(AZURE_DEFAULT_REAUTH_INTERVAL_MS),
}).strict()

/**
 * First supported profile only: Non-clustered clustering policy, Microsoft
 * Entra authentication, TLS. OSS-cluster and Enterprise-proxy policies and
 * access keys are intentionally not accepted until qualified.
 */
export const settings = z.object({
  clusteringPolicy: z.literal('non-clustered'),
  host: managedHostSchema,
  port: managedPortSchema.default(AZURE_MANAGED_REDIS_DEFAULT_PORT),
  auth: z.discriminatedUnion('kind', [entraAuthSchema]),
  tls: managedTlsSchema.default({}),
  ...managedTuningShape,
}).strict()

export type AzureManagedRedisSettings = z.infer<typeof settings>
export type AzureManagedRedisSettingsInput = z.input<typeof settings>

export type AzureAccessToken = { token: string; expiresOnTimestamp: number }
export type AzureTokenCredential = { getToken(scopes: string | string[]): Promise<AzureAccessToken | null> }

export function decodeJwtObjectId(token: string): string | null {
  const payload = token.split('.')[1]
  if (!payload) return null
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { oid?: unknown }
    return typeof claims.oid === 'string' && claims.oid.length > 0 ? claims.oid : null
  } catch {
    return null
  }
}

/** Turn an Entra token credential into Redis credentials: username = principal object id, password = access token. */
export function createEntraTokenSource(credential: AzureTokenCredential, auth: AzureManagedRedisSettings['auth']): ManagedAccessTokenSource {
  return async (): Promise<ManagedAccessToken> => {
    const accessToken = await credential.getToken(AZURE_REDIS_ENTRA_SCOPE)
    if (!accessToken || !accessToken.token) {
      throw new CacheProviderError('unavailable', `Cache provider "${AZURE_MANAGED_REDIS_CACHE_PROVIDER_ID}" did not receive a Microsoft Entra token`, { providerId: AZURE_MANAGED_REDIS_CACHE_PROVIDER_ID })
    }
    const username = auth.objectId ?? decodeJwtObjectId(accessToken.token)
    if (!username) {
      throw new CacheProviderError('invalid_settings', `Cache provider "${AZURE_MANAGED_REDIS_CACHE_PROVIDER_ID}" could not determine the Entra object id; set auth.objectId`, { providerId: AZURE_MANAGED_REDIS_CACHE_PROVIDER_ID, fieldPaths: ['auth.objectId'] })
    }
    return { username, password: accessToken.token, expiresAt: accessToken.expiresOnTimestamp }
  }
}

async function createAzureCredential(auth: AzureManagedRedisSettings['auth']): Promise<AzureTokenCredential> {
  const identity = await import('@azure/identity')
  switch (auth.identity) {
    case 'managed-identity':
      return auth.clientId ? new identity.ManagedIdentityCredential({ clientId: auth.clientId }) : new identity.ManagedIdentityCredential()
    case 'workload-identity':
      return new identity.WorkloadIdentityCredential(auth.clientId ? { clientId: auth.clientId } : {})
    case 'default':
    default:
      return new identity.DefaultAzureCredential(auth.clientId ? { managedIdentityClientId: auth.clientId, workloadIdentityClientId: auth.clientId } : {})
  }
}

export type AzureManagedRedisProviderOptions = {
  /** Test seam: replaces the `@azure/identity` credential (never set in production registrations). */
  credentialSource?: (config: AzureManagedRedisSettings) => ManagedAccessTokenSource
  reauthIntervalMs?: number
}

export function toAzureRespSettings(config: AzureManagedRedisSettings): RespSettings {
  return {
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
  }
}

export function redactAzureManagedRedisSettings(config: AzureManagedRedisSettings): Record<string, unknown> {
  return {
    clusteringPolicy: config.clusteringPolicy,
    host: config.host,
    port: config.port,
    auth: {
      kind: config.auth.kind,
      identity: config.auth.identity,
      clientId: config.auth.clientId !== undefined ? '[redacted]' : null,
      objectId: config.auth.objectId !== undefined ? '[redacted]' : 'from-token',
      reauthIntervalMs: config.auth.reauthIntervalMs,
    },
    tls: redactManagedTls(config.host, config.tls),
    ...redactManagedTuning(config),
  }
}

export function createAzureManagedRedisProvider(options: AzureManagedRedisProviderOptions = {}): CacheProviderDefinition<AzureManagedRedisSettings> {
  return createManagedRespProvider<AzureManagedRedisSettings>({
    id: AZURE_MANAGED_REDIS_CACHE_PROVIDER_ID,
    settings,
    expectedEngine: 'redis',
    toRespSettings: toAzureRespSettings,
    credentials(config) {
      let credential: Promise<AzureTokenCredential> | null = null
      const source: ManagedAccessTokenSource = options.credentialSource
        ? options.credentialSource(config)
        : async () => {
          credential ??= createAzureCredential(config.auth)
          return createEntraTokenSource(await credential, config.auth)()
        }
      return {
        source,
        sourceLabel: `Microsoft Entra (${config.auth.identity})`,
        refreshSkewMs: AZURE_TOKEN_REFRESH_SKEW_MS,
        reauthIntervalMs: options.reauthIntervalMs ?? config.auth.reauthIntervalMs,
      }
    },
    redact: redactAzureManagedRedisSettings,
  })
}
