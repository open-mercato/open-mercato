import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { ScimTokenService, ScimTokenError } from '../../../services/scimTokenService'
import { createScimTokenSchema, scimTokenListSchema } from '../../../data/validators'
import { resolveSsoAdminContext, SsoAdminAuthError } from '../../admin-context'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['sso.config.view'] },
  POST: { requireAuth: true, requireFeatures: ['sso.scim.manage'] },
}

export async function GET(req: Request) {
  try {
    const { scope } = await resolveSsoAdminContext(req)

    const url = new URL(req.url)
    const parsed = scimTokenListSchema.safeParse({
      ssoConfigId: url.searchParams.get('ssoConfigId') ?? undefined,
    })
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
    }

    const container = await createRequestContainer()
    const service = container.resolve<ScimTokenService>('scimTokenService')
    const tokens = await service.listTokens(parsed.data.ssoConfigId, scope)

    return NextResponse.json({ items: tokens })
  } catch (err) {
    return handleError(err)
  }
}

export async function POST(req: Request) {
  try {
    const { scope } = await resolveSsoAdminContext(req)

    const body = await req.json()
    const parsed = createScimTokenSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
    }

    const container = await createRequestContainer()
    const service = container.resolve<ScimTokenService>('scimTokenService')
    const result = await service.generateToken(parsed.data.ssoConfigId, parsed.data.name, scope)

    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    return handleError(err)
  }
}

function handleError(err: unknown): NextResponse {
  const e = err as any
  if (err instanceof SsoAdminAuthError || e?.name === 'SsoAdminAuthError') {
    return NextResponse.json({ error: e.message }, { status: e.statusCode })
  }
  if (err instanceof ScimTokenError || e?.name === 'ScimTokenError') {
    return NextResponse.json({ error: e.message }, { status: e.statusCode })
  }
  console.error('[SCIM Tokens API] Error:', err)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'SSO',
  summary: 'SCIM Token Management',
  methods: {
    GET: {
      summary: 'List SCIM tokens',
      description: 'Returns SCIM tokens for a given SSO config. Token hashes are never exposed.',
      tags: ['SSO', 'SCIM'],
      responses: [{ status: 200, description: 'List of SCIM tokens' }],
      errors: [
        { status: 400, description: 'Missing or invalid ssoConfigId' },
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Forbidden — requires sso.scim.manage' },
      ],
    },
    POST: {
      summary: 'Create SCIM token',
      description: 'Generates a new SCIM bearer token. The raw token is returned once and cannot be retrieved again.',
      tags: ['SSO', 'SCIM'],
      requestBody: {
        contentType: 'application/json',
        schema: createScimTokenSchema,
      },
      responses: [{ status: 201, description: 'SCIM token created — raw token included in response' }],
      errors: [
        { status: 400, description: 'Invalid input' },
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Forbidden — requires sso.scim.manage' },
        { status: 409, description: 'Conflict — cannot create SCIM token while JIT is enabled' },
      ],
    },
  },
}
