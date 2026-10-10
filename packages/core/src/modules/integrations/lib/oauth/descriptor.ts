import { z } from 'zod'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import type { OAuthClientAuthMethod } from './token-endpoint'

/** Phase 1 grants are per organization: `userId` is always absent or `null`. */
export type OAuthGrantOwner = { integrationId: string; tenantId: string; organizationId: string; userId?: null }

export type OAuthTokenSet = {
  accessToken: string
  refreshToken: string | null
  expiresAt: Date
  tokenType: 'Bearer'
  grantedScopes: string[]
}

export type OAuthDisconnectHookContext = {
  tokens: OAuthTokenSet
  providerData: Record<string, unknown> | null
  /** One refresh with the captured refresh token, under `signal`; never persisted. */
  refresh(): Promise<OAuthTokenSet>
  signal: AbortSignal
}

/** Code-level contract of one OAuth provider; values are provider-owned code constants. */
export type OAuthProviderDescriptor = {
  integrationId: string
  authorizationEndpoint: string
  tokenEndpoint: string
  /** RFC 7009; absent means revocation is unsupported. */
  revocationEndpoint?: string
  /** Default `'client_secret_basic'`. */
  clientAuthMethod?: OAuthClientAuthMethod
  /** Default `'S256'`; `'none'` only for a provider that rejects PKCE. */
  pkce?: 'S256' | 'none'
  defaultScopes: readonly string[]
  /** Appended to the authorization URL; never overrides the protocol parameters. Default `{}`. */
  extraAuthorizeParams?: Readonly<Record<string, string>>
  /** Checked at Connect only. Default `true`. */
  requiresRefreshToken?: boolean
  /** Access-token lifetime when the token response has no `expires_in`. Default 3600. */
  defaultAccessTokenTtlSec?: number
  /** Default `minValidityMs` of the Token Provider. Default 120_000. */
  refreshSkewMs?: number
  /** Runs after the Disconnect released the lock, within an 8 s budget; MUST honour `ctx.signal`. */
  onAfterDisconnect?: (ctx: OAuthDisconnectHookContext) => Promise<void>
}

type ResolvedOAuthProviderDescriptor = Required<Omit<OAuthProviderDescriptor, 'revocationEndpoint' | 'onAfterDisconnect'>>
  & Pick<OAuthProviderDescriptor, 'revocationEndpoint' | 'onAfterDisconnect'>

/** All unions below are closed and additive-only: consumers MUST keep a default branch. */
export type OAuthTokenFailure = 'transient' | 'grant_invalidated' | 'client_misconfigured' | 'not_connected' | 'platform_unavailable'
export type OAuthConnectFailure =
  | 'connect_cancelled' | 'connect_state_invalid' | 'connect_exchange_failed' | 'connect_grant_unreadable'
  | 'connect_persist_failed' | 'client_misconfigured' | 'organization_scope_required' | 'oauth_base_url_not_configured'
  | 'connect_origin_rejected'
export type OAuthGrantWriteFailure = 'disconnect_tokens_unreadable'
export type OAuthFailureReason = 'grant_rejected' | 'no_refresh_token' | 'client_changed' | 'client_not_configured' | 'token_endpoint_rejected'
export type OAuthResourceChallengeOutcome = 'scope_insufficient'
export type OAuthInvalidatedReason = 'grant_rejected' | 'no_refresh_token'
export type OAuthLastFailureClass = 'transient' | 'client_misconfigured'
export type OAuthGrantReadStatus = 'active' | 'invalidated' | 'unavailable'
/** Only `'unreadable'` offers "Replace unreadable connection" (App Spec rule 10). */
export type OAuthUnavailableReason = 'unreadable' | 'platform'
export type OAuthConnectionState = 'not_configured' | 'not_connected' | 'unavailable' | 'invalidated' | 'active'
export type OAuthRevocationState = 'pending' | 'confirmed' | 'failed' | 'unsupported' | 'skipped'
export type OAuthRevocationOutcome = 'confirmed' | 'failed' | 'unsupported' | 'skipped_reconnected' | 'skipped_invalidated'

type OAuthGrantErrorCode = OAuthTokenFailure | OAuthConnectFailure | OAuthGrantWriteFailure

/**
 * A descriptor or Grant Owner that breaks the contract: a programming error, thrown before
 * any read, write or network call. `field` names the offending path; the message never
 * carries a value.
 */
export class OAuthDescriptorError extends TypeError {
  readonly field: string
  constructor(field: string) {
    super(`[internal] Invalid OAuth provider descriptor or grant owner at "${field}"`)
    this.name = 'OAuthDescriptorError'
    this.field = field
  }
}

/**
 * A Token Failure, Connect Failure or grant-write failure. Routes map `code`, `reason` and
 * `providerErrorCode` (RFC 6749 `error`), never the message.
 */
