import { createHash, createHmac } from 'node:crypto'
import type { Hash, Hmac } from 'node:crypto'
import { z } from 'zod'
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

export const AWS_ELASTICACHE_CACHE_PROVIDER_ID = 'open-mercato/aws-elasticache' as const

export const ELASTICACHE_SIGNING_SERVICE = 'elasticache'
/** ElastiCache IAM auth tokens are valid for 15 minutes. */
export const ELASTICACHE_IAM_TOKEN_TTL_SECONDS = 900
export const AWS_DEFAULT_REAUTH_INTERVAL_MS = 10 * 60_000
const AWS_TOKEN_REFRESH_SKEW_MS = 5 * 60_000

/** IAM-enabled ElastiCache users need identical, lowercase user id and user name. */
const iamUserIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/, 'Expected a lowercase ElastiCache user id (also the user name)')
const replicationGroupIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/, 'Expected a lowercase replication group id')
const regionSchema = z.string().regex(/^[a-z]{2}(-gov)?-[a-z]+-\d$/, 'Expected an AWS region such as eu-west-1')

const iamAuthSchema = z.object({
  kind: z.literal('iam'),
  userId: iamUserIdSchema,
  /** Replication group id the token is signed for (the signing resource). */
  replicationGroupId: replicationGroupIdSchema,
  region: regionSchema,
  /** AWS SDK default credential chain (env, web identity, ECS/EC2 role, SSO, profile); no keys in settings. */
  credentials: z.literal('default-chain').default('default-chain'),
  reauthIntervalMs: z.number().int().min(MANAGED_REAUTH_LIMITS.minMs).max(MANAGED_REAUTH_LIMITS.maxMs).default(AWS_DEFAULT_REAUTH_INTERVAL_MS),
}).strict()

const valkeyNodeBasedClusterDisabledSchema = z.object({
  engine: z.literal('valkey'),
  deployment: z.literal('node-based'),
  clusterMode: z.literal('disabled'),
  /** Primary (writable) endpoint of the replication group. */
  host: managedHostSchema,
  port: managedPortSchema.default(6379),
  auth: z.discriminatedUnion('kind', [iamAuthSchema]),
  tls: managedTlsSchema.default({}),
  ...managedTuningShape,
}).strict()

/**
 * Discriminated by engine; each engine variant pins deployment mode, cluster
 * mode and auth kind. Only the first qualified profile is listed: node-based
 * Valkey, cluster mode disabled, IAM, TLS.
 */
export const settings = z.discriminatedUnion('engine', [valkeyNodeBasedClusterDisabledSchema])

export type AwsElastiCacheSettings = z.infer<typeof settings>
export type AwsElastiCacheSettingsInput = z.input<typeof settings>

export type AwsCredentialIdentity = {
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
}

export type AwsCredentialProvider = () => Promise<AwsCredentialIdentity>

type BinaryLike = string | ArrayBuffer | ArrayBufferView

function toBuffer(data: BinaryLike): Buffer {
  if (typeof data === 'string') return Buffer.from(data, 'utf8')
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  return Buffer.from(data)
}

/** SHA-256 / HMAC-SHA-256 over node:crypto for the SigV4 signer. */
export class NodeSha256 {
  private readonly secret: Buffer | null
  private hash: Hash | Hmac

  constructor(secret?: BinaryLike) {
    this.secret = secret !== undefined ? toBuffer(secret) : null
    this.hash = this.fresh()
  }

  private fresh(): Hash | Hmac {
    return this.secret ? createHmac('sha256', this.secret) : createHash('sha256')
  }

  update(data: BinaryLike): void {
    this.hash.update(toBuffer(data))
  }

  async digest(): Promise<Uint8Array> {
    return new Uint8Array(this.hash.digest())
  }

  reset(): void {
    this.hash = this.fresh()
  }
}

function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
}

export type ElastiCacheIamTokenInput = {
  userId: string
  replicationGroupId: string
  region: string
  credentials: AwsCredentialIdentity | AwsCredentialProvider
  signingDate?: Date
}

/**
 * SigV4 presigned `connect` request for ElastiCache IAM authentication:
 * `GET http://<replicationGroupId>/?Action=connect&User=<userId>` signed for
 * service `elasticache`, expiring after 900 s. The token is the presigned URL
 * without the `http://` scheme; it is used as the AUTH password with the user id
 * as username.
 */
