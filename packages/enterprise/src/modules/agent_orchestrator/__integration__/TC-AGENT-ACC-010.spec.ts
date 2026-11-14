import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteAgentRunsWithTraceByIds } from './helpers/agentPerfFixtures'
import {
  AGENT_RUN_FEATURE,
  GATED_AGENT_FEATURE,
  GATED_AGENT_ID,
  GATED_AGENT_INPUT,
  INVOKE_DENIED_CODE,
  agentApiRunPath,
} from './helpers/agentAccessFixtures'
import {
  AGENT_API_RUN_SCOPE,
  createExternalAgentClient,
  deleteExternalAgentClient,
  expireDelegationGrant,
  mintAgentToken,
  type ExternalAgentClient,
} from './helpers/agentIdentityFixtures'
import { isModelUnavailableResponse, NO_LLM_PROVIDER_SKIP_REASON } from './helpers/llmProvider'

/**
 * TC-AGENT-ACC-010: the agent-token door end to end — client credentials → token → run.
 * Source: spec .ai/specs/enterprise/agent-orchestrator/2026-10-21-agent-invocation-access-and-identity-binding.md
 * (§E; Integration: agent-token door — valid token, revoked grant, principal lacking the agent feature).
 *
 * ENVIRONMENT: `POST /api/agent_orchestrator/agent-api/agents/:id/run` exists only
 * when the APP process runs with `OM_AGENT_API_ENABLED=true` (start the ephemeral
 * app with it). Every test probes the route first and skips with an explicit
 * reason when it answers the disabled 404.
 *
 * An external (`oauth_client`) principal, its client secret and its delegation
 * grant have no public creation API, so `agentIdentityFixtures` builds them from
 * an API-created role/user/API key plus dbFixtures rows. Tokens are minted through
 * the public `POST /identity/token` client-credentials route.
 *
 * Covered without a model:
 *   - a forged token, a token whose grant has expired and a token whose grant was
 *     revoked through `POST /identity/grants/:id/revoke` each get the one minimal 401;
 *   - a token whose scope covers neither `agent_orchestrator.agents.run` nor
 *     `agent:<id>` gets 403 `agent_invoke_denied` from the route;
 *   - a token whose principal role lacks the agent's required feature gets 403
 *     `agent_invoke_denied` from the runtime invoke check.
 * Model-dependent: a valid token for a principal holding the feature passes the
 * door and the invoke check (never 401/403) in every environment; the 200 +
 * `runId` is asserted only when a model answers — without a usable provider the
 * route answers 503 and the test skips after the door assertions.
 *
 * Self-contained: every principal, grant, API key, role, user and run is removed in `finally`.
 */

type DoorBody = { error?: string; code?: string; agentId?: string; runId?: unknown }

const DISABLED_DOOR_SKIP_REASON =
  'the agent-token door is disabled in this app (start it with OM_AGENT_API_ENABLED=true)'
const TOKEN_RATE_LIMIT_SKIP_REASON = 'the per-IP token rate limit is exhausted in this environment'

async function postAgentApiRun(
  request: APIRequestContext,
  token: string | null,
  agentId: string = GATED_AGENT_ID,
) {
  return request.fetch(agentApiRunPath(agentId), {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
    },
    data: JSON.stringify({ input: GATED_AGENT_INPUT }),
  })
}

async function isDoorEnabled(request: APIRequestContext): Promise<boolean> {
  const probe = await postAgentApiRun(request, 'it-agent-acc-010.forged.token')
  return probe.status() !== 404
}

function adminScope(adminToken: string) {
  const { tenantId, organizationId } = getTokenScope(adminToken)
  return { tenantId, organizationId }
}

