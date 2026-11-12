import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readEndpointRateLimitConfig } from '@open-mercato/shared/lib/ratelimit/config'
import { rateLimitErrorSchema } from '@open-mercato/shared/lib/ratelimit/helpers'
import { agentAuthDiscoverySchema } from '../../../data/validators'
import { enforcePublicEndpointRateLimit } from '../../../lib/guardrails/publicEndpointRateLimit'
import { getAgentAuthDiscovery } from '../../../lib/identity/agentAuthMdService'

/**
 * Public agent-auth discovery endpoint (auth.md / ID-JAG self-registration, Wave 4
 * Phase 4). A read-only GET that advertises the platform's agent-auth metadata —
 * the token + agent-auth endpoints, the supported grant types (client-credentials
 * now + the ID-JAG / JWT-bearer flow), and the audience an external assertion must
 * target — so an external agent can self-onboard at scale. Additive and secret-free:
 * no issuer keys / JWKS / credentials are exposed (the platform validates an
 * assertion server-side against its trusted-issuer registry, so there is no
 * client-fetched verification material to leak). Like the `/token` endpoint it is
 * unauthenticated — discovery metadata is intentionally public.
 *
 * Rate-limited per client IP on a deliberately looser ceiling than the credential
 * endpoints: it verifies nothing and writes nothing, so the limit exists to bound
 * the unauthenticated request volume, not a guessing oracle.
 */
export const metadata = {
  GET: {},
}

const identityWellKnownRateLimitConfig = readEndpointRateLimitConfig('AGENT_ORCH_IDENTITY_WELL_KNOWN', {
  points: 60,
  duration: 60,
  keyPrefix: 'agent_orchestrator:identity_well_known',
})

export async function GET(req: Request) {
  const container = await createRequestContainer()
  const rateLimited = await enforcePublicEndpointRateLimit(container, req, identityWellKnownRateLimitConfig)
  if (rateLimited) return rateLimited

  return NextResponse.json(getAgentAuthDiscovery())
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Agent Orchestrator',
  summary: 'Agent-auth discovery metadata',
  methods: {
    GET: {
      summary: 'Discover the agent-auth endpoints and supported grant types',
      description:
        'Public, read-only agent-auth discovery metadata for external-agent onboarding at scale: the token + agent-auth endpoints, the supported grant types (client_credentials + the ID-JAG / JWT-bearer flow), and the assertion audience an external ID-JAG assertion must target. Contains no secrets, issuer keys, or JWKS.',
      responses: [
        { status: 200, description: 'The agent-auth discovery metadata', schema: agentAuthDiscoverySchema },
      ],
      errors: [
        { status: 429, description: 'Too many discovery requests from this client IP', schema: rateLimitErrorSchema },
        { status: 503, description: 'Rate limiter unavailable — the request is refused rather than left uncounted', schema: rateLimitErrorSchema },
      ],
    },
  },
}
