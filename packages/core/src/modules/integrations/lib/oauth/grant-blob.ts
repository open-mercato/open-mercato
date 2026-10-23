import { z } from 'zod'
import type {
  OAuthGrantOwner,
  OAuthInvalidatedReason,
  OAuthLastFailureClass,
} from './descriptor'

/** @internal Current blob format; readers accept every version up to it. */
export const OAUTH_GRANT_BLOB_VERSION = 1

/** @internal Key namespace of the Grant Lock. */
export const OAUTH_GRANT_LOCK_NAMESPACE = 'oauth_grant'

/** @internal The reserved, frozen suffix of OAuth grant row ids (`<integrationId>__oauth_grant`). */
export const OAUTH_GRANT_ROW_SUFFIX = '__oauth_grant'

/** @internal `resourceKind` of grant writes in the integration log and the mutation guards (frozen). */
export const OAUTH_GRANT_RESOURCE_KIND = 'integrations.oauth_grant'

/** @internal The decrypted grant row (App Spec §1.4.2) with datetimes as `Date`. */
export type OAuthGrantRecord = {
  status: 'active' | 'invalidated'
  invalidatedReason: OAuthInvalidatedReason | null
  invalidatedAt: Date | null
  accessToken: string
  refreshToken: string | null
  expiresAt: Date
  tokenType: 'Bearer'
  clientId: string
  grantedScopes: string[]
  obtainedAt: Date
  refreshedAt: Date | null
  refreshCount: number
  revisedAt: Date
  lastFailureClass: OAuthLastFailureClass | null
  lastFailureAt: Date | null
  lastFailureProviderErrorCode: string | null
  providerData: Record<string, unknown> | null
  previousProviderData: Record<string, unknown> | null
}

const utcDateTimeSchema = z.iso.datetime()
const jsonRecordSchema = z.record(z.string(), z.unknown())

const grantBlobFields = {
  version: z.number().int().min(1).max(OAUTH_GRANT_BLOB_VERSION),
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1).nullish(),
  expiresAt: utcDateTimeSchema,
  tokenType: z.literal('Bearer'),
  clientId: z.string().min(1),
  grantedScopes: z.array(z.string()).nullish(),
  obtainedAt: utcDateTimeSchema,
  refreshedAt: utcDateTimeSchema.nullish(),
  refreshCount: z.number().int().min(0),
  revisedAt: utcDateTimeSchema,
  lastFailureClass: z.enum(['transient', 'client_misconfigured']).nullish(),
  lastFailureAt: utcDateTimeSchema.nullish(),
  lastFailureProviderErrorCode: z.string().min(1).nullish(),
  providerData: jsonRecordSchema.nullish(),
  previousProviderData: jsonRecordSchema.nullish(),
}

/**
 * @internal The stored blob: datetimes as ISO-8601 UTC strings, unknown keys stripped,
 * `invalidatedReason` and `invalidatedAt` required exactly when `status = 'invalidated'`.
 */
export const oauthGrantBlobSchema = z.discriminatedUnion('status', [
  z.object({ ...grantBlobFields, status: z.literal('active') }),
  z.object({
    ...grantBlobFields,
    status: z.literal('invalidated'),
    invalidatedReason: z.enum(['grant_rejected', 'no_refresh_token']),
    invalidatedAt: utcDateTimeSchema,
  }),
])

function toDateOrNull(value: string | null | undefined): Date | null {
  return value ? new Date(value) : null
}

/** @internal Validates a decrypted blob; `null` when it does not match the schema. */
export function parseOAuthGrantBlob(value: Record<string, unknown>): OAuthGrantRecord | null {
  const parsed = oauthGrantBlobSchema.safeParse(value)
  if (!parsed.success) return null
  const blob = parsed.data
  return {
    status: blob.status,
    invalidatedReason: blob.status === 'invalidated' ? blob.invalidatedReason : null,
    invalidatedAt: blob.status === 'invalidated' ? new Date(blob.invalidatedAt) : null,
    accessToken: blob.accessToken,
    refreshToken: blob.refreshToken ?? null,
    expiresAt: new Date(blob.expiresAt),
    tokenType: blob.tokenType,
    clientId: blob.clientId,
    grantedScopes: [...(blob.grantedScopes ?? [])],
    obtainedAt: new Date(blob.obtainedAt),
    refreshedAt: toDateOrNull(blob.refreshedAt),
    refreshCount: blob.refreshCount,
    revisedAt: new Date(blob.revisedAt),
    lastFailureClass: blob.lastFailureClass ?? null,
    lastFailureAt: toDateOrNull(blob.lastFailureAt),
    lastFailureProviderErrorCode: blob.lastFailureProviderErrorCode ?? null,
    providerData: blob.providerData ?? null,
    previousProviderData: blob.previousProviderData ?? null,
  }
}

/** @internal Encodes a grant in the current blob version. */
export function serializeOAuthGrantBlob(grant: OAuthGrantRecord): Record<string, unknown> {
  const blob: Record<string, unknown> = {
    version: OAUTH_GRANT_BLOB_VERSION,
    status: grant.status,
    accessToken: grant.accessToken,
    refreshToken: grant.refreshToken,
    expiresAt: grant.expiresAt.toISOString(),
    tokenType: grant.tokenType,
    clientId: grant.clientId,
    grantedScopes: [...grant.grantedScopes],
    obtainedAt: grant.obtainedAt.toISOString(),
    refreshedAt: grant.refreshedAt?.toISOString() ?? null,
    refreshCount: grant.refreshCount,
    revisedAt: grant.revisedAt.toISOString(),
    lastFailureClass: grant.lastFailureClass,
    lastFailureAt: grant.lastFailureAt?.toISOString() ?? null,
    lastFailureProviderErrorCode: grant.lastFailureProviderErrorCode,
    providerData: grant.providerData,
    previousProviderData: grant.previousProviderData,
  }
  if (grant.status === 'invalidated') {
    blob.invalidatedReason = grant.invalidatedReason
    blob.invalidatedAt = grant.invalidatedAt?.toISOString() ?? null
  }
  return blob
}

/** @internal Persisted format (App Spec §10.1): the grant row's `integration_id`. */
export function oauthGrantRowId(integrationId: string): string {
  return `${integrationId}${OAUTH_GRANT_ROW_SUFFIX}`
}

/** @internal Frozen format (App Spec §8, §10.1): the Grant Lock key of one Grant Owner. */
export function oauthGrantLockKey(owner: OAuthGrantOwner): string {
  return `${OAUTH_GRANT_LOCK_NAMESPACE}:${owner.integrationId}:${owner.tenantId}:${owner.organizationId}:${owner.userId ?? '-'}`
}