test.describe('TC-AGENT-ACC-010: agent-token door', () => {
  test('rejects a forged, an expired and a revoked-grant token with 401', async ({ request }) => {
    test.skip(!(await isDoorEnabled(request)), DISABLED_DOOR_SKIP_REASON)
    const adminToken = await getAuthToken(request, 'admin')
    let client: ExternalAgentClient | null = null
    let revoked: ExternalAgentClient | null = null
    try {
      const forged = await postAgentApiRun(request, 'it-agent-acc-010.not-a-real.agent-token')
      expect(forged.status()).toBe(401)
      expect(await readJsonSafe<DoorBody>(forged)).toEqual({ error: 'unauthorized' })

      client = await createExternalAgentClient(request, adminToken, adminScope(adminToken), {
        label: 'expired',
        roleFeatures: [GATED_AGENT_FEATURE, AGENT_RUN_FEATURE],
        scopes: [AGENT_API_RUN_SCOPE],
      })
      const minted = await mintAgentToken(request, client)
      test.skip(minted.status === 429, TOKEN_RATE_LIMIT_SKIP_REASON)
      expect(minted.status, 'client credentials mint a token').toBe(200)
      expect(minted.accessToken).toBeTruthy()

      await expireDelegationGrant(client.grantId)
      const expired = await postAgentApiRun(request, minted.accessToken)
      expect(expired.status(), 'a token whose grant expired is refused').toBe(401)
      expect(await readJsonSafe<DoorBody>(expired)).toEqual({ error: 'unauthorized' })

      revoked = await createExternalAgentClient(request, adminToken, adminScope(adminToken), {
        label: 'revoked',
        roleFeatures: [AGENT_RUN_FEATURE],
        scopes: [AGENT_API_RUN_SCOPE],
      })
      const revokedMint = await mintAgentToken(request, revoked)
      test.skip(revokedMint.status === 429, TOKEN_RATE_LIMIT_SKIP_REASON)
      expect(revokedMint.status).toBe(200)

      const revokeResponse = await apiRequest(
        request,
        'POST',
        `/api/agent_orchestrator/identity/grants/${encodeURIComponent(revoked.grantId)}/revoke`,
        { token: adminToken, data: {} },
      )
      expect(revokeResponse.status(), await revokeResponse.text()).toBe(200)

      const afterRevoke = await postAgentApiRun(request, revokedMint.accessToken)
      expect(afterRevoke.status(), 'the next call after revocation is refused').toBe(401)
      expect(await readJsonSafe<DoorBody>(afterRevoke)).toEqual({ error: 'unauthorized' })

      const remint = await mintAgentToken(request, revoked)
      test.skip(remint.status === 429, TOKEN_RATE_LIMIT_SKIP_REASON)
      expect(remint.status, 'a revoked grant mints no new token').toBe(401)
    } finally {
      await deleteExternalAgentClient(request, adminToken, client)
      await deleteExternalAgentClient(request, adminToken, revoked)
    }
  })

  test('answers 403 when the grant scope or the principal role does not cover the agent', async ({ request }) => {
    test.skip(!(await isDoorEnabled(request)), DISABLED_DOOR_SKIP_REASON)
    const adminToken = await getAuthToken(request, 'admin')
    let scoped: ExternalAgentClient | null = null
    let unprivileged: ExternalAgentClient | null = null
    try {
      scoped = await createExternalAgentClient(request, adminToken, adminScope(adminToken), {
        label: 'other-agent-scope',
        roleFeatures: [GATED_AGENT_FEATURE, AGENT_RUN_FEATURE],
        scopes: ['agent:support.policy_check'],
      })
      const scopedMint = await mintAgentToken(request, scoped)
      test.skip(scopedMint.status === 429, TOKEN_RATE_LIMIT_SKIP_REASON)
      expect(scopedMint.status).toBe(200)
      expect(scopedMint.scope).toBe('agent:support.policy_check')

      const outOfScope = await postAgentApiRun(request, scopedMint.accessToken)
      const outOfScopeRaw = await outOfScope.text()
      expect(outOfScope.status(), outOfScopeRaw).toBe(403)
      const outOfScopeBody = JSON.parse(outOfScopeRaw) as DoorBody
      expect(outOfScopeBody.code).toBe(INVOKE_DENIED_CODE)
      expect(outOfScopeBody.agentId).toBe(GATED_AGENT_ID)

      unprivileged = await createExternalAgentClient(request, adminToken, adminScope(adminToken), {
        label: 'no-agent-feature',
        roleFeatures: [AGENT_RUN_FEATURE],
        scopes: [AGENT_API_RUN_SCOPE],
      })
      const unprivilegedMint = await mintAgentToken(request, unprivileged)
      test.skip(unprivilegedMint.status === 429, TOKEN_RATE_LIMIT_SKIP_REASON)
      expect(unprivilegedMint.status).toBe(200)

      const denied = await postAgentApiRun(request, unprivilegedMint.accessToken)
      const deniedRaw = await denied.text()
      expect(denied.status(), deniedRaw).toBe(403)
      const deniedBody = JSON.parse(deniedRaw) as DoorBody
      expect(deniedBody.code).toBe(INVOKE_DENIED_CODE)
      expect(deniedBody.agentId).toBe(GATED_AGENT_ID)
      expect(deniedRaw, 'the agent required features are never echoed').not.toContain(GATED_AGENT_FEATURE)
    } finally {
      await deleteExternalAgentClient(request, adminToken, scoped)
      await deleteExternalAgentClient(request, adminToken, unprivileged)
    }
  })

  test('runs the agent for a valid token whose principal holds the agent feature', async ({ request }) => {
    test.slow()
    test.skip(!(await isDoorEnabled(request)), DISABLED_DOOR_SKIP_REASON)
    const adminToken = await getAuthToken(request, 'admin')
    let client: ExternalAgentClient | null = null
    const runIds: string[] = []
    try {
      client = await createExternalAgentClient(request, adminToken, adminScope(adminToken), {
        label: 'valid',
        roleFeatures: [GATED_AGENT_FEATURE, AGENT_RUN_FEATURE],
        scopes: [`agent:${GATED_AGENT_ID}`],
      })
      const minted = await mintAgentToken(request, client)
      test.skip(minted.status === 429, TOKEN_RATE_LIMIT_SKIP_REASON)
      expect(minted.status).toBe(200)

      const response = await postAgentApiRun(request, minted.accessToken)
      const raw = await response.text()
      expect([401, 403], `the door accepts the token: ${raw}`).not.toContain(response.status())
      const body = (raw ? JSON.parse(raw) : {}) as DoorBody
      if (typeof body.runId === 'string') runIds.push(body.runId)
      test.skip(isModelUnavailableResponse(response.status()), NO_LLM_PROVIDER_SKIP_REASON)
      expect(response.status(), raw).toBe(200)
      expect(typeof body.runId).toBe('string')
    } finally {
      await deleteAgentRunsWithTraceByIds(runIds).catch(() => undefined)
      await deleteExternalAgentClient(request, adminToken, client)
    }
  })
})
