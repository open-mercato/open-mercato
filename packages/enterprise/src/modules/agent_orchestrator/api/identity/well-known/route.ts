import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { agentAuthDiscoverySchema } from '../../../data/validators'
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
 */
export const metadata = {
  GET: {},
}

export async function GET() {
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
    },
  },
}
