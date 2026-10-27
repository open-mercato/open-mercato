import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import {
  AdvisoryLockUnavailableError,
  withAdvisoryXactLock,
  type AdvisoryLockWaitResult,
} from '@open-mercato/shared/lib/db/advisoryLock'
import { isTransientLockDbError } from '@open-mercato/shared/lib/db/pg-errors'
import { isCrudHttpError, type CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { assertOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { createKmsService, type KmsService } from '@open-mercato/shared/lib/encryption/kms'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { IntegrationScope } from '@open-mercato/shared/modules/integrations/types'
import { IntegrationCredentials } from '../../data/entities'
import {
  buildCredentialsFilter,
  bundleFallthroughId,
  createCredentialsService,
  eraseIntegrationCredentials,
  isCredentialsEncryptionUnavailableError,
  readCredentialRowLayered,
  type LayeredCredentialRead,
} from '../credentials-service'
import {
  createIntegrationLogService,
  findLatestIntegrationLogsByCodes,
  type IntegrationLogService,
} from '../log-service'
import {
  OAuthDescriptorError,
  OAuthGrantError,
  resolveOAuthProviderDescriptor,
  type OAuthConnectionState,
  type OAuthFailureReason,
  type OAuthGrantOwner,
  type OAuthGrantReadStatus,
  type OAuthInvalidatedReason,
  type OAuthLastFailureClass,
  type OAuthProviderDescriptor,
  type OAuthRevocationOutcome,
  type OAuthRevocationState,
  type OAuthTokenFailure,
  type OAuthUnavailableReason,
} from './descriptor'
import {
  OAUTH_GRANT_RESOURCE_KIND,
  oauthGrantLockKey,
  oauthGrantRowId,
  parseOAuthGrantBlob,
  serializeOAuthGrantBlob,
  type OAuthGrantRecord,
} from './grant-blob'
import { pinTenantDek, type TenantDekPin, type TenantDekPinOutcome } from './pin-tenant-dek'
import { resolveOAuthRedirectUri } from './redirect'
import {
  OAuthTokenEndpointError,
  requestTokenEndpoint,
  revokeToken,
  type OAuthTokenEndpointResponse,
} from './token-endpoint'

export type OAuthAccessToken = {
  accessToken: string
  expiresAt: Date
  /** The stored token, still valid but below `minValidityMs`, returned because no refresh was possible. */
  degraded: boolean
  grantedScopes: string[]
  providerData: Record<string, unknown> | null
}

export type OAuthConnectResult = {
  reconnect: boolean
  replacedUnreadable: boolean
  previousProviderData: Record<string, unknown> | null
  revisedAt: Date
}

/** Derived from the disconnect log entries; `pending` until an outcome entry is written. */
export type OAuthLastDisconnect = { at: Date; disconnectId: string; revocation: OAuthRevocationState }

/**
 * A network-free snapshot of one Grant Owner for the provider tab and health check. `status` is the
 * Grant Read Status (`none` without a live grant); `connectionState` follows the App Spec §1.3
 * precedence, with an unreadable Client Configuration as `unavailable` in `not_configured`'s place.
 * `unavailableReason` is non-null exactly when `connectionState` is `unavailable`: only `'unreadable'`
 * may be replaced by a Connect with `replaceUnreadable`. `baseUrlMissing` flags a missing production
 * `APP_URL`, never a state.
 */
export type OAuthGrantInspection =
  | {
      status: 'none'
      connectionState: 'not_configured' | 'not_connected' | 'unavailable'
      unavailableReason: OAuthUnavailableReason | null
      baseUrlMissing: boolean
      lastDisconnect: OAuthLastDisconnect | null
    }
  | {
      status: 'unavailable'
      connectionState: 'not_configured' | 'unavailable'
      unavailableReason: OAuthUnavailableReason | null
      baseUrlMissing: boolean
    }
  | {
      status: 'active' | 'invalidated'
      connectionState: OAuthConnectionState
      unavailableReason: OAuthUnavailableReason | null
      baseUrlMissing: boolean
      expiresAt: Date
      refreshedAt: Date | null
      obtainedAt: Date
      revisedAt: Date
      lastFailureClass: OAuthLastFailureClass | null
      lastFailureAt: Date | null
      clientChanged: boolean
      missingScopes: string[]
      hasExternalAccount: boolean
      providerData: Record<string, unknown> | null
      previousProviderData: Record<string, unknown> | null
    }

/**
 * `erased: false` when no live grant existed (nothing written). Otherwise the revocation outcome of
 * the cleanup after the lock was released; `failureReason` is set for `failed`: the provider's RFC 6749
 * `error` (or the endpoint error kind), `undecryptable`, `client_not_configured`,
 * `platform_unavailable` or `cleanup_failed`.
 */
export type OAuthDisconnectResult =
  | { erased: false; reason: 'not_connected' }
  | { erased: true; disconnectId: string; revocation: OAuthRevocationOutcome; failureReason: string | null }

/**
 * The tenant-level OAuth grant core; resolve it from DI as `integrationOAuthGrantService`.
 * Failures throw `OAuthGrantError`; a malformed descriptor, owner or input throws
 * `OAuthDescriptorError` before any read, write or network call.
 */
export type IntegrationOAuthGrantService = {
  /**
   * Returns an access token valid for at least `minValidityMs` (default `descriptor.refreshSkewMs`,
   * capped at half the stored token's lifetime so a short-lived token is not refreshed on every call),
   * refreshing it under the Grant Lock with `forceRefresh`, when the stored token equals
   * `rejectedAccessToken` (a resource server rejected it) or when it expires within `minValidityMs`.
   * At most one refresh per call window and Grant Owner, cluster-wide; Refresh never sends `scope` and
   * never moves the Grant Revision. Throws a Token Failure; a `transient` with a stored token still
   * valid returns that token `degraded` instead (never for a `rejectedAccessToken` call). An expired
   * access token is never returned.
   */
  getAccessToken(
    descriptor: OAuthProviderDescriptor,
    owner: OAuthGrantOwner,
    options?: { minValidityMs?: number; rejectedAccessToken?: string; forceRefresh?: boolean },
  ): Promise<OAuthAccessToken>
  /**
   * Persists the Token Set of a successful code exchange as an `active` grant under the Grant Lock:
   * updates the live grant in place (Reconnect) or inserts one. Throws `connect_grant_unreadable`,
   * `connect_exchange_failed` or `connect_persist_failed`; none of them changes the stored grant.
   */
  completeConnect(
    descriptor: OAuthProviderDescriptor,
    owner: OAuthGrantOwner,
    tokenResponse: OAuthTokenEndpointResponse,
    options: { clientId: string; requestedScopes?: readonly string[]; replaceUnreadable?: boolean; actorUserId?: string | null },
  ): Promise<OAuthConnectResult>
  /**
   * Stores the provider-owned, non-secret External Account selection under the Grant Lock:
   * `providerData = data`, clears `previousProviderData` and moves the Grant Revision. Compares
   * `expectedRevisedAt` (from `readOptimisticLockExpected(req)`) with the stored `revisedAt` after
   * decrypt and throws the platform's `CrudHttpError(409)` on a mismatch. Throws `not_connected`,
   * `platform_unavailable` or `transient`; none of them changes the grant.
   */
  updateProviderData(
    descriptor: OAuthProviderDescriptor,
    owner: OAuthGrantOwner,
    data: Record<string, unknown>,
    options: { expectedRevisedAt: string | Date | null; actorUserId?: string | null },
  ): Promise<{ revisedAt: Date }>
  /**
   * Reads the grant, the Client Configuration and, without a live grant, the last Disconnect. Makes no
   * token call, takes no lock and writes nothing; never throws on read failures, which read as
   * `unavailable`. It carries no token.
   */
  inspectGrant(descriptor: OAuthProviderDescriptor, owner: OAuthGrantOwner): Promise<OAuthGrantInspection>
  /**
   * The descriptor-free Grant Read Status: `null` without a live grant, else `active`, `invalidated`
   * or `unavailable`. Never throws.
   */
  readGrantStatus(integrationId: string, scope: { tenantId: string; organizationId: string }): Promise<OAuthGrantReadStatus | null>
  /**
   * Ends the grant. Under the Grant Lock (5 s waiter deadline) it compares `expectedRevisedAt` with
   * the stored `revisedAt` after decrypt, blanks and soft-deletes the grant row and logs
   * `oauth_disconnected` and `oauth_revocation_pending` under a new `disconnectId`, in one commit.
   * After the lock is released it revokes the stored refresh token (8 s), unless the owner reconnected
   * meanwhile or the grant was invalidated, and logs the outcome. When the commit fails with an
   * unknown outcome, it looks for the `oauth_disconnected` entry of its `disconnectId` and, if the
   * erase committed, still revokes. Without a live grant it returns `{ erased: false }` and writes
   * nothing. Unreadable tokens throw `disconnect_tokens_unreadable` unless `force`, which erases
   * without the tokens and without a revision check. Throws `transient` or the platform's
   * `CrudHttpError(409)`; neither changes the grant.
   */
  disconnect(
    descriptor: OAuthProviderDescriptor,
    owner: OAuthGrantOwner,
    options: { expectedRevisedAt: string | Date | null; force?: boolean; actorUserId?: string | null },
  ): Promise<OAuthDisconnectResult>
}

type DetachedLogInput = Parameters<IntegrationLogService['write']>[0]

/** @internal Consumers resolve the DI `integrationOAuthGrantService`. */
export type IntegrationOAuthGrantServiceDeps = {
  /** The request (container) EntityManager. */
  em: EntityManager
  /** DI `kmsService`; absent → one `createKmsService()` per operation. */
  kms?: KmsService | null
  /** DI `tenantEncryptionService`; passed to every credentials service the grant service builds. */
  encryptionService?: Pick<TenantDataEncryptionService, 'invalidateMap'> | null
  /** The token and revocation client; defaults to `requestTokenEndpoint` and `revokeToken`. */
  tokenClient?: { requestTokenEndpoint: typeof requestTokenEndpoint; revokeToken: typeof revokeToken }
  now?: () => Date
  writeDetachedLog?: (input: DetachedLogInput, scope: IntegrationScope) => Promise<void>
}

type GrantScope = { tenantId: string; organizationId: string }
type AfterCommitCallback = () => void | Promise<void>
type ResolvedDescriptor = ReturnType<typeof resolveOAuthProviderDescriptor>
type ConnectPersistFailure =
  | 'no_dek'
  | 'field_ciphertext'
  | 'client_configuration_unreadable'
  | 'encryption_unavailable'
  | 'lock_unavailable'
  | 'transient_db'

type ConnectOutcome =
  | { kind: 'connected'; result: OAuthConnectResult }
  | { kind: 'rejected'; code: 'connect_grant_unreadable' | 'connect_exchange_failed' }
  | { kind: 'persist_failed'; failure: ConnectPersistFailure }

type ConnectInput = {
  descriptor: ResolvedDescriptor
  owner: OAuthGrantOwner
  scope: GrantScope
  tokenResponse: OAuthTokenEndpointResponse
  clientId: string
  requestedScopes: string[] | null
  replaceUnreadable: boolean
  actorUserId: string | null
  pin: TenantDekPin
  afterCommit: AfterCommitCallback[]
}

type ClientConfiguration = { clientId: string; clientSecret: string; scopes: string[] | null }
type ClientConfigurationRead =
  | { kind: 'configured'; value: ClientConfiguration }
  | { kind: 'not_configured' }
  | { kind: 'unreadable' }

type TokenCall = {
  descriptor: ResolvedDescriptor
  owner: OAuthGrantOwner
  scope: GrantScope
  pin: TenantDekPin
  callStart: Date
  minValidityMs: number | null
  rejectedAccessToken: string | null
  forceRefresh: boolean
  lastRead: OAuthGrantRecord | null
  pendingWrite: PendingGrantWrite | null
  afterCommit: AfterCommitCallback[]
}

type PendingGrantWrite = { previous: OAuthGrantRecord; written: OAuthGrantRecord; outcome: TokenOutcome }

type TokenFailureOutcome = {
  kind: 'failure'
  code: OAuthTokenFailure
  reason: OAuthFailureReason | null
  providerErrorCode: string | null
}

type TokenOutcome = { kind: 'token'; grant: OAuthGrantRecord; degraded: boolean } | TokenFailureOutcome

type GrantEvaluation =
  | { kind: 'settled'; outcome: TokenOutcome }
  | { kind: 'refresh_needed'; grant: OAuthGrantRecord; client: ClientConfiguration }

type ProviderDataInput = {
  owner: OAuthGrantOwner
  scope: GrantScope
  data: Record<string, unknown>
  expectedRevisedAt: string | Date | null
  actorUserId: string | null
  pin: TenantDekPin
  afterCommit: AfterCommitCallback[]
}

type ProviderDataOutcome =
  | { kind: 'updated'; revisedAt: Date }
  | { kind: 'failure'; code: 'not_connected' | 'platform_unavailable' }
  | { kind: 'conflict'; error: CrudHttpError }

type InspectedGrant =
  | { kind: 'none' }
  | { kind: 'unavailable'; reason: OAuthUnavailableReason }
  | { kind: 'readable'; grant: OAuthGrantRecord }

type ClientConfigurationGate =
  | { connectionState: 'not_configured'; unavailableReason: null }
  | { connectionState: 'unavailable'; unavailableReason: 'platform' }

type TokenEndpointClassification =
  | { kind: 'grant_rejected' }
  | { kind: 'client_misconfigured'; reason: OAuthFailureReason | null; providerErrorCode: string | null }
  | { kind: 'transient'; salvagedRefreshToken: string | null }

type DisconnectInput = {
  owner: OAuthGrantOwner
  scope: GrantScope
  expectedRevisedAt: string | Date | null
  force: boolean
  actorUserId: string | null
  pin: TenantDekPin | null
}

type ErasedDisconnect = { kind: 'erased'; disconnectId: string; captured: OAuthGrantRecord | null }

type DisconnectOutcome =
  | ErasedDisconnect
  | { kind: 'not_connected' }
  | { kind: 'unreadable' }
  | { kind: 'conflict'; error: CrudHttpError }

type DisconnectCleanup = {
  descriptor: ResolvedDescriptor
  owner: OAuthGrantOwner
  pin: TenantDekPin | null
  disconnectId: string
  captured: OAuthGrantRecord | null
}

type RevocationResult = { revocation: OAuthRevocationOutcome; failureReason: string | null }

class GrantInvalidationWriteError extends Error {
  constructor(cause: unknown) {
    super('[internal] Writing the OAuth grant invalidation failed', { cause })
    this.name = 'GrantInvalidationWriteError'
  }
}

const logger = createLogger('integrations')

const GRANT_LOCK_MAX_CONCURRENT_HOLDERS = 4
const GRANT_WRITE_WAIT_DEADLINE_MS = 15_000
const DISCONNECT_WAIT_DEADLINE_MS = 5_000
const REVOKE_BUDGET_MS = 8_000
const MIN_ACCESS_TOKEN_LIFETIME_SEC = 1
const MAX_ACCESS_TOKEN_LIFETIME_SEC = 31_536_000
const DETACHED_FORK_OPTIONS = {
  disableContextResolution: true,
  clear: true,
  useContext: false,
  cloneEventManager: true,
}


const LOG_CODES = {
  connected: 'integrations.oauth_connected',
  connectPersistFailed: 'integrations.oauth_connect_persist_failed',
  invalidated: 'integrations.oauth_invalidated',
  externalAccountSelected: 'integrations.oauth_external_account_selected',
  disconnected: 'integrations.oauth_disconnected',
  revocationPending: 'integrations.oauth_revocation_pending',
  revocationConfirmed: 'integrations.oauth_revocation_confirmed',
  revocationFailed: 'integrations.oauth_revocation_failed',
  revocationUnsupported: 'integrations.oauth_revocation_unsupported',
  revocationSkippedReconnected: 'integrations.oauth_revocation_skipped_reconnected',
  revocationSkippedInvalidated: 'integrations.oauth_revocation_skipped_invalidated',
} as const

const REVOCATION_OUTCOME_STATES: Readonly<Record<string, OAuthRevocationState>> = {
  [LOG_CODES.revocationConfirmed]: 'confirmed',
  [LOG_CODES.revocationFailed]: 'failed',
  [LOG_CODES.revocationUnsupported]: 'unsupported',
  [LOG_CODES.revocationSkippedReconnected]: 'skipped',
  [LOG_CODES.revocationSkippedInvalidated]: 'skipped',
}
const REVOCATION_OUTCOME_CODES = Object.keys(REVOCATION_OUTCOME_STATES)

const REVOCATION_OUTCOME_ENTRIES: Readonly<Record<OAuthRevocationOutcome, { code: string; level: 'info' | 'error'; message: string }>> = {
  confirmed: { code: LOG_CODES.revocationConfirmed, level: 'info', message: 'OAuth grant revoked at the provider' },
  failed: { code: LOG_CODES.revocationFailed, level: 'error', message: 'OAuth grant could not be revoked at the provider' },
  unsupported: { code: LOG_CODES.revocationUnsupported, level: 'info', message: 'OAuth provider offers no token revocation' },
  skipped_reconnected: {
    code: LOG_CODES.revocationSkippedReconnected,
    level: 'info',
    message: 'OAuth grant revocation skipped because the integration was reconnected',
  },
  skipped_invalidated: {
    code: LOG_CODES.revocationSkippedInvalidated,
    level: 'info',
    message: 'OAuth grant revocation skipped because the grant was already invalidated',
  },
}

const REPORT_CODES = {
  connectPersistFailed: 'integrations.oauth_connect_persist_failed',
  platformUnavailable: 'integrations.oauth_platform_unavailable',
  refreshTransient: 'integrations.oauth_refresh_transient',
  refreshFailed: 'integrations.oauth_refresh_failed',
  clientMisconfigured: 'integrations.oauth_client_misconfigured',
  logWriteFailed: 'integrations.oauth_log_write_failed',
  mapInvalidationFailed: 'integrations.oauth_map_invalidation_failed',
  writeTransient: 'integrations.oauth_write_transient',
  inspectFailed: 'integrations.oauth_inspect_failed',
  revocationFailed: 'integrations.oauth_revocation_failed',
} as const

const TOO_MANY_REQUESTS_STATUS = 429
const FIRST_SERVER_ERROR_STATUS = 500
const TRANSIENT_PROVIDER_ERRORS = new Set(['temporarily_unavailable', 'server_error'])
const CLIENT_PROVIDER_ERRORS = new Set(['invalid_client', 'unauthorized_client'])

const PLATFORM_PERSIST_FAILURES = new Set<ConnectPersistFailure>([
  'no_dek',
  'field_ciphertext',
  'client_configuration_unreadable',
  'encryption_unavailable',
])

const connectOptionsSchema = z.object({
  clientId: z.string().min(1),
  requestedScopes: z.array(z.string().min(1)).optional(),
  replaceUnreadable: z.boolean().optional(),
  actorUserId: z.string().min(1).nullish(),
})

const accessTokenOptionsSchema = z.object({
  minValidityMs: z.number().nonnegative().optional(),
  rejectedAccessToken: z.string().min(1).optional(),
  forceRefresh: z.boolean().optional(),
})

const providerDataSchema = z.record(z.string(), z.unknown())

const providerDataOptionsSchema = z.object({
  expectedRevisedAt: z.union([z.string(), z.date()]).nullable(),
  actorUserId: z.string().min(1).nullish(),
})

const disconnectOptionsSchema = z.object({
  expectedRevisedAt: z.union([z.string(), z.date()]).nullable(),
  force: z.boolean().optional(),
  actorUserId: z.string().min(1).nullish(),
})

const tokenResponseSchema = z.object({
  accessToken: z.string().min(1),
  tokenType: z.literal('Bearer'),
  expiresInSec: z.number().nonnegative().nullable(),
  refreshToken: z.string().min(1).nullable(),
  scope: z.array(z.string().min(1)).nullable(),
})

function parseInput<T>(schema: z.ZodType<T>, value: unknown, prefix: string): T {
  const parsed = schema.safeParse(value)
  if (parsed.success) return parsed.data
  const path = parsed.error.issues[0]?.path.map((segment) => String(segment)) ?? []
  throw new OAuthDescriptorError(path.length > 0 ? `${prefix}.${path.join('.')}` : prefix)
}

function grantScope(owner: OAuthGrantOwner): GrantScope {
  return { tenantId: owner.tenantId, organizationId: owner.organizationId }
}

function hasKeys(value: Record<string, unknown> | null): value is Record<string, unknown> {
  return value !== null && Object.keys(value).length > 0
}

function readTrimmedString(value: Record<string, unknown>, key: string): string {
  const raw = value[key]
  return typeof raw === 'string' ? raw.trim() : ''
}

function parseConfiguredScopes(raw: string): string[] | null {
  const scopes = raw.split(/[\s,]+/).filter((scope) => scope.length > 0)
  return scopes.length > 0 ? scopes : null
}

function validateClientConfiguration(value: Record<string, unknown>): ClientConfiguration {
  return {
    clientId: readTrimmedString(value, 'clientId'),
    clientSecret: readTrimmedString(value, 'clientSecret'),
    scopes: parseConfiguredScopes(readTrimmedString(value, 'scopes')),
  }
}

function classifyClientConfiguration(read: LayeredCredentialRead<ClientConfiguration>): ClientConfigurationRead {
  if (read.kind === 'none') return { kind: 'not_configured' }
  if (read.kind !== 'ok') return { kind: 'unreadable' }
  if (!read.value.clientId || !read.value.clientSecret) return { kind: 'not_configured' }
  return { kind: 'configured', value: read.value }
}

async function readClientConfiguration(
  em: EntityManager,
  integrationId: string,
  scope: GrantScope,
  pin: TenantDekPin,
): Promise<ClientConfigurationRead> {
  const options = { kms: pin, validate: validateClientConfiguration }
  const own = await readCredentialRowLayered(em, integrationId, scope, options)
  if (own.kind !== 'none') return classifyClientConfiguration(own)
  const bundleId = bundleFallthroughId(integrationId)
  if (!bundleId) return { kind: 'not_configured' }
  return classifyClientConfiguration(await readCredentialRowLayered(em, bundleId, scope, options))
}

function resolveConnectRefreshToken(
  tokenResponse: OAuthTokenEndpointResponse,
  existing: OAuthGrantRecord | null,
  clientId: string,
  requiresRefreshToken: boolean,
): { usable: true; refreshToken: string | null } | { usable: false } {
  if (tokenResponse.refreshToken) return { usable: true, refreshToken: tokenResponse.refreshToken }
  const keepsStored = existing !== null
    && existing.status === 'active'
    && existing.clientId === clientId
    && existing.refreshToken !== null
  if (keepsStored) return { usable: true, refreshToken: existing.refreshToken }
  if (requiresRefreshToken) return { usable: false }
  return { usable: true, refreshToken: null }
}

function tokenFailure(
  code: OAuthTokenFailure,
  reason: OAuthFailureReason | null = null,
  providerErrorCode: string | null = null,
): TokenFailureOutcome {
  return { kind: 'failure', code, reason, providerErrorCode }
}

function settled(outcome: TokenOutcome): GrantEvaluation {
  return { kind: 'settled', outcome }
}

function toAccessToken(grant: OAuthGrantRecord, degraded: boolean): OAuthAccessToken {
  return {
    accessToken: grant.accessToken,
    expiresAt: grant.expiresAt,
    degraded,
    grantedScopes: [...grant.grantedScopes],
    providerData: grant.providerData,
  }
}

function matchesRejectedToken(grant: OAuthGrantRecord, call: TokenCall): boolean {
  return call.rejectedAccessToken !== null && call.rejectedAccessToken === grant.accessToken
}

function refreshedSinceCallStart(grant: OAuthGrantRecord, call: TokenCall): boolean {
  if (matchesRejectedToken(grant, call)) return false
  return (grant.refreshedAt ?? grant.obtainedAt).getTime() >= call.callStart.getTime()
}

function failureRecordedSinceCallStart(grant: OAuthGrantRecord, call: TokenCall): OAuthGrantRecord['lastFailureClass'] {
  if (grant.lastFailureClass === null || grant.lastFailureAt === null) return null
  return grant.lastFailureAt.getTime() >= call.callStart.getTime() ? grant.lastFailureClass : null
}

function recordedClientMisconfiguration(grant: OAuthGrantRecord): TokenFailureOutcome {
  const providerErrorCode = grant.lastFailureProviderErrorCode
  return tokenFailure('client_misconfigured', providerErrorCode === null ? null : 'token_endpoint_rejected', providerErrorCode)
}

function isSameGrantWrite(stored: OAuthGrantRecord, expected: OAuthGrantRecord): boolean {
  return stored.accessToken === expected.accessToken
    && stored.refreshToken === expected.refreshToken
    && stored.refreshCount === expected.refreshCount
    && stored.status === expected.status
    && (stored.lastFailureAt?.getTime() ?? null) === (expected.lastFailureAt?.getTime() ?? null)
}

function classifyTokenEndpointError(error: OAuthTokenEndpointError): TokenEndpointClassification {
  const transient: TokenEndpointClassification = { kind: 'transient', salvagedRefreshToken: error.salvagedRefreshToken }
  if (error.kind !== 'protocol' || error.error === null) return transient
  if (error.status !== null && (error.status >= FIRST_SERVER_ERROR_STATUS || error.status === TOO_MANY_REQUESTS_STATUS)) {
    return transient
  }
  if (TRANSIENT_PROVIDER_ERRORS.has(error.error)) return transient
  if (error.error === 'invalid_grant') return { kind: 'grant_rejected' }
  if (CLIENT_PROVIDER_ERRORS.has(error.error)) return { kind: 'client_misconfigured', reason: null, providerErrorCode: null }
  return { kind: 'client_misconfigured', reason: 'token_endpoint_rejected', providerErrorCode: error.error }
}

function inspectGrantRead(read: LayeredCredentialRead<OAuthGrantRecord>, pinned: TenantDekPinOutcome): InspectedGrant {
  if (read.kind === 'none') return { kind: 'none' }
  if (pinned.status === 'unavailable') return { kind: 'unavailable', reason: 'platform' }
  if (read.kind === 'ok') return { kind: 'readable', grant: read.value }
  if (read.kind === 'envelope_undecryptable' || read.kind === 'invalid') return { kind: 'unavailable', reason: 'unreadable' }
  return { kind: 'unavailable', reason: 'platform' }
}

function clientConfigurationGate(configuration: ClientConfigurationRead): ClientConfigurationGate | null {
  if (configuration.kind === 'not_configured') return { connectionState: 'not_configured', unavailableReason: null }
  if (configuration.kind === 'unreadable') return { connectionState: 'unavailable', unavailableReason: 'platform' }
  return null
}

function missingGrantScopes(
  grant: OAuthGrantRecord,
  configuration: ClientConfigurationRead,
  descriptor: ResolvedDescriptor,
): string[] {
  const configuredScopes = configuration.kind === 'configured' ? configuration.value.scopes : null
  const granted = new Set(grant.grantedScopes)
  return [...new Set(configuredScopes ?? descriptor.defaultScopes)].filter((scope) => !granted.has(scope))
}

function isBaseUrlMissing(): boolean {
  try {
    resolveOAuthRedirectUri(undefined, '/')
    return false
  } catch {
    return true
  }
}

async function hasLiveGrantRow(em: EntityManager, owner: OAuthGrantOwner): Promise<boolean> {
  const filter = buildCredentialsFilter(oauthGrantRowId(owner.integrationId), grantScope(owner))
  return (await em.count(IntegrationCredentials, filter)) > 0
}

function findRevisionConflict(
  grant: OAuthGrantRecord,
  owner: OAuthGrantOwner,
  expectedRevisedAt: string | Date | null,
): CrudHttpError | null {
  try {
    assertOptimisticLock({
      resourceKind: OAUTH_GRANT_RESOURCE_KIND,
      resourceId: oauthGrantRowId(owner.integrationId),
      current: grant.revisedAt,
      expected: expectedRevisedAt,
    })
    return null
  } catch (error) {
    if (isCrudHttpError(error)) return error
    throw error
  }
}

function classifyConnectPersistFailure(error: unknown): ConnectPersistFailure | null {
  if (isCredentialsEncryptionUnavailableError(error)) return 'encryption_unavailable'
  if (error instanceof AdvisoryLockUnavailableError) return 'lock_unavailable'
  if (isTransientLockDbError(error)) return 'transient_db'
  return null
}

function isCommitOutcomeUnknown(error: unknown): boolean {
  return error instanceof AdvisoryLockUnavailableError && error.reason === 'commit_unknown'
}

/** `expires_in` (or the descriptor default) clamped to 1 s – 1 year, so a token response always yields a valid date. */
function accessTokenExpiresAt(from: Date, expiresInSec: number | null, defaultLifetimeSec: number): Date {
  const lifetimeSec = Math.min(Math.max(expiresInSec ?? defaultLifetimeSec, MIN_ACCESS_TOKEN_LIFETIME_SEC), MAX_ACCESS_TOKEN_LIFETIME_SEC)
  return new Date(from.getTime() + lifetimeSec * 1000)
}

function revocationOutcome(revocation: OAuthRevocationOutcome): RevocationResult {
  return { revocation, failureReason: null }
}

function revocationFailure(failureReason: string): RevocationResult {
  return { revocation: 'failed', failureReason }
}

function clientUnavailableReason(client: ClientConfigurationRead): string | null {
  if (client.kind === 'unreadable') return 'platform_unavailable'
  if (client.kind === 'not_configured') return 'client_not_configured'
  return null
}

/** @internal Consumers resolve the DI `integrationOAuthGrantService`. */
export function createIntegrationOAuthGrantService(deps: IntegrationOAuthGrantServiceDeps): IntegrationOAuthGrantService {
  const now = deps.now ?? (() => new Date())
  const encryptionService = deps.encryptionService ?? null
  const tokenClient = deps.tokenClient ?? { requestTokenEndpoint, revokeToken }

  function reportGrantError(error: unknown, code: string, owner: OAuthGrantOwner): void {
    try {
      getTelemetryRuntime()?.reportError(error, {
        module: 'integrations',
        code,
        attributes: {
          integrationId: owner.integrationId,
          tenantId: owner.tenantId,
          organizationId: owner.organizationId,
        },
      })
    } catch (telemetryError) {
      logger.warn('Failed to report an OAuth grant error to telemetry', {
        integrationId: owner.integrationId,
        code,
        err: telemetryError as Error,
      })
    }
  }

  async function defaultWriteDetachedLog(input: DetachedLogInput, scope: IntegrationScope): Promise<void> {
    await createIntegrationLogService(deps.em.fork(DETACHED_FORK_OPTIONS)).write(input, scope)
  }

  async function writeDetachedLog(input: DetachedLogInput, owner: OAuthGrantOwner): Promise<void> {
    try {
      await (deps.writeDetachedLog ?? defaultWriteDetachedLog)(input, grantScope(owner))
    } catch (error) {
      reportGrantError(error, REPORT_CODES.logWriteFailed, owner)
    }
  }

  async function runAfterCommit(callbacks: AfterCommitCallback[], owner: OAuthGrantOwner): Promise<void> {
    for (const callback of callbacks) {
      try {
        await callback()
      } catch (error) {
        reportGrantError(error, REPORT_CODES.mapInvalidationFailed, owner)
      }
    }
  }

  async function saveGrant(
    txEm: EntityManager,
    owner: OAuthGrantOwner,
    grant: OAuthGrantRecord,
    pin: TenantDekPin,
    afterCommit: AfterCommitCallback[],
  ): Promise<void> {
    await createCredentialsService(txEm, encryptionService, { kms: pin }).save(
      oauthGrantRowId(owner.integrationId),
      serializeOAuthGrantBlob(grant),
      grantScope(owner),
      {
        ensureEncryptionMap: 'when-not-canonical',
        deferAfterCommit: (callback) => {
          afterCommit.push(callback)
        },
      },
    )
  }

  async function failConnectPersist(
    owner: OAuthGrantOwner,
    failure: ConnectPersistFailure,
    cause: unknown,
  ): Promise<OAuthGrantError> {
    const error = new OAuthGrantError(
      'connect_persist_failed',
      failure === 'transient_db' || cause === null ? {} : { cause },
    )
    reportGrantError(
      error,
      PLATFORM_PERSIST_FAILURES.has(failure) ? REPORT_CODES.platformUnavailable : REPORT_CODES.connectPersistFailed,
      owner,
    )
    await writeDetachedLog({
      integrationId: owner.integrationId,
      level: 'warn',
      message: 'OAuth grant could not be persisted after a successful code exchange',
      code: LOG_CODES.connectPersistFailed,
      payload: { failure },
    }, owner)
    return error
  }

  async function connectUnderLock(txEm: EntityManager, input: ConnectInput): Promise<ConnectOutcome> {
    const rowId = oauthGrantRowId(input.owner.integrationId)
    const read = await readCredentialRowLayered(txEm, rowId, input.scope, { kms: input.pin, validate: parseOAuthGrantBlob })
    if (read.kind === 'field_ciphertext' || read.kind === 'no_dek') {
      return { kind: 'persist_failed', failure: read.kind === 'no_dek' ? 'no_dek' : 'field_ciphertext' }
    }
    const unreadable = read.kind === 'envelope_undecryptable' || read.kind === 'invalid'
    if (unreadable && !input.replaceUnreadable) return { kind: 'rejected', code: 'connect_grant_unreadable' }
    const existing = read.kind === 'ok' ? read.value : null

    const refresh = resolveConnectRefreshToken(
      input.tokenResponse,
      existing,
      input.clientId,
      input.descriptor.requiresRefreshToken,
    )
    if (!refresh.usable) return { kind: 'rejected', code: 'connect_exchange_failed' }

    let grantedScopes = input.tokenResponse.scope ?? input.requestedScopes
    if (grantedScopes === null) {
      const configuration = await readClientConfiguration(txEm, input.owner.integrationId, input.scope, input.pin)
      if (configuration.kind === 'unreadable') return { kind: 'persist_failed', failure: 'client_configuration_unreadable' }
      grantedScopes = configuration.kind === 'configured' ? configuration.value.scopes : null
    }

    const connectedAt = now()
    const previousProviderData = existing === null
      ? null
      : hasKeys(existing.providerData) ? existing.providerData : existing.previousProviderData
    const grant: OAuthGrantRecord = {
      status: 'active',
      invalidatedReason: null,
      invalidatedAt: null,
      accessToken: input.tokenResponse.accessToken,
      refreshToken: refresh.refreshToken,
      expiresAt: accessTokenExpiresAt(connectedAt, input.tokenResponse.expiresInSec, input.descriptor.defaultAccessTokenTtlSec),
      tokenType: 'Bearer',
      clientId: input.clientId,
      grantedScopes: [...(grantedScopes ?? input.descriptor.defaultScopes)],
      obtainedAt: connectedAt,
      refreshedAt: null,
      refreshCount: 0,
      revisedAt: connectedAt,
      lastFailureClass: null,
      lastFailureAt: null,
      lastFailureProviderErrorCode: null,
      providerData: null,
      previousProviderData,
    }

    await saveGrant(txEm, input.owner, grant, input.pin, input.afterCommit)

    const reconnect = read.kind !== 'none'
    await createIntegrationLogService(txEm).write({
      integrationId: input.owner.integrationId,
      level: 'info',
      message: reconnect ? 'OAuth grant reconnected' : 'OAuth grant connected',
      code: LOG_CODES.connected,
      payload: {
        reconnect,
        replacedUnreadable: unreadable,
        clientId: input.clientId,
        grantedScopes: grant.grantedScopes,
        actorUserId: input.actorUserId,
      },
    }, input.scope)

    return {
      kind: 'connected',
      result: { reconnect, replacedUnreadable: unreadable, previousProviderData, revisedAt: connectedAt },
    }
  }

  function isUsable(grant: OAuthGrantRecord): boolean {
    return grant.status === 'active' && grant.expiresAt.getTime() > now().getTime()
  }

  function minValidityMsFor(grant: OAuthGrantRecord, call: TokenCall): number {
    if (call.minValidityMs !== null) return call.minValidityMs
    const lifetimeMs = grant.expiresAt.getTime() - (grant.refreshedAt ?? grant.obtainedAt).getTime()
    return Math.min(call.descriptor.refreshSkewMs, Math.max(lifetimeMs, 0) / 2)
  }

  function isBelowMinValidity(grant: OAuthGrantRecord, call: TokenCall): boolean {
    return grant.expiresAt.getTime() - now().getTime() < minValidityMsFor(grant, call)
  }

  function needsRefresh(grant: OAuthGrantRecord, call: TokenCall): boolean {
    return call.forceRefresh || matchesRejectedToken(grant, call) || isBelowMinValidity(grant, call) || !isUsable(grant)
  }

  function answerAlreadyRefreshed(grant: OAuthGrantRecord, call: TokenCall): TokenOutcome {
    if (!isUsable(grant)) return tokenFailure('transient')
    return { kind: 'token', grant, degraded: isBelowMinValidity(grant, call) }
  }

  function transientOutcome(grant: OAuthGrantRecord | null, call: TokenCall): TokenOutcome {
    if (grant !== null && call.rejectedAccessToken === null && isUsable(grant)) return { kind: 'token', grant, degraded: true }
    return tokenFailure('transient')
  }

  async function evaluateGrant(em: EntityManager, call: TokenCall): Promise<GrantEvaluation> {
    const read = await readCredentialRowLayered(em, oauthGrantRowId(call.owner.integrationId), call.scope, {
      kms: call.pin,
      validate: parseOAuthGrantBlob,
    })
    if (read.kind === 'none') return settled(tokenFailure('not_connected'))
    if (read.kind !== 'ok') return settled(tokenFailure('platform_unavailable'))
    const grant = read.value
    call.lastRead = grant
    if (grant.status === 'invalidated') return settled(tokenFailure('grant_invalidated', grant.invalidatedReason))
    const configuration = await readClientConfiguration(em, call.owner.integrationId, call.scope, call.pin)
    if (configuration.kind === 'unreadable') return settled(tokenFailure('platform_unavailable'))
    if (configuration.kind === 'not_configured') return settled(tokenFailure('client_misconfigured', 'client_not_configured'))
    if (configuration.value.clientId !== grant.clientId) return settled(tokenFailure('client_misconfigured', 'client_changed'))
    if (!needsRefresh(grant, call)) return settled({ kind: 'token', grant, degraded: false })
    return { kind: 'refresh_needed', grant, client: configuration.value }
  }

  async function awaitConcurrentRefresh(call: TokenCall): Promise<AdvisoryLockWaitResult<TokenOutcome>> {
    const evaluation = await evaluateGrant(deps.em.fork(DETACHED_FORK_OPTIONS), call)
    if (evaluation.kind === 'settled') return { done: true, value: evaluation.outcome }
    if (refreshedSinceCallStart(evaluation.grant, call)) {
      return { done: true, value: answerAlreadyRefreshed(evaluation.grant, call) }
    }
    return { done: false }
  }

  async function writeInvalidation(
    txEm: EntityManager,
    grant: OAuthGrantRecord,
    reason: OAuthInvalidatedReason,
    call: TokenCall,
  ): Promise<TokenOutcome> {
    try {
      const invalidated: OAuthGrantRecord = { ...grant, status: 'invalidated', invalidatedReason: reason, invalidatedAt: now() }
      await saveGrant(txEm, call.owner, invalidated, call.pin, call.afterCommit)
      await createIntegrationLogService(txEm).write({
        integrationId: call.owner.integrationId,
        level: 'warn',
        message: 'OAuth grant invalidated; the integration must be reconnected',
        code: LOG_CODES.invalidated,
        payload: { reason },
      }, call.scope)
    } catch (error) {
      throw new GrantInvalidationWriteError(error)
    }
    return tokenFailure('grant_invalidated', reason)
  }

  async function answerWithoutRefreshToken(txEm: EntityManager, grant: OAuthGrantRecord, call: TokenCall): Promise<TokenOutcome> {
    if (grant.expiresAt.getTime() <= now().getTime()) return writeInvalidation(txEm, grant, 'no_refresh_token', call)
    if (matchesRejectedToken(grant, call)) return tokenFailure('transient')
    return { kind: 'token', grant, degraded: true }
  }

  async function recordTokenEndpointFailure(
    txEm: EntityManager,
    grant: OAuthGrantRecord,
    error: OAuthTokenEndpointError,
    call: TokenCall,
  ): Promise<TokenOutcome> {
    const classification = classifyTokenEndpointError(error)
    if (classification.kind === 'grant_rejected') return writeInvalidation(txEm, grant, 'grant_rejected', call)
    if (classification.kind === 'client_misconfigured') {
      const failure = tokenFailure('client_misconfigured', classification.reason, classification.providerErrorCode)
      reportGrantError(
        new OAuthGrantError('client_misconfigured', { reason: failure.reason, providerErrorCode: failure.providerErrorCode, cause: error }),
        REPORT_CODES.clientMisconfigured,
        call.owner,
      )
      const diagnosed: OAuthGrantRecord = {
        ...grant,
        lastFailureClass: 'client_misconfigured',
        lastFailureAt: now(),
        lastFailureProviderErrorCode: classification.providerErrorCode,
      }
      await saveGrant(txEm, call.owner, diagnosed, call.pin, call.afterCommit)
      return failure
    }
    reportGrantError(new OAuthGrantError('transient', { cause: error }), REPORT_CODES.refreshTransient, call.owner)
    const diagnosed: OAuthGrantRecord = {
      ...grant,
      refreshToken: classification.salvagedRefreshToken ?? grant.refreshToken,
      lastFailureClass: 'transient',
      lastFailureAt: now(),
      lastFailureProviderErrorCode: null,
    }
    const outcome = transientOutcome(diagnosed, call)
    if (classification.salvagedRefreshToken !== null) call.pendingWrite = { previous: grant, written: diagnosed, outcome }
    await saveGrant(txEm, call.owner, diagnosed, call.pin, call.afterCommit)
    return outcome
  }

  function applyRefresh(grant: OAuthGrantRecord, response: OAuthTokenEndpointResponse, call: TokenCall): OAuthGrantRecord {
    const refreshedAt = now()
    return {
      ...grant,
      accessToken: response.accessToken,
      refreshToken: response.refreshToken ?? grant.refreshToken,
      expiresAt: accessTokenExpiresAt(refreshedAt, response.expiresInSec, call.descriptor.defaultAccessTokenTtlSec),
      grantedScopes: response.scope ? [...response.scope] : grant.grantedScopes,
      refreshedAt,
      refreshCount: grant.refreshCount + 1,
      lastFailureClass: null,
      lastFailureAt: null,
      lastFailureProviderErrorCode: null,
    }
  }

  async function refreshUnderLock(txEm: EntityManager, call: TokenCall): Promise<TokenOutcome> {
    const evaluation = await evaluateGrant(txEm, call)
    if (evaluation.kind === 'settled') return evaluation.outcome
    const { grant, client } = evaluation
    if (refreshedSinceCallStart(grant, call)) return answerAlreadyRefreshed(grant, call)
    const recordedFailure = failureRecordedSinceCallStart(grant, call)
    if (recordedFailure === 'transient') return transientOutcome(grant, call)
    if (recordedFailure === 'client_misconfigured') return recordedClientMisconfiguration(grant)
    const refreshToken = grant.refreshToken
    if (refreshToken === null) return answerWithoutRefreshToken(txEm, grant, call)

    let response: OAuthTokenEndpointResponse
    try {
      response = await tokenClient.requestTokenEndpoint({
        url: call.descriptor.tokenEndpoint,
        client: { clientId: client.clientId, clientSecret: client.clientSecret, authMethod: call.descriptor.clientAuthMethod },
        params: { grant_type: 'refresh_token', refresh_token: refreshToken },
      })
    } catch (error) {
      if (!(error instanceof OAuthTokenEndpointError)) throw error
      return recordTokenEndpointFailure(txEm, grant, error, call)
    }
    const refreshed = applyRefresh(grant, response, call)
    const outcome: TokenOutcome = { kind: 'token', grant: refreshed, degraded: isBelowMinValidity(refreshed, call) }
    call.pendingWrite = { previous: grant, written: refreshed, outcome }
    await saveGrant(txEm, call.owner, refreshed, call.pin, call.afterCommit)
    return outcome
  }

  function outcomeAfterConcurrentWrite(stored: OAuthGrantRecord, call: TokenCall): TokenOutcome {
    if (stored.status === 'invalidated') return tokenFailure('grant_invalidated', stored.invalidatedReason)
    if (!isUsable(stored)) return tokenFailure('transient')
    return { kind: 'token', grant: stored, degraded: isBelowMinValidity(stored, call) }
  }

  async function reconcilePendingWrite(txEm: EntityManager, call: TokenCall, pending: PendingGrantWrite): Promise<TokenOutcome> {
    const read = await readCredentialRowLayered(txEm, oauthGrantRowId(call.owner.integrationId), call.scope, {
      kms: call.pin,
      validate: parseOAuthGrantBlob,
    })
    if (read.kind === 'none') return tokenFailure('not_connected')
    if (read.kind !== 'ok') return tokenFailure('platform_unavailable')
    if (isSameGrantWrite(read.value, pending.written)) return pending.outcome
    if (!isSameGrantWrite(read.value, pending.previous)) return outcomeAfterConcurrentWrite(read.value, call)
    await saveGrant(txEm, call.owner, pending.written, call.pin, call.afterCommit)
    return pending.outcome
  }

  async function resolveUnknownCommit(call: TokenCall, pending: PendingGrantWrite): Promise<OAuthAccessToken> {
    call.lastRead = pending.written
    let outcome: TokenOutcome
    try {
      outcome = await withAdvisoryXactLock(
        deps.em,
        oauthGrantLockKey(call.owner),
        (txEm) => reconcilePendingWrite(txEm, call, pending),
        { waitDeadlineMs: GRANT_WRITE_WAIT_DEADLINE_MS, maxConcurrentHolders: GRANT_LOCK_MAX_CONCURRENT_HOLDERS },
      )
    } catch (error) {
      return settleTokenError(error, call)
    }
    await runAfterCommit(call.afterCommit, call.owner)
    return settleTokenOutcome(outcome, call.owner)
  }

  function settleTokenOutcome(outcome: TokenOutcome, owner: OAuthGrantOwner): OAuthAccessToken {
    if (outcome.kind === 'token') return toAccessToken(outcome.grant, outcome.degraded)
    const error = new OAuthGrantError(outcome.code, { reason: outcome.reason, providerErrorCode: outcome.providerErrorCode })
    if (outcome.code === 'platform_unavailable') reportGrantError(error, REPORT_CODES.platformUnavailable, owner)
    throw error
  }

  function settleTokenError(error: unknown, call: TokenCall): OAuthAccessToken {
    if (error instanceof GrantInvalidationWriteError) {
      const transient = new OAuthGrantError('transient')
      reportGrantError(transient, REPORT_CODES.refreshTransient, call.owner)
      throw transient
    }
    if (error instanceof AdvisoryLockUnavailableError || isTransientLockDbError(error)) {
      const transient = new OAuthGrantError('transient', error instanceof AdvisoryLockUnavailableError ? { cause: error } : {})
      reportGrantError(transient, REPORT_CODES.refreshTransient, call.owner)
      const fallback = transientOutcome(call.lastRead, call)
      if (fallback.kind === 'token') return toAccessToken(fallback.grant, true)
      throw transient
    }
    if (isCredentialsEncryptionUnavailableError(error)) {
      const unavailable = new OAuthGrantError('platform_unavailable', { cause: error })
      reportGrantError(unavailable, REPORT_CODES.platformUnavailable, call.owner)
      throw unavailable
    }
    reportGrantError(error, REPORT_CODES.refreshFailed, call.owner)
    throw error
  }

  function platformUnavailableError(owner: OAuthGrantOwner, cause: unknown): OAuthGrantError {
    const error = new OAuthGrantError('platform_unavailable', cause == null ? {} : { cause })
    reportGrantError(error, REPORT_CODES.platformUnavailable, owner)
    return error
  }

  function settleGrantWriteError(error: unknown, owner: OAuthGrantOwner): unknown {
    if (error instanceof AdvisoryLockUnavailableError || isTransientLockDbError(error)) {
      const transient = new OAuthGrantError('transient', error instanceof AdvisoryLockUnavailableError ? { cause: error } : {})
      reportGrantError(transient, REPORT_CODES.writeTransient, owner)
      return transient
    }
    if (isCredentialsEncryptionUnavailableError(error)) return platformUnavailableError(owner, error)
    return error
  }

  async function updateProviderDataUnderLock(txEm: EntityManager, input: ProviderDataInput): Promise<ProviderDataOutcome> {
    const read = await readCredentialRowLayered(txEm, oauthGrantRowId(input.owner.integrationId), input.scope, {
      kms: input.pin,
      validate: parseOAuthGrantBlob,
    })
    if (read.kind === 'none') return { kind: 'failure', code: 'not_connected' }
    if (read.kind !== 'ok') return { kind: 'failure', code: 'platform_unavailable' }
    const conflict = findRevisionConflict(read.value, input.owner, input.expectedRevisedAt)
    if (conflict) return { kind: 'conflict', error: conflict }

    const revisedAt = now()
    const grant: OAuthGrantRecord = { ...read.value, providerData: input.data, previousProviderData: null, revisedAt }
    await saveGrant(txEm, input.owner, grant, input.pin, input.afterCommit)
    await createIntegrationLogService(txEm).write({
      integrationId: input.owner.integrationId,
      level: 'info',
      message: 'OAuth grant external account selected',
      code: LOG_CODES.externalAccountSelected,
      payload: { providerDataKeys: Object.keys(input.data), actorUserId: input.actorUserId },
    }, input.scope)
    return { kind: 'updated', revisedAt }
  }

  function reportInspectPinFailure(pinned: TenantDekPinOutcome, owner: OAuthGrantOwner): void {
    if (pinned.status !== 'unavailable' || pinned.error == null) return
    reportGrantError(new OAuthGrantError('platform_unavailable', { cause: pinned.error }), REPORT_CODES.inspectFailed, owner)
  }

  async function readLastDisconnect(em: EntityManager, owner: OAuthGrantOwner): Promise<OAuthLastDisconnect | null> {
    const scope = grantScope(owner)
    try {
      const [disconnected] = await findLatestIntegrationLogsByCodes(em, owner.integrationId, [LOG_CODES.disconnected], scope)
      const disconnectId = disconnected?.payload?.disconnectId
      if (!disconnected || typeof disconnectId !== 'string' || disconnectId.length === 0) return null
      const [outcome] = await findLatestIntegrationLogsByCodes(em, owner.integrationId, REVOCATION_OUTCOME_CODES, scope, {
        disconnectId,
        createdFrom: disconnected.createdAt,
      })
      const revocation = (outcome?.code ? REVOCATION_OUTCOME_STATES[outcome.code] : undefined) ?? 'pending'
      return { at: disconnected.createdAt, disconnectId, revocation }
    } catch (error) {
      reportGrantError(error, REPORT_CODES.inspectFailed, owner)
      return null
    }
  }

  async function inspect(em: EntityManager, descriptor: ResolvedDescriptor, owner: OAuthGrantOwner): Promise<OAuthGrantInspection> {
    const baseUrlMissing = isBaseUrlMissing()
    const scope = grantScope(owner)
    let configuration: ClientConfigurationRead
    let inspected: InspectedGrant
    try {
      const pin = pinTenantDek(deps.kms ?? createKmsService())
      const pinned = await pin.resolve(owner.tenantId)
      reportInspectPinFailure(pinned, owner)
      configuration = await readClientConfiguration(em, owner.integrationId, scope, pin)
      const read = await readCredentialRowLayered(em, oauthGrantRowId(owner.integrationId), scope, {
        kms: pin,
        validate: parseOAuthGrantBlob,
      })
      inspected = inspectGrantRead(read, pinned)
    } catch (error) {
      reportGrantError(error, REPORT_CODES.inspectFailed, owner)
      return { status: 'unavailable', connectionState: 'unavailable', unavailableReason: 'platform', baseUrlMissing }
    }

    const gate = clientConfigurationGate(configuration)
    if (inspected.kind === 'none') {
      return {
        status: 'none',
        connectionState: gate?.connectionState ?? 'not_connected',
        unavailableReason: gate?.unavailableReason ?? null,
        baseUrlMissing,
        lastDisconnect: await readLastDisconnect(em, owner),
      }
    }
    if (inspected.kind === 'unavailable') {
      return {
        status: 'unavailable',
        connectionState: gate?.connectionState ?? 'unavailable',
        unavailableReason: gate ? gate.unavailableReason : inspected.reason,
        baseUrlMissing,
      }
    }
    const grant = inspected.grant
    return {
      status: grant.status,
      connectionState: gate?.connectionState ?? grant.status,
      unavailableReason: gate?.unavailableReason ?? null,
      baseUrlMissing,
      expiresAt: grant.expiresAt,
      refreshedAt: grant.refreshedAt,
      obtainedAt: grant.obtainedAt,
      revisedAt: grant.revisedAt,
      lastFailureClass: grant.lastFailureClass,
      lastFailureAt: grant.lastFailureAt,
      clientChanged: configuration.kind === 'configured' && configuration.value.clientId !== grant.clientId,
      missingScopes: missingGrantScopes(grant, configuration, descriptor),
      hasExternalAccount: hasKeys(grant.providerData),
      providerData: grant.providerData,
      previousProviderData: grant.previousProviderData,
    }
  }

  function tokensUnreadableError(owner: OAuthGrantOwner, cause: unknown): OAuthGrantError {
    const error = new OAuthGrantError('disconnect_tokens_unreadable', cause == null ? {} : { cause })
    reportGrantError(error, REPORT_CODES.platformUnavailable, owner)
    return error
  }

  function settleDisconnectError(error: unknown, owner: OAuthGrantOwner): unknown {
    if (isCredentialsEncryptionUnavailableError(error)) return tokensUnreadableError(owner, error)
    return settleGrantWriteError(error, owner)
  }

  async function disconnectUnderLock(txEm: EntityManager, input: DisconnectInput): Promise<DisconnectOutcome> {
    const rowId = oauthGrantRowId(input.owner.integrationId)
    let captured: OAuthGrantRecord | null = null
    if (input.pin) {
      const read = await readCredentialRowLayered(txEm, rowId, input.scope, { kms: input.pin, validate: parseOAuthGrantBlob })
      if (read.kind === 'none') return { kind: 'not_connected' }
      if (read.kind === 'ok') {
        const conflict = findRevisionConflict(read.value, input.owner, input.expectedRevisedAt)
        if (conflict) return { kind: 'conflict', error: conflict }
        captured = read.value
      } else if (!input.force) {
        return { kind: 'unreadable' }
      }
    }
    if (!(await eraseIntegrationCredentials(txEm, rowId, input.scope))) return { kind: 'not_connected' }

    const disconnectId = randomUUID()
    const logService = createIntegrationLogService(txEm)
    await logService.write({
      integrationId: input.owner.integrationId,
      level: 'info',
      message: 'OAuth grant disconnected',
      code: LOG_CODES.disconnected,
      payload: { disconnectId, actorUserId: input.actorUserId },
    }, input.scope)
    await logService.write({
      integrationId: input.owner.integrationId,
      level: 'warn',
      message: 'OAuth grant revocation at the provider is pending',
      code: LOG_CODES.revocationPending,
      payload: { disconnectId },
    }, input.scope)
    return { kind: 'erased', disconnectId, captured }
  }

  async function reconnectedSinceDisconnect(owner: OAuthGrantOwner): Promise<boolean> {
    return hasLiveGrantRow(deps.em.fork(DETACHED_FORK_OPTIONS), owner)
  }

  async function disconnectCommitted(owner: OAuthGrantOwner, disconnectId: string): Promise<boolean> {
    try {
      const [entry] = await findLatestIntegrationLogsByCodes(
        deps.em.fork(DETACHED_FORK_OPTIONS),
        owner.integrationId,
        [LOG_CODES.disconnected],
        grantScope(owner),
        { disconnectId },
      )
      return entry !== undefined
    } catch (error) {
      reportGrantError(error, REPORT_CODES.writeTransient, owner)
      return false
    }
  }

  async function revokeStoredToken(revocationEndpoint: string, input: DisconnectCleanup, captured: OAuthGrantRecord, pin: TenantDekPin): Promise<string | null> {
    const client = await readClientConfiguration(deps.em.fork(DETACHED_FORK_OPTIONS), input.owner.integrationId, grantScope(input.owner), pin)
    if (client.kind !== 'configured') return clientUnavailableReason(client)
    const refreshToken = captured.refreshToken
    try {
      await tokenClient.revokeToken({
        url: revocationEndpoint,
        client: { clientId: client.value.clientId, clientSecret: client.value.clientSecret, authMethod: input.descriptor.clientAuthMethod },
        token: refreshToken ?? captured.accessToken,
        tokenTypeHint: refreshToken ? 'refresh_token' : 'access_token',
        timeoutMs: REVOKE_BUDGET_MS,
      })
      return null
    } catch (error) {
      if (error instanceof OAuthTokenEndpointError) return error.error ?? error.kind
      throw error
    }
  }

  async function resolveRevocation(input: DisconnectCleanup): Promise<RevocationResult> {
    const captured = input.captured
    if (captured === null || input.pin === null) return revocationFailure('undecryptable')
    if (captured.status === 'invalidated') return revocationOutcome('skipped_invalidated')
    const revocationEndpoint = input.descriptor.revocationEndpoint
    if (!revocationEndpoint) return revocationOutcome('unsupported')
    if (await reconnectedSinceDisconnect(input.owner)) return revocationOutcome('skipped_reconnected')
    const revokeFailure = await revokeStoredToken(revocationEndpoint, input, captured, input.pin)
    if (revokeFailure !== null) return revocationFailure(revokeFailure)
    return revocationOutcome('confirmed')
  }

  async function cleanUpAfterDisconnect(input: DisconnectCleanup): Promise<RevocationResult> {
    let result: RevocationResult
    try {
      result = await resolveRevocation(input)
    } catch (error) {
      reportGrantError(error, REPORT_CODES.revocationFailed, input.owner)
      result = revocationFailure('cleanup_failed')
    }
    const entry = REVOCATION_OUTCOME_ENTRIES[result.revocation]
    await writeDetachedLog({
      integrationId: input.owner.integrationId,
      level: entry.level,
      message: entry.message,
      code: entry.code,
      payload: result.revocation === 'failed'
        ? { disconnectId: input.disconnectId, failureReason: result.failureReason }
        : { disconnectId: input.disconnectId },
    }, input.owner)
    return result
  }

  return {
    async getAccessToken(descriptor, owner, options) {
      const callStart = now()
      const resolved = resolveOAuthProviderDescriptor(descriptor, owner)
      const tokenOptions = parseInput(accessTokenOptionsSchema, options ?? {}, 'options')

      const pin = pinTenantDek(deps.kms ?? createKmsService())
      const pinned = await pin.resolve(owner.tenantId)
      if (pinned.status === 'unavailable') {
        const error = new OAuthGrantError('platform_unavailable', pinned.error == null ? {} : { cause: pinned.error })
        reportGrantError(error, REPORT_CODES.platformUnavailable, owner)
        throw error
      }

      const call: TokenCall = {
        descriptor: resolved,
        owner,
        scope: grantScope(owner),
        pin,
        callStart,
        minValidityMs: tokenOptions.minValidityMs ?? null,
        rejectedAccessToken: tokenOptions.rejectedAccessToken ?? null,
        forceRefresh: tokenOptions.forceRefresh === true,
        lastRead: null,
        pendingWrite: null,
        afterCommit: [],
      }

      let evaluation: GrantEvaluation
      try {
        evaluation = await evaluateGrant(deps.em.fork(DETACHED_FORK_OPTIONS), call)
      } catch (error) {
        return settleTokenError(error, call)
      }
      if (evaluation.kind === 'settled') return settleTokenOutcome(evaluation.outcome, owner)

      let outcome: TokenOutcome
      try {
        outcome = await withAdvisoryXactLock(deps.em, oauthGrantLockKey(owner), (txEm) => refreshUnderLock(txEm, call), {
          waitDeadlineMs: GRANT_WRITE_WAIT_DEADLINE_MS,
          maxConcurrentHolders: GRANT_LOCK_MAX_CONCURRENT_HOLDERS,
          onWait: () => awaitConcurrentRefresh(call),
        })
      } catch (error) {
        if (isCommitOutcomeUnknown(error) && call.pendingWrite !== null) return resolveUnknownCommit(call, call.pendingWrite)
        return settleTokenError(error, call)
      }
      await runAfterCommit(call.afterCommit, owner)
      return settleTokenOutcome(outcome, owner)
    },

    async completeConnect(descriptor, owner, tokenResponse, options) {
      const resolved = resolveOAuthProviderDescriptor(descriptor, owner)
      const connectOptions = parseInput(connectOptionsSchema, options, 'options')
      const tokens = parseInput(tokenResponseSchema, tokenResponse, 'tokenResponse')
      const scope = grantScope(owner)

      const pin = pinTenantDek(deps.kms ?? createKmsService())
      const pinned = await pin.resolve(owner.tenantId)
      if (pinned.status === 'unavailable') throw await failConnectPersist(owner, 'no_dek', pinned.error)

      const afterCommit: AfterCommitCallback[] = []
      const input: ConnectInput = {
        descriptor: resolved,
        owner,
        scope,
        tokenResponse: tokens,
        clientId: connectOptions.clientId,
        requestedScopes: connectOptions.requestedScopes ? [...connectOptions.requestedScopes] : null,
        replaceUnreadable: connectOptions.replaceUnreadable === true,
        actorUserId: connectOptions.actorUserId ?? null,
        pin,
        afterCommit,
      }

      let outcome: ConnectOutcome
      try {
        outcome = await withAdvisoryXactLock(deps.em, oauthGrantLockKey(owner), (txEm) => connectUnderLock(txEm, input), {
          waitDeadlineMs: GRANT_WRITE_WAIT_DEADLINE_MS,
          maxConcurrentHolders: GRANT_LOCK_MAX_CONCURRENT_HOLDERS,
        })
      } catch (error) {
        const failure = classifyConnectPersistFailure(error)
        if (failure === null) throw error
        throw await failConnectPersist(owner, failure, error)
      }

      await runAfterCommit(afterCommit, owner)
      if (outcome.kind === 'connected') return outcome.result
      if (outcome.kind === 'rejected') throw new OAuthGrantError(outcome.code)
      throw await failConnectPersist(owner, outcome.failure, null)
    },

    async updateProviderData(descriptor, owner, data, options) {
      resolveOAuthProviderDescriptor(descriptor, owner)
      const providerData = parseInput(providerDataSchema, data, 'data')
      const writeOptions = parseInput(providerDataOptionsSchema, options, 'options')

      const pin = pinTenantDek(deps.kms ?? createKmsService())
      const pinned = await pin.resolve(owner.tenantId)
      if (pinned.status === 'unavailable') throw platformUnavailableError(owner, pinned.error)

      const afterCommit: AfterCommitCallback[] = []
      const input: ProviderDataInput = {
        owner,
        scope: grantScope(owner),
        data: providerData,
        expectedRevisedAt: writeOptions.expectedRevisedAt,
        actorUserId: writeOptions.actorUserId ?? null,
        pin,
        afterCommit,
      }

      let outcome: ProviderDataOutcome
      try {
        outcome = await withAdvisoryXactLock(deps.em, oauthGrantLockKey(owner), (txEm) => updateProviderDataUnderLock(txEm, input), {
          waitDeadlineMs: GRANT_WRITE_WAIT_DEADLINE_MS,
          maxConcurrentHolders: GRANT_LOCK_MAX_CONCURRENT_HOLDERS,
        })
      } catch (error) {
        throw settleGrantWriteError(error, owner)
      }

      await runAfterCommit(afterCommit, owner)
      if (outcome.kind === 'updated') return { revisedAt: outcome.revisedAt }
      if (outcome.kind === 'conflict') throw outcome.error
      if (outcome.code === 'platform_unavailable') throw platformUnavailableError(owner, null)
      throw new OAuthGrantError('not_connected')
    },

    async inspectGrant(descriptor, owner) {
      const resolved = resolveOAuthProviderDescriptor(descriptor, owner)
      return inspect(deps.em.fork(DETACHED_FORK_OPTIONS), resolved, owner)
    },

    async readGrantStatus(integrationId, scope) {
      const owner: OAuthGrantOwner = { integrationId, tenantId: scope.tenantId, organizationId: scope.organizationId }
      const strictScope = grantScope(owner)
      const rowId = oauthGrantRowId(integrationId)
      try {
        const em = deps.em.fork(DETACHED_FORK_OPTIONS)
        if (!(await hasLiveGrantRow(em, owner))) return null
        const pin = pinTenantDek(deps.kms ?? createKmsService())
        const pinned = await pin.resolve(scope.tenantId)
        if (pinned.status === 'unavailable') {
          reportInspectPinFailure(pinned, owner)
          return 'unavailable'
        }
        const read = await readCredentialRowLayered(em, rowId, strictScope, { kms: pin, validate: parseOAuthGrantBlob })
        if (read.kind === 'none') return null
        return read.kind === 'ok' ? read.value.status : 'unavailable'
      } catch (error) {
        reportGrantError(error, REPORT_CODES.inspectFailed, owner)
        return 'unavailable'
      }
    },

    async disconnect(descriptor, owner, options) {
      const resolved = resolveOAuthProviderDescriptor(descriptor, owner)
      const disconnectOptions = parseInput(disconnectOptionsSchema, options, 'options')
      const force = disconnectOptions.force === true

      const pin = pinTenantDek(deps.kms ?? createKmsService())
      const pinned = await pin.resolve(owner.tenantId)
      if (pinned.status === 'unavailable' && !force) throw tokensUnreadableError(owner, pinned.error)

      const input: DisconnectInput = {
        owner,
        scope: grantScope(owner),
        expectedRevisedAt: disconnectOptions.expectedRevisedAt,
        force,
        actorUserId: disconnectOptions.actorUserId ?? null,
        pin: pinned.status === 'unavailable' ? null : pin,
      }

      const attempt: { erased: ErasedDisconnect | null } = { erased: null }
      let outcome: DisconnectOutcome
      try {
        outcome = await withAdvisoryXactLock(deps.em, oauthGrantLockKey(owner), async (txEm) => {
          const result = await disconnectUnderLock(txEm, input)
          attempt.erased = result.kind === 'erased' ? result : null
          return result
        }, {
          waitDeadlineMs: DISCONNECT_WAIT_DEADLINE_MS,
          maxConcurrentHolders: GRANT_LOCK_MAX_CONCURRENT_HOLDERS,
        })
      } catch (error) {
        const erased = attempt.erased
        if (erased === null || !isCommitOutcomeUnknown(error) || !(await disconnectCommitted(owner, erased.disconnectId))) {
          throw settleDisconnectError(error, owner)
        }
        outcome = erased
      }

      if (outcome.kind === 'not_connected') return { erased: false, reason: 'not_connected' }
      if (outcome.kind === 'conflict') throw outcome.error
      if (outcome.kind === 'unreadable') throw tokensUnreadableError(owner, null)

      const { revocation, failureReason } = await cleanUpAfterDisconnect({
        descriptor: resolved,
        owner,
        pin: input.pin,
        disconnectId: outcome.disconnectId,
        captured: outcome.captured,
      })
      return { erased: true, disconnectId: outcome.disconnectId, revocation, failureReason }
    },
  }
}
