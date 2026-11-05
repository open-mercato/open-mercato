import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { ScimTokenService } from '../../../../services/scimTokenService'
import { resolveSsoAdminContext } from '../../../admin-context'
import { handleSsoAdminApiError } from '../../../error-handler'

export const metadata = {
  DELETE: { requireAuth: true, requireFeatures: ['sso.scim.manage'] },
}

type RouteContext = { params: Promise<{ id: string }> }

export async function DELETE(req: Request, ctx: RouteContext) {
  try {
    const { id } = await ctx.params
    const { scope } = await resolveSsoAdminContext(req)

    const container = await createRequestContainer()
    const service = container.resolve<ScimTokenService>('scimTokenService')
    await service.revokeToken(id, scope)

    return NextResponse.json({ ok: true })
  } catch (err) {
    return handleSsoAdminApiError(err, 'SCIM Tokens API')
  }
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
