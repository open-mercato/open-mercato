import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { verifyJwt } from '@open-mercato/shared/lib/auth/jwt'
import { AgentDelegationGrant, AgentPrincipal } from '../../data/entities'
import {
  idJagAssertionClaimsSchema,
  type AgentAuthDiscovery,
  type IdJagAssertionClaims,
  ID_JAG_GRANT_TYPE,
} from '../../data/validators'
import {
  AGENT_TOKEN_AUDIENCE,
  AGENT_TOKEN_ISSUER,
  type IssueAgentTokenResult,
  mintAgentTokenForGrant,
} from './agentTokenService'
import { provisionAgentPrincipal } from './agentPrincipalService'
import { isGrantActive } from './agentDelegationGrantService'

/**
 * auth.md / ID-JAG self-registration (agent identity & on-behalf-of, Wave 4
 * Phase 4). Lets an EXTERNAL agent onboard itself at scale by presenting an
 * issuer-signed identity assertion (ID-JAG / RFC 7523 JWT-bearer) instead of a
 * pre-provisioned client secret: the platform validates the issuer + audience +
 * signature, maps the assertion to a scoped `AgentPrincipal` (`credentialMode=
 * 'authmd'`) + an `AgentDelegationGrant` (populating the `issuer`/`subject`/
 * `audience` seam columns), then mints a scoped, revocable token via the SAME
 * `mintAgentTokenForGrant` core the OAuth-now `/token` server uses. This is an
 * additional credential PATH, not a parallel token system — the no-bypass +
 * propose-only invariants and per-request revocation hold identically.
 *
 * Crypto reuse: the assertion is verified with the shared `verifyJwt` HS256
 * primitive against a per-issuer signing secret from the server-side trusted-issuer
 * registry (env-configured). No JWT/crypto is hand-rolled here, and no issuer key
 * material is ever exposed to the client.
 */

/** The audience an external ID-JAG assertion MUST target to be accepted. */
export const AGENT_ASSERTION_AUDIENCE =
  process.env.AGENT_ID_JAG_AUDIENCE?.trim() || 'open-mercato:agent-auth'

const TOKEN_ENDPOINT_PATH = '/api/agent_orchestrator/identity/token'
const AGENT_AUTH_ENDPOINT_PATH = '/api/agent_orchestrator/identity/agent/auth'

/**
 * A trusted external issuer the platform accepts ID-JAG assertions from. Resolved
 * from server-side config only (`AGENT_ID_JAG_ISSUERS` JSON env) — never from
 * client input. `allowedOrganizationIds` (optional) pins which orgs the issuer may
 * provision agents into; an empty/absent list means the issuer is not org-pinned
 * and the assertion's `org_id` is trusted as-is (still tenant-isolated downstream).
 */
export type TrustedAgentIssuer = {
  issuer: string
  secret: string
  allowedOrganizationIds?: string[]
}

/**
 * Parse the trusted-issuer registry from `AGENT_ID_JAG_ISSUERS` (a JSON array of
 * `{ issuer, secret, allowedOrganizationIds? }`). Returns an empty map when unset
 * or malformed so the endpoint fails CLOSED (every assertion is rejected) rather
 * than trusting an unconfigured issuer. Never logs the secrets.
 */
function loadTrustedIssuers(): Map<string, TrustedAgentIssuer> {
  const raw = process.env.AGENT_ID_JAG_ISSUERS
  const registry = new Map<string, TrustedAgentIssuer>()
  if (!raw || !raw.trim()) return registry
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return registry
  }
  if (!Array.isArray(parsed)) return registry
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue
    const candidate = entry as Record<string, unknown>
    const issuer = typeof candidate.issuer === 'string' ? candidate.issuer.trim() : ''
    const secret = typeof candidate.secret === 'string' ? candidate.secret : ''
    if (!issuer || !secret) continue
    const allowedOrganizationIds = Array.isArray(candidate.allowedOrganizationIds)
      ? candidate.allowedOrganizationIds.filter((value): value is string => typeof value === 'string')
      : undefined
    registry.set(issuer, { issuer, secret, allowedOrganizationIds })
  }
  return registry
}

/**
 * The public discovery metadata advertised at `/.well-known`. Read-only and
 * secret-free: it advertises the token + agent-auth endpoints, the supported grant
 * types (client-credentials now + the ID-JAG / JWT-bearer flow), and the audience
 * an external assertion must target. No issuer keys / JWKS are exposed.
 */
export function getAgentAuthDiscovery(): AgentAuthDiscovery {
  return {
    issuer: AGENT_TOKEN_ISSUER,
    token_endpoint: TOKEN_ENDPOINT_PATH,
    agent_auth_endpoint: AGENT_AUTH_ENDPOINT_PATH,
    grant_types_supported: ['client_credentials', ID_JAG_GRANT_TYPE],
    agent_assertion_audience: AGENT_ASSERTION_AUDIENCE,
    token_audience: AGENT_TOKEN_AUDIENCE,
    token_endpoint_auth_methods_supported: ['client_secret_post', 'private_key_jwt'],
  }
}

