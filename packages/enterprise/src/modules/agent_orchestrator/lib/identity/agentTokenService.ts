import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { signAudienceJwt, verifyAudienceJwt } from '@open-mercato/shared/lib/auth/jwt'
import { ApiKey } from '@open-mercato/core/modules/api_keys/data/entities'
import {
  createApiKey,
  verifyApiKey,
} from '@open-mercato/core/modules/api_keys/services/apiKeyService'
import { AgentDelegationGrant, AgentPrincipal } from '../../data/entities'
import {
  agentTokenClaimsSchema,
  type AgentTokenClaims,
} from '../../data/validators'
import { isGrantActive } from './agentDelegationGrantService'

/**
 * External agent OAuth client-credentials token server (agent identity &
 * on-behalf-of, Wave 4 Phase 3, Part A). Built on the sanctioned primitives —
 * `signAudienceJwt`/`verifyAudienceJwt` for the audience-isolated JWT layer and
 * the `api_keys` module (`createApiKey` + bcrypt `verifyApiKey`) for client-secret
 * storage and constant-time verification. No JWT/crypto/credential hashing is
 * hand-rolled here.
 *
 * The audience is `'agent'`, so the derived signing key isolates an agent token
 * from staff/customer sessions — an agent JWT can never be replayed as either.
 */
export const AGENT_TOKEN_AUDIENCE = 'agent'
export const AGENT_TOKEN_ISSUER = 'open-mercato'

/** Default agent token TTL — minutes, deliberately short so revocation is felt fast. */
const DEFAULT_AGENT_TOKEN_TTL_SECONDS = 5 * 60

/** The `api_keys.name` marker that scopes a row to an external agent principal's client secret. */
function clientSecretKeyName(agentPrincipalId: string): string {
  return `__agent_oauth_client__${agentPrincipalId}__`
}

export type TokenScope = { tenantId: string; organizationId: string }

export type IssueAgentTokenResult = {
  accessToken: string
  expiresInSeconds: number
  scope: string
  grantId: string
}

/**
 * Provision a client secret for an external agent principal. Stores it bcrypt-
 * hashed in an `api_keys` row scoped to the principal (`createdBy = agentUserId`,
 * `name` markered with the principal id) so the secret is never persisted in the
 * clear and verification reuses the hardened `api_keys` bcrypt compare. Returns
 * the `client_id` (the principal id) + the plaintext `client_secret` ONCE.
 */
export async function provisionAgentClientSecret(
  container: AwilixContainer,
  scope: TokenScope,
  agentPrincipalId: string,
): Promise<{ clientId: string; clientSecret: string }> {
  const em = (container.resolve('em') as EntityManager).fork()
  const principal = await em.findOne(AgentPrincipal, {
    id: agentPrincipalId,
    organizationId: scope.organizationId,
    deletedAt: null,
  })
  if (!principal) throw new Error('[internal] agent principal not found for client-secret provisioning')

  const { secret } = await createApiKey(em, {
    name: clientSecretKeyName(principal.id),
    description: 'External agent OAuth client secret',
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    createdBy: principal.userId,
  })
  return { clientId: principal.id, clientSecret: secret }
}

/**
 * Verify a presented `client_id` + `client_secret` against an external agent
 * principal's stored (bcrypt-hashed) `api_keys` secret. The `client_id` is the
 * `AgentPrincipal.id` (a globally-unique PK that is itself pinned to exactly one
 * org), so org scope is derived FROM the resolved principal — a client can never
 * pass or widen the org. A secret minted for org B's principal resolves only org
 * B's principal, so it can never mint an org A token. Returns the resolved
 * principal, or null on ANY failure (unknown client, wrong secret, not an
 * oauth_client principal, disabled). The caller maps null → a single 401 with no
 * info leak (never reveals whether the client id exists). bcrypt compare runs per
 * candidate via the hardened `api_keys` verification.
 */
async function verifyClientCredentials(
  em: EntityManager,
  clientId: string,
  clientSecret: string,
): Promise<AgentPrincipal | null> {
  const principal = await em.findOne(AgentPrincipal, {
    id: clientId,
    credentialMode: 'oauth_client',
    enabled: true,
    deletedAt: null,
  })
  if (!principal) return null

  // Candidate client-secret rows for this principal (live, non-expired), scoped to
  // the principal's own agent user + org. bcrypt compare each until one matches.
  const candidates = await em.find(ApiKey, {
    name: clientSecretKeyName(principal.id),
    createdBy: principal.userId,
    organizationId: principal.organizationId,
    deletedAt: null,
  })
  const now = Date.now()
  for (const candidate of candidates) {
    if (candidate.expiresAt && candidate.expiresAt.getTime() < now) continue
    if (await verifyApiKey(clientSecret, candidate.keyHash)) return principal
  }
  return null
}

