import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { ScimTokenService, ScimTokenError } from '../../../../services/scimTokenService'
import { resolveSsoAdminContext, SsoAdminAuthError } from '../../../admin-context'

export const metadata = {
  DELETE: { requireAuth: true, requireFeatures: ['sso.scim.manage'] },
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  try {
    const { scope } = await resolveSsoAdminContext(req)

    const container = await createRequestContainer()
    const service = container.resolve<ScimTokenService>('scimTokenService')
    await service.revokeToken(params.id, scope)

    return NextResponse.json({ ok: true })
  } catch (err) {
    return handleError(err)
  }
}

function handleError(err: unknown): NextResponse {
  if (err instanceof SsoAdminAuthError) {
    return NextResponse.json({ error: err.message }, { status: err.statusCode })
  }
  if (err instanceof ScimTokenError) {
    return NextResponse.json({ error: err.message }, { status: err.statusCode })
  }
  console.error('[SCIM Tokens API] Error:', err)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'SSO',
  summary: 'SCIM Token by ID',
  methods: {
    DELETE: {
      summary: 'Revoke SCIM token',
      description: 'Revokes (deactivates) a SCIM token. The token can no longer be used for authentication.',
      tags: ['SSO', 'SCIM'],
      responses: [{ status: 200, description: 'Token revoked' }],
      errors: [
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Forbidden — requires sso.scim.manage' },
        { status: 404, description: 'Token not found' },
      ],
    },
  },
}
