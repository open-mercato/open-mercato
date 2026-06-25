import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import {
  oauthTokenRequestSchema,
  oauthTokenResponseSchema,
} from '../../../data/validators'
import { issueAgentToken } from '../../../lib/identity/agentTokenService'

/**
 * OAuth 2.0 client-credentials token endpoint (RFC 6749 §4.4) for EXTERNAL agents
 * (Wave 4 Phase 3). It is authenticated by the client credentials themselves — no
 * staff session — so it deliberately declares no `requireAuth`. The client_id is
 * an external agent principal id; org/tenant/scope are derived server-side from
 * the resolved principal + its active AgentDelegationGrant and are never read from
 * client input (a client cannot widen tenant or capability). On success it mints a
 * short-lived, revocable, audience-bound JWT. Invalid credentials / inactive grant
 * → a single minimal 401 (`invalid_client`), never revealing whether the client id
 * exists. No secret is ever echoed; credentials are never logged.
 */
export const metadata = {
  POST: {},
}

const oauthErrorSchema = z.object({ error: z.string() })

export async function POST(req: Request) {
  const body = await readJsonSafe(req, {})
  const parsed = oauthTokenRequestSchema.safeParse(body)
  if (!parsed.success) {
    // RFC 6749 §5.2: malformed request → invalid_request (still no info leak).
    const isBadGrant = parsed.error.issues.some((issue) => issue.path[0] === 'grant_type')
    return NextResponse.json(
      { error: isBadGrant ? 'unsupported_grant_type' : 'invalid_request' },
      { status: 400 },
    )
  }

  const container = await createRequestContainer()
  const result = await issueAgentToken(container, {
    clientId: parsed.data.client_id,
    clientSecret: parsed.data.client_secret,
    requestedScope: parsed.data.scope,
  })

  if (!result) {
    // Minimal error — never reveal whether the client id exists.
    return NextResponse.json({ error: 'invalid_client' }, { status: 401 })
  }

  return NextResponse.json({
    access_token: result.accessToken,
    token_type: 'Bearer',
    expires_in: result.expiresInSeconds,
    scope: result.scope,
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Agent Orchestrator',
  summary: 'External-agent OAuth client-credentials token',
  methods: {
    POST: {
      summary: 'Mint a scoped, revocable agent access token',
      description:
        'OAuth 2.0 client-credentials grant for external agents. Validates the client_id/client_secret against an external (oauth_client) AgentPrincipal with an active (non-revoked, non-expired) AgentDelegationGrant, then mints a short-lived audience-bound JWT scoped to the grant capability + the principal tenant/org (both server-derived, never widenable by the client). Invalid credentials or an inactive grant return a single minimal 401 with no info leak.',
      requestBody: {
        contentType: 'application/json',
        schema: oauthTokenRequestSchema,
        description: 'The client-credentials grant request (grant_type, client_id, client_secret, optional scope).',
      },
      responses: [
        { status: 200, description: 'The minted access token', schema: oauthTokenResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Malformed request or unsupported grant_type', schema: oauthErrorSchema },
        { status: 401, description: 'Invalid client credentials or inactive grant', schema: oauthErrorSchema },
      ],
    },
  },
}
