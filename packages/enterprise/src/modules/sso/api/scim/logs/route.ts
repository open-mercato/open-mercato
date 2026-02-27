import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { ScimProvisioningLog } from '../../../data/entities'
import { resolveSsoAdminContext, SsoAdminAuthError } from '../../admin-context'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['sso.config.view'] },
}

export async function GET(req: Request) {
  try {
    const { scope } = await resolveSsoAdminContext(req)

    const url = new URL(req.url)
    const ssoConfigId = url.searchParams.get('ssoConfigId')
    if (!ssoConfigId) {
      return NextResponse.json({ error: 'ssoConfigId is required' }, { status: 400 })
    }

    const where: Record<string, unknown> = { ssoConfigId }
    if (!scope.isSuperAdmin && scope.organizationId) {
      where.organizationId = scope.organizationId
    }

    const container = await createRequestContainer()
    const em = container.resolve<EntityManager>('em')

    const logs = await em.find(ScimProvisioningLog, where, {
      orderBy: { createdAt: 'desc' },
      limit: 50,
    })

    return NextResponse.json({
      items: logs.map((log) => ({
        id: log.id,
        operation: log.operation,
        resourceType: log.resourceType,
        resourceId: log.resourceId,
        scimExternalId: log.scimExternalId,
        responseStatus: log.responseStatus,
        errorMessage: log.errorMessage,
        createdAt: log.createdAt.toISOString(),
      })),
    })
  } catch (err) {
    if (err instanceof SsoAdminAuthError || (err as any)?.name === 'SsoAdminAuthError') {
      return NextResponse.json({ error: (err as any).message }, { status: (err as any).statusCode })
    }
    console.error('[SCIM Logs API] Error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'SCIM',
  summary: 'SCIM Provisioning Logs',
  methods: {
    GET: {
      summary: 'List recent provisioning log entries',
      description: 'Returns the last 50 SCIM provisioning log entries for a given SSO config.',
      tags: ['SSO', 'SCIM'],
      responses: [{ status: 200, description: 'List of provisioning log entries' }],
      errors: [
        { status: 400, description: 'Missing ssoConfigId' },
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Forbidden — requires sso.scim.manage' },
      ],
    },
  },
}
