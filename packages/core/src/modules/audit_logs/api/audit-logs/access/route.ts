import { NextResponse } from 'next/server'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { resolveFeatureCheckContext } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { AccessLogService } from '@open-mercato/core/modules/audit_logs/services/accessLogService'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['audit_logs.view_self'] },
}

function parseDate(value: string | null): Date | undefined {
  if (!value) return undefined
  const ts = Date.parse(value)
  if (Number.isNaN(ts)) return undefined
  return new Date(ts)
}

function parseLimit(param: string | null): number {
  if (!param) return 50
  const value = Number(param)
  if (!Number.isFinite(value)) return 50
  return Math.min(Math.max(Math.trunc(value), 1), 200)
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const container = await createRequestContainer()
  const { organizationId: defaultOrganizationId, scope } = await resolveFeatureCheckContext({ container, auth, request: req })

  const rbac = container.resolve<RbacService>('rbacService')
  const accessLogs = container.resolve<AccessLogService>('accessLogService')

  const canViewTenant = await rbac.userHasAllFeatures(
    auth.sub,
    ['audit_logs.view_tenant'],
    { tenantId: auth.tenantId ?? null, organizationId: defaultOrganizationId ?? null },
  )

  const url = new URL(req.url)
  const queryOrgId = url.searchParams.get('organizationId')
  const actorQuery = url.searchParams.get('actorUserId')
  const resourceKind = url.searchParams.get('resourceKind')
  const accessType = url.searchParams.get('accessType')
  const limit = parseLimit(url.searchParams.get('limit'))
  const before = parseDate(url.searchParams.get('before'))
  const after = parseDate(url.searchParams.get('after'))

  let organizationId = defaultOrganizationId
  if (queryOrgId) {
    if (scope.allowedIds === null || scope.allowedIds.includes(queryOrgId)) {
      organizationId = queryOrgId
    }
  }

  let actorUserId = auth.sub
  if (canViewTenant && actorQuery) {
    actorUserId = actorQuery
  }

  const list = await accessLogs.list({
    tenantId: auth.tenantId ?? undefined,
    organizationId: organizationId ?? undefined,
    actorUserId,
    resourceKind: resourceKind ?? undefined,
    accessType: accessType ?? undefined,
    limit,
    before,
    after,
  })

  const items = list.map((entry) => ({
    id: entry.id,
    resourceKind: entry.resourceKind,
    resourceId: entry.resourceId,
    accessType: entry.accessType,
    actorUserId: entry.actorUserId,
    tenantId: entry.tenantId,
    organizationId: entry.organizationId,
    fields: entry.fieldsJson ?? [],
    context: entry.contextJson,
    createdAt: entry.createdAt,
  }))

  return NextResponse.json({ items, canViewTenant })
}