export class OAuthGrantError extends Error {
  readonly code: OAuthGrantErrorCode
  readonly reason: OAuthFailureReason | null
  readonly providerErrorCode: string | null
  constructor(
    code: OAuthGrantErrorCode,
    options: { reason?: OAuthFailureReason | null; providerErrorCode?: string | null; cause?: unknown } = {},
  ) {
    const reason = options.reason ?? null
    super(
      reason ? `[internal] OAuth grant operation failed: ${code} (${reason})` : `[internal] OAuth grant operation failed: ${code}`,
      options.cause === undefined ? undefined : { cause: options.cause },
    )
    this.name = 'OAuthGrantError'
    this.code = code
    this.reason = reason
    this.providerErrorCode = options.providerErrorCode ?? null
  }
}

const TEST_OAUTH_GRANTS_ENV = 'OM_ENABLE_TEST_OAUTH_GRANTS'
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]'])

function allowsLoopbackHttpEndpoints(): boolean {
  return process.env.NODE_ENV !== 'production' || parseBooleanWithDefault(process.env[TEST_OAUTH_GRANTS_ENV], false)
}

function isAllowedEndpoint(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.username || url.password || url.hash) return false
  if (url.protocol === 'https:') return true
  if (url.protocol !== 'http:') return false
  return LOOPBACK_HOSTNAMES.has(url.hostname) && allowsLoopbackHttpEndpoints()
}

const endpointSchema = z.string().refine(isAllowedEndpoint)
const positiveIntegerSchema = z.number().int().positive()

/**
 * Validates a descriptor without applying defaults. Endpoints are absolute `https:` URLs
 * without credentials or fragment, or `http:` on a loopback host only when
 * `NODE_ENV !== 'production'` or `OM_ENABLE_TEST_OAUTH_GRANTS` is on (read at parse time);
 * unknown keys are rejected.
 */
export const oauthProviderDescriptorSchema: z.ZodType<OAuthProviderDescriptor> = z.strictObject({
  integrationId: z.string().min(1),
  authorizationEndpoint: endpointSchema,
  tokenEndpoint: endpointSchema,
  revocationEndpoint: endpointSchema.optional(),
  clientAuthMethod: z.enum(['client_secret_basic', 'client_secret_post']).optional(),
  pkce: z.enum(['S256', 'none']).optional(),
  defaultScopes: z.array(z.string().regex(/^\S+$/)).min(1),
  extraAuthorizeParams: z.record(z.string().min(1), z.string()).optional(),
  requiresRefreshToken: z.boolean().optional(),
  defaultAccessTokenTtlSec: positiveIntegerSchema.optional(),
  refreshSkewMs: positiveIntegerSchema.optional(),
  onAfterDisconnect: z
    .custom<(ctx: OAuthDisconnectHookContext) => Promise<void>>((value) => typeof value === 'function')
    .optional(),
})

const grantOwnerSchema = z.object({
  integrationId: z.string().min(1),
  tenantId: z.string().min(1),
  organizationId: z.string().min(1),
  userId: z.null().optional(),
})

function issueField(issue: z.ZodError['issues'][number] | undefined, prefix: string | null): string {
  const path = issue ? issue.path.map((segment) => String(segment)) : []
  if (issue?.code === 'unrecognized_keys' && issue.keys.length > 0) path.push(issue.keys[0])
  if (path.length === 0) return prefix ?? 'descriptor'
  return prefix ? `${prefix}.${path.join('.')}` : path.join('.')
}

/** Validates the whole descriptor, applies defaults and, when given, checks the owner. */
export function resolveOAuthProviderDescriptor(descriptor: unknown, owner?: OAuthGrantOwner): ResolvedOAuthProviderDescriptor {
  const parsed = oauthProviderDescriptorSchema.safeParse(descriptor)
  if (!parsed.success) throw new OAuthDescriptorError(issueField(parsed.error.issues[0], null))
  const value = parsed.data
  if (owner !== undefined) {
    const parsedOwner = grantOwnerSchema.safeParse(owner)
    if (!parsedOwner.success) throw new OAuthDescriptorError(issueField(parsedOwner.error.issues[0], 'owner'))
    if (parsedOwner.data.integrationId !== value.integrationId) throw new OAuthDescriptorError('integrationId')
  }
  return {
    integrationId: value.integrationId,
    authorizationEndpoint: value.authorizationEndpoint,
    tokenEndpoint: value.tokenEndpoint,
    revocationEndpoint: value.revocationEndpoint,
    clientAuthMethod: value.clientAuthMethod ?? 'client_secret_basic',
    pkce: value.pkce ?? 'S256',
    defaultScopes: [...value.defaultScopes],
    extraAuthorizeParams: { ...(value.extraAuthorizeParams ?? {}) },
    requiresRefreshToken: value.requiresRefreshToken ?? true,
    defaultAccessTokenTtlSec: value.defaultAccessTokenTtlSec ?? 3600,
    refreshSkewMs: value.refreshSkewMs ?? 120_000,
    onAfterDisconnect: value.onAfterDisconnect,
  }
}