/**
 * Intersect the client-requested scope (optional, space-delimited) with the
 * grant's authorized scopes. The result NEVER widens beyond the grant — an
 * unrequested-or-unauthorized capability is dropped. With no requested scope the
 * full granted scope set is used.
 */
function narrowScope(grantedScopes: string[], requested: string | undefined): string {
  const granted = new Set(grantedScopes)
  if (!requested || !requested.trim()) {
    return Array.from(granted).join(' ')
  }
  const requestedSet = requested.trim().split(/\s+/)
  const narrowed = requestedSet.filter((s) => granted.has(s))
  return narrowed.join(' ')
}

/**
 * The OAuth client-credentials token mint. Verifies the client credentials for an
 * external agent principal with an ACTIVE (non-revoked, non-expired)
 * `AgentDelegationGrant`, then mints a short-lived, scoped, revocable
 * audience-bound JWT via `signAudienceJwt('agent', …)`. Scope + tenant + org are
 * SERVER-DERIVED from the resolved principal + grant — client input never widens
 * them, and the org is taken from the principal row (never from the request), so
 * a client authenticated against org B can never mint a token scoped to org A.
 *
 * Returns null on ANY credential/grant failure so the route emits a single 401
 * with no information leak.
 */
export async function issueAgentToken(
  container: AwilixContainer,
  args: { clientId: string; clientSecret: string; requestedScope?: string },
): Promise<IssueAgentTokenResult | null> {
  const em = (container.resolve('em') as EntityManager).fork()

  const principal = await verifyClientCredentials(em, args.clientId, args.clientSecret)
  if (!principal) return null

  // The grant is the authorization spine. Mint only against a LIVE, ACTIVE grant
  // for this principal in ITS OWN org (most recently created wins).
  const grant = await em.findOne(
    AgentDelegationGrant,
    {
      agentPrincipalId: principal.id,
      organizationId: principal.organizationId,
      deletedAt: null,
    },
    { orderBy: { createdAt: 'DESC' } },
  )
  if (!grant || !isGrantActive(grant)) return null

  const scopeString = narrowScope(grant.scopes, args.requestedScope)

  // TTL never outlives the grant's hard expiry.
  let ttlSeconds = DEFAULT_AGENT_TOKEN_TTL_SECONDS
  if (grant.expiresAt) {
    const remaining = Math.floor((grant.expiresAt.getTime() - Date.now()) / 1000)
    if (remaining <= 0) return null
    ttlSeconds = Math.min(ttlSeconds, remaining)
  }

  const claims: AgentTokenClaims = {
    iss: AGENT_TOKEN_ISSUER,
    aud: AGENT_TOKEN_AUDIENCE,
    sub: principal.userId,
    obo: grant.delegatorUserId ?? null,
    tenantId: principal.tenantId,
    organizationId: principal.organizationId,
    scope: scopeString,
    grantId: grant.id,
  }

  const accessToken = signAudienceJwt(AGENT_TOKEN_AUDIENCE, claims, ttlSeconds)
  return { accessToken, expiresInSeconds: ttlSeconds, scope: scopeString, grantId: grant.id }
}

export type VerifiedAgentToken = {
  claims: AgentTokenClaims
  actorUserId: string
  onBehalfOfUserId: string | null
  scopes: string[]
}

/**
 * Verify an agent Bearer token and enforce immediate revocation. Two layers:
 *   1. STATELESS audience-bound signature/expiry check (`verifyAudienceJwt`) —
 *      rejects tampered, expired, or wrong-audience tokens (a staff JWT cannot
 *      verify here, and vice versa).
 *   2. STATEFUL per-request grant check — re-loads the `AgentDelegationGrant` by
 *      the signed `grantId` and denies when it is revoked or expired. This is what
 *      makes revocation immediate: a token minted before revoke is denied on its
 *      NEXT request, regardless of its remaining TTL.
 *
 * Returns null on ANY failure (bad signature, claim-shape mismatch, cross-org
 * grant, revoked/expired grant) so the caller emits a single minimal 401.
 */
export async function verifyAgentToken(
  container: AwilixContainer,
  token: string,
): Promise<VerifiedAgentToken | null> {
  const raw = verifyAudienceJwt(AGENT_TOKEN_AUDIENCE, token)
  if (!raw) return null

  const parsed = agentTokenClaimsSchema.safeParse(raw)
  if (!parsed.success) return null
  const claims = parsed.data

  const em = (container.resolve('em') as EntityManager).fork()
  const grant = await em.findOne(AgentDelegationGrant, {
    id: claims.grantId,
    organizationId: claims.organizationId,
    deletedAt: null,
  })
  if (!grant || !isGrantActive(grant)) return null

  return {
    claims,
    actorUserId: claims.sub,
    onBehalfOfUserId: claims.obo,
    scopes: claims.scope ? claims.scope.split(/\s+/).filter(Boolean) : [],
  }
}