/**
 * Verify an issuer-signed ID-JAG assertion. Two server-side gates, neither of
 * which trusts client input:
 *   1. The `iss` claim selects the trusted-issuer verification secret from the
 *      registry (env). An unknown issuer → reject (no info leak).
 *   2. `verifyJwt(assertion, { issuer, audience })` checks the HS256 signature,
 *      expiry, AND that `aud` equals the platform's assertion audience — so a
 *      forged/tampered assertion or a wrong-audience assertion is rejected.
 * Returns the parsed claims, or null on ANY failure so the caller emits a single
 * minimal 401 with no info leak. Never logs the raw assertion.
 */
export function verifyIdJagAssertion(assertion: string): IdJagAssertionClaims | null {
  // The `iss` is read from the UNVERIFIED payload only to SELECT a candidate
  // verification key; the signature is then checked against that key, so a forged
  // `iss` selects a key whose signature will not match → rejected below.
  const issuers = loadTrustedIssuers()
  if (issuers.size === 0) return null

  let unverifiedIssuer: string | null = null
  const parts = assertion.split('.')
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8')) as { iss?: unknown }
      if (typeof payload.iss === 'string') unverifiedIssuer = payload.iss
    } catch {
      return null
    }
  }
  if (!unverifiedIssuer) return null

  const trusted = issuers.get(unverifiedIssuer)
  if (!trusted) return null

  const verified = verifyJwt(assertion, {
    secret: trusted.secret,
    issuer: trusted.issuer,
    audience: AGENT_ASSERTION_AUDIENCE,
  })
  if (!verified) return null

  const parsed = idJagAssertionClaimsSchema.safeParse(verified)
  if (!parsed.success) return null

  // The issuer may be pinned to a fixed set of organizations it can provision into.
  if (trusted.allowedOrganizationIds && trusted.allowedOrganizationIds.length > 0) {
    if (!trusted.allowedOrganizationIds.includes(parsed.data.org_id)) return null
  }

  return parsed.data
}

function resolveEm(container: AwilixContainer): EntityManager {
  return (container.resolve('em') as EntityManager).fork()
}

export type RegisterViaIdJagResult = {
  principal: AgentPrincipal
  grant: AgentDelegationGrant
  token: IssueAgentTokenResult
}

/**
 * Onboard (idempotently) an external agent from a VALIDATED ID-JAG assertion and
 * mint a scoped token. Steps:
 *   1. Provision the `AgentPrincipal` (`credentialMode='authmd'`) via the existing
 *      `provisionAgentPrincipal` service — idempotent on `(org, agentDefinitionId)`,
 *      so re-presenting the same issuer+subject resolves the SAME principal (no
 *      duplicate `User`/`Role`/principal rows). Tenant/org come from the SIGNED
 *      assertion, never request input.
 *   2. Find-or-create the `AgentDelegationGrant` keyed on (org, principal, issuer,
 *      subject) over LIVE rows — re-registration resolves the existing active grant
 *      rather than stacking duplicates. The grant carries the `issuer`/`subject`/
 *      `audience` seam columns, bridging the OAuth-now and ID-JAG paths in one row.
 *   3. Mint via the SHARED `mintAgentTokenForGrant` core (same token system, same
 *      per-request revocation, same no-bypass invariant).
 *
 * Returns null when the grant cannot be minted against (e.g. resolved an inactive
 * grant), so the caller emits a single minimal 401.
 */
export async function registerAgentViaIdJag(
  container: AwilixContainer,
  claims: IdJagAssertionClaims,
  requestedScope?: string,
): Promise<RegisterViaIdJagResult | null> {
  const scope = { tenantId: claims.tenant_id, organizationId: claims.org_id }
  const grantScopes = claims.scopes && claims.scopes.length > 0 ? claims.scopes : []

  const resolved = await provisionAgentPrincipal(container, scope, {
    agentDefinitionId: claims.agent_definition_id,
    displayName: claims.display_name,
    // Least-privilege: the agent's scoped role grants exactly the assertion's scopes
    // (deduped). An assertion with no scopes provisions a no-feature role.
    roleFeatures: Array.from(new Set(grantScopes)),
    credentialMode: 'authmd',
  })
  const principal = resolved.principal

  const em = resolveEm(container)

  // Find-or-create the grant keyed on the ID-JAG identity (issuer+subject) within
  // the principal's org over LIVE rows — idempotent re-registration.
  let grant = await em.findOne(AgentDelegationGrant, {
    organizationId: scope.organizationId,
    agentPrincipalId: principal.id,
    issuer: claims.iss,
    subject: claims.sub,
    deletedAt: null,
  })

  if (!grant || !isGrantActive(grant)) {
    if (!grant) {
      grant = em.create(AgentDelegationGrant, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        agentPrincipalId: principal.id,
        agentUserId: principal.userId,
        delegatorUserId: claims.delegator_user_id ?? null,
        scopes: grantScopes,
        issuer: claims.iss,
        subject: claims.sub,
        audience: claims.aud,
        expiresAt: null,
        revokedAt: null,
        revokedByUserId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      em.persist(grant)
      await em.flush()
    } else {
      // An existing grant that is revoked/expired must NOT be silently re-activated
      // — revocation is durable. Re-onboarding does not resurrect a revoked grant.
      return null
    }
  }

  const token = mintAgentTokenForGrant(principal, grant, requestedScope)
  if (!token) return null

  return { principal, grant, token }
}
