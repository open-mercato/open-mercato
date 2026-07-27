import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import {
  idJagTokenRequestSchema,
  oauthTokenResponseSchema,
} from '../../../../data/validators'
import {
  registerAgentViaIdJag,
  verifyIdJagAssertion,
} from '../../../../lib/identity/agentAuthMdService'
import { emitAgentOrchestratorEvent } from '../../../../events'

/**
 * ID-JAG / JWT-bearer self-registration endpoint (RFC 7523 §2.1) for EXTERNAL
 * agents (auth.md, Wave 4 Phase 4). Authenticated by the issuer-signed assertion
 * itself — no staff session — so it declares no `requireAuth` (like the
 * client-credentials `/token` endpoint). It validates the assertion's issuer +
 * audience + signature server-side against the trusted-issuer registry, onboards
 * the agent idempotently to a scoped `AgentPrincipal` (`credentialMode='authmd'`)
 * + an `AgentDelegationGrant` (issuer/subject/audience populated), then mints a
 * scoped, revocable, audience-bound token via the SAME mint core the `/token`
 * server uses. tenant/org/scope are derived from the SIGNED assertion + resolved
 * grant — never from request input. An invalid/forged/wrong-audience assertion →
 * a single minimal 401 (`invalid_grant`), never revealing whether the issuer or
 * subject exists. The raw assertion is never logged.
 */
export const metadata = {
  POST: {},
}

const oauthErrorSchema = z.object({ error: z.string() })

export async function POST(req: Request) {
  const body = await readJsonSafe(req, {})
  const parsed = idJagTokenRequestSchema.safeParse(body)
  if (!parsed.success) {
    const isBadGrant = parsed.error.issues.some((issue) => issue.path[0] === 'grant_type')
    return NextResponse.json(
      { error: isBadGrant ? 'unsupported_grant_type' : 'invalid_request' },
      { status: 400 },
    )
  }

  const claims = verifyIdJagAssertion(parsed.data.assertion)
  if (!claims) {
    // Invalid signature / unknown issuer / wrong audience → single minimal 401.
    return NextResponse.json({ error: 'invalid_grant' }, { status: 401 })
  }

  const container = await createRequestContainer()
  const result = await registerAgentViaIdJag(container, claims, parsed.data.scope)
  if (!result) {
    return NextResponse.json({ error: 'invalid_grant' }, { status: 401 })
  }

  await emitAgentOrchestratorEvent(
    'agent_orchestrator.agent_principal.registered',
    {
      agentPrincipalId: result.principal.id,
      grantId: result.grant.id,
      issuer: claims.iss,
      tenantId: result.principal.tenantId,
      organizationId: result.principal.organizationId,
    },
    { persistent: true },
  )

  return NextResponse.json({
    access_token: result.token.accessToken,
    token_type: 'Bearer',
    expires_in: result.token.expiresInSeconds,
    scope: result.token.scope,
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Agent Orchestrator',
  summary: 'External-agent ID-JAG self-registration + token',
  methods: {
    POST: {
      summary: 'Onboard an external agent from an issuer-signed assertion and mint a scoped token',
      description:
        'RFC 7523 JWT-bearer grant for external-agent self-registration at scale. Validates the issuer-signed ID-JAG assertion (issuer + audience + signature, server-side against the trusted-issuer registry), idempotently onboards the agent to a scoped AgentPrincipal (credentialMode=authmd) + an AgentDelegationGrant (issuer/subject/audience populated), then mints a short-lived, revocable agent token via the same mint path the client-credentials /token server uses. tenant/org/scope are derived from the signed assertion + grant, never widenable by the caller. An invalid/forged/wrong-audience assertion returns a single minimal 401 with no info leak.',
      requestBody: {
        contentType: 'application/json',
        schema: idJagTokenRequestSchema,
        description: 'The JWT-bearer grant request (grant_type, the issuer-signed assertion, optional scope).',
      },
      responses: [
        { status: 200, description: 'The minted access token', schema: oauthTokenResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Malformed request or unsupported grant_type', schema: oauthErrorSchema },
        { status: 401, description: 'Invalid, forged, or wrong-audience assertion', schema: oauthErrorSchema },
      ],
    },
  },
}