export async function createElastiCacheIamToken(input: ElastiCacheIamTokenInput): Promise<string> {
  const { SignatureV4 } = await import('@smithy/signature-v4')
  const signer = new SignatureV4({
    service: ELASTICACHE_SIGNING_SERVICE,
    region: input.region,
    credentials: input.credentials,
    sha256: NodeSha256,
    applyChecksum: false,
  })
  const presigned = await signer.presign({
    method: 'GET',
    protocol: 'http:',
    hostname: input.replicationGroupId,
    path: '/',
    query: { Action: 'connect', User: input.userId },
    headers: { host: input.replicationGroupId },
  }, {
    expiresIn: ELASTICACHE_IAM_TOKEN_TTL_SECONDS,
    ...(input.signingDate ? { signingDate: input.signingDate } : {}),
  })
  const query = Object.entries(presigned.query ?? {})
    .flatMap(([key, value]) => (Array.isArray(value) ? value.map((item) => [key, item] as const) : value === null || value === undefined ? [] : [[key, value] as const]))
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${rfc3986(key)}=${rfc3986(String(value))}`)
    .join('&')
  return `${input.replicationGroupId}/?${query}`
}

export function createElastiCacheIamTokenSource(
  auth: AwsElastiCacheSettings['auth'],
  credentials: AwsCredentialProvider,
  now: () => number = Date.now,
): ManagedAccessTokenSource {
  return async (): Promise<ManagedAccessToken> => {
    const issuedAt = now()
    const token = await createElastiCacheIamToken({
      userId: auth.userId,
      replicationGroupId: auth.replicationGroupId,
      region: auth.region,
      credentials,
      signingDate: new Date(issuedAt),
    })
    return { username: auth.userId, password: token, expiresAt: issuedAt + ELASTICACHE_IAM_TOKEN_TTL_SECONDS * 1000 }
  }
}

async function defaultCredentialChain(): Promise<AwsCredentialProvider> {
  const { defaultProvider } = await import('@aws-sdk/credential-provider-node')
  return defaultProvider()
}

export type AwsElastiCacheProviderOptions = {
  /** Test seam: replaces IAM token signing (never set in production registrations). */
  credentialSource?: (config: AwsElastiCacheSettings) => ManagedAccessTokenSource
  reauthIntervalMs?: number
}

export function toElastiCacheRespSettings(config: AwsElastiCacheSettings): RespSettings {
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

export function redactAwsElastiCacheSettings(config: AwsElastiCacheSettings): Record<string, unknown> {
  return {
    engine: config.engine,
    deployment: config.deployment,
    clusterMode: config.clusterMode,
    host: config.host,
    port: config.port,
    auth: {
      kind: config.auth.kind,
      userId: '[redacted]',
      replicationGroupId: config.auth.replicationGroupId,
      region: config.auth.region,
      credentials: config.auth.credentials,
      reauthIntervalMs: config.auth.reauthIntervalMs,
    },
    tls: redactManagedTls(config.host, config.tls),
    ...redactManagedTuning(config),
  }
}

export function createAwsElastiCacheProvider(options: AwsElastiCacheProviderOptions = {}): CacheProviderDefinition<AwsElastiCacheSettings> {
  return createManagedRespProvider<AwsElastiCacheSettings>({
    id: AWS_ELASTICACHE_CACHE_PROVIDER_ID,
    settings,
    expectedEngine: 'valkey',
    toRespSettings: toElastiCacheRespSettings,
    credentials(config) {
      let chain: Promise<AwsCredentialProvider> | null = null
      const source: ManagedAccessTokenSource = options.credentialSource
        ? options.credentialSource(config)
        : async () => {
          chain ??= defaultCredentialChain()
          const credentials = await chain
          return createElastiCacheIamTokenSource(config.auth, credentials)()
        }
      return {
        source,
        sourceLabel: 'AWS IAM (default credential chain)',
        refreshSkewMs: AWS_TOKEN_REFRESH_SKEW_MS,
        reauthIntervalMs: options.reauthIntervalMs ?? config.auth.reauthIntervalMs,
      }
    },
    redact: redactAwsElastiCacheSettings,
  })
}
